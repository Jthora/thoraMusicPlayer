import {memo, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {MediaStoreTrack} from '../../native/modules';
import {radii, spacing} from '../theme';
import {ThemeColors, useTheme} from '../themeRuntime';
import {EndMode} from '../../features/playback/useNowPlayingState';

type MiniNowPlayingDockProps = {
  currentTrack?: MediaStoreTrack;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  endMode: EndMode;
  randomEnabled: boolean;
  onSeekBy: (deltaMs: number) => void;
  onNext: () => Promise<void> | void;
  onPrevious: () => Promise<void> | void;
  onTogglePlayPause: () => Promise<void> | void;
  onCycleEndMode: () => void;
  onToggleRandomEnabled: () => void;
  onOpenNowPlaying: () => void;
  onReportError?: (message: string) => void;
};

function formatMs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unknown playback error';
}

function repeatModeLabel(mode: EndMode): string {
  if (mode === 'repeat_all') {
    return '↺';
  }

  if (mode === 'repeat_one') {
    return '↺1';
  }

  return '↺×';
}

export const MiniNowPlayingDock = memo(function MiniNowPlayingDock({
  currentTrack,
  isPlaying,
  positionMs,
  durationMs,
  endMode,
  randomEnabled,
  onSeekBy,
  onNext,
  onPrevious,
  onTogglePlayPause,
  onCycleEndMode,
  onToggleRandomEnabled,
  onOpenNowPlaying,
  onReportError,
}: MiniNowPlayingDockProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [isPending, setIsPending] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [progressWidth, setProgressWidth] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPreviewMs, setScrubPreviewMs] = useState<number | null>(null);
  const isMountedRef = useRef(true);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewPositionMs = scrubPreviewMs ?? positionMs;
  const progressRatio = currentTrack && durationMs > 0 ? Math.min(1, previewPositionMs / durationMs) : 0;
  const title = currentTrack?.title ?? 'Nothing Playing';
  const subtitle = currentTrack ? `${currentTrack.artist} • ${currentTrack.album}` : 'Pick music to start playback';
  const locationLine = currentTrack ? `${currentTrack.displayName} • ${currentTrack.relativePath}` : '';
  const elapsedLabel = currentTrack ? formatMs(previewPositionMs) : '0:00';
  const totalLabel = currentTrack ? formatMs(durationMs) : '0:00';
  const controlLabel = useMemo(() => {
    if (!currentTrack) {
      return 'OPEN';
    }

    if (isPending) {
      return '...';
    }

    return isPlaying ? '❚❚' : '▶';
  }, [currentTrack, isPending, isPlaying]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!errorText) {
      return;
    }

    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }

    errorTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) {
        return;
      }
      setErrorText('');
      errorTimeoutRef.current = null;
    }, 4500);

    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
    };
  }, [errorText]);

  useEffect(() => {
    setIsScrubbing(false);
    setScrubPreviewMs(null);
  }, [currentTrack?.uri, durationMs]);

  const handlePrimaryAction = async () => {
    if (!currentTrack) {
      return;
    }

    if (isPending) {
      return;
    }

    setIsPending(true);
    setErrorText('');
    try {
      await Promise.resolve(onTogglePlayPause());
    } catch (error) {
      const message = `Mini player action failed: ${getErrorMessage(error)}`;
      setErrorText(message);
      onReportError?.(message);
    } finally {
      setIsPending(false);
    }
  };

  const handleSecondaryAction = async (action: () => Promise<void> | void) => {
    if (!currentTrack || isPending) {
      return;
    }

    setIsPending(true);
    setErrorText('');
    try {
      await Promise.resolve(action());
    } catch (error) {
      const message = `Mini player action failed: ${getErrorMessage(error)}`;
      setErrorText(message);
      onReportError?.(message);
    } finally {
      setIsPending(false);
    }
  };

  const updateScrubPreview = (x: number) => {
    if (!currentTrack || durationMs <= 0 || progressWidth <= 0) {
      return;
    }

    const ratio = Math.min(1, Math.max(0, x / progressWidth));
    setScrubPreviewMs(Math.floor(ratio * durationMs));
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
      <View style={styles.row}>
        <Pressable
          onPress={currentTrack ? onOpenNowPlaying : undefined}
          style={({pressed}) => [styles.metaWrap, pressed && currentTrack ? styles.pressed : null]}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{subtitle}</Text>
          {locationLine ? <Text style={styles.metaSmall} numberOfLines={1}>{locationLine}</Text> : null}
        </Pressable>
      </View>
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      <View style={styles.controlAndModeRow}>
        <View style={styles.controlLeftSpacer} />
        <View style={styles.controlWrap}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void handleSecondaryAction(onPrevious);
            }}
            style={({pressed}) => [styles.controlButton, pressed ? styles.controlButtonPressed : null, !currentTrack ? styles.controlButtonDisabled : null]}>
            <Text style={styles.controlLabel}>◁◁</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void handlePrimaryAction();
            }}
            style={({pressed}) => [styles.controlButton, styles.controlButtonPrimary, pressed ? styles.controlButtonPressed : null, isPending ? styles.controlButtonDisabled : null]}>
            <Text style={styles.controlLabel}>{controlLabel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void handleSecondaryAction(onNext);
            }}
            style={({pressed}) => [styles.controlButton, pressed ? styles.controlButtonPressed : null, !currentTrack ? styles.controlButtonDisabled : null]}>
            <Text style={styles.controlLabel}>▷▷</Text>
          </Pressable>
        </View>
        <View style={styles.modeWrapRight}>
          <Pressable
            testID="mini-mode-random"
            accessibilityRole="button"
            onPress={onToggleRandomEnabled}
            style={({pressed}) => [styles.modeButton, pressed ? styles.controlButtonPressed : null]}>
            <Text style={styles.modeLabel}>{randomEnabled ? '↭' : '→'}</Text>
          </Pressable>
          <Pressable
            testID="mini-mode-repeat"
            accessibilityRole="button"
            onPress={onCycleEndMode}
            style={({pressed}) => [styles.modeButton, pressed ? styles.controlButtonPressed : null]}>
            <Text style={styles.modeLabel}>{repeatModeLabel(endMode)}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.seekRow}>
        <Text style={styles.timeLabel}>{elapsedLabel}</Text>
        <View
          testID="mini-progress-track"
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
          <Pressable onPress={event => commitScrub(event.nativeEvent.locationX)} style={styles.progressTapRegion}>
            <View testID="mini-progress-fill" style={[styles.progressFill, {width: `${Math.round(progressRatio * 100)}%`}]} />
            <View style={[styles.progressThumb, {left: `${Math.round(progressRatio * 100)}%`}]} />
          </Pressable>
        </View>
        <Text style={styles.timeLabel}>{totalLabel}</Text>
      </View>
    </View>
  );
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      borderTopWidth: 1,
      borderTopColor: colors.borderSubtle,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
      backgroundColor: colors.backgroundCard,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.xs,
    },
    pressed: {
      opacity: 0.92,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    metaWrap: {
      flex: 1,
      gap: 2,
    },
    title: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    meta: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    metaSmall: {
      fontSize: 10,
      color: colors.textSecondary,
    },
    error: {
      fontSize: 11,
      color: colors.accentDanger,
    },
    controlAndModeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    controlLeftSpacer: {
      width: 84,
    },
    controlWrap: {
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      paddingHorizontal: 6,
    },
    modeWrapRight: {
      flexDirection: 'row',
      gap: 6,
      width: 84,
      justifyContent: 'flex-end',
    },
    controlButton: {
      minWidth: 36,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingVertical: 5,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    controlButtonPrimary: {
      borderColor: colors.accentPrimary,
      backgroundColor: colors.backgroundCard,
    },
    controlButtonPressed: {
      opacity: 0.86,
    },
    controlButtonDisabled: {
      opacity: 0.45,
    },
    controlLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    modeButton: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      minWidth: 36,
      paddingVertical: 5,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    seekRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    timeLabel: {
      fontSize: 10,
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
  });
}
