import {useRef, useState} from 'react';

import {
  AlbumGroup,
  ArtistGroup,
  MediaStoreTrack,
  SearchRelevanceReport,
  UnifiedSearchScope,
  UserPlaylist,
  mediaLibrary,
} from '../../native/modules';
import {sameTrackList} from './sortKeys';
import {useStableCallback} from '../../platform/hooks/useStableCallback';

const MAX_QUERY_LENGTH = 256;
// Search used to return 30 songs (100 at most), so broad searches looked like a library cap.
export const SEARCH_RESULT_LIMIT = 500;
const MAX_SEARCH_LIMIT = 2_000;
/**
 * The library views (All Songs, Folders, Albums, Artists, the Search folder browser) are built
 * from these lists, so they must hold the whole index: a 100-song sample made folders show one
 * track and whole folders (e.g. Liked Songs) disappear on a ~5,000-song library.
 */
export const FULL_LIBRARY_LIMIT = 50_000;
const MAX_BROWSE_LIMIT = FULL_LIBRARY_LIMIT;
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

  const search = useStableCallback(async (query: string, scope: UnifiedSearchScope = 'all', limit = SEARCH_RESULT_LIMIT) => {
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
  });

  const browseAlbums = useStableCallback(async (limit = FULL_LIBRARY_LIMIT, options?: {force?: boolean}) => {
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
  });

  const browseArtists = useStableCallback(async (limit = FULL_LIBRARY_LIMIT, options?: {force?: boolean}) => {
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
  });

  const browseSongs = useStableCallback(async (limit = FULL_LIBRARY_LIMIT, options?: {force?: boolean}) => {
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
      const fetched = await request;
      // A refresh that changed nothing keeps the old array, so nothing derived from it is rebuilt
      // (re-sorting 5,000+ songs after every start/resume sync used to stall scrolling).
      const previous = songsCacheRef.current?.rows;
      const rows = previous && sameTrackList(previous, fetched) ? previous : fetched;
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
  });


  const validateSearchRelevance = useStableCallback(async () => {
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
  });

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
    validateSearchRelevance,
  };
}
