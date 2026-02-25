import {useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';

import {MediaStoreTrack} from '../../native/modules';
import {AppButton} from '../../ui/components/AppButton';
import {SectionCard} from '../../ui/components/SectionCard';
import {TrackActionSheet} from '../../ui/components/TrackActionSheet';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';

type QueueEditorPanelProps = {
  queue: MediaStoreTrack[];
  activeIndex: number;
  onSetActive: (index: number) => void;
  onMoveTo: (fromIndex: number, toIndex: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (index: number) => void;
};

export function QueueEditorPanel(props: QueueEditorPanelProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {queue, activeIndex, onSetActive, onMoveTo, onMoveUp, onMoveDown, onRemove} = props;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);

  const selectedTrack = useMemo(
    () => (selectedIndex === null ? null : queue[selectedIndex] ?? null),
    [queue, selectedIndex],
  );

  const draggedTrack = useMemo(
    () => (dragSourceIndex === null ? null : queue[dragSourceIndex] ?? null),
    [queue, dragSourceIndex],
  );

  return (
    <SectionCard title="Queue Editor" subtitle="Reorder tracks and jump playback position quickly.">
      {draggedTrack ? (
        <View style={styles.dragBanner}>
          <Text style={styles.dragTitle}>MOVE MODE</Text>
          <Text style={styles.dragMeta} numberOfLines={1}>
            {dragSourceIndex !== null ? `${dragSourceIndex + 1}. ` : ''}{draggedTrack.title}
          </Text>
          <Text style={styles.dragHint}>Tap destination row to drop track</Text>
          <AppButton title="CANCEL MOVE" onPress={() => setDragSourceIndex(null)} />
        </View>
      ) : null}
      <FlatList
        scrollEnabled={false}
        style={styles.list}
        data={queue}
        keyExtractor={item => item.uri}
        renderItem={({item, index}) => (
          <Pressable
            style={[
              styles.itemWrap,
              dragSourceIndex === index ? styles.dragSourceRow : null,
              dragSourceIndex !== null && dragSourceIndex !== index ? styles.dragTargetRow : null,
            ]}
            onLongPress={() => setSelectedIndex(index)}
            onPress={() => {
              if (dragSourceIndex !== null && dragSourceIndex !== index) {
                onMoveTo(dragSourceIndex, index);
                setDragSourceIndex(null);
                return;
              }
              if (dragSourceIndex === index) {
                setDragSourceIndex(null);
              }
            }}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {index === activeIndex ? '▶ ' : ''}{index + 1}. {item.title}
            </Text>
            <Text style={styles.trackMeta} numberOfLines={1}>{item.artist} • {item.album}</Text>
            <Text style={styles.hint}>{dragSourceIndex === null ? 'Long press for actions' : 'Tap this row to move here'}</Text>
            <View style={styles.row}>
              <View style={styles.buttonWrap}>
                <AppButton title="▶" onPress={() => onSetActive(index)} variant="primary" />
              </View>
              <View style={styles.buttonWrap}>
                <AppButton
                  title={dragSourceIndex === index ? 'CANCEL MOVE' : 'MOVE'}
                  onPress={() => {
                    if (dragSourceIndex === index) {
                      setDragSourceIndex(null);
                      return;
                    }
                    setDragSourceIndex(index);
                  }}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.buttonWrap}>
                <AppButton title="UP" onPress={() => onMoveUp(index)} disabled={index === 0} />
              </View>
              <View style={styles.buttonWrap}>
                <AppButton title="DOWN" onPress={() => onMoveDown(index)} disabled={index >= queue.length - 1} />
              </View>
              <View style={styles.buttonWrap}>
                <AppButton title="REMOVE" onPress={() => onRemove(index)} />
              </View>
            </View>
          </Pressable>
        )}
      />
      <TrackActionSheet
        visible={selectedTrack !== null}
        title={selectedTrack?.title ?? 'Queue Track'}
        subtitle="Queue actions"
        onClose={() => setSelectedIndex(null)}
        actions={
          selectedIndex === null
            ? []
            : [
                {key: 'play', label: 'PLAY HERE', onPress: () => onSetActive(selectedIndex), primary: true},
                {key: 'start-move', label: 'START MOVE MODE', onPress: () => setDragSourceIndex(selectedIndex)},
                {key: 'up', label: 'MOVE UP', onPress: () => onMoveUp(selectedIndex), disabled: selectedIndex === 0},
                {
                  key: 'down',
                  label: 'MOVE DOWN',
                  onPress: () => onMoveDown(selectedIndex),
                  disabled: selectedIndex >= queue.length - 1,
                },
                {key: 'remove', label: 'REMOVE FROM QUEUE', onPress: () => onRemove(selectedIndex)},
              ]
        }
      />
    </SectionCard>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    list: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
    },
    itemWrap: {
      marginBottom: 10,
      gap: 4,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      padding: spacing.sm,
    },
    dragSourceRow: {
      borderColor: colors.accentPrimary,
      backgroundColor: colors.backgroundCard,
    },
    dragTargetRow: {
      borderColor: colors.accentWarning,
    },
    trackTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    trackMeta: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    hint: {
      fontSize: 11,
      color: colors.textMuted,
    },
    dragBanner: {
      borderWidth: 1,
      borderColor: colors.accentPrimary,
      borderRadius: radii.md,
      backgroundColor: colors.backgroundCard,
      padding: spacing.md,
      gap: spacing.xs,
    },
    dragTitle: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    dragMeta: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    dragHint: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    row: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    buttonWrap: {
      flex: 1,
    },
  });
}
