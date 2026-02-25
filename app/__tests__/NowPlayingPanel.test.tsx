import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {NowPlayingPanel} from '../src/features/playback/NowPlayingPanel';
import {ThemeProvider} from '../src/ui/themeRuntime';
import {MediaStoreTrack} from '../src/native/modules';

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

describe('NowPlayingPanel', () => {
  const onSeekBy = jest.fn();
  const onCycleEndMode = jest.fn();
  const onToggleRandomEnabled = jest.fn();

  const renderPanel = (node: React.ReactElement) => ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('triggers random and repeat mode buttons', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderPanel(
        <NowPlayingPanel
          currentTrack={baseTrack}
          isPlaying={true}
          positionMs={0}
          durationMs={200000}
          endMode="repeat_one"
          randomEnabled={true}
          onTogglePlayPause={async () => {}}
          onNext={async () => {}}
          onPrevious={async () => {}}
          onSeekBy={onSeekBy}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          queueToolsOpen={false}
          onToggleQueueTools={() => {}}
          seekStepMs={10000}
        />,
      );
    });

    const randomButton = renderer!.root.findByProps({testID: 'nowplaying-mode-random'});
    const repeatButton = renderer!.root.findByProps({testID: 'nowplaying-mode-repeat'});

    await ReactTestRenderer.act(async () => {
      randomButton.props.onPress();
      repeatButton.props.onPress();
    });

    expect(onToggleRandomEnabled).toHaveBeenCalledTimes(1);
    expect(onCycleEndMode).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  test('seeks with correct delta from scrubber release', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderPanel(
        <NowPlayingPanel
          currentTrack={baseTrack}
          isPlaying={true}
          positionMs={5000}
          durationMs={10000}
          endMode="stop"
          randomEnabled={false}
          onTogglePlayPause={async () => {}}
          onNext={async () => {}}
          onPrevious={async () => {}}
          onSeekBy={onSeekBy}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          queueToolsOpen={false}
          onToggleQueueTools={() => {}}
          seekStepMs={10000}
        />,
      );
    });

    const progressTrack = renderer!.root.findByProps({testID: 'nowplaying-progress-track'});

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onLayout({nativeEvent: {layout: {width: 100}}});
    });

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onResponderGrant({nativeEvent: {locationX: 90}});
      progressTrack.props.onResponderRelease({nativeEvent: {locationX: 90}});
    });

    expect(onSeekBy).toHaveBeenCalledWith(4000);

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  test('clears scrub preview when track changes', async () => {
    const secondTrack = {...baseTrack, uri: 'content://track/2', title: 'Track 2', durationMs: 5000};

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = renderPanel(
        <NowPlayingPanel
          currentTrack={baseTrack}
          isPlaying={true}
          positionMs={1000}
          durationMs={10000}
          endMode="stop"
          randomEnabled={false}
          onTogglePlayPause={async () => {}}
          onNext={async () => {}}
          onPrevious={async () => {}}
          onSeekBy={onSeekBy}
          onCycleEndMode={onCycleEndMode}
          onToggleRandomEnabled={onToggleRandomEnabled}
          queueToolsOpen={false}
          onToggleQueueTools={() => {}}
          seekStepMs={10000}
        />,
      );
    });

    const progressTrack = renderer!.root.findByProps({testID: 'nowplaying-progress-track'});

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onLayout({nativeEvent: {layout: {width: 100}}});
    });

    await ReactTestRenderer.act(async () => {
      progressTrack.props.onResponderGrant({nativeEvent: {locationX: 80}});
    });

    await ReactTestRenderer.act(async () => {
      renderer!.update(
        <ThemeProvider>
          <NowPlayingPanel
            currentTrack={secondTrack}
            isPlaying={true}
            positionMs={0}
            durationMs={5000}
            endMode="stop"
            randomEnabled={false}
            onTogglePlayPause={async () => {}}
            onNext={async () => {}}
            onPrevious={async () => {}}
            onSeekBy={onSeekBy}
            onCycleEndMode={onCycleEndMode}
            onToggleRandomEnabled={onToggleRandomEnabled}
            queueToolsOpen={false}
            onToggleQueueTools={() => {}}
            seekStepMs={10000}
          />
        </ThemeProvider>,
      );
    });

    const progressFill = renderer!.root.findByProps({testID: 'nowplaying-progress-fill'});
    const style = Array.isArray(progressFill.props.style) ? progressFill.props.style : [progressFill.props.style];
    const widthStyle = style.find((entry: {width?: string} | null | undefined) => entry && typeof entry.width === 'string');
    expect(widthStyle?.width).toBe('0%');

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });
});
