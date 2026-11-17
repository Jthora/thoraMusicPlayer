/**
 * Regression: opening a playlist while the playlist list refreshes. Both used one request counter,
 * so a refresh that started after the open made the open's result look stale; the open was
 * dropped and the playlist page said "Loading…" forever (always, from Home's Liked Songs tile,
 * because switching to LIBRARY refreshes the list).
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useUserPlaylists} from '../src/features/playlists/useUserPlaylists';
import {mediaLibrary} from '../src/native/modules';

jest.mock('../src/native/modules', () => ({
  ...jest.requireActual('../src/native/modules'),
  mediaLibrary: {listUserPlaylists: jest.fn(), getUserPlaylistEntries: jest.fn()},
}));

type Api = {
  selectedPlaylistId: number | null;
  entries: unknown[];
  selectPlaylist: (id: number) => Promise<void>;
  refreshPlaylists: () => Promise<void>;
};

const playlists = [
  {id: 1, name: 'Angels', entryCount: 1, updatedAtSec: 1},
  {id: 2, name: 'Liked Songs', entryCount: 2, updatedAtSec: 1},
];

const flush = () => ReactTestRenderer.act(async () => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
});

test('an open playlist is shown even if the list refreshes while it loads', async () => {
  let finishLikedSongs: (rows: unknown[]) => void = () => {};
  const native = mediaLibrary as unknown as {listUserPlaylists: jest.Mock; getUserPlaylistEntries: jest.Mock};
  native.listUserPlaylists.mockImplementation(async () => playlists);
  native.getUserPlaylistEntries.mockImplementation((id: number) =>
    id === 2 ? new Promise(resolve => { finishLikedSongs = resolve; }) : Promise.resolve([{uri: 'a'}]),
  );

  let api!: Api;
  function Host() {
    api = useUserPlaylists();
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Host />);
  });
  await flush();
  expect(api.selectedPlaylistId).toBe(1); // the default selection after the first refresh

  let opening!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    opening = api.selectPlaylist(2); // Liked Songs: entries still loading
  });
  await ReactTestRenderer.act(async () => {
    await api.refreshPlaylists(); // e.g. LIBRARY became visible
  });
  await ReactTestRenderer.act(async () => {
    finishLikedSongs([{uri: 'x'}, {uri: 'y'}]);
    await opening;
  });

  expect(api.selectedPlaylistId).toBe(2);
  expect(api.entries).toHaveLength(2);
  ReactTestRenderer.act(() => renderer.unmount());
});
