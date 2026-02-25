import {memo, useEffect, useMemo, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

import {MediaStoreTrack} from '../../native/modules';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';

type CompactSongRowProps = {
  track: MediaStoreTrack;
  onPlay: (trackUri: string) => void;
  isCurrent?: boolean;
  isPlaying?: boolean;
};

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

function getArtworkUri(trackUri: string): string | null {
  const match = trackUri.match(/\/audio\/media\/(\d+)(?:$|\?)/);
  if (!match) {
    return null;
  }

  return `content://media/external/audio/media/${match[1]}/albumart`;
}

function createStyles(colors: ThemeColors, fontFamily: string) {
  return StyleSheet.create({
    root: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    rootCurrent: {
      borderColor: colors.accentPrimary,
      backgroundColor: colors.backgroundCard,
    },
    rootPressed: {
      opacity: 0.9,
    },
    artWrap: {
      width: 34,
      height: 34,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.backgroundCard,
      flexShrink: 0,
    },
    artwork: {
      width: '100%',
      height: '100%',
    },
    artFallback: {
      fontSize: 16,
      color: colors.accentPrimary,
      fontWeight: '700',
      fontFamily,
    },
    body: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    title: {
      flex: 1,
      minWidth: 0,
      fontSize: 12,
      fontWeight: '700',
      color: colors.textPrimary,
      fontFamily,
    },
    duration: {
      fontSize: 10,
      color: colors.textSecondary,
      flexShrink: 0,
      fontFamily,
    },
    meta: {
      fontSize: 10,
      color: colors.textSecondary,
      fontFamily,
    },
    currentStatus: {
      fontSize: 10,
      color: colors.accentPrimary,
      fontWeight: '700',
      fontFamily,
    },
    playButton: {
      borderWidth: 1,
      borderColor: colors.accentPrimary,
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 8,
      backgroundColor: colors.backgroundCard,
      flexShrink: 0,
    },
    playButtonCurrent: {
      backgroundColor: colors.accentPrimary,
    },
    playLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textPrimary,
      fontFamily,
    },
    playLabelCurrent: {
      color: colors.backgroundBase,
    },
  });
}

export const CompactSongRow = memo(function CompactSongRow({
  track,
  onPlay,
  isCurrent = false,
  isPlaying = false,
}: CompactSongRowProps) {
  const {colors, fontFamily} = useTheme();
  const styles = useMemo(() => createStyles(colors, fontFamily), [colors, fontFamily]);

  const artworkUri = getArtworkUri(track.uri);
  const [artworkFailed, setArtworkFailed] = useState(false);

  useEffect(() => {
    setArtworkFailed(false);
  }, [track.uri]);

  const shouldShowArtwork = artworkUri !== null && !artworkFailed;
  const artistAlbum = `${track.artist} • ${track.album}`;
  const folderPath = track.relativePath || 'Unknown folder';
  const fileName = track.displayName || 'Unknown file';
  const currentStatusLabel = isCurrent ? (isPlaying ? 'NOW PLAYING' : 'IN QUEUE') : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: isCurrent}}
      onPress={() => onPlay(track.uri)}
      style={({pressed}) => [
        styles.root,
        isCurrent ? styles.rootCurrent : null,
        pressed ? styles.rootPressed : null,
      ]}>
      <View style={styles.artWrap}>
        {shouldShowArtwork ? (
          <Image source={{uri: artworkUri}} style={styles.artwork} resizeMode="cover" onError={() => setArtworkFailed(true)} />
        ) : (
          <Text style={styles.artFallback}>♪</Text>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.duration}>{formatDuration(track.durationMs)}</Text>
        </View>
        {currentStatusLabel ? (
          <Text style={styles.currentStatus} numberOfLines={1}>{currentStatusLabel}</Text>
        ) : null}
        <Text style={styles.meta} numberOfLines={1}>{artistAlbum}</Text>
        <Text style={styles.meta} numberOfLines={1}>{fileName}</Text>
        <Text style={styles.meta} numberOfLines={1}>{folderPath}</Text>
      </View>

      <View style={[styles.playButton, isCurrent ? styles.playButtonCurrent : null]}>
        <Text style={[styles.playLabel, isCurrent ? styles.playLabelCurrent : null]}>{isCurrent && isPlaying ? '❚❚' : '▶'}</Text>
      </View>
    </Pressable>
  );
});
