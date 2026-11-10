import {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Pressable, StyleSheet, Text, View} from 'react-native';

import {MediaStoreTrack} from '../../native/modules';
import {EndMode} from './useNowPlayingState';
import {AppButton} from '../../ui/components/AppButton';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';

type NowPlayingPanelProps = {
  currentTrack?: MediaStoreTrack;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  endMode: EndMode;
  randomEnabled: boolean;
  onTogglePlayPause: () => Promise<void>;
  onNext: () => Promise<void>;
  onPrevious: () => Promise<void>;
  onSeekBy: (deltaMs: number) => void;
  onCycleEndMode: () => void;
  onToggleRandomEnabled: () => void;
  queueToolsOpen: boolean;
  onToggleQueueTools: () => void;
  seekStepMs: number;
};

function endModeLabel(mode: EndMode): string {
  if (mode === 'repeat_all') {
    return '↺';
  }

  if (mode === 'repeat_one') {
    return '↺1';
  }

  return '↺×';
}

function formatMs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function NowPlayingPanel(props: NowPlayingPanelProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    currentTrack,
    isPlaying,
    endMode,
    randomEnabled,
    positionMs,
    durationMs,
    onTogglePlayPause,
    onNext,
    onPrevious,
    onSeekBy,
    onCycleEndMode,
    onToggleRandomEnabled,
    queueToolsOpen,
    onToggleQueueTools,
  } = props;

  const [progressWidth, setProgressWidth] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPreviewMs, setScrubPreviewMs] = useState<number | null>(null);
  const artworkGlow = useRef(new Animated.Value(isPlaying ? 1 : 0.65)).current;

  const displayPositionMs = scrubPreviewMs ?? positionMs;
  const displayProgressRatio = durationMs > 0 ? Math.min(1, displayPositionMs / durationMs) : 0;

  useEffect(() => {
    if (!isPlaying || !currentTrack) {
      artworkGlow.stopAnimation();
      Animated.timing(artworkGlow, {
        toValue: 0.65,
        duration: 160,
        useNativeDriver: true,
      }).start();
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(artworkGlow, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(artworkGlow, {
          toValue: 0.72,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => {
      loop.stop();
    };
  }, [artworkGlow, currentTrack, isPlaying]);

  useEffect(() => {
    setIsScrubbing(false);
    setScrubPreviewMs(null);
  }, [currentTrack?.uri, durationMs]);

  const seekToTapPosition = (x: number) => {
    if (!currentTrack || durationMs <= 0 || progressWidth <= 0) {
      return;
    }

    const ratio = Math.min(1, Math.max(0, x / progressWidth));
    const targetMs = Math.floor(ratio * durationMs);
    onSeekBy(targetMs - positionMs);
  };

  const updateScrubPreview = (x: number) => {
    if (!currentTrack || durationMs <= 0 || progressWidth <= 0) {
      return;
    }

    const ratio = Math.min(1, Math.max(0, x / progressWidth));
    const targetMs = Math.floor(ratio * durationMs);
    setScrubPreviewMs(targetMs);
  };

  const commitScrub = (x: number) => {
    if (!currentTrack || durationMs <= 0 || progressWidth <= 0) {
      setIsScrubbing(false);
      setScrubPreviewMs(null);
      return;
    }

    const ratio = Math.min(1, Math.max(0, x / progressWidth));
    const targetMs = Math.floor(ratio * durationMs);
    onSeekBy(targetMs - positionMs);
    setIsScrubbing(false);
    setScrubPreviewMs(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Now Playing</Text>
        <Pressable onPress={onToggleQueueTools} style={styles.queueToggle}>
          <Text style={styles.queueToggleLabel}>{queueToolsOpen ? 'QUEUE ▾' : 'QUEUE ▸'}</Text>
        </Pressable>
      </View>
      <Animated.View style={[styles.artworkBox, isPlaying ? styles.artworkBoxActive : null, {opacity: artworkGlow}]}>
        <Text style={styles.artworkGlyph}>♪</Text>
      </Animated.View>
      <Text style={styles.trackTitle} numberOfLines={1}>{currentTrack?.title ?? 'No track selected'}</Text>
      <Text style={styles.meta} numberOfLines={1}>{currentTrack?.artist ?? 'Unknown artist'} • {currentTrack?.album ?? 'Unknown album'}</Text>
      <Text style={styles.metaSmall} numberOfLines={1}>{currentTrack?.displayName ?? 'Unknown file'}</Text>
      <Text style={styles.metaSmall} numberOfLines={1}>{currentTrack?.relativePath ?? 'Unknown folder'}</Text>
      <View style={styles.seekWrap}>
        <View style={styles.seekRow}>
          <Text style={styles.timeLabel}>{formatMs(displayPositionMs)}</Text>
          <View
            testID="nowplaying-progress-track"
            onStartShouldSetResponder={() => Boolean(currentTrack && durationMs > 0)}
            onMoveShouldSetResponder={() => Boolean(currentTrack && durationMs > 0)}
            onResponderGrant={event => {
              setIsScrubbing(true);
              updateScrubPreview(event.nativeEvent.locationX);
            }}
            onResponderMove={event => {
              if (!isScrubbing) {
                return;
              }
              updateScrubPreview(event.nativeEvent.locationX);
            }}
            onResponderRelease={event => {
              commitScrub(event.nativeEvent.locationX);
            }}
            onResponderTerminate={() => {
              setIsScrubbing(false);
              setScrubPreviewMs(null);
            }}
            onLayout={event => setProgressWidth(event.nativeEvent.layout.width)}
            style={styles.progressTrack}>
            <Pressable
              onPress={event => seekToTapPosition(event.nativeEvent.locationX)}
              style={styles.progressTapRegion}>
              <View testID="nowplaying-progress-fill" style={[styles.progressFill, {width: `${Math.round(displayProgressRatio * 100)}%`}]} />
              <View style={[styles.progressThumb, {left: `${Math.round(displayProgressRatio * 100)}%`}]} />
            </Pressable>
          </View>
          <Text style={styles.timeLabel}>{formatMs(durationMs)}</Text>
        </View>
      </View>
      <View style={styles.controlRow}>
        <View style={styles.controlLeftSpacer} />
        <View style={styles.transportCenterWrap}>
          <View style={styles.controlButtonWrap}>
            <AppButton title="◁◁" onPress={() => void onPrevious()} disabled={!currentTrack} />
          </View>
          <View style={styles.controlButtonWrap}>
            <AppButton title={isPlaying ? '❚❚' : '▶'} onPress={() => void onTogglePlayPause()} disabled={!currentTrack} variant="primary" />
          </View>
          <View style={styles.controlButtonWrap}>
            <AppButton title="▷▷" onPress={() => void onNext()} disabled={!currentTrack} />
          </View>
        </View>
        <View style={styles.modeWrapRight}>
          <Pressable testID="nowplaying-mode-random" onPress={onToggleRandomEnabled} style={styles.modeButton}>
            <Text style={styles.modeButtonLabel}>{randomEnabled ? '↭' : '→'}</Text>
          </Pressable>
          <Pressable testID="nowplaying-mode-repeat" onPress={onCycleEndMode} style={styles.modeButton}>
            <Text style={styles.modeButtonLabel}>{endModeLabel(endMode)}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      width: '100%',
      gap: spacing.sm,
      marginTop: 8,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.lg,
      padding: spacing.md,
      backgroundColor: colors.backgroundCard,
    },
    title: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    queueToggle: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 999,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      backgroundColor: colors.backgroundElevated,
    },
    queueToggleLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    artworkBox: {
      height: 120,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.backgroundElevated,
    },
    artworkBoxActive: {
      borderColor: colors.accentPrimary,
    },
    artworkGlyph: {
      fontSize: 42,
      color: colors.accentPrimary,
    },
    trackTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    meta: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    metaSmall: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    seekWrap: {
      gap: 6,
    },
    seekRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    timeLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      minWidth: 34,
      textAlign: 'center',
    },
    progressTrack: {
      flex: 1,
      height: 7,
      borderRadius: 99,
      overflow: 'visible',
      backgroundColor: colors.backgroundElevated,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      justifyContent: 'center',
    },
    progressTapRegion: {
      width: '100%',
      height: '100%',
      borderRadius: 99,
      overflow: 'visible',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.accentPrimary,
      borderRadius: 99,
    },
    progressThumb: {
      position: 'absolute',
      top: -4,
      width: 14,
      height: 14,
      borderRadius: 7,
      marginLeft: -7,
      backgroundColor: colors.accentPrimary,
      borderWidth: 1,
      borderColor: colors.backgroundCard,
    },
    controlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    controlLeftSpacer: {
      width: 84,
    },
    transportCenterWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      justifyContent: 'center',
      flex: 1,
      paddingHorizontal: 6,
    },
    modeWrapRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      width: 84,
      justifyContent: 'flex-end',
    },
    controlButtonWrap: {
      minWidth: 56,
      flexShrink: 1,
    },
    modeButton: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      minWidth: 42,
      paddingVertical: 8,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeButtonLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
  });
}
