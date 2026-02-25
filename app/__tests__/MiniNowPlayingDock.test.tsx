import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';

import {MiniNowPlayingDock} from '../src/ui/components/MiniNowPlayingDock';
import {MediaStoreTrack} from '../src/native/modules';
import {ThemeProvider} from '../src/ui/themeRuntime';

const baseTrack: MediaStoreTrack = {
  uri: 'content://track/1',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  durationMs: 200000,
  mimeType: 'audio/mpeg',
  sizeBytes: 1000,
  dateModifiedEpochSeconds: 0,
  displayName: 'test.mp3',
  relativePath: 'Music/',
};

describe('MiniNowPlayingDock', () => {
  const onSeekBy = jest.fn();
  const onNext = jest.fn();
  const onPrevious = jest.fn();
  const onCycleEndMode = jest.fn();
  const onToggleRandomEnabled = jest.fn();

  const renderDock = (node: React.ReactElement) => ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('renders always-visible empty state when no track is available', async () => {
    jest.useFakeTimers();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderDock(
        <MiniNowPlayingDock
          isPlaying={false}
          positionMs={0}
          durationMs={0}
          endMode="stop"
          randomEnabled={false}
          onSeekBy={onSeekBy}
          onNext={onNext}
          onPrevious={onPrevious}
          onTogglePlayPause={() => {}}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          onOpenNowPlaying={() => {}}
        />,
      );
    });

    const output = renderer!.root;
    expect(output.findByProps({children: 'Nothing Playing'})).toBeTruthy();
    expect(output.findByProps({children: 'OPEN'})).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  test('does not invoke open callback when empty-state primary control is pressed', async () => {
    jest.useFakeTimers();
    const onOpenNowPlaying = jest.fn();

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderDock(
        <MiniNowPlayingDock
          isPlaying={false}
          positionMs={0}
          durationMs={0}
          endMode="stop"
          randomEnabled={false}
          onSeekBy={onSeekBy}
          onNext={onNext}
          onPrevious={onPrevious}
          onTogglePlayPause={() => {}}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          onOpenNowPlaying={onOpenNowPlaying}
        />,
      );
    });

    const controls = renderer!.root.findAll(node => node.props?.accessibilityRole === 'button');
    const primaryControl = controls.find(node => node.findAllByType(Text).some(textNode => textNode.props.children === 'OPEN'));
    expect(primaryControl).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      primaryControl!.props.onPress();
    });

    expect(onOpenNowPlaying).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  test('reports and renders playback error when toggle fails', async () => {
    jest.useFakeTimers();
    const onReportError = jest.fn();
    const failingToggle = jest.fn().mockRejectedValue(new Error('Native player unavailable'));

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderDock(
        <MiniNowPlayingDock
          currentTrack={baseTrack}
          isPlaying={false}
          positionMs={1000}
          durationMs={200000}
          endMode="stop"
          randomEnabled={false}
          onSeekBy={onSeekBy}
          onNext={onNext}
          onPrevious={onPrevious}
          onTogglePlayPause={failingToggle}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          onOpenNowPlaying={() => {}}
          onReportError={onReportError}
        />,
      );
    });

    const controls = renderer!.root.findAll(node => node.props?.accessibilityRole === 'button');
    const playButton = controls.find(node => node.findAllByType(Text).some(textNode => textNode.props.children === '▶'));
    expect(playButton).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      await playButton!.props.onPress();
    });

    expect(failingToggle).toHaveBeenCalledTimes(1);
    expect(onReportError).toHaveBeenCalledTimes(1);
    const reported = onReportError.mock.calls[0][0] as string;
    expect(reported).toContain('Mini player action failed');
    expect(reported).toContain('Native player unavailable');

    const errorTexts = renderer!.root.findAllByType(Text).map(node => node.props.children).flat();
    expect(errorTexts.join(' ')).toContain('Mini player action failed: Native player unavailable');

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  test('fires playback mode callbacks from random and repeat buttons', async () => {
    jest.useFakeTimers();

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderDock(
        <MiniNowPlayingDock
          currentTrack={baseTrack}
          isPlaying={true}
          positionMs={0}
          durationMs={200000}
          endMode="repeat_all"
          randomEnabled={true}
          onSeekBy={onSeekBy}
          onNext={onNext}
          onPrevious={onPrevious}
          onTogglePlayPause={() => {}}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          onOpenNowPlaying={() => {}}
        />,
      );
    });

    expect(renderer!.root.findByProps({children: '↭'})).toBeTruthy();
    expect(renderer!.root.findByProps({children: '↺'})).toBeTruthy();

    const randomButton = renderer!.root.findByProps({testID: 'mini-mode-random'});
    const repeatButton = renderer!.root.findByProps({testID: 'mini-mode-repeat'});

    await ReactTestRenderer.act(async () => {
      randomButton!.props.onPress();
      repeatButton!.props.onPress();
    });

    expect(onToggleRandomEnabled).toHaveBeenCalledTimes(1);
    expect(onCycleEndMode).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  test('seeks based on scrub release delta', async () => {
    jest.useFakeTimers();

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderDock(
        <MiniNowPlayingDock
          currentTrack={baseTrack}
          isPlaying={true}
          positionMs={10000}
          durationMs={20000}
          endMode="stop"
          randomEnabled={false}
          onSeekBy={onSeekBy}
          onNext={onNext}
          onPrevious={onPrevious}
          onTogglePlayPause={() => {}}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          onOpenNowPlaying={() => {}}
        />,
      );
    });

    const progressTrack = renderer!.root.findByProps({testID: 'mini-progress-track'});

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onLayout({nativeEvent: {layout: {width: 100}}});
    });

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onResponderGrant({nativeEvent: {locationX: 75}});
      progressTrack.props.onResponderRelease({nativeEvent: {locationX: 75}});
    });

    expect(onSeekBy).toHaveBeenCalledWith(5000);

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  test('resets scrub preview when track changes', async () => {
    jest.useFakeTimers();
    const secondTrack = {...baseTrack, uri: 'content://track/2', title: 'Track 2', durationMs: 5000};

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderDock(
        <MiniNowPlayingDock
          currentTrack={baseTrack}
          isPlaying={true}
          positionMs={1000}
          durationMs={10000}
          endMode="stop"
          randomEnabled={false}
          onSeekBy={onSeekBy}
          onNext={onNext}
          onPrevious={onPrevious}
          onTogglePlayPause={() => {}}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          onOpenNowPlaying={() => {}}
        />,
      );
    });

    const progressTrack = renderer!.root.findByProps({testID: 'mini-progress-track'});

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onLayout({nativeEvent: {layout: {width: 100}}});
    });

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onResponderGrant({nativeEvent: {locationX: 80}});
      progressTrack.props.onResponderMove({nativeEvent: {locationX: 80}});
    });

    const beforeFill = renderer!.root.findByProps({testID: 'mini-progress-fill'});
    const beforeStyle = Array.isArray(beforeFill.props.style) ? beforeFill.props.style : [beforeFill.props.style];
    const beforeWidthStyle = beforeStyle.find((entry: {width?: string} | null | undefined) => entry && typeof entry.width === 'string');
    expect(beforeWidthStyle?.width).toBe('80%');

    await ReactTestRenderer.act(async () => {
      renderer!.update(
        <ThemeProvider>
          <MiniNowPlayingDock
            currentTrack={secondTrack}
            isPlaying={true}
            positionMs={0}
            durationMs={5000}
            endMode="stop"
            randomEnabled={false}
            onSeekBy={onSeekBy}
            onNext={onNext}
            onPrevious={onPrevious}
            onTogglePlayPause={() => {}}
            onCycleEndMode={onCycleEndMode}
            onToggleRandomEnabled={onToggleRandomEnabled}
            onOpenNowPlaying={() => {}}
          />
        </ThemeProvider>,
      );
    });

    const progressFill = renderer!.root.findByProps({testID: 'mini-progress-fill'});
    const style = Array.isArray(progressFill.props.style) ? progressFill.props.style : [progressFill.props.style];
    const widthStyle = style.find((entry: {width?: string} | null | undefined) => entry && typeof entry.width === 'string');
    expect(widthStyle?.width).toBe('0%');

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });
});
