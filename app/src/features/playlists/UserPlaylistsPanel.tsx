import {useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

import {MediaStoreTrack, UserPlaylist, UserPlaylistTrack} from '../../native/modules';
import {AppButton} from '../../ui/components/AppButton';
import {SectionCard} from '../../ui/components/SectionCard';
import {StatusChip} from '../../ui/components/StatusChip';
import {TrackActionSheet} from '../../ui/components/TrackActionSheet';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';

type UserPlaylistsPanelProps = {
  mode?: 'full' | 'home' | 'detail' | 'add';
  status: string;
  playlists: UserPlaylist[];
  selectedPlaylistId: number | null;
  entries: UserPlaylistTrack[];
  searchResults: MediaStoreTrack[];
  onRefreshPlaylists: () => Promise<void>;
  onCreatePlaylist: (name: string) => Promise<UserPlaylist | null>;
  onSelectPlaylist: (playlistId: number) => Promise<void>;
  onOpenPlaylist?: (playlistId: number) => void;
  onSearchTracks: (query: string) => Promise<void>;
  onAddTrack: (track: MediaStoreTrack) => Promise<void>;
  onPlayEntry?: (position: number) => Promise<void> | void;
  onRemoveTrack: (position: number) => Promise<void>;
  onMoveTrack: (fromPosition: number, toPosition: number) => Promise<void>;
};

export function UserPlaylistsPanel(props: UserPlaylistsPanelProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    mode = 'full',
    status,
    playlists,
    selectedPlaylistId,
    entries,
    searchResults,
    onRefreshPlaylists,
    onCreatePlaylist,
    onSelectPlaylist,
    onOpenPlaylist,
    onSearchTracks,
    onAddTrack,
    onPlayEntry,
    onRemoveTrack,
    onMoveTrack,
  } = props;

  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSearchIndex, setSelectedSearchIndex] = useState<number | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(null);
  const statusTone = status.toLowerCase().includes('error')
    ? 'danger'
    : status.toLowerCase().includes('running')
      ? 'warning'
      : 'neutral';
  const selectedPlaylist = playlists.find(item => item.id === selectedPlaylistId) ?? null;
  const showCreateControls = mode === 'full' || mode === 'home';
  const showPlaylistSelector = true;
  const showSearchControls = mode === 'full' || mode === 'add';
  const showSearchResults = mode === 'full' || mode === 'add';
  const showEntryList = mode === 'full' || mode === 'detail';
  const panelTitle = mode === 'detail'
    ? 'Playlist Detail'
    : mode === 'add'
      ? 'Add Tracks'
      : 'My Playlists';
  const panelSubtitle = mode === 'detail'
    ? `Manage and reorder tracks${selectedPlaylist ? ` in ${selectedPlaylist.name}` : ''}.`
    : mode === 'add'
      ? `Search and add tracks${selectedPlaylist ? ` to ${selectedPlaylist.name}` : ''}.`
      : 'Create, fill, and order playlists for quick listening.';

  return (
    <SectionCard title={panelTitle} subtitle={panelSubtitle}>
      <StatusChip label={`PLAYLISTS: ${status}`} tone={statusTone} />

      {showCreateControls && (
        <>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              placeholder="New playlist name"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.buttonWrap}>
              <AppButton
                title="CREATE"
                onPress={() => {
                  void onCreatePlaylist(newPlaylistName);
                  setNewPlaylistName('');
                }}
                variant="primary"
              />
            </View>
          </View>
          <Pressable onPress={() => void onRefreshPlaylists()} style={styles.compactAction}>
            <Text style={styles.compactActionLabel}>REFRESH PLAYLISTS</Text>
          </Pressable>
        </>
      )}

      {showPlaylistSelector && (
        <FlatList
          scrollEnabled={false}
          style={styles.list}
          data={playlists}
          keyExtractor={item => String(item.id)}
          renderItem={({item}) => (
            <Pressable
              style={({pressed}) => [styles.tableRow, pressed ? styles.tableRowPressed : null]}
              onPress={() => {
                void onSelectPlaylist(item.id);
                onOpenPlaylist?.(item.id);
              }}>
              <View style={styles.tableContent}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.itemMeta} numberOfLines={1}>Tracks: {item.entryCount} • Updated: {item.updatedAtSec}</Text>
              </View>
              <View style={styles.tableAction}>
                <AppButton
                  title={item.id === selectedPlaylistId ? 'SELECTED' : 'OPEN'}
                  onPress={() => void onSelectPlaylist(item.id)}
                  disabled={item.id === selectedPlaylistId}
                  variant={item.id === selectedPlaylistId ? 'primary' : 'secondary'}
                />
              </View>
            </Pressable>
          )}
        />
      )}

      {showSearchControls && (
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search indexed tracks"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.buttonWrap}>
            <AppButton title="SEARCH" onPress={() => void onSearchTracks(searchQuery)} variant="primary" />
          </View>
        </View>
      )}

      {showSearchResults && (
        <FlatList
          scrollEnabled={false}
          style={styles.list}
          data={searchResults}
          keyExtractor={item => `search-${item.uri}`}
          renderItem={({item, index}) => (
            <Pressable style={styles.item} onLongPress={() => setSelectedSearchIndex(index)}>
              <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.itemMeta} numberOfLines={1}>{item.artist} • {item.album}</Text>
              <Text style={styles.hint}>Long press for actions</Text>
              <View style={styles.row}>
                <View style={styles.buttonWrap}>
                  <AppButton title="ADD" onPress={() => void onAddTrack(item)} />
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      {showEntryList && (
        <FlatList
          scrollEnabled={false}
          style={styles.list}
          data={entries}
          keyExtractor={item => `entry-${item.position}-${item.uri}`}
          renderItem={({item, index}) => (
            <Pressable style={styles.item} onLongPress={() => setSelectedEntryIndex(index)}>
              <Text style={styles.itemTitle} numberOfLines={1}>{index + 1}. {item.title}</Text>
              <Text style={styles.itemMeta} numberOfLines={1}>{item.artist} • {item.album}</Text>
              <View style={styles.compactActionsRow}>
                <Pressable onPress={() => void onPlayEntry?.(index)} style={styles.compactAction}>
                  <Text style={styles.compactActionLabel}>▶</Text>
                </Pressable>
                <Pressable onPress={() => void onMoveTrack(index, index - 1)} disabled={index === 0} style={styles.compactAction}>
                  <Text style={[styles.compactActionLabel, index === 0 ? styles.compactActionLabelDisabled : null]}>UP</Text>
                </Pressable>
                <Pressable onPress={() => void onMoveTrack(index, index + 1)} disabled={index >= entries.length - 1} style={styles.compactAction}>
                  <Text style={[styles.compactActionLabel, index >= entries.length - 1 ? styles.compactActionLabelDisabled : null]}>DOWN</Text>
                </Pressable>
                <Pressable onPress={() => void onRemoveTrack(index)} style={styles.compactAction}>
                  <Text style={styles.compactActionLabel}>REMOVE</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>Long press for more actions</Text>
            </Pressable>
          )}
        />
      )}

      <TrackActionSheet
        visible={selectedSearchIndex !== null}
        title={selectedSearchIndex === null ? 'Track' : (searchResults[selectedSearchIndex]?.title ?? 'Track')}
        subtitle="Search result actions"
        onClose={() => setSelectedSearchIndex(null)}
        actions={
          selectedSearchIndex === null
            ? []
            : [
                {
                  key: 'add',
                  label: 'ADD TO PLAYLIST',
                  primary: true,
                  onPress: () => {
                    const selectedTrack = searchResults[selectedSearchIndex];
                    if (selectedTrack) {
                      void onAddTrack(selectedTrack);
                    }
                  },
                },
              ]
        }
      />

      <TrackActionSheet
        visible={selectedEntryIndex !== null}
        title={selectedEntryIndex === null ? 'Playlist Entry' : (entries[selectedEntryIndex]?.title ?? 'Playlist Entry')}
        subtitle="Playlist entry actions"
        onClose={() => setSelectedEntryIndex(null)}
        actions={
          selectedEntryIndex === null
            ? []
            : [
                {
                  key: 'play',
                  label: 'PLAY FROM HERE',
                  primary: true,
                  onPress: () => void onPlayEntry?.(selectedEntryIndex),
                },
                {
                  key: 'up',
                  label: 'MOVE UP',
                  onPress: () => void onMoveTrack(selectedEntryIndex, selectedEntryIndex - 1),
                  disabled: selectedEntryIndex === 0,
                },
                {
                  key: 'down',
                  label: 'MOVE DOWN',
                  onPress: () => void onMoveTrack(selectedEntryIndex, selectedEntryIndex + 1),
                  disabled: selectedEntryIndex >= entries.length - 1,
                },
                {
                  key: 'remove',
                  label: 'REMOVE',
                  onPress: () => void onRemoveTrack(selectedEntryIndex),
                },
              ]
        }
      />
    </SectionCard>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      color: colors.textPrimary,
    },
    buttonWrap: {
      flex: 1,
    },
    list: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
    },
    item: {
      marginBottom: 8,
      gap: 4,
    },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    tableContent: {
      flex: 1,
      gap: 2,
    },
    tableAction: {
      minWidth: 96,
    },
    tableRowPressed: {
      opacity: 0.85,
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
    hint: {
      fontSize: 11,
      color: colors.textMuted,
    },
    compactActionsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    compactAction: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    compactActionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    compactActionLabelDisabled: {
      opacity: 0.45,
    },
  });
}
