import {useRef, useState} from 'react';

import {
  IndexStats,
  mediaLibrary,
  MediaStoreTrack,
  ScanDiagnostic,
  SyncStatus,
} from '../../native/modules';

const defaultStats: IndexStats = {
  totalTracks: 0,
  distinctRoots: 0,
  lastUpdatedSec: 0,
  snapshotCount: 0,
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

function isSyncStatusShape(value: unknown): value is SyncStatus {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SyncStatus>;
  return (
    typeof candidate.snapshotId === 'number' &&
    typeof candidate.sourceType === 'string' &&
    typeof candidate.sourceRoot === 'string' &&
    typeof candidate.startedAtSec === 'number' &&
    typeof candidate.completedAtSec === 'number' &&
    typeof candidate.scannedCount === 'number' &&
    typeof candidate.insertedCount === 'number' &&
    typeof candidate.updatedCount === 'number' &&
    typeof candidate.duplicateCount === 'number' &&
    typeof candidate.skippedCount === 'number' &&
    typeof candidate.removedCount === 'number'
  );
}

export function useIndexedLibrary() {
  const [status, setStatus] = useState('Idle');
  const [stats, setStats] = useState<IndexStats>(defaultStats);
  const [results, setResults] = useState<MediaStoreTrack[]>([]);
  const [latestSync, setLatestSync] = useState<SyncStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostic[]>([]);
  const requestSeqRef = useRef(0);
  const syncInFlightRef = useRef(false);

  const nextRequestSeq = () => {
    requestSeqRef.current += 1;
    return requestSeqRef.current;
  };

  const isCurrentRequest = (requestSeq: number) => requestSeqRef.current === requestSeq;

  const refreshStats = async () => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      const requestSeq = nextRequestSeq();
      const nextStats = await mediaLibrary.getIndexStats();
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      setStats(nextStats);
      setStatus(`Index stats loaded: ${nextStats.totalTracks} track(s)`);
    } catch (error) {
      setStatus(`Failed to load index stats (${getErrorMessage(error)})`);
    }
  };

  const searchIndex = async (query: string, limit = 25) => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setStatus('Enter a search query');
      return;
    }

    try {
      const requestSeq = nextRequestSeq();
      const rows = await mediaLibrary.searchIndexedTracks(trimmed, limit);
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      setResults(rows);
      setStatus(`Index search complete: ${rows.length} result(s)`);
    } catch (error) {
      setStatus(`Index search failed (${getErrorMessage(error)})`);
    }
  };

  const refreshLatestSync = async () => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      const requestSeq = nextRequestSeq();
      const syncStatus = await mediaLibrary.getLatestSyncStatus();
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      if (!isSyncStatusShape(syncStatus) || syncStatus.snapshotId <= 0) {
        setLatestSync(null);
        setDiagnostics([]);
        setStatus('No sync snapshots yet');
        return;
      }

      setLatestSync(syncStatus);
      const rows = await mediaLibrary.getLatestSyncDiagnostics(25);
      if (!isCurrentRequest(requestSeq)) {
        return;
      }
      setDiagnostics(rows);
      setStatus(`Latest sync snapshot: #${syncStatus.snapshotId}`);
    } catch (error) {
      setStatus(`Failed to load sync diagnostics (${getErrorMessage(error)})`);
    }
  };

  const runIncrementalMediaSync = async () => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    if (syncInFlightRef.current) {
      setStatus('Sync already in progress');
      return;
    }

    try {
      syncInFlightRef.current = true;
      setStatus('Running incremental MediaStore sync...');
      const result = await mediaLibrary.runIncrementalMediaStoreSync(0);
      setStatus(
        `Incremental MediaStore sync: +${result.summary.inserted}/~${result.summary.updated}/-${result.summary.removed}`,
      );
      await refreshStats();
      await refreshLatestSync();
    } catch (error) {
      setStatus(`Incremental MediaStore sync failed (${getErrorMessage(error)})`);
    } finally {
      syncInFlightRef.current = false;
    }
  };

  const runIncrementalSafSync = async () => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    if (syncInFlightRef.current) {
      setStatus('Sync already in progress');
      return;
    }

    try {
      syncInFlightRef.current = true;
      setStatus('Running incremental SAF sync...');
      const result = await mediaLibrary.runIncrementalSafSync(100);
      const summary = result.summary;
      setStatus(`Incremental SAF sync: +${summary.inserted}/~${summary.updated}/-${summary.removed}`);
      await refreshStats();
      await refreshLatestSync();
    } catch (error) {
      setStatus(`Incremental SAF sync failed (${getErrorMessage(error)})`);
    } finally {
      syncInFlightRef.current = false;
    }
  };

  return {
    status,
    stats,
    results,
    latestSync,
    diagnostics,
    refreshStats,
    searchIndex,
    refreshLatestSync,
    runIncrementalMediaSync,
    runIncrementalSafSync,
  };
}
