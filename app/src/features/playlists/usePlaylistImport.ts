import {useRef, useState} from 'react';

import {
  PlaylistImportResult,
  mediaLibrary,
  storageAccess,
} from '../../native/modules';

const emptyImport: PlaylistImportResult = {
  sourceUri: '',
  sourceName: '',
  format: 'm3u',
  totalEntries: 0,
  resolvedCount: 0,
  unresolvedCount: 0,
  duplicateCount: 0,
  unsupportedCount: 0,
  importedAtSec: 0,
  diagnostics: [],
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

export function usePlaylistImport() {
  const [status, setStatus] = useState('No playlist imported');
  const [latestImport, setLatestImport] = useState<PlaylistImportResult>(emptyImport);
  const operationInFlightRef = useRef(false);
  const requestSeqRef = useRef(0);

  const nextRequestSeq = () => {
    requestSeqRef.current += 1;
    return requestSeqRef.current;
  };

  const isCurrentRequest = (requestSeq: number) => requestSeqRef.current === requestSeq;

  const importPlaylist = async () => {
    if (!storageAccess || !mediaLibrary) {
      setStatus('Playlist import modules unavailable');
      return;
    }

    if (operationInFlightRef.current) {
      setStatus('Playlist import already in progress');
      return;
    }

    try {
      operationInFlightRef.current = true;
      const requestSeq = nextRequestSeq();
      setStatus('Picking playlist file...');
      const selected = await storageAccess.pickPlaylistFile();
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      setStatus(`Importing ${selected.name}...`);

      const result = await mediaLibrary.importPlaylistFile(selected.uri, selected.name);
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      setLatestImport(result);

      setStatus(
        `Imported ${result.sourceName}: ${result.resolvedCount}/${result.totalEntries} resolved, ${result.unresolvedCount} unresolved`,
      );
    } catch (error) {
      setStatus(`Playlist import cancelled or failed (${getErrorMessage(error)})`);
    } finally {
      operationInFlightRef.current = false;
    }
  };

  const refreshLatestImport = async () => {
    if (!mediaLibrary) {
      setStatus('Playlist import modules unavailable');
      return;
    }

    if (operationInFlightRef.current) {
      return;
    }

    try {
      const requestSeq = nextRequestSeq();
      const latest = await mediaLibrary.getLatestPlaylistImportSummary();
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      if (!('totalEntries' in latest)) {
        return;
      }

      setLatestImport(latest as PlaylistImportResult);
    } catch (error) {
      setStatus(`Failed to load latest import summary (${getErrorMessage(error)})`);
    }
  };

  const retryLatestImport = async () => {
    if (!mediaLibrary) {
      setStatus('Playlist import modules unavailable');
      return;
    }

    if (!latestImport.sourceUri) {
      setStatus('No previous playlist import to retry');
      return;
    }

    if (operationInFlightRef.current) {
      setStatus('Playlist import already in progress');
      return;
    }

    try {
      operationInFlightRef.current = true;
      const requestSeq = nextRequestSeq();
      setStatus(`Retrying ${latestImport.sourceName || 'playlist'} resolution...`);
      const retried = await mediaLibrary.importPlaylistFile(
        latestImport.sourceUri,
        latestImport.sourceName || null,
      );
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      setLatestImport(retried);
      setStatus(
        `Retry complete: ${retried.resolvedCount}/${retried.totalEntries} resolved, ${retried.unresolvedCount} unresolved`,
      );
    } catch (error) {
      setStatus(`Retry failed (${getErrorMessage(error)})`);
    } finally {
      operationInFlightRef.current = false;
    }
  };

  return {
    status,
    latestImport,
    importPlaylist,
    refreshLatestImport,
    retryLatestImport,
  };
}
