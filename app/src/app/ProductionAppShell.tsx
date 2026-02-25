import {memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {FlashList} from '@shopify/flash-list';

import {IndexedLibraryPanel, useIndexedLibraryPanelState} from '../features/library/IndexedLibraryPanel';
import {MediaStorePanel} from '../features/library/MediaStorePanel';
import {SafRootScanPanel} from '../features/library/SafRootScanPanel';
import {SearchBrowsePanel} from '../features/library/SearchBrowsePanel';
import {CompactSongRow} from '../features/library/CompactSongRow';
import {useBackgroundSyncOrchestrator} from '../features/library/useBackgroundSyncOrchestrator';
import {useMediaStoreScan} from '../features/library/useMediaStoreScan';
import {useSafRootScan} from '../features/library/useSafRootScan';
import {useSearchBrowse} from '../features/library/useSearchBrowse';
import {useAudioPermission} from '../features/permissions/useAudioPermission';
import {NowPlayingPanel} from '../features/playback/NowPlayingPanel';
import {useNowPlayingState} from '../features/playback/useNowPlayingState';
import {usePlaybackService} from '../features/playback/usePlaybackService';
import {PlaylistImportPanel} from '../features/playlists/PlaylistImportPanel';
import {usePlaylistImport} from '../features/playlists/usePlaylistImport';
import {useUserPlaylists} from '../features/playlists/useUserPlaylists';
import {FolderQueuePanel} from '../features/queue/FolderQueuePanel';
import {QueueEditorPanel} from '../features/queue/QueueEditorPanel';
import {useFolderQueue} from '../features/queue/useFolderQueue';
import {DeviceSetupPanel} from '../features/reliability/DeviceSetupPanel';
import {useDeviceSetupGuidance} from '../features/reliability/useDeviceSetupGuidance';
import {FolderGrantsPanel} from '../features/storage/FolderGrantsPanel';
import {useFolderGrants} from '../features/storage/useFolderGrants';
import {MediaStoreTrack} from '../native/modules';
import {AppButton} from '../ui/components/AppButton';
import {IconTabBar} from '../ui/components/IconTabBar';
import {MiniNowPlayingDock} from '../ui/components/MiniNowPlayingDock';
import {SectionCard} from '../ui/components/SectionCard';
import {StatusChip} from '../ui/components/StatusChip';
import {colors, radii, spacing} from '../ui/theme';
import {baseThemePresets, fontOptions, highlightThemePresets, ThemeColors, useTheme} from '../ui/themeRuntime';
import {kvStore} from '../platform/storage/kvStore';
import {AnySupportedTabKey, resolveAppTabKey} from './tabCompatibility';

type TabKey = 'home' | 'search' | 'yourLibrary' | 'create' | 'settings' | 'nowplaying';
type LibraryView = 'allSongs' | 'playlists' | 'albums' | 'artists' | 'folders';
type AllSongsSortMode = 'name' | 'album' | 'artist' | 'lastPlayed' | 'mostPlayed' | 'length';
type HomeFeedTab = 'recentlyAdded' | 'mostPlayed' | 'popularSongs';
type PlaylistsSubPage = 'home' | 'detail' | 'add' | 'import';
type SettingsSubPage = 'home' | 'librarySetup' | 'libraryMaintenance' | 'reliabilityTools';
type CreateSubPage = 'home' | 'newPlaylist' | 'addToExisting';

function allSongsSortLabel(mode: AllSongsSortMode): string {
  if (mode === 'lastPlayed') {
    return 'LAST PLAYED';
  }
  if (mode === 'mostPlayed') {
    return 'MOST PLAYED';
  }

  return mode.toUpperCase();
}

type PersistedShellState = {
  activeTab: TabKey;
  libraryView: LibraryView;
  allSongsSortMode: AllSongsSortMode;
  homeFeedTab: HomeFeedTab;
  playlistsSubPage: PlaylistsSubPage;
  settingsSubPage: SettingsSubPage;
  createSubPage: CreateSubPage;
  createDraftName: string;
  createSongQuery: string;
  selectedAlbumName: string | null;
  selectedArtistName: string | null;
  selectedFolderPath: string | null;
};

const APP_SHELL_STATE_KEY = 'android_music_player.shell_state.v1';

function isTabKey(value: unknown): value is TabKey {
  return value === 'home' || value === 'search' || value === 'yourLibrary' || value === 'create' || value === 'settings' || value === 'nowplaying';
}

function isLibraryView(value: unknown): value is LibraryView {
  return value === 'allSongs' || value === 'playlists' || value === 'albums' || value === 'artists' || value === 'folders';
}

function isAllSongsSortMode(value: unknown): value is AllSongsSortMode {
  return value === 'name' || value === 'album' || value === 'artist' || value === 'lastPlayed' || value === 'mostPlayed' || value === 'length';
}

function isHomeFeedTab(value: unknown): value is HomeFeedTab {
  return value === 'recentlyAdded' || value === 'mostPlayed' || value === 'popularSongs';
}

function isPlaylistsSubPage(value: unknown): value is PlaylistsSubPage {
  return value === 'home' || value === 'detail' || value === 'add' || value === 'import';
}

function isSettingsSubPage(value: unknown): value is SettingsSubPage {
  return value === 'home' || value === 'librarySetup' || value === 'libraryMaintenance' || value === 'reliabilityTools';
}

function isCreateSubPage(value: unknown): value is CreateSubPage {
  return value === 'home' || value === 'newPlaylist' || value === 'addToExisting';
}

function isValidHexColor(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

function pseudoPopularityScore(track: MediaStoreTrack) {
  const durationScore = Math.max(0, track.durationMs);
  const sizeScore = Math.max(0, Math.floor(track.sizeBytes / 1024) % 1000);
  return durationScore + sizeScore;
}

function deepestFolderName(path: string): string {
  const segments = path
    .split('/')
    .map(item => item.trim())
    .filter(Boolean);

  return segments[segments.length - 1] ?? path;
}

function parseTrackNumber(text: string): number | null {
  const cleaned = text.trim();
  if (!cleaned) {
    return null;
  }

  const patterns = [
    /^(\d{1,3})\s*[.\-_:)]\s*/,
    /^(\d{1,3})\s+/,
    /^track\s*(\d{1,3})\b/i,
    /^no\.?\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s*\/\s*\d{1,3}\b/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) {
      continue;
    }

    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function inferredTrackOrder(track: MediaStoreTrack): number | null {
  const displayNameWithoutExtension = track.displayName.replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const fromDisplayName = parseTrackNumber(displayNameWithoutExtension);
  if (fromDisplayName !== null) {
    return fromDisplayName;
  }

  return parseTrackNumber(track.title);
}

function compareTracksByTrackThenTitle(left: MediaStoreTrack, right: MediaStoreTrack): number {
  const leftOrder = inferredTrackOrder(left);
  const rightOrder = inferredTrackOrder(right);

  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  if (leftOrder !== null && rightOrder === null) {
    return -1;
  }

  if (leftOrder === null && rightOrder !== null) {
    return 1;
  }

  const titleCompare = left.title.localeCompare(right.title, undefined, {numeric: true, sensitivity: 'base'});
  if (titleCompare !== 0) {
    return titleCompare;
  }

  return left.uri.localeCompare(right.uri);
}

function runWhenIdle(callback: () => void): {cancel: () => void} {
  const globalScope = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  let cancelled = false;

  const invoke = () => {
    if (cancelled) {
      return;
    }
    callback();
  };

  if (typeof globalScope.requestIdleCallback === 'function') {
    const idleCallbackId = globalScope.requestIdleCallback(() => {
      invoke();
    });

    return {
      cancel: () => {
        cancelled = true;
        if (typeof globalScope.cancelIdleCallback === 'function') {
          globalScope.cancelIdleCallback(idleCallbackId);
        }
      },
    };
  }

  const timeoutId = setTimeout(() => {
    invoke();
  }, 0);

  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timeoutId);
    },
  };
}

function statusIndicatesWorkInProgress(statusText: string): boolean {
  const value = statusText.toLowerCase().trim();
  if (!value) {
    return false;
  }

  const terminalKeywords = [
    'idle',
    'complete',
    'completed',
    'loaded',
    'synced',
    'fresh',
    'failed',
    'error',
    'paused',
    'unavailable',
    'cancelled',
    'no sync snapshots',
    'waiting for permission',
  ];

  if (terminalKeywords.some(keyword => value.includes(keyword))) {
    return false;
  }

  const inProgressKeywords = [
    'loading',
    'running',
    'scanning',
    'syncing',
    'validating',
    'in progress',
    'already in progress',
    'bootstrapping',
  ];

  return inProgressKeywords.some(keyword => value.includes(keyword));
}

const TAB_ORDER: Array<{key: TabKey; label: string; icon: string; accessibilityLabel: string}> = [
  {key: 'home', label: 'HOME', icon: '⌂', accessibilityLabel: 'HOME'},
  {key: 'search', label: 'SEARCH', icon: '⌕', accessibilityLabel: 'SEARCH'},
  {key: 'yourLibrary', label: 'LIBRARY', icon: '☰', accessibilityLabel: 'LIBRARY'},
  {key: 'create', label: 'CREATE', icon: '✚', accessibilityLabel: 'CREATE'},
  {key: 'settings', label: 'SETTINGS', icon: '⚙', accessibilityLabel: 'SETTINGS'},
];

type ProductionStyles = ReturnType<typeof createStyles>;
type StatusChipTone = React.ComponentProps<typeof StatusChip>['tone'];

type HomeTabSceneProps = {
  styles: ProductionStyles;
  loadingIndicatorColor: string;
  totalTracks: number;
  folderCount: number;
  lastAutoSyncAt: string;
  autoSyncTone: StatusChipTone;
  homeFeedTab: HomeFeedTab;
  onSelectHomeFeedTab: (tab: HomeFeedTab) => void;
  homeBrowseHasError: boolean;
  browseStatus: string;
  songsLength: number;
  homeBrowseIsLoading: boolean;
  defaultMusicFolder: string;
  activeHomeFeedSongs: MediaStoreTrack[];
  currentTrackUri: string | null;
  isPlaying: boolean;
  isLibraryDataLoading: boolean;
  onPlayFromHomeFeed: (trackUri: string) => void;
  needsQuickStart: boolean;
  miniPlayerStatus: string;
};

const HOME_FEED_ITEMS: ReadonlyArray<{key: HomeFeedTab; label: string}> = [
  {key: 'recentlyAdded', label: 'RECENTLY ADDED'},
  {key: 'mostPlayed', label: 'MOST PLAYED'},
  {key: 'popularSongs', label: 'POPULAR SONGS'},
];

const HomeTabScene = memo(function HomeTabScene({
  styles,
  loadingIndicatorColor,
  totalTracks,
  folderCount,
  lastAutoSyncAt,
  autoSyncTone,
  homeFeedTab,
  onSelectHomeFeedTab,
  homeBrowseHasError,
  browseStatus,
  songsLength,
  homeBrowseIsLoading,
  defaultMusicFolder,
  activeHomeFeedSongs,
  currentTrackUri,
  isPlaying,
  isLibraryDataLoading,
  onPlayFromHomeFeed,
  needsQuickStart,
  miniPlayerStatus,
}: HomeTabSceneProps) {
  const loadingPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isLibraryDataLoading) {
      loadingPulse.stopAnimation();
      loadingPulse.setValue(0);
      return;
    }

    const animationLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(loadingPulse, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(loadingPulse, {
          toValue: 0,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    animationLoop.start();

    return () => {
      animationLoop.stop();
    };
  }, [isLibraryDataLoading, loadingPulse]);

  const loadingLabelOpacity = loadingPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });

  return (
    <>
      <View style={styles.homeStatusStrip}>
        <StatusChip label={`TRACKS: ${String(totalTracks)}`} tone={totalTracks > 0 ? 'success' : 'neutral'} />
        <StatusChip label={`FOLDERS: ${String(folderCount)}`} tone="success" />
        <StatusChip label={`LAST SYNC: ${lastAutoSyncAt.toUpperCase()}`} tone={autoSyncTone} />
        {isLibraryDataLoading ? (
          <View style={styles.homeLoadingIndicator}>
            <ActivityIndicator size="small" color={loadingIndicatorColor} />
            <Animated.Text style={[styles.homeLoadingLabel, {opacity: loadingLabelOpacity}]}>LOADING</Animated.Text>
          </View>
        ) : null}
      </View>

      <SectionCard title="Music" subtitle="Browse quick feeds from your library.">
        <View style={styles.libraryPillRow}>
          {HOME_FEED_ITEMS.map(item => {
            const active = homeFeedTab === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                onPress={() => onSelectHomeFeedTab(item.key)}
                style={({pressed}) => [
                  styles.libraryPill,
                  active ? styles.libraryPillActive : styles.libraryPillInactive,
                  pressed ? styles.libraryPillPressed : null,
                ]}>
                <Text style={[styles.libraryPillLabel, active ? styles.libraryPillLabelActive : styles.libraryPillLabelInactive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {homeBrowseHasError ? (
          <View style={styles.statusRow}>
            <StatusChip label={`DISCOVERY: ${browseStatus.toUpperCase()}`} tone="danger" />
          </View>
        ) : null}

        {songsLength === 0 ? (
          <Text style={styles.meta}>
            {homeBrowseHasError
              ? 'Library discovery failed. Open Search or Your Library to retry loading tracks.'
              : homeBrowseIsLoading
                ? 'Loading library songs...'
                : `No songs yet. Library sync runs automatically from ${defaultMusicFolder} after audio permission is granted.`}
          </Text>
        ) : (
          <FlashList
            data={activeHomeFeedSongs.slice(0, 8)}
            keyExtractor={(item, index) => `home-feed-song-${item.uri}-${String(index)}`}
            renderItem={({item}) => (
              <CompactSongRow
                track={item}
                isCurrent={currentTrackUri === item.uri}
                isPlaying={isPlaying}
                onPlay={onPlayFromHomeFeed}
              />
            )}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.virtualizedListMedium}
            contentContainerStyle={styles.virtualizedListContainer}
          />
        )}

        {needsQuickStart && (
          <View style={styles.quickStartCard}>
            <Text style={styles.quickStartStep}>Android will request audio access once. Approve it to continue straight into your music.</Text>
          </View>
        )}

        {miniPlayerStatus ? (
          <View style={styles.statusRow}>
            <StatusChip label={`MINI PLAYER: ${miniPlayerStatus.toUpperCase()}`} tone="warning" />
          </View>
        ) : null}
      </SectionCard>
    </>
  );
});

type SearchTabSceneProps = {
  browseStatus: string;
  browseSearchResults: MediaStoreTrack[];
  browsePlaylistSearchResults: ReturnType<typeof useSearchBrowse>['playlistSearchResults'];
  playlists: ReturnType<typeof useUserPlaylists>['playlists'];
  albums: ReturnType<typeof useSearchBrowse>['albums'];
  artists: ReturnType<typeof useSearchBrowse>['artists'];
  songs: ReturnType<typeof useSearchBrowse>['songs'];
  relevanceReport: ReturnType<typeof useSearchBrowse>['relevanceReport'];
  onSearch: ReturnType<typeof useSearchBrowse>['search'];
  onBrowseAlbums: ReturnType<typeof useSearchBrowse>['browseAlbums'];
  onBrowseArtists: ReturnType<typeof useSearchBrowse>['browseArtists'];
  onBrowseSongs: ReturnType<typeof useSearchBrowse>['browseSongs'];
  onPlayFromBrowse: ReturnType<typeof useSearchBrowse>['playFromBrowse'];
  onValidateRelevance: ReturnType<typeof useSearchBrowse>['validateSearchRelevance'];
  onQuickAddTrack: ReturnType<typeof useUserPlaylists>['addTrack'];
  onOpenPlaylists: () => void;
  hasQuickAddTarget: boolean;
};

const SearchTabScene = memo(function SearchTabScene({
  browseStatus,
  browseSearchResults,
  browsePlaylistSearchResults,
  playlists,
  albums,
  artists,
  songs,
  relevanceReport,
  onSearch,
  onBrowseAlbums,
  onBrowseArtists,
  onBrowseSongs,
  onPlayFromBrowse,
  onValidateRelevance,
  onQuickAddTrack,
  onOpenPlaylists,
  hasQuickAddTarget,
}: SearchTabSceneProps) {
  return (
    <SearchBrowsePanel
      status={browseStatus}
      searchResults={browseSearchResults}
      playlistSearchResults={browsePlaylistSearchResults}
      userPlaylists={playlists}
      albums={albums}
      artists={artists}
      songs={songs}
      relevanceReport={relevanceReport}
      onSearch={onSearch}
      onBrowseAlbums={onBrowseAlbums}
      onBrowseArtists={onBrowseArtists}
      onBrowseSongs={onBrowseSongs}
      onPlayFromBrowse={onPlayFromBrowse}
      onValidateRelevance={onValidateRelevance}
      onQuickAddTrack={onQuickAddTrack}
      onOpenPlaylists={onOpenPlaylists}
      hasQuickAddTarget={hasQuickAddTarget}
      showAdvancedSearchTools={false}
    />
  );
});

type CreateTabSceneProps = {
  styles: ProductionStyles;
  playlistsCount: number;
  songsCount: number;
  selectedPlaylist: ReturnType<typeof useUserPlaylists>['playlists'][number] | null;
  selectedPlaylistId: number | null;
  createSubPage: CreateSubPage;
  onSelectCreateSubPage: (value: CreateSubPage) => void;
  createDraftName: string;
  onCreateDraftNameChange: (value: string) => void;
  createSongQuery: string;
  onCreateSongQueryChange: (value: string) => void;
  onCreatePlaylist: () => void;
  onSearchSongs: () => void;
  onOpenPlaylistAdd: () => void;
  userPlaylistSearchResults: ReturnType<typeof useUserPlaylists>['searchResults'];
  onAddToExisting: (track: MediaStoreTrack) => void;
  onAddToNew: (track: MediaStoreTrack) => void;
};

const CREATE_SUB_PAGE_ITEMS: ReadonlyArray<{key: CreateSubPage; label: string}> = [
  {key: 'home', label: 'HOME'},
  {key: 'newPlaylist', label: 'NEW PLAYLIST'},
  {key: 'addToExisting', label: 'ADD TO EXISTING'},
];

const CreateTabScene = memo(function CreateTabScene({
  styles,
  playlistsCount,
  songsCount,
  selectedPlaylist,
  selectedPlaylistId,
  createSubPage,
  onSelectCreateSubPage,
  createDraftName,
  onCreateDraftNameChange,
  createSongQuery,
  onCreateSongQueryChange,
  onCreatePlaylist,
  onSearchSongs,
  onOpenPlaylistAdd,
  userPlaylistSearchResults,
  onAddToExisting,
  onAddToNew,
}: CreateTabSceneProps) {
  return (
    <SectionCard title="Create" subtitle="Playlist authoring workspace.">
      <View style={styles.statusRow}>
        <StatusChip label={`PLAYLISTS: ${String(playlistsCount)}`} tone={playlistsCount > 0 ? 'success' : 'neutral'} />
        <StatusChip label={`ALL SONGS: ${String(songsCount)}`} tone={songsCount > 0 ? 'success' : 'neutral'} />
      </View>

      <View style={styles.libraryPillRow}>
        {CREATE_SUB_PAGE_ITEMS.map(item => {
          const active = createSubPage === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={() => onSelectCreateSubPage(item.key)}
              style={({pressed}) => [
                styles.libraryPill,
                active ? styles.libraryPillActive : styles.libraryPillInactive,
                pressed ? styles.libraryPillPressed : null,
              ]}>
              <Text style={[styles.libraryPillLabel, active ? styles.libraryPillLabelActive : styles.libraryPillLabelInactive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {createSubPage === 'home' && (
        <View style={styles.createPanel}>
          <Text style={styles.meta}>Create flow shell is active. Choose a mode to begin authoring.</Text>
          <View style={styles.row}>
            <View style={styles.buttonWrap}>
              <AppButton title="NEW PLAYLIST" onPress={() => onSelectCreateSubPage('newPlaylist')} variant="primary" />
            </View>
            <View style={styles.buttonWrap}>
              <AppButton title="ADD TO EXISTING" onPress={() => onSelectCreateSubPage('addToExisting')} />
            </View>
          </View>
        </View>
      )}

      {createSubPage === 'newPlaylist' && (
        <View style={styles.createPanel}>
          <Text style={styles.sectionTitle}>New Playlist Draft</Text>
          <TextInput
            style={styles.createInput}
            value={createDraftName}
            onChangeText={onCreateDraftNameChange}
            placeholder="Playlist name"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.row}>
            <View style={styles.buttonWrap}>
              <AppButton
                title="CREATE PLAYLIST"
                onPress={onCreatePlaylist}
                variant="primary"
                disabled={createDraftName.trim().length === 0}
              />
            </View>
          </View>
          <Text style={styles.meta}>Set a draft name, then use it for direct create or add-to-new actions.</Text>
        </View>
      )}

      {createSubPage === 'addToExisting' && (
        <View style={styles.createPanel}>
          <Text style={styles.sectionTitle}>Song Picker</Text>
          <Text style={styles.meta}>
            {selectedPlaylist ? `Target playlist: ${selectedPlaylist.name}` : 'No playlist selected yet. Create one first.'}
          </Text>
          <TextInput
            style={styles.createInput}
            value={createSongQuery}
            onChangeText={onCreateSongQueryChange}
            placeholder="Search songs to add"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.row}>
            <View style={styles.buttonWrap}>
              <AppButton title="SEARCH SONGS" onPress={onSearchSongs} variant="primary" />
            </View>
            <View style={styles.buttonWrap}>
              <AppButton title="OPEN PLAYLIST ADD" onPress={onOpenPlaylistAdd} disabled={selectedPlaylistId === null} />
            </View>
          </View>
          {createDraftName.trim().length === 0 && (
            <Text style={styles.meta}>Tip: set a playlist draft name in NEW PLAYLIST to enable ADD TO NEW.</Text>
          )}
          <FlashList
            data={userPlaylistSearchResults}
            keyExtractor={item => `create-result-${item.uri}`}
            renderItem={({item: track}) => (
              <View style={styles.trackRow}>
                <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
                <Text style={styles.trackMeta} numberOfLines={1}>{track.artist} • {track.album}</Text>
                <View style={styles.row}>
                  <View style={styles.buttonWrap}>
                    <AppButton
                      title="ADD TO EXISTING"
                      onPress={() => onAddToExisting(track)}
                      disabled={selectedPlaylistId === null}
                    />
                  </View>
                  <View style={styles.buttonWrap}>
                    <AppButton
                      title="ADD TO NEW"
                      onPress={() => onAddToNew(track)}
                      disabled={createDraftName.trim().length === 0}
                      variant="primary"
                    />
                  </View>
                </View>
              </View>
            )}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.virtualizedListMedium}
            contentContainerStyle={styles.virtualizedListContainer}
          />
        </View>
      )}
    </SectionCard>
  );
});

type FolderGroupRow = {path: string; trackCount: number; sampleArtist: string};

type YourLibraryTabSceneProps = {
  styles: ProductionStyles;
  loadingIndicatorColor: string;
  isLibraryDataLoading: boolean;
  libraryView: LibraryView;
  onSelectLibraryView: (value: LibraryView) => void;
  allSongsSortMode: AllSongsSortMode;
  showAllSongsSortMenu: boolean;
  onToggleAllSongsSortMenu: () => void;
  onSelectAllSongsSortMode: (mode: AllSongsSortMode) => void;
  songsLength: number;
  sortedAllSongs: MediaStoreTrack[];
  currentTrackUri: string | null;
  isPlaying: boolean;
  onPlayTrackFromList: (trackList: MediaStoreTrack[], trackUri: string, sourceLabel: string) => void;
  selectedAlbumName: string | null;
  onSelectAlbumName: (value: string | null) => void;
  selectedAlbumSongs: MediaStoreTrack[];
  albums: ReturnType<typeof useSearchBrowse>['albums'];
  selectedArtistName: string | null;
  onSelectArtistName: (value: string | null) => void;
  selectedArtistSongs: MediaStoreTrack[];
  artists: ReturnType<typeof useSearchBrowse>['artists'];
  selectedFolderPath: string | null;
  onSelectFolderPath: (value: string | null) => void;
  selectedFolderSongs: MediaStoreTrack[];
  folderGroups: FolderGroupRow[];
  playlists: ReturnType<typeof useUserPlaylists>['playlists'];
  onSelectPlaylist: (playlistId: number) => void;
};

const LIBRARY_VIEW_ITEMS: ReadonlyArray<{key: LibraryView; label: string}> = [
  {key: 'playlists', label: 'PLAYLISTS'},
  {key: 'albums', label: 'ALBUMS'},
  {key: 'artists', label: 'ARTISTS'},
  {key: 'folders', label: 'FOLDERS'},
  {key: 'allSongs', label: 'ALL SONGS'},
];

const ALL_SONG_SORT_ITEMS: ReadonlyArray<{key: AllSongsSortMode; label: string}> = [
  {key: 'name', label: 'NAME'},
  {key: 'album', label: 'ALBUM'},
  {key: 'artist', label: 'ARTIST'},
  {key: 'lastPlayed', label: 'LAST PLAYED'},
  {key: 'mostPlayed', label: 'MOST PLAYED'},
  {key: 'length', label: 'LENGTH'},
];

const YourLibraryTabScene = memo(function YourLibraryTabScene({
  styles,
  loadingIndicatorColor,
  isLibraryDataLoading,
  libraryView,
  onSelectLibraryView,
  allSongsSortMode,
  showAllSongsSortMenu,
  onToggleAllSongsSortMenu,
  onSelectAllSongsSortMode,
  songsLength,
  sortedAllSongs,
  currentTrackUri,
  isPlaying,
  onPlayTrackFromList,
  selectedAlbumName,
  onSelectAlbumName,
  selectedAlbumSongs,
  albums,
  selectedArtistName,
  onSelectArtistName,
  selectedArtistSongs,
  artists,
  selectedFolderPath,
  onSelectFolderPath,
  selectedFolderSongs,
  folderGroups,
  playlists,
  onSelectPlaylist,
}: YourLibraryTabSceneProps) {
  return (
    <View style={styles.libraryScene}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.libraryTopPillRow}
        style={styles.libraryTopPillScroll}>
        {LIBRARY_VIEW_ITEMS.map(item => {
          const active = libraryView === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelectLibraryView(item.key)}
              style={({pressed}) => [
                styles.libraryPill,
                styles.libraryTopPill,
                active ? styles.libraryPillActive : styles.libraryPillInactive,
                pressed ? styles.libraryPillPressed : null,
              ]}>
              <Text style={[styles.libraryPillLabel, active ? styles.libraryPillLabelActive : styles.libraryPillLabelInactive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

        <View style={styles.librarySceneContent}>

      {libraryView === 'allSongs' && (
        <SectionCard
          title="All Songs"
          titleRight={(
            <Pressable
              onPress={onToggleAllSongsSortMenu}
              style={styles.librarySortSelectorButton}>
              <Text style={styles.librarySortSelectorButtonText}>
                {allSongsSortLabel(allSongsSortMode)} {showAllSongsSortMenu ? '▴' : '▾'}
              </Text>
            </Pressable>
          )}>
          {showAllSongsSortMenu && (
            <View style={styles.librarySortMenuFloating}>
              {ALL_SONG_SORT_ITEMS.map(item => {
                const active = allSongsSortMode === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onSelectAllSongsSortMode(item.key)}
                    style={[styles.librarySortMenuItem, active ? styles.librarySortMenuItemActive : null]}>
                    <Text style={[styles.librarySortMenuItemText, active ? styles.librarySortMenuItemTextActive : null]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {(allSongsSortMode === 'lastPlayed' || allSongsSortMode === 'mostPlayed') ? (
            <Text style={styles.meta}>Last Played and Most Played currently use deterministic local signals until play-history indexing lands.</Text>
          ) : null}
          {songsLength === 0 ? (
            <Text style={styles.meta}>No songs available yet. Library sync will populate this list automatically.</Text>
          ) : (
            <FlashList
              data={sortedAllSongs.slice(0, 80)}
              keyExtractor={(item, index) => `library-all-song-${item.uri}-${String(index)}`}
              renderItem={({item}) => (
                <CompactSongRow
                  track={item}
                  isCurrent={currentTrackUri === item.uri}
                  isPlaying={isPlaying}
                  onPlay={trackUri => onPlayTrackFromList(sortedAllSongs, trackUri, 'library:allSongs')}
                />
              )}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.virtualizedListTall}
              contentContainerStyle={styles.virtualizedListContainer}
            />
          )}
        </SectionCard>
      )}

      {libraryView === 'albums' && (
        <SectionCard
          title={selectedAlbumName !== null ? 'Album' : 'Albums'}
          titleRight={selectedAlbumName !== null ? (
            <Pressable
              onPress={() => onSelectAlbumName(null)}
              style={({pressed}) => [styles.libraryHeaderBackButton, pressed ? styles.libraryPillPressed : null]}>
              <Text style={styles.libraryHeaderBackButtonLabel}>← back</Text>
            </Pressable>
          ) : undefined}>
          {selectedAlbumName !== null ? (
            <>
              <Text style={styles.librarySelectionName}>{selectedAlbumName}</Text>
              {selectedAlbumSongs.length === 0 ? (
                <Text style={styles.meta}>No songs found for this album.</Text>
              ) : (
                <FlashList
                  data={selectedAlbumSongs}
                  keyExtractor={(item, index) => `library-album-song-${item.uri}-${String(index)}`}
                  renderItem={({item}) => (
                    <CompactSongRow
                      track={item}
                      isCurrent={currentTrackUri === item.uri}
                      isPlaying={isPlaying}
                      onPlay={trackUri => onPlayTrackFromList(selectedAlbumSongs, trackUri, `library:album:${selectedAlbumName}`)}
                    />
                  )}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  style={styles.virtualizedListTall}
                  contentContainerStyle={styles.virtualizedListContainer}
                />
              )}
            </>
          ) : albums.length === 0 ? (
            <Text style={styles.meta}>No albums available yet.</Text>
          ) : (
            <FlashList
              data={albums}
              keyExtractor={(item, index) => `library-album-${item.album}-${String(index)}`}
              renderItem={({item}) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onSelectAlbumName(item.album)}
                  style={({pressed}) => [styles.trackRow, pressed ? styles.libraryPillPressed : null]}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{item.album}</Text>
                  <Text style={styles.trackMeta} numberOfLines={1}>{item.sampleArtist} • Tracks: {item.trackCount}</Text>
                </Pressable>
              )}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.virtualizedListTall}
              contentContainerStyle={styles.virtualizedListContainer}
            />
          )}
        </SectionCard>
      )}

      {libraryView === 'artists' && (
        <SectionCard
          title={selectedArtistName !== null ? 'Artist' : 'Artists'}
          titleRight={selectedArtistName !== null ? (
            <Pressable
              onPress={() => onSelectArtistName(null)}
              style={({pressed}) => [styles.libraryHeaderBackButton, pressed ? styles.libraryPillPressed : null]}>
              <Text style={styles.libraryHeaderBackButtonLabel}>← back</Text>
            </Pressable>
          ) : undefined}>
          {selectedArtistName !== null ? (
            <>
              <Text style={styles.librarySelectionName}>{selectedArtistName}</Text>
              {selectedArtistSongs.length === 0 ? (
                <Text style={styles.meta}>No songs found for this artist.</Text>
              ) : (
                <FlashList
                  data={selectedArtistSongs}
                  keyExtractor={(item, index) => `library-artist-song-${item.uri}-${String(index)}`}
                  renderItem={({item}) => (
                    <CompactSongRow
                      track={item}
                      isCurrent={currentTrackUri === item.uri}
                      isPlaying={isPlaying}
                      onPlay={trackUri => onPlayTrackFromList(selectedArtistSongs, trackUri, `library:artist:${selectedArtistName}`)}
                    />
                  )}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  style={styles.virtualizedListTall}
                  contentContainerStyle={styles.virtualizedListContainer}
                />
              )}
            </>
          ) : artists.length === 0 ? (
            <Text style={styles.meta}>No artists available yet.</Text>
          ) : (
            <FlashList
              data={artists}
              keyExtractor={(item, index) => `library-artist-${item.artist}-${String(index)}`}
              renderItem={({item}) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onSelectArtistName(item.artist)}
                  style={({pressed}) => [styles.trackRow, pressed ? styles.libraryPillPressed : null]}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{item.artist}</Text>
                  <Text style={styles.trackMeta} numberOfLines={1}>Albums: {item.albumCount} • Tracks: {item.trackCount}</Text>
                </Pressable>
              )}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.virtualizedListTall}
              contentContainerStyle={styles.virtualizedListContainer}
            />
          )}
        </SectionCard>
      )}

      {libraryView === 'folders' && (
        <SectionCard
          title={selectedFolderPath !== null ? 'Folder' : 'Folders'}
          titleRight={selectedFolderPath !== null ? (
            <Pressable
              onPress={() => onSelectFolderPath(null)}
              style={({pressed}) => [styles.libraryHeaderBackButton, pressed ? styles.libraryPillPressed : null]}>
              <Text style={styles.libraryHeaderBackButtonLabel}>← back</Text>
            </Pressable>
          ) : undefined}>
          {selectedFolderPath !== null ? (
            <>
              <Text style={styles.librarySelectionName}>{selectedFolderPath}</Text>
              {selectedFolderSongs.length === 0 ? (
                <Text style={styles.meta}>No songs found for this folder.</Text>
              ) : (
                <FlashList
                  data={selectedFolderSongs}
                  keyExtractor={(item, index) => `library-folder-song-${item.uri}-${String(index)}`}
                  renderItem={({item}) => (
                    <CompactSongRow
                      track={item}
                      isCurrent={currentTrackUri === item.uri}
                      isPlaying={isPlaying}
                      onPlay={trackUri => onPlayTrackFromList(selectedFolderSongs, trackUri, `library:folder:${selectedFolderPath}`)}
                    />
                  )}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  style={styles.virtualizedListTall}
                  contentContainerStyle={styles.virtualizedListContainer}
                />
              )}
            </>
          ) : folderGroups.length === 0 ? (
            <Text style={styles.meta}>No folders available yet.</Text>
          ) : (
            <FlashList
              data={folderGroups}
              keyExtractor={(item, index) => `library-folder-${item.path}-${String(index)}`}
              renderItem={({item}) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onSelectFolderPath(item.path)}
                  style={({pressed}) => [styles.trackRow, pressed ? styles.libraryPillPressed : null]}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{deepestFolderName(item.path)}</Text>
                  <Text style={styles.trackSubMeta} numberOfLines={1}>{item.path}</Text>
                  <Text style={styles.trackMeta} numberOfLines={1}>{item.sampleArtist || 'Unknown artist'} • Tracks: {item.trackCount}</Text>
                </Pressable>
              )}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.virtualizedListTall}
              contentContainerStyle={styles.virtualizedListContainer}
            />
          )}
        </SectionCard>
      )}

      {libraryView === 'playlists' && (
        <SectionCard title="Playlists">
          {playlists.length === 0 ? (
            <Text style={styles.meta}>No playlists yet.</Text>
          ) : (
            <FlashList
              data={playlists}
              keyExtractor={(item, index) => `library-playlist-${item.id}-${String(index)}`}
              renderItem={({item}) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onSelectPlaylist(item.id)}
                  style={({pressed}) => [styles.trackRow, pressed ? styles.libraryPillPressed : null]}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.trackMeta} numberOfLines={1}>Tracks: {item.entryCount}</Text>
                </Pressable>
              )}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.virtualizedListTall}
              contentContainerStyle={styles.virtualizedListContainer}
            />
          )}
        </SectionCard>
      )}

      {isLibraryDataLoading ? (
        <View pointerEvents="none" style={styles.libraryLoadingOverlay}>
          <ActivityIndicator size="small" color={loadingIndicatorColor} />
        </View>
      ) : null}
      </View>
    </View>
  );
});

export function ProductionAppShell() {
  const safeAreaInsets = useSafeAreaInsets();
  const {
    activeBasePresetId,
    activeFontOptionId,
    activeHighlightPresetId,
    applyBasePreset,
    applyFontOption,
    applyHighlightPreset,
    colors: themeColors,
    fontFamily,
    setThemeColors,
  } = useTheme();
  const styles = useMemo(() => createStyles(themeColors, fontFamily), [fontFamily, themeColors]);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [libraryView, setLibraryView] = useState<LibraryView>('allSongs');
  const [allSongsSortMode, setAllSongsSortMode] = useState<AllSongsSortMode>('name');
  const [homeFeedTab, setHomeFeedTab] = useState<HomeFeedTab>('recentlyAdded');
  const [selectedAlbumName, setSelectedAlbumName] = useState<string | null>(null);
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [playlistsSubPage, setPlaylistsSubPage] = useState<PlaylistsSubPage>('home');
  const [settingsSubPage, setSettingsSubPage] = useState<SettingsSubPage>('home');
  const [createSubPage, setCreateSubPage] = useState<CreateSubPage>('home');
  const [createDraftName, setCreateDraftName] = useState('');
  const [createSongQuery, setCreateSongQuery] = useState('');
  const [customBackgroundBase, setCustomBackgroundBase] = useState(themeColors.backgroundBase);
  const [customTextPrimary, setCustomTextPrimary] = useState(themeColors.textPrimary);
  const [customAccentPrimary, setCustomAccentPrimary] = useState(themeColors.accentPrimary);
  const [themeEditorStatus, setThemeEditorStatus] = useState('Use #RRGGBB format for custom colors.');
  const [showQueueTools, setShowQueueTools] = useState(false);
  const [showAllSongsSortMenu, setShowAllSongsSortMenu] = useState(false);
  const [miniPlayerStatus, setMiniPlayerStatus] = useState('');
  const [shellStateHydrated, setShellStateHydrated] = useState(false);
  const contentFade = useRef(new Animated.Value(1)).current;
  const previousActiveTabRef = useRef<TabKey>('home');
  const libraryViewRefreshAtMsRef = useRef(0);
  const libraryBootstrapInFlightRef = useRef(false);
  const autoPermissionPromptedRef = useRef(false);
  const mediaSyncAfterGrantDoneRef = useRef(false);

  const {
    permissionStatus,
    requestAudioPermission,
    refreshAudioPermissionStatus,
  } = useAudioPermission();
  const {serviceStatus, startService, stopService} = usePlaybackService();
  const {
    folderGrantStatus,
    folderGrants,
    pickFolderRoot,
    refreshFolderGrants,
    cleanupRevokedGrants,
    removeGrant,
  } = useFolderGrants();
  const DEFAULT_MUSIC_FOLDER = '/storage/emulated/0/Music';
  const navigateToTab = useCallback(
    (tabKey: AnySupportedTabKey) => {
      setActiveTab(resolveAppTabKey(tabKey));
    },
    [],
  );
  const {
    statusText: deviceSetupStatus,
    diagnosticText: deviceSetupDiagnostics,
    setupStatus,
    events: reliabilityEvents,
    snapshots: setupSnapshots,
    validationReport,
    idleTestSessions,
    checklistItems,
    dataFreshness,
    verificationReadiness,
    refreshSetupStatus,
    openBatteryOptimizationSettings,
    openAutostartSettings,
    recordEvent,
    captureSnapshot,
    evaluateSetupDelta,
    refreshValidationReport,
    shareValidationReport,
    shareValidationBundle,
    startIdleTestSession,
    completeIdleTestSession,
    setChecklistItem,
    recordRetestRunSummary,
  } = useDeviceSetupGuidance();
  const {scanStatus, tracks, hasMore, scanMediaStore, loadMoreMediaStore} = useMediaStoreScan();
  const {
    scanStatus: safScanStatus,
    tracks: safTracks,
    diagnostics: safDiagnostics,
    scanSafRoots,
  } = useSafRootScan();
  const {
    status: indexStatus,
    stats: indexStats,
    results: indexResults,
    latestSync,
    diagnostics: indexDiagnostics,
    refreshStats,
    searchIndex,
    refreshLatestSync,
    runIncrementalMediaSync,
    runIncrementalSafSync,
  } = useIndexedLibraryPanelState();
  const {
    status: browseStatus,
    searchResults: browseSearchResults,
    playlistSearchResults: browsePlaylistSearchResults,
    albums,
    artists,
    songs,
    relevanceReport,
    search,
    browseAlbums,
    browseArtists,
    browseSongs,
    playFromBrowse,
    validateSearchRelevance,
  } = useSearchBrowse();
  const deferredSongs = useDeferredValue(songs);
  const {
    status: folderQueueStatus,
    queueState,
    generateQueue,
    startFromQueue,
    loadQueueAndStart,
    setAnchorByIndex,
    reorderQueue,
    removeFromQueue,
  } = useFolderQueue();
  const {
    status: playlistImportStatus,
    latestImport,
    importPlaylist,
    refreshLatestImport,
    retryLatestImport,
  } = usePlaylistImport();
  const {
    playlists,
    selectedPlaylistId,
    searchResults: userPlaylistSearchResults,
    refreshPlaylists,
    createPlaylist,
    selectPlaylist,
    searchTracks,
    addTrack,
  } = useUserPlaylists();

  const selectedPlaylist = playlists.find(item => item.id === selectedPlaylistId) ?? null;

  const handleCreatePlaylistFromCreatePage = useCallback(async () => {
    const trimmed = createDraftName.trim();
    if (!trimmed) {
      return;
    }

    await createPlaylist(trimmed);
    setCreateDraftName('');
    setCreateSubPage('addToExisting');
  }, [createDraftName, createPlaylist]);

  const handleSearchCreateSongs = useCallback(async () => {
    await searchTracks(createSongQuery);
  }, [createSongQuery, searchTracks]);

  const handleAddToExistingPlaylistFromCreate = useCallback(async (track: MediaStoreTrack) => {
    if (!selectedPlaylistId) {
      return;
    }

    await addTrack(track);
  }, [addTrack, selectedPlaylistId]);

  const handleAddToNewPlaylistFromCreate = useCallback(async (track: MediaStoreTrack) => {
    const trimmed = createDraftName.trim();
    if (!trimmed) {
      return;
    }

    const created = await createPlaylist(trimmed);
    if (!created) {
      return;
    }

    await selectPlaylist(created.id);
    await addTrack(track);
    setCreateDraftName('');
  }, [addTrack, createDraftName, createPlaylist, selectPlaylist]);

  const playTrackFromList = useCallback(async (trackList: MediaStoreTrack[], trackUri: string, sourceLabel: string) => {
    if (trackList.length === 0) {
      return;
    }

    const index = trackList.findIndex(item => item.uri === trackUri);
    const targetIndex = index >= 0 ? index : 0;
    await loadQueueAndStart(trackList, targetIndex, sourceLabel);
  }, [loadQueueAndStart]);
  const {
    currentTrack,
    isPlaying,
    endMode,
    randomEnabled,
    positionMs,
    durationMs,
    seekStepMs,
    togglePlayPause,
    seekBy,
    skipNext,
    skipPrevious,
    cycleEndMode,
    toggleRandomEnabled,
  } = useNowPlayingState({
    queue: queueState.queue,
    activeIndex: queueState.activeIndex,
    onSetActiveIndex: setAnchorByIndex,
  });
  const currentTrackUri = currentTrack?.uri ?? null;

  const ensureLibraryReady = useCallback(
    async (trigger: 'auto' | 'manual') => {
      if (libraryBootstrapInFlightRef.current) {
        return false;
      }

      libraryBootstrapInFlightRef.current = true;
      try {
        let currentPermissionStatus = permissionStatus;
        if (currentPermissionStatus !== 'Granted') {
          const shouldPromptPermission = trigger === 'manual' || !autoPermissionPromptedRef.current;
          if (!shouldPromptPermission) {
            return false;
          }

          autoPermissionPromptedRef.current = true;
          currentPermissionStatus = await requestAudioPermission();
          if (currentPermissionStatus !== 'Granted') {
            currentPermissionStatus = await refreshAudioPermissionStatus();
          }
          if (currentPermissionStatus !== 'Granted') {
            return false;
          }
        }

        await refreshFolderGrants();
        await runIncrementalMediaSync();

        await browseSongs();
        return true;
      } finally {
        libraryBootstrapInFlightRef.current = false;
      }
    },
    [
      browseSongs,
      permissionStatus,
      refreshAudioPermissionStatus,
      refreshFolderGrants,
      requestAudioPermission,
      runIncrementalMediaSync,
    ],
  );

  const needsQuickStart = permissionStatus !== 'Granted';
  const {
    automationStatus,
    lastAutoSyncAt,
    syncRevision,
  } = useBackgroundSyncOrchestrator({
    permissionStatus,
    refreshFolderGrants,
    runIncrementalMediaSync,
    cleanupRevokedGrants,
  });
  const autoSyncTone = automationStatus.toLowerCase().includes('paused')
    ? 'warning'
    : automationStatus.toLowerCase().includes('synced') || automationStatus.toLowerCase().includes('fresh')
      ? 'success'
      : 'neutral';
  const homeBrowseHasError = browseStatus.toLowerCase().includes('error') || browseStatus.toLowerCase().includes('failed');
  const homeBrowseIsLoading = browseStatus.toLowerCase().includes('loading') || browseStatus.toLowerCase().includes('running');
  const isLibraryDataLoading = homeBrowseIsLoading
    || statusIndicatesWorkInProgress(indexStatus)
    || statusIndicatesWorkInProgress(scanStatus)
    || statusIndicatesWorkInProgress(safScanStatus)
    || statusIndicatesWorkInProgress(automationStatus);

  const sortedAllSongs = useMemo(() => {
    const rows = [...deferredSongs];
    const byTitle = (left: MediaStoreTrack, right: MediaStoreTrack) => left.title.localeCompare(right.title);

    if (allSongsSortMode === 'name') {
      return rows.sort(byTitle);
    }

    if (allSongsSortMode === 'album') {
      return rows.sort((left, right) => {
        const albumCmp = left.album.localeCompare(right.album);
        return albumCmp !== 0 ? albumCmp : byTitle(left, right);
      });
    }

    if (allSongsSortMode === 'artist') {
      return rows.sort((left, right) => {
        const artistCmp = left.artist.localeCompare(right.artist);
        return artistCmp !== 0 ? artistCmp : byTitle(left, right);
      });
    }

    if (allSongsSortMode === 'lastPlayed') {
      return rows.sort((left, right) => {
        const modifiedCmp = right.dateModifiedEpochSeconds - left.dateModifiedEpochSeconds;
        return modifiedCmp !== 0 ? modifiedCmp : byTitle(left, right);
      });
    }

    if (allSongsSortMode === 'mostPlayed') {
      return rows.sort((left, right) => {
        const scoreCmp = pseudoPopularityScore(right) - pseudoPopularityScore(left);
        return scoreCmp !== 0 ? scoreCmp : byTitle(left, right);
      });
    }

    return rows.sort((left, right) => {
      const lengthCmp = right.durationMs - left.durationMs;
      return lengthCmp !== 0 ? lengthCmp : byTitle(left, right);
    });
  }, [allSongsSortMode, deferredSongs]);

  const homeMostPlayedSongs = useMemo(() => {
    const rows = [...deferredSongs];
    rows.sort((left, right) => {
      const scoreCmp = pseudoPopularityScore(right) - pseudoPopularityScore(left);
      return scoreCmp !== 0 ? scoreCmp : left.title.localeCompare(right.title);
    });
    return rows;
  }, [deferredSongs]);

  const homePopularSongs = useMemo(() => {
    const rows = [...deferredSongs];
    rows.sort((left, right) => {
      const modifiedCmp = right.dateModifiedEpochSeconds - left.dateModifiedEpochSeconds;
      return modifiedCmp !== 0 ? modifiedCmp : left.title.localeCompare(right.title);
    });
    return rows;
  }, [deferredSongs]);

  const activeHomeFeedSongs = useMemo(() => {
    if (homeFeedTab === 'recentlyAdded') {
      return songs;
    }

    if (homeFeedTab === 'mostPlayed') {
      return homeMostPlayedSongs;
    }

    return homePopularSongs;
  }, [homeFeedTab, homeMostPlayedSongs, homePopularSongs, songs]);

  const handlePlayFromHomeFeed = useCallback(
    (trackUri: string) => {
      void playTrackFromList(activeHomeFeedSongs, trackUri, `home:${homeFeedTab}`);
    },
    [activeHomeFeedSongs, homeFeedTab, playTrackFromList],
  );

  const handleOpenPlaylistsFromSearch = useCallback(() => {
    setActiveTab('yourLibrary');
    setLibraryView('playlists');
    setPlaylistsSubPage('home');
  }, []);

  const handleToggleAllSongsSortMenu = useCallback(() => {
    setShowAllSongsSortMenu(current => !current);
  }, []);

  const handleSelectAllSongsSortMode = useCallback((mode: AllSongsSortMode) => {
    setAllSongsSortMode(mode);
    setShowAllSongsSortMenu(false);
  }, []);

  const handleSelectPlaylistFromLibrary = useCallback((playlistId: number) => {
    void selectPlaylist(playlistId);
  }, [selectPlaylist]);

  const handlePlayTrackFromList = useCallback((trackList: MediaStoreTrack[], trackUri: string, sourceLabel: string) => {
    void playTrackFromList(trackList, trackUri, sourceLabel);
  }, [playTrackFromList]);

  const handleCreatePlaylistFromCreatePagePress = useCallback(() => {
    void handleCreatePlaylistFromCreatePage();
  }, [handleCreatePlaylistFromCreatePage]);

  const handleSearchCreateSongsPress = useCallback(() => {
    void handleSearchCreateSongs();
  }, [handleSearchCreateSongs]);

  const handleOpenPlaylistAddFromCreate = useCallback(() => {
    navigateToTab('playlists');
  }, [navigateToTab]);

  const handleAddToExistingFromCreate = useCallback((track: MediaStoreTrack) => {
    void handleAddToExistingPlaylistFromCreate(track);
  }, [handleAddToExistingPlaylistFromCreate]);

  const handleAddToNewFromCreate = useCallback((track: MediaStoreTrack) => {
    void handleAddToNewPlaylistFromCreate(track);
  }, [handleAddToNewPlaylistFromCreate]);

  const selectedAlbumSongs = useMemo(() => {
    if (!selectedAlbumName) {
      return [];
    }

    return deferredSongs
      .filter(track => track.album === selectedAlbumName)
      .sort(compareTracksByTrackThenTitle);
  }, [deferredSongs, selectedAlbumName]);

  const selectedArtistSongs = useMemo(() => {
    if (!selectedArtistName) {
      return [];
    }

    return deferredSongs.filter(track => track.artist === selectedArtistName);
  }, [deferredSongs, selectedArtistName]);

  const folderGroups = useMemo(() => {
    const grouped = new Map<string, {path: string; trackCount: number; sampleArtist: string}>();

    deferredSongs.forEach(track => {
      const path = (track.relativePath && track.relativePath.trim()) || 'Unknown folder';
      const existing = grouped.get(path);
      if (existing) {
        existing.trackCount += 1;
        if (!existing.sampleArtist.trim() && track.artist.trim()) {
          existing.sampleArtist = track.artist;
        }
      } else {
        grouped.set(path, {
          path,
          trackCount: 1,
          sampleArtist: track.artist,
        });
      }
    });

    return Array.from(grouped.values()).sort((left, right) => left.path.localeCompare(right.path));
  }, [deferredSongs]);

  const selectedFolderSongs = useMemo(() => {
    if (!selectedFolderPath) {
      return [];
    }

    return deferredSongs
      .filter(track => ((track.relativePath && track.relativePath.trim()) || 'Unknown folder') === selectedFolderPath)
      .sort(compareTracksByTrackThenTitle);
  }, [deferredSongs, selectedFolderPath]);

  const containerStyle = useMemo(
    () => ({
      paddingTop: safeAreaInsets.top,
      paddingBottom: safeAreaInsets.bottom,
      paddingLeft: safeAreaInsets.left,
      paddingRight: safeAreaInsets.right,
    }),
    [safeAreaInsets.bottom, safeAreaInsets.left, safeAreaInsets.right, safeAreaInsets.top],
  );

  useEffect(() => {
    let cancelled = false;

    const restoreShellState = async () => {
      try {
        const raw = kvStore.getItem(APP_SHELL_STATE_KEY);
        if (!raw || cancelled) {
          return;
        }

        const parsed = JSON.parse(raw) as Partial<PersistedShellState>;

        if (isTabKey(parsed.activeTab)) {
          setActiveTab(parsed.activeTab);
        }
        if (isLibraryView(parsed.libraryView)) {
          setLibraryView(parsed.libraryView);
        }
        if (isAllSongsSortMode(parsed.allSongsSortMode)) {
          setAllSongsSortMode(parsed.allSongsSortMode);
        }
        if (isHomeFeedTab(parsed.homeFeedTab)) {
          setHomeFeedTab(parsed.homeFeedTab);
        }
        if (isPlaylistsSubPage(parsed.playlistsSubPage)) {
          setPlaylistsSubPage(parsed.playlistsSubPage);
        }
        if (isSettingsSubPage(parsed.settingsSubPage)) {
          setSettingsSubPage(parsed.settingsSubPage);
        }
        if (isCreateSubPage(parsed.createSubPage)) {
          setCreateSubPage(parsed.createSubPage);
        }
        if (typeof parsed.createDraftName === 'string') {
          setCreateDraftName(parsed.createDraftName);
        }
        if (typeof parsed.createSongQuery === 'string') {
          setCreateSongQuery(parsed.createSongQuery);
        }
        if (typeof parsed.selectedAlbumName === 'string' || parsed.selectedAlbumName === null) {
          setSelectedAlbumName(parsed.selectedAlbumName ?? null);
        }
        if (typeof parsed.selectedArtistName === 'string' || parsed.selectedArtistName === null) {
          setSelectedArtistName(parsed.selectedArtistName ?? null);
        }
        if (typeof parsed.selectedFolderPath === 'string' || parsed.selectedFolderPath === null) {
          setSelectedFolderPath(parsed.selectedFolderPath ?? null);
        }
      } catch {
      } finally {
        if (!cancelled) {
          setShellStateHydrated(true);
        }
      }
    };

    void restoreShellState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shellStateHydrated) {
      return;
    }

    const payload: PersistedShellState = {
      activeTab,
      libraryView,
      allSongsSortMode,
      homeFeedTab,
      playlistsSubPage,
      settingsSubPage,
      createSubPage,
      createDraftName,
      createSongQuery,
      selectedAlbumName,
      selectedArtistName,
      selectedFolderPath,
    };

    kvStore.setItem(APP_SHELL_STATE_KEY, JSON.stringify(payload));
  }, [
    activeTab,
    allSongsSortMode,
    createDraftName,
    createSongQuery,
    createSubPage,
    homeFeedTab,
    libraryView,
    playlistsSubPage,
    selectedAlbumName,
    selectedArtistName,
    selectedFolderPath,
    settingsSubPage,
    shellStateHydrated,
  ]);

  useEffect(() => {
    contentFade.setValue(0.82);
    Animated.timing(contentFade, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [activeTab, contentFade]);

  useEffect(() => {
    let cancelled = false;
    const task = runWhenIdle(() => {
      if (cancelled) {
        return;
      }

      void ensureLibraryReady('auto');
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [ensureLibraryReady]);

  useEffect(() => {
    setCustomBackgroundBase(themeColors.backgroundBase);
    setCustomTextPrimary(themeColors.textPrimary);
    setCustomAccentPrimary(themeColors.accentPrimary);
  }, [themeColors.accentPrimary, themeColors.backgroundBase, themeColors.textPrimary]);

  useEffect(() => {
    if (activeTab === 'yourLibrary' && playlistsSubPage === 'home') {
      const task = runWhenIdle(() => {
        void refreshPlaylists();
      });

      return () => task.cancel();
    }

    return;
  }, [activeTab, playlistsSubPage, refreshPlaylists]);

  useEffect(() => {
    if (activeTab !== 'yourLibrary') {
      previousActiveTabRef.current = activeTab;
      return;
    }

    previousActiveTabRef.current = activeTab;

    const nowMs = Date.now();
    const shouldRefreshLibraryViews = nowMs - libraryViewRefreshAtMsRef.current > 45_000;

    const task = runWhenIdle(() => {
      if (!shouldRefreshLibraryViews) {
        return;
      }

      libraryViewRefreshAtMsRef.current = nowMs;
      void browseSongs();
      void browseAlbums();
      void browseArtists();
    });

    return () => task.cancel();
  }, [activeTab, browseAlbums, browseArtists, browseSongs]);

  useEffect(() => {
    if (permissionStatus !== 'Granted' || mediaSyncAfterGrantDoneRef.current) {
      return;
    }

    mediaSyncAfterGrantDoneRef.current = true;
    const task = runWhenIdle(() => {
      void runIncrementalMediaSync()
        .then(() => browseSongs())
        .catch(() => {
        });
    });

    return () => task.cancel();
  }, [permissionStatus, browseSongs, runIncrementalMediaSync]);

  useEffect(() => {
    if (syncRevision <= 0 || permissionStatus !== 'Granted') {
      return;
    }

    const task = runWhenIdle(() => {
      void Promise.all([
        browseSongs(100, {force: true}),
        browseAlbums(50, {force: true}),
        browseArtists(50, {force: true}),
        refreshStats(),
      ]).catch(() => {
      });
    });

    return () => task.cancel();
  }, [syncRevision, permissionStatus]);

  const applyCustomThemeColors = () => {
    const nextBackgroundBase = customBackgroundBase.trim();
    const nextTextPrimary = customTextPrimary.trim();
    const nextAccentPrimary = customAccentPrimary.trim();

    if (!isValidHexColor(nextBackgroundBase) || !isValidHexColor(nextTextPrimary) || !isValidHexColor(nextAccentPrimary)) {
      setThemeEditorStatus('Invalid color format. Use #RRGGBB values only.');
      return;
    }

    setThemeColors({
      ...themeColors,
      backgroundBase: nextBackgroundBase,
      textPrimary: nextTextPrimary,
      accentPrimary: nextAccentPrimary,
    });
    setThemeEditorStatus('Custom theme colors applied.');
  };

  const settingsScene = useMemo(() => (
    <>
      {settingsSubPage === 'home' && (
        <>
          <SectionCard title="Settings" subtitle="Choose a section to configure app behavior.">
            <View style={styles.createPanel}>
              <Text style={styles.sectionTitle}>Library Access</Text>
              <Text style={styles.meta}>Manage audio permission and source folders.</Text>
              <View style={styles.buttonWrap}>
                <AppButton
                  title={needsQuickStart ? 'SET UP LIBRARY ACCESS' : 'OPEN LIBRARY ACCESS'}
                  onPress={() => setSettingsSubPage('librarySetup')}
                  variant="primary"
                />
              </View>
            </View>

            <View style={styles.createPanel}>
              <Text style={styles.sectionTitle}>Library Maintenance</Text>
              <Text style={styles.meta}>Scan, index, and troubleshoot advanced library issues.</Text>
              <View style={styles.buttonWrap}>
                <AppButton title="OPEN LIBRARY MAINTENANCE" onPress={() => setSettingsSubPage('libraryMaintenance')} />
              </View>
            </View>

            <View style={styles.createPanel}>
              <Text style={styles.sectionTitle}>Advanced Reliability</Text>
              <Text style={styles.meta}>Optional diagnostics and evidence tools for difficult devices.</Text>
              <Pressable onPress={() => setSettingsSubPage('reliabilityTools')} style={styles.compactAction}>
                <Text style={styles.compactActionLabel}>OPEN RELIABILITY TOOLS</Text>
              </Pressable>
            </View>
          </SectionCard>

          <SectionCard title="Playback Settings" subtitle="Core controls for service and session behavior.">
            <View style={styles.statusRow}>
              <StatusChip
                label={`PLAYBACK SERVICE: ${serviceStatus.toUpperCase()}`}
                tone={serviceStatus.toLowerCase().includes('running') ? 'success' : 'neutral'}
              />
            </View>
            <View style={styles.row}>
              <View style={styles.buttonWrap}>
                <AppButton title="START SERVICE" onPress={startService} variant="primary" />
              </View>
              <View style={styles.buttonWrap}>
                <AppButton title="STOP SERVICE" onPress={stopService} />
              </View>
            </View>
          </SectionCard>

          <SectionCard title="Overall Theme" subtitle="Choose the base app surface and text theme.">
            <View style={styles.libraryPillRow}>
              {baseThemePresets.map(item => {
                const active = item.id === activeBasePresetId;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => applyBasePreset(item.id)}
                    style={({pressed}) => [
                      styles.libraryPill,
                      active ? styles.libraryPillActive : styles.libraryPillInactive,
                      pressed ? styles.libraryPillPressed : null,
                    ]}>
                    <Text style={[styles.libraryPillLabel, active ? styles.libraryPillLabelActive : styles.libraryPillLabelInactive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SectionCard title="Highlight Theme" subtitle="Choose accent and status highlight colors.">
            <View style={styles.libraryPillRow}>
              {highlightThemePresets.map(item => {
                const active = item.id === activeHighlightPresetId;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => applyHighlightPreset(item.id)}
                    style={({pressed}) => [
                      styles.libraryPill,
                      active ? styles.libraryPillActive : styles.libraryPillInactive,
                      pressed ? styles.libraryPillPressed : null,
                    ]}>
                    <Text style={[styles.libraryPillLabel, active ? styles.libraryPillLabelActive : styles.libraryPillLabelInactive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SectionCard title="Font Selector" subtitle="Choose the app typography.">
            <View style={styles.libraryPillRow}>
              {fontOptions.map(item => {
                const active = item.id === activeFontOptionId;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => applyFontOption(item.id)}
                    style={({pressed}) => [
                      styles.libraryPill,
                      active ? styles.libraryPillActive : styles.libraryPillInactive,
                      pressed ? styles.libraryPillPressed : null,
                    ]}>
                    <Text style={[styles.libraryPillLabel, active ? styles.libraryPillLabelActive : styles.libraryPillLabelInactive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SectionCard title="Custom Theme Colors" subtitle="Edit key colors with validation.">
            <Text style={styles.meta}>{themeEditorStatus}</Text>
            <Text style={styles.compactActionLabel}>BACKGROUND BASE</Text>
            <TextInput
              style={styles.createInput}
              value={customBackgroundBase}
              onChangeText={setCustomBackgroundBase}
              placeholder="#0F1318"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={styles.compactActionLabel}>TEXT PRIMARY</Text>
            <TextInput
              style={styles.createInput}
              value={customTextPrimary}
              onChangeText={setCustomTextPrimary}
              placeholder="#E7EDF7"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={styles.compactActionLabel}>ACCENT PRIMARY</Text>
            <TextInput
              style={styles.createInput}
              value={customAccentPrimary}
              onChangeText={setCustomAccentPrimary}
              placeholder="#5BD1FF"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <View style={styles.buttonWrap}>
              <AppButton title="APPLY CUSTOM COLORS" onPress={applyCustomThemeColors} variant="primary" />
            </View>
          </SectionCard>

          <SectionCard title="Playlist Import" subtitle="Import external playlist files.">
            <PlaylistImportPanel
              status={playlistImportStatus}
              latestImport={latestImport}
              onImport={importPlaylist}
              onRefreshLatest={refreshLatestImport}
              onRetryLatest={retryLatestImport}
            />
          </SectionCard>
        </>
      )}

      {settingsSubPage === 'librarySetup' && (
        <>
          <SectionCard title="Library Setup" subtitle="Automatic default source with optional extras.">
            <View style={styles.buttonWrap}>
              <AppButton title="BACK TO SETTINGS" onPress={() => setSettingsSubPage('home')} />
            </View>
            <Text style={styles.meta}>READ_MEDIA_AUDIO: {permissionStatus}</Text>
            <Text style={styles.meta}>DEFAULT SOURCE: {DEFAULT_MUSIC_FOLDER}</Text>
            {permissionStatus !== 'Granted' ? (
              <View style={styles.row}>
                <View style={styles.buttonWrap}>
                  <AppButton title="ALLOW AUDIO" onPress={requestAudioPermission} variant="primary" />
                </View>
              </View>
            ) : (
              <Text style={styles.meta}>Audio access is already granted. Library updates run automatically.</Text>
            )}
            <Pressable onPress={() => void pickFolderRoot()} style={styles.compactAction}>
              <Text style={styles.compactActionLabel}>ADD EXTRA FOLDER (OPTIONAL)</Text>
            </Pressable>
          </SectionCard>
        </>
      )}

      {settingsSubPage === 'libraryMaintenance' && (
        <>
          <SectionCard title="Library Maintenance" subtitle="Advanced tools for scan, index, and troubleshooting.">
            <View style={styles.buttonWrap}>
              <AppButton title="BACK TO SETTINGS" onPress={() => setSettingsSubPage('home')} />
            </View>
          </SectionCard>
          <FolderGrantsPanel
            folderGrantStatus={folderGrantStatus}
            folderGrants={folderGrants}
            onPickFolderRoot={pickFolderRoot}
            onRefreshFolderGrants={refreshFolderGrants}
            onCleanupRevokedGrants={cleanupRevokedGrants}
            onRemoveGrant={removeGrant}
          />
          <View style={styles.row}>
            <View style={styles.buttonWrap}>
              <AppButton title="SCAN MEDIASTORE" onPress={() => scanMediaStore(50)} />
            </View>
            <View style={styles.buttonWrap}>
              <AppButton title="RUN SAF SCAN" onPress={() => scanSafRoots(100)} />
            </View>
          </View>
          <MediaStorePanel
            scanStatus={scanStatus}
            tracks={tracks}
            onScan={() => scanMediaStore(50)}
            onLoadMore={() => loadMoreMediaStore(50)}
            hasMore={hasMore}
          />
          <SafRootScanPanel
            scanStatus={safScanStatus}
            tracks={safTracks}
            diagnostics={safDiagnostics}
            onScan={() => scanSafRoots(100)}
          />
          <IndexedLibraryPanel
            status={indexStatus}
            stats={indexStats}
            results={indexResults}
            latestSync={latestSync}
            diagnostics={indexDiagnostics}
            onRefreshStats={refreshStats}
            onSearch={query => searchIndex(query, 25)}
            onRefreshLatestSync={refreshLatestSync}
            onRunIncrementalMediaSync={runIncrementalMediaSync}
            onRunIncrementalSafSync={runIncrementalSafSync}
          />
        </>
      )}

      {settingsSubPage === 'reliabilityTools' && (
        <>
          <SectionCard title="Reliability Tools" subtitle="Diagnostics, validation, and OEM hardening evidence tools.">
            <View style={styles.buttonWrap}>
              <AppButton title="BACK TO SETTINGS" onPress={() => setSettingsSubPage('home')} />
            </View>
          </SectionCard>
          <DeviceSetupPanel
            statusText={deviceSetupStatus}
            diagnosticText={deviceSetupDiagnostics}
            freshnessSummary={dataFreshness.summary}
            setupStatusFreshness={dataFreshness.setupStatus}
            eventsFreshness={dataFreshness.events}
            snapshotsFreshness={dataFreshness.snapshots}
            idleSessionsFreshness={dataFreshness.idleSessions}
            checklistFreshness={dataFreshness.checklist}
            reportFreshness={dataFreshness.report}
            verificationReadinessLevel={verificationReadiness.level}
            verificationReadinessSummary={verificationReadiness.summary}
            manufacturer={setupStatus.manufacturer}
            model={setupStatus.model}
            batteryOptimized={setupStatus.batteryOptimized}
            isXiaomiFamily={setupStatus.isXiaomiFamily}
            autostartSettingsAvailable={setupStatus.autostartSettingsAvailable}
            events={reliabilityEvents}
            snapshots={setupSnapshots}
            idleTestSessions={idleTestSessions}
            checklistItems={checklistItems}
            validationReportText={validationReport?.reportText ?? ''}
            onRefreshStatus={refreshSetupStatus}
            onOpenBatterySettings={openBatteryOptimizationSettings}
            onOpenAutostartSettings={openAutostartSettings}
            onRecordInterruption={() =>
              recordEvent('PLAYBACK_INTERRUPTION', 'Playback interruption observed during background/idle')
            }
            onRecordRecovery={() =>
              recordEvent('PLAYBACK_RECOVERY', 'Playback recovered after interruption')
            }
            onCaptureBaselineSnapshot={() => captureSnapshot('baseline')}
            onCapturePostSetupSnapshot={() => captureSnapshot('post_setup')}
            onEvaluateSetupDelta={evaluateSetupDelta}
            onGenerateValidationReport={refreshValidationReport}
            onShareValidationReport={shareValidationReport}
            onShareValidationBundle={shareValidationBundle}
            onStartIdleTestSession={startIdleTestSession}
            onCompleteIdleTestSession={completeIdleTestSession}
            onSetChecklistItem={setChecklistItem}
            onRecordRetestRunSummary={recordRetestRunSummary}
          />
        </>
      )}
    </>
  ), [
    settingsSubPage,
    styles,
    needsQuickStart,
    serviceStatus,
    startService,
    stopService,
    activeBasePresetId,
    activeHighlightPresetId,
    applyBasePreset,
    applyHighlightPreset,
    activeFontOptionId,
    applyFontOption,
    themeEditorStatus,
    customBackgroundBase,
    customTextPrimary,
    customAccentPrimary,
    applyCustomThemeColors,
    playlistImportStatus,
    latestImport,
    importPlaylist,
    refreshLatestImport,
    retryLatestImport,
    permissionStatus,
    requestAudioPermission,
    pickFolderRoot,
    folderGrantStatus,
    folderGrants,
    refreshFolderGrants,
    cleanupRevokedGrants,
    removeGrant,
    scanStatus,
    tracks,
    hasMore,
    scanMediaStore,
    loadMoreMediaStore,
    safScanStatus,
    safTracks,
    safDiagnostics,
    scanSafRoots,
    indexStatus,
    indexStats,
    indexResults,
    latestSync,
    indexDiagnostics,
    refreshStats,
    searchIndex,
    refreshLatestSync,
    runIncrementalMediaSync,
    runIncrementalSafSync,
    deviceSetupStatus,
    deviceSetupDiagnostics,
    dataFreshness,
    verificationReadiness,
    setupStatus,
    reliabilityEvents,
    setupSnapshots,
    idleTestSessions,
    checklistItems,
    validationReport,
    refreshSetupStatus,
    openBatteryOptimizationSettings,
    openAutostartSettings,
    recordEvent,
    captureSnapshot,
    evaluateSetupDelta,
    refreshValidationReport,
    shareValidationReport,
    shareValidationBundle,
    startIdleTestSession,
    completeIdleTestSession,
    setChecklistItem,
    recordRetestRunSummary,
    DEFAULT_MUSIC_FOLDER,
  ]);

  return (
    <View style={[styles.root, containerStyle]}>
      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, activeTab === 'yourLibrary' ? styles.contentContainerLibrary : null]}
        nestedScrollEnabled={activeTab !== 'yourLibrary'}
        showsVerticalScrollIndicator={activeTab !== 'yourLibrary'}
        scrollEnabled={activeTab !== 'yourLibrary'}>
        <Animated.View style={[styles.tabContent, {opacity: contentFade}]} key={activeTab as string}>
        {activeTab === 'home' && (
          <HomeTabScene
            styles={styles}
            loadingIndicatorColor={themeColors.accentPrimary}
            totalTracks={indexStats.totalTracks}
            folderCount={folderGroups.length}
            lastAutoSyncAt={lastAutoSyncAt}
            autoSyncTone={autoSyncTone}
            homeFeedTab={homeFeedTab}
            onSelectHomeFeedTab={setHomeFeedTab}
            homeBrowseHasError={homeBrowseHasError}
            browseStatus={browseStatus}
            songsLength={songs.length}
            homeBrowseIsLoading={homeBrowseIsLoading}
            defaultMusicFolder={DEFAULT_MUSIC_FOLDER}
            activeHomeFeedSongs={activeHomeFeedSongs}
            currentTrackUri={currentTrackUri}
            isPlaying={isPlaying}
            isLibraryDataLoading={isLibraryDataLoading}
            onPlayFromHomeFeed={handlePlayFromHomeFeed}
            needsQuickStart={needsQuickStart}
            miniPlayerStatus={miniPlayerStatus}
          />
        )}

        {activeTab === 'search' && (
          <SearchTabScene
            browseStatus={browseStatus}
            browseSearchResults={browseSearchResults}
            browsePlaylistSearchResults={browsePlaylistSearchResults}
            playlists={playlists}
            albums={albums}
            artists={artists}
            songs={songs}
            relevanceReport={relevanceReport}
            onSearch={search}
            onBrowseAlbums={browseAlbums}
            onBrowseArtists={browseArtists}
            onBrowseSongs={browseSongs}
            onPlayFromBrowse={playFromBrowse}
            onValidateRelevance={validateSearchRelevance}
            onQuickAddTrack={addTrack}
            onOpenPlaylists={handleOpenPlaylistsFromSearch}
            hasQuickAddTarget={selectedPlaylistId !== null}
          />
        )}

        {activeTab === 'yourLibrary' && (
          <YourLibraryTabScene
            styles={styles}
            loadingIndicatorColor={themeColors.accentPrimary}
            isLibraryDataLoading={isLibraryDataLoading}
            libraryView={libraryView}
            onSelectLibraryView={setLibraryView}
            allSongsSortMode={allSongsSortMode}
            showAllSongsSortMenu={showAllSongsSortMenu}
            onToggleAllSongsSortMenu={handleToggleAllSongsSortMenu}
            onSelectAllSongsSortMode={handleSelectAllSongsSortMode}
            songsLength={songs.length}
            sortedAllSongs={sortedAllSongs}
            currentTrackUri={currentTrackUri}
            isPlaying={isPlaying}
            onPlayTrackFromList={handlePlayTrackFromList}
            selectedAlbumName={selectedAlbumName}
            onSelectAlbumName={setSelectedAlbumName}
            selectedAlbumSongs={selectedAlbumSongs}
            albums={albums}
            selectedArtistName={selectedArtistName}
            onSelectArtistName={setSelectedArtistName}
            selectedArtistSongs={selectedArtistSongs}
            artists={artists}
            selectedFolderPath={selectedFolderPath}
            onSelectFolderPath={setSelectedFolderPath}
            selectedFolderSongs={selectedFolderSongs}
            folderGroups={folderGroups}
            playlists={playlists}
            onSelectPlaylist={handleSelectPlaylistFromLibrary}
          />
        )}

        {activeTab === 'create' && (
          <CreateTabScene
            styles={styles}
            playlistsCount={playlists.length}
            songsCount={songs.length}
            selectedPlaylist={selectedPlaylist}
            selectedPlaylistId={selectedPlaylistId}
            createSubPage={createSubPage}
            onSelectCreateSubPage={setCreateSubPage}
            createDraftName={createDraftName}
            onCreateDraftNameChange={setCreateDraftName}
            createSongQuery={createSongQuery}
            onCreateSongQueryChange={setCreateSongQuery}
            onCreatePlaylist={handleCreatePlaylistFromCreatePagePress}
            onSearchSongs={handleSearchCreateSongsPress}
            onOpenPlaylistAdd={handleOpenPlaylistAddFromCreate}
            userPlaylistSearchResults={userPlaylistSearchResults}
            onAddToExisting={handleAddToExistingFromCreate}
            onAddToNew={handleAddToNewFromCreate}
          />
        )}

        {activeTab === 'nowplaying' && (
          <>
            <NowPlayingPanel
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              endMode={endMode}
              randomEnabled={randomEnabled}
              positionMs={positionMs}
              durationMs={durationMs}
              onTogglePlayPause={togglePlayPause}
              onNext={skipNext}
              onPrevious={skipPrevious}
              onSeekBy={seekBy}
              onCycleEndMode={cycleEndMode}
              onToggleRandomEnabled={toggleRandomEnabled}
              queueToolsOpen={showQueueTools}
              onToggleQueueTools={() => setShowQueueTools(current => !current)}
              seekStepMs={seekStepMs}
            />
            {showQueueTools && (
              <>
                <View style={styles.statusRow}>
                  <StatusChip label={`QUEUE: ${folderQueueStatus.toUpperCase()}`} tone={folderQueueStatus.toLowerCase().includes('error') ? 'danger' : folderQueueStatus.toLowerCase().includes('running') ? 'warning' : 'neutral'} />
                  <StatusChip label={`ITEMS: ${String(queueState.queue.length)}`} tone={queueState.queue.length > 0 ? 'success' : 'neutral'} />
                </View>
                <FolderQueuePanel
                  status={folderQueueStatus}
                  queue={queueState.queue}
                  activeIndex={queueState.activeIndex}
                  skippedCount={queueState.skippedCount}
                  unreadableCount={queueState.unreadableCount}
                  skippedDiagnostics={queueState.skippedDiagnostics}
                  onGenerateQueue={generateQueue}
                  onStartFromQueue={startFromQueue}
                  onSetAnchor={setAnchorByIndex}
                />
                <QueueEditorPanel
                  queue={queueState.queue}
                  activeIndex={queueState.activeIndex}
                  onSetActive={setAnchorByIndex}
                  onMoveTo={(fromIndex, toIndex) => reorderQueue(fromIndex, toIndex)}
                  onMoveUp={index => reorderQueue(index, index - 1)}
                  onMoveDown={index => reorderQueue(index, index + 1)}
                  onRemove={removeFromQueue}
                />
              </>
            )}
          </>
        )}

        {activeTab === 'settings' && settingsScene}
        </Animated.View>
      </ScrollView>

      <MiniNowPlayingDock
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        positionMs={positionMs}
        durationMs={durationMs}
        endMode={endMode}
        randomEnabled={randomEnabled}
        onSeekBy={seekBy}
        onNext={skipNext}
        onPrevious={skipPrevious}
        onTogglePlayPause={togglePlayPause}
        onCycleEndMode={cycleEndMode}
        onToggleRandomEnabled={toggleRandomEnabled}
        onOpenNowPlaying={() => navigateToTab('nowplaying')}
        onReportError={setMiniPlayerStatus}
      />

      <IconTabBar tabs={TAB_ORDER} activeTab={activeTab} onSelect={navigateToTab} />
    </View>
  );
}

function createStyles(colors: ThemeColors, fontFamily: string) {
  return StyleSheet.create({
    root: {
      flex: 1,
      width: '100%',
      backgroundColor: colors.backgroundBase,
    },
    content: {
      flex: 1,
      width: '100%',
    },
    contentContainer: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      gap: 10,
    },
    contentContainerLibrary: {
      paddingHorizontal: spacing.lg / 2,
    },
    tabContent: {
      gap: spacing.sm,
    },
    quickStartCard: {
      borderWidth: 1,
      borderColor: colors.accentPrimary,
      borderRadius: radii.lg,
      backgroundColor: colors.backgroundCard,
      padding: spacing.md,
      gap: 6,
    },
    statusRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    homeStatusStrip: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.md,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
      gap: spacing.sm,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    homeLoadingIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 999,
      backgroundColor: colors.backgroundCard,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    homeLoadingLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textPrimary,
      fontFamily,
    },
    quickStartTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      fontFamily,
    },
    quickStartStep: {
      fontSize: 13,
      color: colors.textSecondary,
      fontFamily,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textPrimary,
      fontFamily,
    },
    meta: {
      fontSize: 13,
      color: colors.textSecondary,
      fontFamily,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    compactActionsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    libraryRecentRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    libraryRecentBlock: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.md,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
      gap: 4,
    },
    libraryPillRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    libraryTopPillRow: {
      flexDirection: 'row',
      flexWrap: 'nowrap',
      gap: spacing.xs,
      paddingRight: spacing.md,
    },
    libraryTopPillScroll: {
      width: '100%',
    },
    libraryScene: {
      position: 'relative',
      gap: spacing.sm,
    },
    librarySceneContent: {
      position: 'relative',
      gap: spacing.sm,
      marginHorizontal: -spacing.md / 2,
    },
    libraryLoadingOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: spacing.md,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    libraryLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    libraryLoadingLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      fontFamily,
    },
    libraryPill: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    libraryTopPill: {
      minWidth: 96,
      paddingHorizontal: spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    libraryPillActive: {
      borderColor: colors.accentPrimary,
      backgroundColor: colors.backgroundCard,
    },
    libraryPillInactive: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.backgroundElevated,
    },
    libraryPillPressed: {
      opacity: 0.85,
    },
    libraryPillLabel: {
      fontSize: 11,
      fontWeight: '700',
      fontFamily,
    },
    libraryPillLabelActive: {
      color: colors.textPrimary,
    },
    libraryPillLabelInactive: {
      color: colors.textSecondary,
    },
    librarySortSelectorButton: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    librarySortSelectorButtonText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textPrimary,
      fontFamily,
    },
    librarySortMenuFloating: {
      alignSelf: 'flex-end',
      minWidth: 170,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.md,
      backgroundColor: colors.backgroundElevated,
      overflow: 'hidden',
    },
    librarySortMenuItem: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    librarySortMenuItemActive: {
      backgroundColor: colors.backgroundCard,
    },
    librarySortMenuItemText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      fontFamily,
    },
    librarySortMenuItemTextActive: {
      color: colors.textPrimary,
    },
    libraryHeaderBackButton: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 66,
    },
    libraryHeaderBackButtonLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      fontFamily,
      letterSpacing: 0.2,
    },
    librarySortPill: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    librarySortPillActive: {
      borderColor: colors.accentPrimary,
      backgroundColor: colors.backgroundCard,
    },
    librarySortPillInactive: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.backgroundElevated,
    },
    librarySortPillPressed: {
      opacity: 0.85,
    },
    librarySortPillLabel: {
      fontSize: 10,
      fontWeight: '700',
      fontFamily,
    },
    librarySortPillLabelActive: {
      color: colors.textPrimary,
    },
    librarySortPillLabelInactive: {
      color: colors.textSecondary,
    },
    createPanel: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.md,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
      gap: spacing.sm,
    },
    createInput: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      color: colors.textPrimary,
      fontSize: 13,
      fontFamily,
    },
    buttonWrap: {
      flex: 1,
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
      fontFamily,
    },
    trackRow: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
      gap: 4,
    },
    trackTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      fontFamily,
    },
    trackMeta: {
      fontSize: 13,
      color: colors.textSecondary,
      fontFamily,
    },
    trackSubMeta: {
      fontSize: 11,
      color: colors.textMuted,
      fontFamily,
    },
    librarySelectionName: {
      fontSize: 13,
      color: colors.textSecondary,
      fontFamily,
      textAlign: 'center',
      alignSelf: 'center',
    },
    trackActionWrap: {
      marginTop: 2,
    },
    virtualizedListTall: {
      minHeight: 240,
      maxHeight: 560,
      width: '100%',
      marginHorizontal: -spacing.md / 2,
    },
    virtualizedListMedium: {
      minHeight: 120,
      maxHeight: 380,
      width: '100%',
    },
    virtualizedListContainer: {
      paddingBottom: spacing.xs,
      paddingHorizontal: 0,
    },
  });
}
