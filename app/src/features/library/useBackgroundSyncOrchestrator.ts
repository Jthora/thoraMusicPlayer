import {useEffect, useRef, useState} from 'react';
import {AppState, AppStateStatus} from 'react-native';

import {useStableCallback} from '../../platform/hooks/useStableCallback';

type BackgroundSyncOrchestratorParams = {
  permissionStatus: string;
  refreshFolderGrants: () => Promise<unknown> | void;
  runIncrementalMediaSync: () => Promise<void>;
  cleanupRevokedGrants?: () => Promise<unknown> | void;
};

type SyncReason = 'startup' | 'resume' | 'state-change' | 'periodic';

// Minimum time since the last sync before each trigger may sync again.
const SYNC_DEBOUNCE_MS: Record<SyncReason, number> = {
  startup: 0,
  'state-change': 0,
  resume: 2 * 60 * 1000,
  periodic: 10 * 60 * 1000, // catches files arriving (e.g. thora-transfer push) while the app stays open
};
const CLEANUP_DEBOUNCE_MS = 6 * 60 * 60 * 1000;
const ACTIVE_POLL_MS = 75 * 1000;

/**
 * Single owner of automatic library syncing. Every other caller (shell bootstrap, permission
 * changes) relies on `syncRevision` bumps instead of starting syncs of its own.
 */
export function useBackgroundSyncOrchestrator({
  permissionStatus,
  refreshFolderGrants,
  runIncrementalMediaSync,
  cleanupRevokedGrants,
}: BackgroundSyncOrchestratorParams) {
  const [automationStatus, setAutomationStatus] = useState('Auto sync idle');
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string>('Never');
  const [syncRevision, setSyncRevision] = useState(0);
  const inFlightRef = useRef(false);
  const lastSyncAtMsRef = useRef(0);
  const lastCleanupAtMsRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const startedRef = useRef(false);

  const canAutoSync = permissionStatus === 'Granted';

  const runAutomation = useStableCallback(async (reason: SyncReason) => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    try {
      // Folder grants only change through user action outside the app; refresh on startup/resume only.
      if (reason === 'startup' || reason === 'resume') {
        await Promise.resolve(refreshFolderGrants());
      }

      if (!canAutoSync) {
        setAutomationStatus('Auto sync waiting for permission');
        return;
      }

      const now = Date.now();
      if (lastSyncAtMsRef.current > 0 && now - lastSyncAtMsRef.current < SYNC_DEBOUNCE_MS[reason]) {
        setAutomationStatus('Library fresh in background');
        return;
      }

      setAutomationStatus(reason === 'resume' ? 'Auto syncing on resume...' : 'Auto syncing library...');
      await runIncrementalMediaSync();
      lastSyncAtMsRef.current = now;
      setLastAutoSyncAt(new Date(now).toLocaleTimeString());
      setSyncRevision(current => current + 1);
      setAutomationStatus('Library auto-synced');

      if (cleanupRevokedGrants && now - lastCleanupAtMsRef.current >= CLEANUP_DEBOUNCE_MS) {
        await Promise.resolve(cleanupRevokedGrants());
        lastCleanupAtMsRef.current = now;
      }
    } catch {
      setAutomationStatus('Auto sync paused (retry on next resume)');
    } finally {
      inFlightRef.current = false;
    }
  });

  // Mount, and each permission transition (e.g. the user grants audio access).
  useEffect(() => {
    const reason: SyncReason = startedRef.current ? 'state-change' : 'startup';
    startedRef.current = true;
    void runAutomation(reason);
  }, [canAutoSync, runAutomation]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      if ((prevState === 'background' || prevState === 'inactive') && nextState === 'active') {
        void runAutomation('resume');
      }
    });

    return () => {
      subscription.remove();
    };
  }, [runAutomation]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (appStateRef.current === 'active') {
        void runAutomation('periodic');
      }
    }, ACTIVE_POLL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [runAutomation]);

  return {
    automationStatus,
    lastAutoSyncAt,
    syncRevision,
  };
}
