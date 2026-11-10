import {useRef, useState} from 'react';

import {
  PlaylistImportResult,
  mediaLibrary,
  storageAccess,
} from '../../native/modules';
import {logDiagnostic} from '../../platform/diagnostics';
import {useStableCallback} from '../../platform/hooks/useStableCallback';

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

export function summarizeImports(results: PlaylistImportResult[], failures: number): string {
  const created = results.filter(result => result.playlistId != null);
  const matched = results.reduce((sum, result) => sum + result.resolvedCount, 0);
  const entries = results.reduce((sum, result) => sum + result.totalEntries, 0);
  const empty = results.length - created.length;
  if (results.length === 1 && failures === 0) {
    const [only] = results;
    return only.playlistId != null
      ? `Imported "${only.playlistName}": ${only.resolvedCount} of ${only.totalEntries} songs found`
      : `No songs from ${only.sourceName} are in the library yet (${only.totalEntries} entries)`;
  }
  const parts = [`Imported ${created.length} playlist${created.length === 1 ? '' : 's'}: ${matched} of ${entries} songs found`];
  if (empty > 0) {
    parts.push(`${empty} with no songs in the library`);
  }
  if (failures > 0) {
    parts.push(`${failures} could not be read`);
  }
  return parts.join('; ');
}

type UsePlaylistImportOptions = {
  /** Called after any playlist was created or refreshed, e.g. to reload the playlist list. */
  onImported?: () => void | Promise<void>;
};

export function usePlaylistImport(options: UsePlaylistImportOptions = {}) {
  const {onImported} = options;
  const [status, setStatus] = useState('No playlist imported');
  const [latestImport, setLatestImport] = useState<PlaylistImportResult>(emptyImport);
  const operationInFlightRef = useRef(false);
  const requestSeqRef = useRef(0);

  const nextRequestSeq = useStableCallback(() => {
    requestSeqRef.current += 1;
    return requestSeqRef.current;
  });

  const isCurrentRequest = (requestSeq: number) => requestSeqRef.current === requestSeq;

  const importPlaylist = useStableCallback(async () => {
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
      setStatus('Picking playlist files...');
      const selected = storageAccess.pickPlaylistFiles
        ? await storageAccess.pickPlaylistFiles()
        : [await storageAccess.pickPlaylistFile()];
      if (!isCurrentRequest(requestSeq)) {
        return;
      }

      // One at a time: each import loads the library index and writes a playlist.
      const results: PlaylistImportResult[] = [];
      let failures = 0;
      for (const [index, file] of selected.entries()) {
        setStatus(`Importing ${index + 1}/${selected.length}: ${file.name}...`);
        try {
          const result = await mediaLibrary.importPlaylistFile(file.uri, file.name);
          results.push(result);
          setLatestImport(result);
        } catch (error) {
          failures += 1;
          logDiagnostic('warn', 'playlist-import', `Could not import ${file.name}`, {
            error: getErrorMessage(error),
          });
        }
        if (!isCurrentRequest(requestSeq)) {
          return;
        }
      }

      setStatus(summarizeImports(results, failures));
      if (results.some(result => result.playlistId != null)) {
        await onImported?.();
      }
    } catch (error) {
      setStatus(`Playlist import cancelled or failed (${getErrorMessage(error)})`);
    } finally {
      operationInFlightRef.current = false;
    }
  });

  const refreshLatestImport = useStableCallback(async () => {
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
  });

  const retryLatestImport = useStableCallback(async () => {
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
      setStatus(summarizeImports([retried], 0));
      if (retried.playlistId != null) {
        await onImported?.();
      }
    } catch (error) {
      setStatus(`Retry failed (${getErrorMessage(error)})`);
    } finally {
      operationInFlightRef.current = false;
    }
  });

  return {
    status,
    latestImport,
    importPlaylist,
    refreshLatestImport,
    retryLatestImport,
  };
}
