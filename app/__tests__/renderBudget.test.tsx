/**
 * Render/bridge budget for the production shell.
 *
 * Guards against the runaway loop found in the 2026-11 review: unstable hook callbacks made
 * effects re-run every render, which re-fetched folder grants and re-ran full MediaStore syncs
 * continuously (measured: 1,640 commits and 94 syncs in 2 s of idle time). Since P2 the native
 * player pushes state via events, so JS must not poll it at all.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform} from 'react-native';

const calls: Record<string, number> = {};
const args: Record<string, unknown[][]> = {};
const count = (name: string, callArgs: unknown[]) => {
  calls[name] = (calls[name] ?? 0) + 1;
  (args[name] ??= []).push(callArgs);
};
const resolveWith = <T,>(name: string, value: () => T) =>
  jest.fn(async (...callArgs: unknown[]) => {
    count(name, callArgs);
    return value();
  });

const track = (i: number) => ({
  uri: `content://media/external/audio/media/${i}`,
  title: `Song ${i}`,
  artist: 'Artist',
  album: 'Album',
  durationMs: 180000,
  mimeType: 'audio/mpeg',
  sizeBytes: 1000,
  dateModifiedEpochSeconds: 1,
  displayName: `${i}.mp3`,
  relativePath: 'Music/',
});

const idleSnapshot = {
  isPlaying: false,
  playWhenReady: false,
  playbackState: 'idle',
  positionMs: 0,
  durationMs: 0,
  capturedAtEpochMs: 0,
  queueIndex: -1,
  queueLength: 0,
  currentUri: null,
  repeatMode: 'off',
  shuffle: false,
  speed: 1,
};

let nativeQueue: ReturnType<typeof track>[] = [];
let nativeSnapshot: Record<string, unknown> = idleSnapshot;

NativeModules.StorageAccess = {
  getFolderGrants: resolveWith('getFolderGrants', () => []),
  cleanupRevokedFolderGrants: resolveWith('cleanupRevokedFolderGrants', () => 0),
};
NativeModules.MediaLibrary = {
  runIncrementalMediaStoreSync: resolveWith('runIncrementalMediaStoreSync', () => ({
    summary: {scanned: 3, inserted: 0, updated: 0, duplicate: 0, skipped: 0, removed: 0, snapshotId: 1},
  })),
  getIndexStats: resolveWith('getIndexStats', () => ({totalTracks: 3, distinctRoots: 1, lastUpdatedSec: 1, snapshotCount: 1})),
  getLatestSyncStatus: resolveWith('getLatestSyncStatus', () => ({})),
  getLatestSyncDiagnostics: resolveWith('getLatestSyncDiagnostics', () => []),
  browseIndexedSongs: resolveWith('browseIndexedSongs', () => [track(1), track(2), track(3)]),
  browseIndexedAlbums: resolveWith('browseIndexedAlbums', () => []),
  browseIndexedArtists: resolveWith('browseIndexedArtists', () => []),
  listUserPlaylists: resolveWith('listUserPlaylists', () => []),
  getLatestPlaylistImportSummary: resolveWith('getLatestPlaylistImportSummary', () => ({})),
};
NativeModules.PlaybackControl = {
  getPlaybackState: resolveWith('getPlaybackState', () => ({...nativeSnapshot, capturedAtEpochMs: Date.now()})),
  getQueue: resolveWith('getQueue', () => nativeQueue),
  setQueue: resolveWith('setQueue', () => true),
  play: resolveWith('play', () => true),
  togglePlayPause: resolveWith('togglePlayPause', () => true),
  seekTo: resolveWith('seekTo', () => true),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms));

function mountShell() {
  const {ThemeProvider} = require('../src/ui/themeRuntime');
  const {ProductionAppShell} = require('../src/app/ProductionAppShell');
  const {SafeAreaProvider} = require('react-native-safe-area-context');

  const stats = {commits: 0};
  const renderer = ReactTestRenderer.create(
    <React.Profiler id="shell" onRender={() => { stats.commits += 1; }}>
      <SafeAreaProvider initialMetrics={{frame: {x: 0, y: 0, width: 360, height: 800}, insets: {top: 0, left: 0, right: 0, bottom: 0}}}>
        <ThemeProvider>
          <ProductionAppShell />
        </ThemeProvider>
      </SafeAreaProvider>
    </React.Profiler>,
  );
  return {renderer, stats};
}

beforeAll(() => {
  // Real timers + real scheduling: act() would never settle if a loop came back.
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
  Object.defineProperty(Platform, 'OS', {get: () => 'android', configurable: true});
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
});

beforeEach(() => {
  for (const key of Object.keys(calls)) {
    delete calls[key];
    delete args[key];
  }
  nativeQueue = [];
  nativeSnapshot = idleSnapshot;
});

test('idle shell settles: no repeated grant refreshes or library syncs', async () => {
  const {renderer, stats} = mountShell();
  await wait(2000);
  renderer.unmount();

  expect(calls.getFolderGrants ?? 0).toBeLessThanOrEqual(3); // mount + orchestrator startup + revoked-grant cleanup
  expect(calls.runIncrementalMediaStoreSync ?? 0).toBeLessThanOrEqual(1);
  expect(calls.getLatestSyncStatus ?? 0).toBeLessThanOrEqual(2);
  expect(stats.commits).toBeLessThan(40);
}, 15000);

test('playing: state comes from native events, never from polling', async () => {
  nativeQueue = [track(1), track(2), track(3)];
  nativeSnapshot = {...idleSnapshot, isPlaying: true, playWhenReady: true, playbackState: 'ready',
    queueIndex: 0, queueLength: 3, durationMs: 180000, currentUri: track(1).uri};

  const {renderer, stats} = mountShell();
  await wait(1000);
  const statePollsAfter1s = calls.getPlaybackState ?? 0;
  await wait(2000);
  const statePollsAfter3s = calls.getPlaybackState ?? 0;

  // A native "queue changed" event makes the mirror refetch exactly once.
  const queueFetchesBefore = calls.getQueue ?? 0;
  nativeQueue = [track(1), track(3)];
  DeviceEventEmitter.emit('ThoraQueueChanged', {revision: 2, queueLength: 2});
  await wait(200);
  const queueFetchesAfterEvent = calls.getQueue ?? 0;
  renderer.unmount();

  expect(statePollsAfter1s).toBeLessThanOrEqual(3); // initial reads only
  expect(statePollsAfter3s).toBe(statePollsAfter1s); // no polling while playing
  expect(queueFetchesAfterEvent).toBe(queueFetchesBefore + 1);
  expect(calls.setQueue ?? 0).toBe(0); // nothing re-sent to native
  expect(calls.runIncrementalMediaStoreSync ?? 0).toBeLessThanOrEqual(1);
  expect(stats.commits).toBeLessThan(60); // ~2 display ticks/s while playing
}, 15000);

test('legacy JS-persisted queue migrates into the native queue once', async () => {
  const {kvStore} = require('../src/platform/storage/kvStore');
  const legacyQueue = [track(7), track(8)];
  kvStore.setItem(
    'android_music_player.queue_state.v1',
    JSON.stringify({queue: legacyQueue, activeIndex: 1, revision: 1, folderPath: 'old', sortMode: 'manual',
      skippedDiagnostics: [], skippedCount: 0, unreadableCount: 0}),
  );

  const {renderer} = mountShell();
  await wait(500);
  renderer.unmount();

  expect(calls.setQueue).toBe(1);
  const [tracks, startIndex, startPositionMs, playWhenReady] = args.setQueue[0];
  expect((tracks as unknown[]).length).toBe(2);
  expect([startIndex, startPositionMs, playWhenReady]).toEqual([1, 0, false]);
  expect(kvStore.getItem('android_music_player.queue_state.v1')).toBeNull();
}, 15000);
