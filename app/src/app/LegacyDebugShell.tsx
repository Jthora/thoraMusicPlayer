import {useMemo} from 'react';
import {Button, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {IndexedLibraryPanel, useIndexedLibraryPanelState} from '../features/library/IndexedLibraryPanel';
import {MediaStorePanel} from '../features/library/MediaStorePanel';
import {SafRootScanPanel} from '../features/library/SafRootScanPanel';
import {SearchBrowsePanel} from '../features/library/SearchBrowsePanel';
import {useMediaStoreScan} from '../features/library/useMediaStoreScan';
import {useSafRootScan} from '../features/library/useSafRootScan';
import {useSearchBrowse} from '../features/library/useSearchBrowse';
import {useAudioPermission} from '../features/permissions/useAudioPermission';
import {NowPlayingPanel} from '../features/playback/NowPlayingPanel';
import {useNowPlayingState} from '../features/playback/useNowPlayingState';
import {usePlaybackService} from '../features/playback/usePlaybackService';
import {useLivePositionMs} from '../features/playback/playbackEvents';
import {PlaylistImportPanel} from '../features/playlists/PlaylistImportPanel';
import {UserPlaylistsPanel} from '../features/playlists/UserPlaylistsPanel';
import {usePlaylistImport} from '../features/playlists/usePlaylistImport';
import {useUserPlaylists} from '../features/playlists/useUserPlaylists';
import {FolderQueuePanel} from '../features/queue/FolderQueuePanel';
import {QueueEditorPanel} from '../features/queue/QueueEditorPanel';
import {useFolderQueue} from '../features/queue/useFolderQueue';
import {DeviceSetupPanel} from '../features/reliability/DeviceSetupPanel';
import {useDeviceSetupGuidance} from '../features/reliability/useDeviceSetupGuidance';
import {FolderGrantsPanel} from '../features/storage/FolderGrantsPanel';
import {useFolderGrants} from '../features/storage/useFolderGrants';

export function LegacyDebugShell() {
  const safeAreaInsets = useSafeAreaInsets();
  const {permissionStatus, requestAudioPermission} = useAudioPermission();
  const {serviceStatus, startService, stopService} = usePlaybackService();
  const {
    folderGrantStatus,
    folderGrants,
    pickFolderRoot,
    refreshFolderGrants,
    cleanupRevokedGrants,
    removeGrant,
  } = useFolderGrants();
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
  const {
    status: folderQueueStatus,
    queueState,
    generateQueue,
    startFromQueue,
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
    status: userPlaylistStatus,
    playlists,
    selectedPlaylistId,
    entries: userPlaylistEntries,
    searchResults: userPlaylistSearchResults,
    refreshPlaylists,
    createPlaylist,
    selectPlaylist,
    searchTracks,
    addTrack,
    removeTrack,
    moveTrack,
  } = useUserPlaylists();
  const {
    currentTrack,
    isPlaying,
    endMode,
    randomEnabled,
    clock: playbackClock,
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
  });
  const positionMs = useLivePositionMs(playbackClock);

  const safeAreaStyle = useMemo(
    () => ({
      paddingTop: safeAreaInsets.top,
      paddingBottom: safeAreaInsets.bottom,
      paddingLeft: safeAreaInsets.left,
      paddingRight: safeAreaInsets.right,
    }),
    [safeAreaInsets.bottom, safeAreaInsets.left, safeAreaInsets.right, safeAreaInsets.top],
  );

  return (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={[styles.container, safeAreaStyle]}>
      <Text style={styles.label}>READ_MEDIA_AUDIO: {permissionStatus}</Text>
      <Text style={styles.label}>Playback Service: {serviceStatus}</Text>
      <View style={styles.buttonWrap}>
        <Button title="Request Audio Permission" onPress={requestAudioPermission} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Start Playback Service" onPress={startService} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Stop Playback Service" onPress={stopService} />
      </View>
      <FolderGrantsPanel
        folderGrantStatus={folderGrantStatus}
        folderGrants={folderGrants}
        onPickFolderRoot={pickFolderRoot}
        onRefreshFolderGrants={refreshFolderGrants}
        onCleanupRevokedGrants={cleanupRevokedGrants}
        onRemoveGrant={removeGrant}
      />
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
        onRecordInterruption={() => recordEvent('PLAYBACK_INTERRUPTION', 'Playback interruption observed during background/idle')}
        onRecordRecovery={() => recordEvent('PLAYBACK_RECOVERY', 'Playback recovered after interruption')}
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
      <SearchBrowsePanel
        status={browseStatus}
        searchResults={browseSearchResults}
        playlistSearchResults={browsePlaylistSearchResults}
        userPlaylists={playlists}
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
      />
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
        queueToolsOpen={false}
        onToggleQueueTools={() => {}}
        seekStepMs={seekStepMs}
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
      <PlaylistImportPanel
        status={playlistImportStatus}
        latestImport={latestImport}
        onImport={importPlaylist}
        onRefreshLatest={refreshLatestImport}
        onRetryLatest={retryLatestImport}
      />
      <UserPlaylistsPanel
        status={userPlaylistStatus}
        playlists={playlists}
        selectedPlaylistId={selectedPlaylistId}
        entries={userPlaylistEntries}
        searchResults={userPlaylistSearchResults}
        onRefreshPlaylists={refreshPlaylists}
        onCreatePlaylist={createPlaylist}
        onSelectPlaylist={selectPlaylist}
        onSearchTracks={searchTracks}
        onAddTrack={addTrack}
        onRemoveTrack={removeTrack}
        onMoveTrack={moveTrack}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
    width: '100%',
  },
  container: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  label: {
    fontSize: 14,
  },
  buttonWrap: {
    marginTop: 8,
    width: '100%',
  },
});
