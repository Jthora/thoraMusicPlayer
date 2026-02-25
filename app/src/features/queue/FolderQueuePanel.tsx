import {useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

import {MediaStoreTrack, ScanDiagnostic} from '../../native/modules';
import {AppButton} from '../../ui/components/AppButton';
import {SectionCard} from '../../ui/components/SectionCard';
import {StatusChip} from '../../ui/components/StatusChip';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';

type FolderQueuePanelProps = {
  status: string;
  queue: MediaStoreTrack[];
  activeIndex: number;
  skippedCount: number;
  unreadableCount: number;
  skippedDiagnostics: ScanDiagnostic[];
  onGenerateQueue: (folderPath: string, sortMode: string, anchorUri: string | null) => Promise<void>;
  onStartFromQueue: () => Promise<void>;
  onSetAnchor: (index: number) => void;
};

const sortModes = ['name', 'modified', 'random'] as const;

export function FolderQueuePanel(props: FolderQueuePanelProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    status,
    queue,
    activeIndex,
    skippedCount,
    unreadableCount,
    skippedDiagnostics,
    onGenerateQueue,
    onStartFromQueue,
    onSetAnchor,
  } = props;
  const [folderPath, setFolderPath] = useState('Music');
  const [sortMode, setSortMode] = useState<(typeof sortModes)[number]>('name');

  const anchorUri = useMemo(() => queue[activeIndex]?.uri ?? null, [queue, activeIndex]);
  const statusTone = status.toLowerCase().includes('error')
    ? 'danger'
    : status.toLowerCase().includes('running')
      ? 'warning'
      : 'neutral';

  return (
    <SectionCard title="Folder Queue" subtitle="Generate playback order from a folder and launch from anchor.">
      <StatusChip label={`QUEUE: ${status}`} tone={statusTone} />
      <TextInput
        style={styles.input}
        value={folderPath}
        onChangeText={setFolderPath}
        placeholder="Folder path contains... (e.g. Music)"
        placeholderTextColor={colors.textMuted}
      />
      <View style={styles.sortRow}>
        {sortModes.map(mode => (
          <Pressable
            key={mode}
            onPress={() => setSortMode(mode)}
            style={({pressed}) => [
              styles.sortButton,
              mode === sortMode ? styles.sortButtonActive : styles.sortButtonInactive,
              pressed ? styles.sortButtonPressed : null,
            ]}>
            <Text style={[styles.sortLabel, mode === sortMode ? styles.sortLabelActive : styles.sortLabelInactive]}>
              {mode.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.buttonWrap}>
        <AppButton
          title="GENERATE FOLDER QUEUE"
          onPress={() => {
            void onGenerateQueue(folderPath, sortMode, anchorUri);
          }}
          variant="primary"
        />
      </View>
      <View style={styles.buttonWrap}>
        <AppButton
          title="START FROM ANCHOR"
          onPress={() => {
            void onStartFromQueue();
          }}
          disabled={queue.length === 0}
        />
      </View>
      <Text style={styles.meta}>Queue tracks: {queue.length} • Anchor: {activeIndex + 1}</Text>
      <Text style={styles.meta}>Skipped: {skippedCount} • Unreadable: {unreadableCount}</Text>
      {skippedDiagnostics.slice(0, 3).map(diagnostic => (
        <Text style={styles.itemMeta} key={`${diagnostic.code}-${diagnostic.message}`} numberOfLines={1}>
          {diagnostic.code}: {diagnostic.message}
        </Text>
      ))}
      <FlatList
        scrollEnabled={false}
        style={styles.list}
        data={queue}
        keyExtractor={item => item.uri}
        renderItem={({item, index}) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {index === activeIndex ? '▶ ' : ''}{item.title}
            </Text>
            <Text style={styles.itemMeta} numberOfLines={1}>{item.displayName || item.relativePath}</Text>
            <View style={styles.itemButtonWrap}>
              <AppButton title="SET ANCHOR" onPress={() => onSetAnchor(index)} />
            </View>
          </View>
        )}
      />
    </SectionCard>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    input: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      paddingHorizontal: 10,
      paddingVertical: 8,
      width: '100%',
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.backgroundElevated,
    },
    sortRow: {
      flexDirection: 'row',
      width: '100%',
      gap: spacing.sm,
    },
    sortButton: {
      flex: 1,
      minHeight: 38,
      borderWidth: 1,
      borderRadius: radii.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sortButtonActive: {
      borderColor: colors.accentPrimary,
      backgroundColor: colors.backgroundCard,
    },
    sortButtonInactive: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.backgroundElevated,
    },
    sortButtonPressed: {
      opacity: 0.88,
    },
    sortLabel: {
      fontSize: 11,
      fontWeight: '700',
    },
    sortLabelActive: {
      color: colors.textPrimary,
    },
    sortLabelInactive: {
      color: colors.textSecondary,
    },
    buttonWrap: {
      width: '100%',
    },
    meta: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    list: {
      width: '100%',
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
    },
    itemRow: {
      marginBottom: 8,
    },
    itemTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    itemMeta: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    itemButtonWrap: {
      marginTop: 4,
    },
  });
}
