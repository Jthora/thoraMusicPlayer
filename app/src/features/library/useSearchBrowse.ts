import {useRef, useState} from 'react';

import {
  AlbumGroup,
  ArtistGroup,
  MediaStoreTrack,
  SearchRelevanceReport,
  UnifiedSearchScope,
  UserPlaylist,
  mediaLibrary,
  playbackControl,
} from '../../native/modules';

const MAX_QUERY_LENGTH = 256;
const MAX_SEARCH_LIMIT = 100;
const MAX_BROWSE_LIMIT = 500;
const SEARCH_CACHE_TTL_MS = 20_000;
const BROWSE_CACHE_TTL_MS = 60_000;

type SearchCacheEntry = {
  tracks: MediaStoreTrack[];
  playlists: UserPlaylist[];
  atMs: number;
};

type BrowseCacheEntry<T> = {
  rows: T[];
  atMs: number;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unknown error';
}

function normalizeQuery(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function clampLimit(limit: number, max: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return Math.min(30, max);
  }

  return Math.min(Math.floor(limit), max);
}

export function useSearchBrowse() {
  const [status, setStatus] = useState('Idle');
  const [searchResults, setSearchResults] = useState<MediaStoreTrack[]>([]);
  const [playlistSearchResults, setPlaylistSearchResults] = useState<UserPlaylist[]>([]);
  const [albums, setAlbums] = useState<AlbumGroup[]>([]);
  const [artists, setArtists] = useState<ArtistGroup[]>([]);
  const [songs, setSongs] = useState<MediaStoreTrack[]>([]);
  const [relevanceReport, setRelevanceReport] = useState<SearchRelevanceReport | null>(null);
  const searchCacheRef = useRef<Map<string, SearchCacheEntry>>(new Map());
  const inFlightSearchRef = useRef<Map<string, Promise<SearchCacheEntry>>>(new Map());
  const albumsCacheRef = useRef<BrowseCacheEntry<AlbumGroup> | null>(null);
  const artistsCacheRef = useRef<BrowseCacheEntry<ArtistGroup> | null>(null);
  const songsCacheRef = useRef<BrowseCacheEntry<MediaStoreTrack> | null>(null);
  const inFlightBrowseRef = useRef<{
    albums: Promise<AlbumGroup[]> | null;
    artists: Promise<ArtistGroup[]> | null;
    songs: Promise<MediaStoreTrack[]> | null;
  }>({
    albums: null,
    artists: null,
    songs: null,
  });

  const search = async (query: string, scope: UnifiedSearchScope = 'all', limit = 30) => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    const trimmed = normalizeQuery(query);
    if (!trimmed) {
      setSearchResults([]);
      setPlaylistSearchResults([]);
      setStatus('Enter a search query');
      return;
    }

    const normalizedLimit = clampLimit(limit, MAX_SEARCH_LIMIT);
    const cacheKey = `${scope}::${normalizedLimit}::${trimmed.toLowerCase()}`;

    try {
      const nowMs = Date.now();
      const cached = searchCacheRef.current.get(cacheKey);
      if (cached && nowMs - cached.atMs <= SEARCH_CACHE_TTL_MS) {
        setSearchResults(cached.tracks);
        setPlaylistSearchResults(cached.playlists);
        const total = cached.tracks.length + cached.playlists.length;
        setStatus(`Search complete: ${total} result(s) [cached]`);
        return;
      }

      if (inFlightSearchRef.current.has(cacheKey)) {
        const inFlight = inFlightSearchRef.current.get(cacheKey);
        if (inFlight) {
          const shared = await inFlight;
          setSearchResults(shared.tracks);
          setPlaylistSearchResults(shared.playlists);
          const total = shared.tracks.length + shared.playlists.length;
          setStatus(`Search complete: ${total} result(s)`);
          return;
        }
      }

      if (typeof mediaLibrary.searchUnified === 'function') {
        const request = mediaLibrary
          .searchUnified(trimmed, scope, normalizedLimit)
          .then(rows => ({
            tracks: rows.tracks,
            playlists: rows.playlists,
            atMs: Date.now(),
          }));
        inFlightSearchRef.current.set(cacheKey, request);
        const resolved = await request;
        searchCacheRef.current.set(cacheKey, resolved);
        setSearchResults(resolved.tracks);
        setPlaylistSearchResults(resolved.playlists);
        const total = resolved.tracks.length + resolved.playlists.length;
        setStatus(`Search complete: ${total} result(s)`);
        inFlightSearchRef.current.delete(cacheKey);
        return;
      }

      const request = mediaLibrary
        .searchIndexedTracks(trimmed, normalizedLimit)
        .then(fallbackTracks => ({
          tracks: fallbackTracks,
          playlists: [] as UserPlaylist[],
          atMs: Date.now(),
        }));
      inFlightSearchRef.current.set(cacheKey, request);
      const resolved = await request;
      searchCacheRef.current.set(cacheKey, resolved);
      setSearchResults(resolved.tracks);
      setPlaylistSearchResults([]);
      const total = resolved.tracks.length;
      setStatus(`Search complete: ${total} result(s)`);
    } catch (error) {
      setPlaylistSearchResults([]);
      setStatus(`Search failed (${getErrorMessage(error)})`);
    } finally {
      inFlightSearchRef.current.delete(cacheKey);
    }
  };

  const browseAlbums = async (limit = 50, options?: {force?: boolean}) => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      const nowMs = Date.now();
      const cached = albumsCacheRef.current;
      if (!options?.force && cached && nowMs - cached.atMs <= BROWSE_CACHE_TTL_MS) {
        setAlbums(cached.rows);
        setStatus(`Albums loaded: ${cached.rows.length} [cached]`);
        return;
      }

      if (inFlightBrowseRef.current.albums) {
        const sharedRows = await inFlightBrowseRef.current.albums;
        setAlbums(sharedRows);
        setStatus(`Albums loaded: ${sharedRows.length}`);
        return;
      }

      setStatus('Loading albums...');
      const request = mediaLibrary.browseIndexedAlbums(clampLimit(limit, MAX_BROWSE_LIMIT));
      inFlightBrowseRef.current.albums = request;
      const rows = await request;
      albumsCacheRef.current = {
        rows,
        atMs: Date.now(),
      };
      setAlbums(rows);
      setStatus(`Albums loaded: ${rows.length}`);
    } catch (error) {
      setStatus(`Failed to load albums (${getErrorMessage(error)})`);
    } finally {
      inFlightBrowseRef.current.albums = null;
    }
  };

  const browseArtists = async (limit = 50, options?: {force?: boolean}) => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      const nowMs = Date.now();
      const cached = artistsCacheRef.current;
      if (!options?.force && cached && nowMs - cached.atMs <= BROWSE_CACHE_TTL_MS) {
        setArtists(cached.rows);
        setStatus(`Artists loaded: ${cached.rows.length} [cached]`);
        return;
      }

      if (inFlightBrowseRef.current.artists) {
        const sharedRows = await inFlightBrowseRef.current.artists;
        setArtists(sharedRows);
        setStatus(`Artists loaded: ${sharedRows.length}`);
        return;
      }

      setStatus('Loading artists...');
      const request = mediaLibrary.browseIndexedArtists(clampLimit(limit, MAX_BROWSE_LIMIT));
      inFlightBrowseRef.current.artists = request;
      const rows = await request;
      artistsCacheRef.current = {
        rows,
        atMs: Date.now(),
      };
      setArtists(rows);
      setStatus(`Artists loaded: ${rows.length}`);
    } catch (error) {
      setStatus(`Failed to load artists (${getErrorMessage(error)})`);
    } finally {
      inFlightBrowseRef.current.artists = null;
    }
  };

  const browseSongs = async (limit = 100, options?: {force?: boolean}) => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      const nowMs = Date.now();
      const cached = songsCacheRef.current;
      if (!options?.force && cached && nowMs - cached.atMs <= BROWSE_CACHE_TTL_MS) {
        setSongs(cached.rows);
        setStatus(`Songs loaded: ${cached.rows.length} [cached]`);
        return;
      }

      if (inFlightBrowseRef.current.songs) {
        const sharedRows = await inFlightBrowseRef.current.songs;
        setSongs(sharedRows);
        setStatus(`Songs loaded: ${sharedRows.length}`);
        return;
      }

      setStatus('Loading songs...');
      const request = mediaLibrary.browseIndexedSongs(clampLimit(limit, MAX_BROWSE_LIMIT));
      inFlightBrowseRef.current.songs = request;
      const rows = await request;
      songsCacheRef.current = {
        rows,
        atMs: Date.now(),
      };
      setSongs(rows);
      setStatus(`Songs loaded: ${rows.length}`);
    } catch (error) {
      setStatus(`Failed to load songs (${getErrorMessage(error)})`);
    } finally {
      inFlightBrowseRef.current.songs = null;
    }
  };

  const playFromBrowse = async () => {
    if (!playbackControl) {
      setStatus('Playback control unavailable');
      return;
    }

    try {
      await playbackControl.startPlaybackService();
      await playbackControl.play();
      setStatus('Playback triggered from browse view');
    } catch (error) {
      setStatus(`Playback action failed (${getErrorMessage(error)})`);
    }
  };

  const validateSearchRelevance = async () => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      setStatus('Validating search relevance...');
      const report = await mediaLibrary.validateIndexedSearchRelevance(12, 10);
      setRelevanceReport(report);
      setStatus(
        `Relevance ${report.status}: ${report.passed}/${report.sampled} (${Math.round(report.passRate * 100)}%)`,
      );
    } catch (error) {
      setStatus(`Search relevance validation failed (${getErrorMessage(error)})`);
    }
  };

  return {
    status,
    searchResults,
    playlistSearchResults,
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
  };
}
