import {filterPlaylistsByScope, filterTracksByScope} from '../src/features/library/searchScopeFilters';
import {MediaStoreTrack, UserPlaylist} from '../src/native/modules';

const tracks: MediaStoreTrack[] = [
  {
    uri: 'track-1',
    title: 'Evergreen Lights',
    artist: 'Luna Wave',
    album: 'Night Drive',
    durationMs: 210000,
    mimeType: 'audio/mpeg',
    sizeBytes: 1,
    dateModifiedEpochSeconds: 1,
    displayName: 'evergreen.mp3',
    relativePath: 'Music/Luna',
  },
  {
    uri: 'track-2',
    title: 'Dawn Runner',
    artist: 'Solar Echo',
    album: 'Morning Bloom',
    durationMs: 180000,
    mimeType: 'audio/mpeg',
    sizeBytes: 1,
    dateModifiedEpochSeconds: 1,
    displayName: 'dawn.mp3',
    relativePath: 'Music/Solar',
  },
];

const playlists: UserPlaylist[] = [
  {
    id: 1,
    name: 'Morning Mix',
    entryCount: 10,
    updatedAtSec: 100,
  },
  {
    id: 2,
    name: 'Night Drive Favorites',
    entryCount: 14,
    updatedAtSec: 90,
  },
];

describe('search scope filters', () => {
  it('matches title in song_names scope', () => {
    const result = filterTracksByScope(tracks, 'evergreen', 'song_names');
    expect(result.map(item => item.uri)).toEqual(['track-1']);
  });

  it('matches album in song_albums scope', () => {
    const result = filterTracksByScope(tracks, 'morning', 'song_albums');
    expect(result.map(item => item.uri)).toEqual(['track-2']);
  });

  it('matches artist in song_artists scope', () => {
    const result = filterTracksByScope(tracks, 'luna', 'song_artists');
    expect(result.map(item => item.uri)).toEqual(['track-1']);
  });

  it('returns no tracks in playlist_titles scope', () => {
    const result = filterTracksByScope(tracks, 'night', 'playlist_titles');
    expect(result).toEqual([]);
  });

  it('matches all searchable track fields in all scope', () => {
    const result = filterTracksByScope(tracks, 'night', 'all');
    expect(result.map(item => item.uri)).toEqual(['track-1']);
  });

  it('returns playlist results only for all or playlist_titles scopes', () => {
    const allScope = filterPlaylistsByScope(playlists, 'night', 'all');
    const playlistScope = filterPlaylistsByScope(playlists, 'night', 'playlist_titles');
    const artistScope = filterPlaylistsByScope(playlists, 'night', 'song_artists');

    expect(allScope.map(item => item.id)).toEqual([2]);
    expect(playlistScope.map(item => item.id)).toEqual([2]);
    expect(artistScope).toEqual([]);
  });
});
