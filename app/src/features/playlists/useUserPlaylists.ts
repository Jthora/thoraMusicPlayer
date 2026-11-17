import {useEffect, useRef, useState} from 'react';

import {
  MediaStoreTrack,
  UserPlaylist,
  UserPlaylistTrack,
  mediaLibrary,
} from '../../native/modules';
import {kvStore} from '../../platform/storage/kvStore';
import {useStableCallback} from '../../platform/hooks/useStableCallback';

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
  // Loading a playlist's entries has its own counter: a playlist-list refresh that starts while a
  // playlist is opening must not make that open look stale (the page then said "Loading…" forever).
  const entriesSeqRef = useRef(0);
  // The playlist being opened, so a refresh in the meantime doesn't pick a different default.
  const pendingSelectionRef = useRef<number | null>(null);

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

  const nextRequestSeq = useStableCallback(() => {
    requestSeqRef.current += 1;
    return requestSeqRef.current;
  });

  const isCurrentRequest = (requestSeq: number) => requestSeqRef.current == requestSeq;

  const refreshPlaylists = useStableCallback(async () => {
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
      if (pendingSelectionRef.current !== null) {
        return; // selectPlaylist is loading the playlist the user opened
      }
      const preferredPlaylistId =
        selectedPlaylistId && rows.some(item => item.id === selectedPlaylistId)
          ? selectedPlaylistId
          : restoredSelectedPlaylistId && rows.some(item => item.id === restoredSelectedPlaylistId)
            ? restoredSelectedPlaylistId
            : rows[0].id;

      if (!selectedPlaylistId || selectedPlaylistId !== preferredPlaylistId) {
        const entriesSeq = ++entriesSeqRef.current;
        const defaultEntries = await mediaLibrary.getUserPlaylistEntries(preferredPlaylistId);
        if (entriesSeq !== entriesSeqRef.current || pendingSelectionRef.current !== null) {
          return;
        }
        setSelectedPlaylistId(preferredPlaylistId);
        setEntries(defaultEntries);
      }
    } catch (error) {
      setStatus(`Failed to load user playlists (${getErrorMessage(error)})`);
    }
  });

  useEffect(() => {
    if (!selectionHydrated) {
      return;
    }

    void refreshPlaylists();
  }, [selectionHydrated, refreshPlaylists]);

  const createPlaylist = useStableCallback(async (name: string): Promise<UserPlaylist | null> => {
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
  });

  const selectPlaylist = useStableCallback(async (playlistId: number) => {
    if (!mediaLibrary) {
      setStatus('Media library module unavailable');
      return;
    }

    const entriesSeq = ++entriesSeqRef.current;
    pendingSelectionRef.current = playlistId;
    try {
      const rows = await mediaLibrary.getUserPlaylistEntries(playlistId);
      if (entriesSeq !== entriesSeqRef.current) {
        return; // another playlist was opened meanwhile
      }
      setSelectedPlaylistId(playlistId);
      setEntries(rows);
      setStatus(`Loaded ${rows.length} track(s) from playlist`);
    } catch (error) {
      setStatus(`Failed to load playlist entries (${getErrorMessage(error)})`);
    } finally {
      if (entriesSeq === entriesSeqRef.current) {
        pendingSelectionRef.current = null;
      }
    }
  });

  const searchTracks = useStableCallback(async (query: string) => {
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
  });

  const addTrack = useStableCallback(async (track: MediaStoreTrack) => {
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
  });

  const removeTrack = useStableCallback(async (position: number) => {
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
  });

  const deletePlaylist = useStableCallback(async (playlistId: number): Promise<boolean> => {
    if (!mediaLibrary) {
      setStatus('Media library module unavailable');
      return false;
    }
    try {
      setIsMutating(true);
      const remaining = await mediaLibrary.deleteUserPlaylist(playlistId);
      setPlaylists(remaining);
      if (selectedPlaylistId === playlistId) {
        setSelectedPlaylistId(null);
        setEntries([]);
      }
      setStatus(`Deleted playlist (${remaining.length} left)`);
      return true;
    } catch (error) {
      setStatus(`Failed to delete playlist (${getErrorMessage(error)})`);
      return false;
    } finally {
      setIsMutating(false);
    }
  });

  const moveTrack = useStableCallback(async (fromPosition: number, toPosition: number) => {
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
  });

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
    deletePlaylist,
  };
}
