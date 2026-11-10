import {useEffect, useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

import {
  AlbumGroup,
  ArtistGroup,
  MediaStoreTrack,
  SearchRelevanceReport,
  UnifiedSearchScope,
  UserPlaylist,
} from '../../native/modules';
import {AppButton} from '../../ui/components/AppButton';
import {SectionCard} from '../../ui/components/SectionCard';
import {StatusChip} from '../../ui/components/StatusChip';
import {TrackActionSheet} from '../../ui/components/TrackActionSheet';
import {kvStore} from '../../platform/storage/kvStore';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';
import {filterPlaylistsByScope, filterTracksByScope} from './searchScopeFilters';

type SearchBrowsePanelProps = {
  status: string;
  searchResults: MediaStoreTrack[];
  playlistSearchResults?: UserPlaylist[];
  userPlaylists?: UserPlaylist[];
  albums: AlbumGroup[];
  artists: ArtistGroup[];
  songs: MediaStoreTrack[];
  relevanceReport: SearchRelevanceReport | null;
  onSearch: (query: string, scope?: UnifiedSearchScope) => Promise<void>;
  onBrowseAlbums: () => Promise<void>;
  onBrowseArtists: () => Promise<void>;
  onBrowseSongs: () => Promise<void>;
  /** Play `tracks` as the queue, starting at `startUri` (the first track when null). */
  onPlayTracks: (tracks: MediaStoreTrack[], startUri: string | null, sourceLabel: string) => void;
  onValidateRelevance: () => Promise<void>;
  onQuickAddTrack?: (track: MediaStoreTrack) => Promise<void>;
  onOpenPlaylists?: () => void;
  hasQuickAddTarget?: boolean;
  showAdvancedSearchTools?: boolean;
};

const modes = ['search', 'folders', 'albums', 'artists', 'songs'] as const;

type Mode = (typeof modes)[number];

const searchScopes: UnifiedSearchScope[] = ['all', 'song_names', 'song_albums', 'song_artists', 'playlist_titles'];
type SearchScope = UnifiedSearchScope;
const SEARCH_PANEL_STATE_KEY = 'android_music_player.search_panel.v1';

type PersistedSearchPanelState = {
  mode: Mode;
  query: string;
  searchScope: SearchScope;
  currentFolderPath: string;
};

function isMode(value: unknown): value is Mode {
  return value === 'search' || value === 'folders' || value === 'albums' || value === 'artists' || value === 'songs';
}

function isSearchScope(value: unknown): value is SearchScope {
  return value === 'all' || value === 'song_names' || value === 'song_albums' || value === 'song_artists' || value === 'playlist_titles';
}

function scopeLabel(scope: SearchScope): string {
  if (scope === 'song_names') {
    return 'SONG NAMES';
  }

  if (scope === 'song_albums') {
    return 'SONG ALBUMS';
  }

  if (scope === 'song_artists') {
    return 'SONG ARTISTS';
  }

  if (scope === 'playlist_titles') {
    return 'PLAYLIST TITLES';
  }

  return 'ALL';
}

function normalizeFolderPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function splitFolderSegments(value: string): string[] {
  const normalized = normalizeFolderPath(value);
  return normalized ? normalized.split('/').filter(Boolean) : [];
}

export function SearchBrowsePanel(props: SearchBrowsePanelProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    status,
    searchResults,
    playlistSearchResults = [],
    userPlaylists = [],
    albums,
    artists,
    songs,
    relevanceReport,
    onSearch,
    onBrowseAlbums,
    onBrowseArtists,
    onBrowseSongs,
    onPlayTracks,
    onValidateRelevance,
    onQuickAddTrack,
    onOpenPlaylists,
    hasQuickAddTarget = false,
    showAdvancedSearchTools = false,
  } = props;
  const [mode, setMode] = useState<Mode>('folders');
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [showScopeMenu, setShowScopeMenu] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState<number | null>(null);
  const [selectedSongIndex, setSelectedSongIndex] = useState<number | null>(null);
  const [currentFolderPath, setCurrentFolderPath] = useState('');
  const [searchPanelStateHydrated, setSearchPanelStateHydrated] = useState(false);

  const currentFolderSegments = useMemo(() => splitFolderSegments(currentFolderPath), [currentFolderPath]);

  const folderRows = useMemo(() => {
    const directoryMap = new Map<string, {name: string; path: string; trackCount: number}>();
    const directTracks: MediaStoreTrack[] = [];

    songs.forEach(track => {
      const trackSegments = splitFolderSegments(track.relativePath);
      const sharesPrefix = currentFolderSegments.every((segment, index) => trackSegments[index] === segment);
      if (!sharesPrefix) {
        return;
      }

      if (trackSegments.length > currentFolderSegments.length) {
        const childName = trackSegments[currentFolderSegments.length];
        const childPath = [...currentFolderSegments, childName].join('/');
        const existing = directoryMap.get(childPath);
        if (existing) {
          existing.trackCount += 1;
          return;
        }

        directoryMap.set(childPath, {
          name: childName,
          path: childPath,
          trackCount: 1,
        });
        return;
      }

      directTracks.push(track);
    });

    const directories = [...directoryMap.values()].sort((left, right) => left.name.localeCompare(right.name));
    const tracks = [...directTracks].sort((left, right) => left.title.localeCompare(right.title));

    return {
      directories,
      tracks,
      rows: [
        ...directories.map(item => ({kind: 'directory' as const, ...item})),
        ...tracks.map(item => ({kind: 'track' as const, track: item})),
      ],
    };
  }, [currentFolderSegments, songs]);

  const toneForStatus = status.toLowerCase().includes('error')
    ? 'danger'
    : status.toLowerCase().includes('running') || status.toLowerCase().includes('loading')
      ? 'warning'
      : 'neutral';

  const normalizedSearchQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  const filteredTrackSearchResults = useMemo(() => {
    return filterTracksByScope(searchResults, normalizedSearchQuery, searchScope);
  }, [normalizedSearchQuery, searchResults, searchScope]);

  const filteredPlaylistResults = useMemo(() => {
    const source = playlistSearchResults.length > 0 ? playlistSearchResults : userPlaylists;
    return filterPlaylistsByScope(source, normalizedSearchQuery, searchScope);
  }, [normalizedSearchQuery, playlistSearchResults, searchScope, userPlaylists]);

  const shouldShowTracksInSearch = searchScope !== 'playlist_titles';
  const shouldShowPlaylistsInSearch = searchScope === 'playlist_titles' || searchScope === 'all';

  useEffect(() => {
    let cancelled = false;

    const restorePanelState = async () => {
      try {
        const raw = kvStore.getItem(SEARCH_PANEL_STATE_KEY);
        if (!raw || cancelled) {
          return;
        }

        const parsed = JSON.parse(raw) as Partial<PersistedSearchPanelState>;
        if (isMode(parsed.mode)) {
          setMode(parsed.mode);
        }
        if (typeof parsed.query === 'string') {
          setQuery(parsed.query);
        }
        if (isSearchScope(parsed.searchScope)) {
          setSearchScope(parsed.searchScope);
        }
        if (typeof parsed.currentFolderPath === 'string') {
          setCurrentFolderPath(parsed.currentFolderPath);
        }
      } catch {
      } finally {
        if (!cancelled) {
          setSearchPanelStateHydrated(true);
        }
      }
    };

    void restorePanelState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!searchPanelStateHydrated) {
      return;
    }

    const payload: PersistedSearchPanelState = {
      mode,
      query,
      searchScope,
      currentFolderPath,
    };

    kvStore.setItem(SEARCH_PANEL_STATE_KEY, JSON.stringify(payload));
  }, [currentFolderPath, mode, query, searchPanelStateHydrated, searchScope]);

  useEffect(() => {
    if (mode !== 'search') {
      return;
    }

    if (!normalizedSearchQuery) {
      return;
    }

    void onSearch(query, searchScope);
  }, [mode, normalizedSearchQuery, onSearch, query, searchScope]);

  useEffect(() => {
    if (mode === 'folders' || mode === 'songs') {
      if (songs.length === 0) {
        void onBrowseSongs();
      }
      return;
    }

    if (mode === 'albums' && albums.length === 0) {
      void onBrowseAlbums();
      return;
    }

    if (mode === 'artists' && artists.length === 0) {
      void onBrowseArtists();
    }
  }, [albums.length, artists.length, mode, onBrowseAlbums, onBrowseArtists, onBrowseSongs, songs.length]);

  return (
    <SectionCard title="Discover" subtitle="Search tracks, then jump right into playback.">
      <StatusChip label={`DISCOVERY: ${status}`} tone={toneForStatus} />
      <View style={styles.segmentRow}>
        {modes.map(item => {
          const active = mode === item;
          return (
            <Pressable
              key={item}
              onPress={() => setMode(item)}
              style={({pressed}) => [styles.segment, active ? styles.segmentActive : styles.segmentInactive, pressed ? styles.segmentPressed : null]}>
              <Text style={[styles.segmentText, active ? styles.segmentTextActive : styles.segmentTextInactive]}>
                {item.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'search' && (
        <>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search filename/title/artist/album/folder"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.scopeRow}>
            <Text style={styles.scopeLabel}>Scope</Text>
            <Pressable onPress={() => setShowScopeMenu(prev => !prev)} style={styles.scopeButton}>
              <Text style={styles.scopeButtonText}>{scopeLabel(searchScope)}</Text>
            </Pressable>
          </View>
          {showScopeMenu && (
            <View style={styles.scopeMenu}>
              {searchScopes.map(scope => {
                const active = scope === searchScope;
                return (
                  <Pressable
                    key={scope}
                    onPress={() => {
                      setSearchScope(scope);
                      setShowScopeMenu(false);
                    }}
                    style={[styles.scopeMenuItem, active ? styles.scopeMenuItemActive : null]}>
                    <Text style={[styles.scopeMenuItemText, active ? styles.scopeMenuItemTextActive : null]}>{scopeLabel(scope)}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <View style={styles.row}>
            <View style={styles.buttonWrap}>
              <AppButton title="RUN SEARCH" onPress={() => void onSearch(query, searchScope)} variant="primary" />
            </View>
          </View>
          <Text style={styles.hint}>Tip: Use row actions to play or add quickly. Long press for more actions.</Text>
          {showAdvancedSearchTools && (
            <>
              <View style={styles.buttonWrap}>
                <AppButton title="VALIDATE RELEVANCE" onPress={() => void onValidateRelevance()} />
              </View>
              <Text style={styles.itemMeta}>
                Relevance: {relevanceReport ? `${relevanceReport.status} ${relevanceReport.passed}/${relevanceReport.sampled}` : 'not run'}
              </Text>
              {relevanceReport?.failedExamples?.slice(0, 3).map((example, index) => (
                <Text style={styles.itemMeta} key={`${example.targetUri}-${index}`} numberOfLines={1}>
                  {example.reason}: {example.targetTitle} (q: {example.query || '-'})
                </Text>
              ))}
            </>
          )}
          {query.trim().length === 0 ? (
            <Text style={styles.hint}>Start typing to search your library.</Text>
          ) : (
            <>
              {shouldShowTracksInSearch && (
                <>
                  <Text style={styles.groupHeader}>Tracks</Text>
                  <FlatList
                    scrollEnabled={false}
                    style={styles.list}
                    data={filteredTrackSearchResults}
                    keyExtractor={item => `search-${item.uri}`}
                    ListEmptyComponent={<Text style={styles.hint}>No matching tracks.</Text>}
                    renderItem={({item, index}) => (
                      <Pressable style={styles.item} onLongPress={() => setSelectedSearchIndex(index)}>
                        <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.itemMeta} numberOfLines={1}>{item.artist} • {item.album}</Text>
                        <View style={styles.rowActions}>
                          <AppButton
                            title="▶"
                            onPress={() => {
                              onPlayTracks(filteredTrackSearchResults, item.uri, 'search');
                            }}
                            variant="primary"
                          />
                          {hasQuickAddTarget && onQuickAddTrack ? (
                            <AppButton
                              title="ADD"
                              onPress={() => {
                                void onQuickAddTrack(item);
                              }}
                            />
                          ) : null}
                        </View>
                        <Text style={styles.hint}>Long press for more actions</Text>
                      </Pressable>
                    )}
                  />
                </>
              )}

              {shouldShowPlaylistsInSearch && (
                <>
                  <View style={styles.groupHeaderRow}>
                    <Text style={styles.groupHeader}>Playlists</Text>
                    {onOpenPlaylists ? (
                      <Pressable style={styles.compactAction} onPress={onOpenPlaylists}>
                        <Text style={styles.compactActionLabel}>OPEN</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <FlatList
                    scrollEnabled={false}
                    style={styles.list}
                    data={filteredPlaylistResults}
                    keyExtractor={item => `playlist-${item.id}`}
                    ListEmptyComponent={<Text style={styles.hint}>No matching playlists.</Text>}
                    renderItem={({item}) => (
                      <View style={styles.item}>
                        <Text style={styles.itemTitle} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.itemMeta} numberOfLines={1}>Tracks: {item.entryCount}</Text>
                        {onOpenPlaylists ? (
                          <View style={styles.rowActions}>
                            <AppButton title="OPEN" onPress={onOpenPlaylists} />
                          </View>
                        ) : null}
                      </View>
                    )}
                  />
                </>
              )}
            </>
          )}
        </>
      )}

      {mode === 'folders' && (
        <>
          <View style={styles.folderToolbar}>
            <Pressable
              style={styles.compactAction}
              onPress={() => {
                if (currentFolderSegments.length === 0) {
                  return;
                }
                setCurrentFolderPath(currentFolderSegments.slice(0, -1).join('/'));
              }}
              disabled={currentFolderSegments.length === 0}>
              <Text style={[styles.compactActionLabel, currentFolderSegments.length === 0 ? styles.compactActionLabelDisabled : null]}>UP</Text>
            </Pressable>
            <Pressable
              style={styles.compactAction}
              onPress={() => setCurrentFolderPath('')}
              disabled={currentFolderSegments.length === 0}>
              <Text style={[styles.compactActionLabel, currentFolderSegments.length === 0 ? styles.compactActionLabelDisabled : null]}>ROOT</Text>
            </Pressable>
            <Text style={styles.folderPath} numberOfLines={1}>PATH: /{currentFolderPath || 'ROOT'}</Text>
          </View>
          {songs.length === 0 ? (
            <Text style={styles.hint}>Folders load automatically from your library. If this stays empty, confirm Android audio permission.</Text>
          ) : (
            <FlatList
              scrollEnabled={false}
              style={styles.list}
              data={folderRows.rows}
              keyExtractor={(item, index) =>
                item.kind === 'directory' ? `folder-${item.path}` : `track-${item.track.uri}-${String(index)}`
              }
              renderItem={({item}) => {
                if (item.kind === 'directory') {
                  return (
                    <Pressable style={styles.tableRow} onPress={() => setCurrentFolderPath(item.path)}>
                      <View style={styles.tableContent}>
                        <Text style={styles.itemTitle} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.itemMeta} numberOfLines={1}>Folder • Tracks: {item.trackCount}</Text>
                      </View>
                      <Text style={styles.tableChevron}>›</Text>
                    </Pressable>
                  );
                }

                const trackIndex = songs.findIndex(track => track.uri === item.track.uri);
                return (
                  <Pressable style={styles.tableRow} onLongPress={() => setSelectedSongIndex(trackIndex >= 0 ? trackIndex : null)}>
                    <View style={styles.tableContent}>
                      <Text style={styles.itemTitle} numberOfLines={1}>{item.track.title}</Text>
                      <Text style={styles.itemMeta} numberOfLines={1}>{item.track.artist} • {item.track.album}</Text>
                    </View>
                    <View style={styles.tableAction}>
                      <AppButton
                        title={hasQuickAddTarget && onQuickAddTrack ? 'ADD' : 'PLAY'}
                        onPress={() => {
                          if (hasQuickAddTarget && onQuickAddTrack) {
                            void onQuickAddTrack(item.track);
                            return;
                          }
                          onPlayTracks(folderRows.tracks, item.track.uri, `search:folder:${currentFolderPath}`);
                        }}
                        variant="primary"
                      />
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </>
      )}

      {mode === 'albums' && (
        <>
          {albums.length === 0 ? (
            <Text style={styles.hint}>Albums load automatically from your library.</Text>
          ) : (
            <FlatList
              scrollEnabled={false}
              style={styles.list}
              data={albums}
              keyExtractor={(item, index) => `album-${item.album}-${index}`}
              renderItem={({item}) => (
                <View style={styles.tableRow}>
                  <View style={styles.tableContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.album}</Text>
                    <Text style={styles.itemMeta} numberOfLines={1}>Artist: {item.sampleArtist}</Text>
                  </View>
                  <Text style={styles.tableMeta}>Tracks: {item.trackCount}</Text>
                </View>
              )}
            />
          )}
        </>
      )}

      {mode === 'artists' && (
        <>
          {artists.length === 0 ? (
            <Text style={styles.hint}>Artists load automatically from your library.</Text>
          ) : (
            <FlatList
              scrollEnabled={false}
              style={styles.list}
              data={artists}
              keyExtractor={(item, index) => `artist-${item.artist}-${index}`}
              renderItem={({item}) => (
                <View style={styles.tableRow}>
                  <View style={styles.tableContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.artist}</Text>
                    <Text style={styles.itemMeta}>Albums: {item.albumCount}</Text>
                  </View>
                  <Text style={styles.tableMeta}>Tracks: {item.trackCount}</Text>
                </View>
              )}
            />
          )}
        </>
      )}

      {mode === 'songs' && (
        <>
          <Pressable onPress={() => onPlayTracks(songs, null, 'search:songs')} disabled={songs.length === 0} style={styles.compactAction}>
            <Text style={[styles.compactActionLabel, songs.length === 0 ? styles.compactActionLabelDisabled : null]}>PLAY SONGS</Text>
          </Pressable>
          {songs.length === 0 ? (
            <Text style={styles.hint}>Songs load automatically from your library.</Text>
          ) : null}
          <FlatList
            scrollEnabled={false}
            style={styles.list}
            data={songs}
            keyExtractor={item => `song-${item.uri}`}
            renderItem={({item, index}) => (
              <Pressable style={styles.tableRow} onLongPress={() => setSelectedSongIndex(index)}>
                <View style={styles.tableContent}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>{item.artist} • {item.album}</Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>{normalizeFolderPath(item.relativePath) || 'No folder path'}</Text>
                </View>
                <View style={styles.tableAction}>
                  <AppButton
                    title={hasQuickAddTarget && onQuickAddTrack ? 'ADD' : 'PLAY'}
                    onPress={() => {
                      if (hasQuickAddTarget && onQuickAddTrack) {
                        void onQuickAddTrack(item);
                        return;
                      }
                      onPlayTracks(songs, item.uri, 'search:songs');
                    }}
                    variant="primary"
                  />
                </View>
              </Pressable>
            )}
          />
        </>
      )}

      <TrackActionSheet
        visible={selectedSearchIndex !== null}
        title={selectedSearchIndex === null ? 'Search Result' : (filteredTrackSearchResults[selectedSearchIndex]?.title ?? 'Search Result')}
        subtitle="Search row actions"
        onClose={() => setSelectedSearchIndex(null)}
        actions={
          selectedSearchIndex === null
            ? []
            : [
                {
                  key: 'play',
                  label: 'PLAY RESULTS',
                  primary: true,
                  onPress: () =>
                    onPlayTracks(filteredTrackSearchResults, filteredTrackSearchResults[selectedSearchIndex]?.uri ?? null, 'search'),
                  disabled: filteredTrackSearchResults.length === 0,
                },
                {
                  key: 'add',
                  label: 'ADD TO SELECTED PLAYLIST',
                  onPress: () => {
                    const selectedTrack = filteredTrackSearchResults[selectedSearchIndex];
                    if (selectedTrack && onQuickAddTrack) {
                      void onQuickAddTrack(selectedTrack);
                    }
                  },
                  disabled: !hasQuickAddTarget || !onQuickAddTrack,
                },
              ]
        }
      />

      <TrackActionSheet
        visible={selectedSongIndex !== null}
        title={selectedSongIndex === null ? 'Song' : (songs[selectedSongIndex]?.title ?? 'Song')}
        subtitle="Song row actions"
        onClose={() => setSelectedSongIndex(null)}
        actions={
          selectedSongIndex === null
            ? []
            : [
                {
                  key: 'play',
                  label: 'PLAY SONGS',
                  primary: true,
                  onPress: () => onPlayTracks(songs, songs[selectedSongIndex]?.uri ?? null, 'search:songs'),
                  disabled: songs.length === 0,
                },
                {
                  key: 'add',
                  label: 'ADD TO SELECTED PLAYLIST',
                  onPress: () => {
                    const selectedTrack = songs[selectedSongIndex];
                    if (selectedTrack && onQuickAddTrack) {
                      void onQuickAddTrack(selectedTrack);
                    }
                  },
                  disabled: !hasQuickAddTarget || !onQuickAddTrack,
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
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  scopeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  scopeButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.backgroundElevated,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  scopeButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  scopeMenu: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.sm,
    backgroundColor: colors.backgroundElevated,
    overflow: 'hidden',
  },
  scopeMenuItem: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  scopeMenuItemActive: {
    backgroundColor: colors.backgroundCard,
  },
  scopeMenuItemText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  scopeMenuItemTextActive: {
    color: colors.textPrimary,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.backgroundElevated,
  },
  segmentInactive: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.backgroundElevated,
  },
  segmentPressed: {
    opacity: 0.88,
  },
  segmentText: {
    fontSize: 10,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: colors.textPrimary,
  },
  segmentTextInactive: {
    color: colors.textSecondary,
  },
  buttonWrap: {
    flex: 1,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.backgroundElevated,
    paddingHorizontal: 10,
    paddingVertical: 8,
    width: '100%',
    fontSize: 13,
    color: colors.textPrimary,
  },
  list: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.sm,
    padding: spacing.sm,
    backgroundColor: colors.backgroundElevated,
  },
  item: {
    marginBottom: 8,
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
  tableMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  tableAction: {
    minWidth: 92,
  },
  tableChevron: {
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  folderToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  folderPath: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  itemMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  hint: {
    fontSize: 11,
    color: colors.textMuted,
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
