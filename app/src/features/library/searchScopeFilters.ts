import {MediaStoreTrack, UnifiedSearchScope, UserPlaylist} from '../../native/modules';

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function filterTracksByScope(
  tracks: MediaStoreTrack[],
  query: string,
  scope: UnifiedSearchScope,
): MediaStoreTrack[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return tracks;
  }

  if (scope === 'song_names') {
    return tracks.filter(track => track.title.toLowerCase().includes(normalizedQuery));
  }

  if (scope === 'song_albums') {
    return tracks.filter(track => track.album.toLowerCase().includes(normalizedQuery));
  }

  if (scope === 'song_artists') {
    return tracks.filter(track => track.artist.toLowerCase().includes(normalizedQuery));
  }

  if (scope === 'playlist_titles') {
    return [];
  }

  return tracks.filter(track => {
    return (
      track.title.toLowerCase().includes(normalizedQuery) ||
      track.artist.toLowerCase().includes(normalizedQuery) ||
      track.album.toLowerCase().includes(normalizedQuery)
    );
  });
}

export function filterPlaylistsByScope(
  playlists: UserPlaylist[],
  query: string,
  scope: UnifiedSearchScope,
): UserPlaylist[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  if (scope !== 'playlist_titles' && scope !== 'all') {
    return [];
  }

  return playlists.filter(item => item.name.toLowerCase().includes(normalizedQuery));
}
