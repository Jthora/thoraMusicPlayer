import {NativeModules} from 'react-native';

export type FolderGrant = {
  uri: string;
  granted: boolean;
};

export type PlaylistFileGrant = {
  uri: string;
  name: string;
  granted: boolean;
};

export type MediaStoreTrack = {
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  mimeType: string;
  sizeBytes: number;
  dateModifiedEpochSeconds: number;
  displayName: string;
  relativePath: string;
};

export type MediaStoreScanPage = {
  items: MediaStoreTrack[];
  totalCount: number;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  indexSummary?: IndexSummary;
};

export type IndexSummary = {
  scanned: number;
  inserted: number;
  updated: number;
  duplicate: number;
  skipped: number;
  removed: number;
  snapshotId: number;
  coverageMode?: 'FULL' | 'PARTIAL' | string;
};

export type ScanDiagnostic = {
  level?: string;
  code: string;
  root: string;
  message: string;
};

export type SafScanResult = {
  roots: string[];
  tracks: MediaStoreTrack[];
  diagnostics: ScanDiagnostic[];
  rootCount: number;
  trackCount: number;
  indexSummary?: IndexSummary;
};

export type IndexStats = {
  totalTracks: number;
  distinctRoots: number;
  lastUpdatedSec: number;
  snapshotCount: number;
};

export type SyncStatus = {
  snapshotId: number;
  sourceType: string;
  sourceRoot: string;
  coverageMode?: 'FULL' | 'PARTIAL' | string;
  startedAtSec: number;
  completedAtSec: number;
  scannedCount: number;
  insertedCount: number;
  updatedCount: number;
  duplicateCount: number;
  skippedCount: number;
  removedCount: number;
};

export type FolderQueueResult = {
  folderPath: string;
  sortMode: string;
  queue: MediaStoreTrack[];
  queueLength: number;
  anchorIndex: number;
  queueRevision: number;
  skippedDiagnostics: ScanDiagnostic[];
  skippedCount: number;
  unreadableCount: number;
};

export type PlaylistEntryDiagnostic = {
  lineNumber: number;
  entryText: string;
  status: string;
  reasonCode: string;
  resolvedUri?: string | null;
};

export type PlaylistImportResult = {
  sourceUri: string;
  sourceName: string;
  format: string;
  totalEntries: number;
  resolvedCount: number;
  unresolvedCount: number;
  duplicateCount: number;
  unsupportedCount: number;
  importedAtSec: number;
  diagnostics: PlaylistEntryDiagnostic[];
};

export type UserPlaylist = {
  id: number;
  name: string;
  entryCount: number;
  updatedAtSec: number;
};

export type UserPlaylistTrack = {
  position: number;
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  displayName: string;
  relativePath: string;
};

export type AlbumGroup = {
  album: string;
  trackCount: number;
  sampleArtist: string;
};

export type RecentlyPlayedAlbum = {
  album: string;
  trackCount: number;
  sampleArtist: string;
  lastPlayedAtSec: number;
};

export type RecentlyPlayedPlaylist = {
  id: number;
  name: string;
  entryCount: number;
  updatedAtSec: number;
};

export type ArtistGroup = {
  artist: string;
  trackCount: number;
  albumCount: number;
};

export type SearchRelevanceFailedExample = {
  query: string;
  targetTitle: string;
  targetUri: string;
  reason: string;
  topResultUri?: string;
};

export type SearchRelevanceReport = {
  sampled: number;
  passed: number;
  failed: number;
  passRate: number;
  status: string;
  failedExamples: SearchRelevanceFailedExample[];
};

export type UnifiedSearchScope =
  | 'all'
  | 'song_names'
  | 'song_albums'
  | 'song_artists'
  | 'playlist_titles';

export type UnifiedSearchResult = {
  type: 'song' | 'playlist';
  primaryText: string;
  secondaryText: string;
  uriOrId: string;
  playable: boolean;
  addable: boolean;
};

export type UnifiedSearchResponse = {
  scope: UnifiedSearchScope;
  tracks: MediaStoreTrack[];
  playlists: UserPlaylist[];
  results: UnifiedSearchResult[];
};

export type OemSetupStatus = {
  manufacturer: string;
  model: string;
  batteryOptimized: boolean;
  isXiaomiFamily: boolean;
  autostartSettingsAvailable: boolean;
};

export type ReliabilityEvent = {
  timestampSec: number;
  eventCode: string;
  message: string;
};

export type SetupValidationSnapshot = {
  timestampSec: number;
  label: string;
  batteryOptimized: boolean;
  autostartSettingsAvailable: boolean;
};

export type SetupValidationReport = {
  generatedAtSec: number;
  reportText: string;
};

export type ReliabilityChecklistItem = {
  key: string;
  passed: boolean;
  notes: string;
  updatedAtSec: number;
};

export type IdleTestSession = {
  sessionId: string;
  label: string;
  expectedMinutes: number;
  startedAtSec: number;
  completedAtSec: number;
  status: string;
  notes: string;
};

export type PlaybackRuntimeState = {
  isPlaying: boolean;
  lastReason: string;
  updatedAtSec: number;
  queueLength: number;
  queueIndex: number;
  positionMs: number;
  durationMs: number;
};

export type PlaybackModeState = {
  endMode: 'stop' | 'repeat_all' | 'repeat_one';
  randomEnabled: boolean;
};

export type TrackPlayStats = {
  uri: string;
  playCount: number;
  lastPlayedAtSec: number;
  lastCompletedAtSec: number;
  skipCount: number;
};

export type PlaybackEventType = 'PLAY_STARTED' | 'PLAY_COMPLETED' | 'PLAY_SKIPPED' | 'PLAY_PAUSED';

export type PlaybackQueueTrack = {
  uri: string;
  title: string;
  artist: string;
  album: string;
  displayName: string;
  durationMs: number;
};

type PlaybackControlModule = {
  startPlaybackService: () => Promise<boolean>;
  stopPlaybackService: () => Promise<boolean>;
  play: () => Promise<boolean>;
  pause: () => Promise<boolean>;
  next: () => Promise<boolean>;
  previous: () => Promise<boolean>;
  setQueueTracks: (tracks: PlaybackQueueTrack[]) => Promise<boolean>;
  setQueueState: (queueLength: number, queueIndex: number) => Promise<boolean>;
  setPlaybackProgress: (positionMs: number, durationMs: number) => Promise<boolean>;
  getPlaybackState: () => Promise<PlaybackRuntimeState>;
  setPlaybackModes: (endMode: 'stop' | 'repeat_all' | 'repeat_one', randomEnabled: boolean) => Promise<boolean>;
  getPlaybackModes: () => Promise<PlaybackModeState>;
};

type StorageAccessModule = {
  pickFolderTree: () => Promise<FolderGrant>;
  pickPlaylistFile: () => Promise<PlaylistFileGrant>;
  getFolderGrants: () => Promise<FolderGrant[]>;
  cleanupRevokedFolderGrants: () => Promise<number>;
  removeFolderGrant: (uri: string) => Promise<boolean>;
};

type MediaLibraryModule = {
  scanMediaStore: (limit: number) => Promise<MediaStoreTrack[]>;
  scanMediaStorePage: (limit: number, offset: number) => Promise<MediaStoreScanPage>;
  scanSafRoots: (options: {limitPerRoot: number}) => Promise<SafScanResult>;
  indexMediaStorePage: (limit: number, offset: number) => Promise<MediaStoreScanPage>;
  indexSafRoots: (limitPerRoot: number) => Promise<SafScanResult>;
  runIncrementalMediaStoreSync: (limit: number) => Promise<{summary: IndexSummary}>;
  runIncrementalSafSync: (limitPerRoot: number) => Promise<SafScanResult & {summary: IndexSummary}>;
  recordPlaybackEvent: (
    uri: string,
    eventType: PlaybackEventType,
    positionMs: number,
    durationMs: number,
  ) => Promise<TrackPlayStats>;
  upsertScannedTracks: (
    sourceType: string,
    sourceRoot: string,
    tracks: MediaStoreTrack[],
  ) => Promise<IndexSummary>;
  getIndexStats: () => Promise<IndexStats>;
  searchIndexedTracks: (query: string, limit: number) => Promise<MediaStoreTrack[]>;
  searchUnified: (query: string, scope: UnifiedSearchScope, limit: number) => Promise<UnifiedSearchResponse>;
  browseIndexedAlbums: (limit: number) => Promise<AlbumGroup[]>;
  browseIndexedArtists: (limit: number) => Promise<ArtistGroup[]>;
  browseIndexedSongs: (limit: number) => Promise<MediaStoreTrack[]>;
  getRecentlyPlayedTracks: (limit: number) => Promise<MediaStoreTrack[]>;
  getPopularTracks: (limit: number, windowDays?: number) => Promise<MediaStoreTrack[]>;
  getRecentlyPlayedAlbums: (limit: number) => Promise<RecentlyPlayedAlbum[]>;
  getRecentlyPlayedPlaylists: (limit: number) => Promise<RecentlyPlayedPlaylist[]>;
  validateIndexedSearchRelevance: (
    sampleLimit: number,
    resultLimit: number,
  ) => Promise<SearchRelevanceReport>;
  getLatestSyncStatus: () => Promise<SyncStatus | Record<string, never>>;
  getLatestSyncDiagnostics: (limit: number) => Promise<ScanDiagnostic[]>;
  generateFolderQueue: (
    folderPath: string,
    anchorUri: string | null,
    sortMode: string,
    limit: number,
  ) => Promise<FolderQueueResult>;
  importPlaylistFile: (playlistUri: string, sourceName?: string | null) => Promise<PlaylistImportResult>;
  getLatestPlaylistImportSummary: () => Promise<PlaylistImportResult | Record<string, never>>;
  createUserPlaylist: (name: string) => Promise<UserPlaylist>;
  listUserPlaylists: () => Promise<UserPlaylist[]>;
  getUserPlaylistEntries: (playlistId: number) => Promise<UserPlaylistTrack[]>;
  addTrackToUserPlaylist: (playlistId: number, track: MediaStoreTrack) => Promise<UserPlaylistTrack[]>;
  removeTrackFromUserPlaylist: (playlistId: number, position: number) => Promise<UserPlaylistTrack[]>;
  moveTrackInUserPlaylist: (
    playlistId: number,
    fromPosition: number,
    toPosition: number,
  ) => Promise<UserPlaylistTrack[]>;
};

type OemSetupModule = {
  getDeviceSetupStatus: () => Promise<OemSetupStatus>;
  openBatteryOptimizationSettings: () => Promise<boolean>;
  openAutostartSettings: () => Promise<boolean>;
  recordReliabilityEvent: (eventCode: string, message?: string | null) => Promise<ReliabilityEvent>;
  getReliabilityEvents: (limit: number) => Promise<ReliabilityEvent[]>;
  captureSetupValidationSnapshot: (label: string) => Promise<SetupValidationSnapshot>;
  getSetupValidationSnapshots: (limit: number) => Promise<SetupValidationSnapshot[]>;
  getSetupValidationReport: () => Promise<SetupValidationReport>;
  startIdleTestSession: (label: string, expectedMinutes: number) => Promise<IdleTestSession>;
  completeIdleTestSession: (
    sessionId: string,
    outcome: string,
    notes?: string | null,
  ) => Promise<IdleTestSession>;
  getIdleTestSessions: (limit: number) => Promise<IdleTestSession[]>;
};

type ReliabilityChecklistModule = {
  getChecklist: () => Promise<ReliabilityChecklistItem[]>;
  setChecklistItem: (
    key: string,
    passed: boolean,
    notes?: string | null,
  ) => Promise<ReliabilityChecklistItem>;
};

export const playbackControl =
  NativeModules.PlaybackControl as PlaybackControlModule | undefined;
export const storageAccess = NativeModules.StorageAccess as StorageAccessModule | undefined;
export const mediaLibrary = NativeModules.MediaLibrary as MediaLibraryModule | undefined;
export const oemSetup = NativeModules.OemSetup as OemSetupModule | undefined;
export const reliabilityChecklist = NativeModules.ReliabilityChecklist as ReliabilityChecklistModule | undefined;
