import {useEffect, useRef, useState} from 'react';

import {
  MediaStoreTrack,
  UserPlaylist,
  UserPlaylistTrack,
  mediaLibrary,
} from '../../native/modules';
import {kvStore} from '../../platform/storage/kvStore';

const MAX_PLAYLIST_NAME_LENGTH = 80;
const MAX_QUERY_LENGTH = 256;
const SELECTED_PLAYLIST_STORAGE_KEY = 'android_music_player.selected_playlist_id.v1';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unknown error';
}

function normalizeSearchQuery(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function normalizePlaylistName(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PLAYLIST_NAME_LENGTH);
}

export function useUserPlaylists() {
  const [status, setStatus] = useState('No user playlists yet');
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [entries, setEntries] = useState<UserPlaylistTrack[]>([]);
  const [searchResults, setSearchResults] = useState<MediaStoreTrack[]>([]);
  const [isMutating, setIsMutating] = useState(false);
  const [restoredSelectedPlaylistId, setRestoredSelectedPlaylistId] = useState<number | null>(null);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const restoreSelectedPlaylist = async () => {
      try {
        const raw = kvStore.getItem(SELECTED_PLAYLIST_STORAGE_KEY);
        if (!raw || cancelled) {
          return;
        }

        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          setRestoredSelectedPlaylistId(parsed);
        }
      } catch {
      } finally {
        if (!cancelled) {
          setSelectionHydrated(true);
        }
      }
    };

    void restoreSelectedPlaylist();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPlaylistId) {
      return;
    }

    kvStore.setItem(SELECTED_PLAYLIST_STORAGE_KEY, String(selectedPlaylistId));
  }, [selectedPlaylistId]);

  const nextRequestSeq = () => {
    requestSeqRef.current += 1;
    return requestSeqRef.current;
  };

  const isCurrentRequest = (requestSeq: number) => requestSeqRef.current == requestSeq;

  const refreshPlaylists = async () => {
    if (!mediaLibrary) {
      setStatus('Media library module unavailable');
      return;
    }

    try {
      const requestSeq = nextRequestSeq();
      const rows = await mediaLibrary.listUserPlaylists();
      if (!isCurrentRequest(requestSeq)) {
        return;
      }

      setPlaylists(rows);
      if (rows.length === 0) {
        setStatus('No user playlists yet');
        setSelectedPlaylistId(null);
        setEntries([]);
        return;
      }

      setStatus(`Loaded ${rows.length} user playlist(s)`);
      const preferredPlaylistId =
        selectedPlaylistId && rows.some(item => item.id === selectedPlaylistId)
          ? selectedPlaylistId
          : restoredSelectedPlaylistId && rows.some(item => item.id === restoredSelectedPlaylistId)
            ? restoredSelectedPlaylistId
            : rows[0].id;

      if (!selectedPlaylistId || selectedPlaylistId !== preferredPlaylistId) {
        setSelectedPlaylistId(preferredPlaylistId);
        const defaultEntries = await mediaLibrary.getUserPlaylistEntries(preferredPlaylistId);
        if (!isCurrentRequest(requestSeq)) {
          return;
        }
        setEntries(defaultEntries);
      }
    } catch (error) {
      setStatus(`Failed to load user playlists (${getErrorMessage(error)})`);
    }
  };

  useEffect(() => {
    if (!selectionHydrated) {
      return;
    }

    void refreshPlaylists();
  }, [selectionHydrated]);

  const createPlaylist = async (name: string): Promise<UserPlaylist | null> => {
    if (!mediaLibrary) {
      setStatus('Media library module unavailable');
      return null;
    }

    const normalizedName = normalizePlaylistName(name);
    if (!normalizedName) {
      setStatus('Playlist name is required');
      return null;
    }

    if (isMutating) {
      return null;
    }

    try {
      setIsMutating(true);
      const created = await mediaLibrary.createUserPlaylist(normalizedName);
      setStatus(`Created playlist: ${created.name}`);
      await refreshPlaylists();
      setSelectedPlaylistId(created.id);
      setEntries([]);
      return created;
    } catch (error) {
      setStatus(`Create playlist failed (${getErrorMessage(error)})`);
      return null;
    } finally {
      setIsMutating(false);
    }
  };

  const selectPlaylist = async (playlistId: number) => {
    if (!mediaLibrary) {
      setStatus('Media library module unavailable');
      return;
    }

    try {
      const requestSeq = nextRequestSeq();
      const rows = await mediaLibrary.getUserPlaylistEntries(playlistId);
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      setSelectedPlaylistId(playlistId);
      setEntries(rows);
      setStatus(`Loaded ${rows.length} track(s) from playlist`);
    } catch (error) {
      setStatus(`Failed to load playlist entries (${getErrorMessage(error)})`);
    }
  };

  const searchTracks = async (query: string) => {
    if (!mediaLibrary) {
      setStatus('Media library module unavailable');
      return;
    }

    const trimmed = normalizeSearchQuery(query);
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    try {
      const rows = await mediaLibrary.searchIndexedTracks(trimmed, 20);
      setSearchResults(rows);
      setStatus(`Search results: ${rows.length}`);
    } catch (error) {
      setStatus(`Search failed (${getErrorMessage(error)})`);
    }
  };

  const addTrack = async (track: MediaStoreTrack) => {
    if (!mediaLibrary || !selectedPlaylistId) {
      setStatus('Select a playlist first');
      return;
    }

    if (isMutating) {
      return;
    }

    try {
      setIsMutating(true);
      const rows = await mediaLibrary.addTrackToUserPlaylist(selectedPlaylistId, track);
      setEntries(rows);
      await refreshPlaylists();
      setStatus(`Added track to playlist (${rows.length} total)`);
    } catch (error) {
      setStatus(`Failed to add track to playlist (${getErrorMessage(error)})`);
    } finally {
      setIsMutating(false);
    }
  };

  const removeTrack = async (position: number) => {
    if (!mediaLibrary || !selectedPlaylistId) {
      setStatus('Select a playlist first');
      return;
    }

    if (isMutating) {
      return;
    }

    try {
      setIsMutating(true);
      const rows = await mediaLibrary.removeTrackFromUserPlaylist(selectedPlaylistId, position);
      setEntries(rows);
      await refreshPlaylists();
      setStatus(`Removed track (${rows.length} remaining)`);
    } catch (error) {
      setStatus(`Failed to remove track (${getErrorMessage(error)})`);
    } finally {
      setIsMutating(false);
    }
  };

  const moveTrack = async (fromPosition: number, toPosition: number) => {
    if (!mediaLibrary || !selectedPlaylistId) {
      setStatus('Select a playlist first');
      return;
    }

    if (isMutating) {
      return;
    }

    try {
      setIsMutating(true);
      const rows = await mediaLibrary.moveTrackInUserPlaylist(
        selectedPlaylistId,
        fromPosition,
        toPosition,
      );
      setEntries(rows);
      await refreshPlaylists();
      setStatus('Playlist order updated');
    } catch (error) {
      setStatus(`Failed to reorder playlist (${getErrorMessage(error)})`);
    } finally {
      setIsMutating(false);
    }
  };

  return {
    status,
    playlists,
    selectedPlaylistId,
    entries,
    searchResults,
    refreshPlaylists,
    createPlaylist,
    selectPlaylist,
    searchTracks,
    addTrack,
    removeTrack,
    moveTrack,
  };
}
