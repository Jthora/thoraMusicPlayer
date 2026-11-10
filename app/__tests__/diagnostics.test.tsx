import React from 'react';
import {Text} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {AppErrorBoundary} from '../src/app/AppErrorBoundary';
import {
  describeError,
  installGlobalErrorLogging,
  markAppReady,
  resetDiagnosticsForTests,
} from '../src/platform/diagnostics';

type Handler = (error: unknown, isFatal?: boolean) => void;

function fakeErrorUtils() {
  const previous = jest.fn<void, [unknown, boolean | undefined]>();
  let current: Handler = previous;
  return {
    previous,
    errorUtils: {
      getGlobalHandler: () => current,
      setGlobalHandler: (next: Handler) => {
        current = next;
      },
    },
    fire: (error: unknown, isFatal: boolean) => current(error, isFatal),
  };
}

describe('installGlobalErrorLogging (release policy)', () => {
  beforeEach(() => resetDiagnosticsForTests());

  it('lets fatal errors before the UI mounts reach the default handler', () => {
    const utils = fakeErrorUtils();
    installGlobalErrorLogging({errorUtils: utils.errorUtils, isDev: false, now: () => 0});
    utils.fire(new Error('boot failure'), true);
    expect(utils.previous).toHaveBeenCalledTimes(1);
  });

  it('survives an isolated fatal error after mount, so playback keeps running', () => {
    const utils = fakeErrorUtils();
    installGlobalErrorLogging({errorUtils: utils.errorUtils, isDev: false, now: () => 0});
    markAppReady();
    utils.fire(new Error('onPress threw'), true);
    expect(utils.previous).not.toHaveBeenCalled();
  });

  it('hands an error storm to the default handler so the app restarts clean', () => {
    const utils = fakeErrorUtils();
    let clock = 0;
    installGlobalErrorLogging({errorUtils: utils.errorUtils, isDev: false, now: () => clock});
    markAppReady();
    for (let i = 0; i < 4; i += 1) {
      clock += 1_000;
      utils.fire(new Error(`loop ${i}`), true);
    }
    expect(utils.previous).toHaveBeenCalledTimes(1);
  });

  it('forgets old errors outside the storm window', () => {
    const utils = fakeErrorUtils();
    let clock = 0;
    installGlobalErrorLogging({errorUtils: utils.errorUtils, isDev: false, now: () => clock});
    markAppReady();
    for (let i = 0; i < 6; i += 1) {
      clock += 6_000;
      utils.fire(new Error(`sparse ${i}`), true);
    }
    expect(utils.previous).not.toHaveBeenCalled();
  });

  it('always defers to the default handler in dev and for non-fatal errors', () => {
    const dev = fakeErrorUtils();
    installGlobalErrorLogging({errorUtils: dev.errorUtils, isDev: true, now: () => 0});
    markAppReady();
    dev.fire(new Error('dev'), true);
    expect(dev.previous).toHaveBeenCalledTimes(1);

    resetDiagnosticsForTests();
    const release = fakeErrorUtils();
    installGlobalErrorLogging({errorUtils: release.errorUtils, isDev: false, now: () => 0});
    markAppReady();
    release.fire(new Error('soft'), false);
    expect(release.previous).toHaveBeenCalledTimes(1);
  });

  it('tracks unhandled promise rejections only in release', () => {
    const tracker = jest.fn();
    installGlobalErrorLogging({errorUtils: fakeErrorUtils().errorUtils, hermes: {enablePromiseRejectionTracker: tracker}, isDev: false});
    expect(tracker).toHaveBeenCalledWith(expect.objectContaining({allRejections: true}));
  });
});

describe('describeError', () => {
  it('handles errors, strings and arbitrary values', () => {
    expect(describeError(new TypeError('bad')).message).toBe('TypeError: bad');
    expect(describeError('plain').message).toBe('plain');
    expect(describeError({code: 7}).message).toBe('{"code":7}');
  });
});

describe('AppErrorBoundary', () => {
  it('shows a fallback on render errors and rebuilds the tree on reload', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) {
        throw new Error('render exploded');
      }
      return <Text>healthy</Text>;
    }

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AppErrorBoundary>
          <Flaky />
        </AppErrorBoundary>,
      );
    });
    expect(renderer.root.findAllByProps({testID: 'app-error-fallback'}).length).toBeGreaterThan(0);

    shouldThrow = false;
    const reload = renderer.root.findAll(node => node.props.testID === 'app-error-reload' && typeof node.props.onPress === 'function')[0];
    await ReactTestRenderer.act(() => {
      reload.props.onPress();
    });
    expect(renderer.root.findAllByProps({testID: 'app-error-fallback'})).toHaveLength(0);
    expect(renderer.root.findByType(Text).props.children).toBe('healthy');
    consoleError.mockRestore();
  });
});
