import {useEffect, useMemo, useRef, useState} from 'react';
import {AppState, AppStateStatus} from 'react-native';

type BackgroundSyncOrchestratorParams = {
  permissionStatus: string;
  refreshFolderGrants: () => Promise<unknown> | void;
  runIncrementalMediaSync: () => Promise<void>;
  cleanupRevokedGrants?: () => Promise<unknown> | void;
};

const SYNC_DEBOUNCE_MS = 2 * 60 * 1000;
const CLEANUP_DEBOUNCE_MS = 6 * 60 * 60 * 1000;
const ACTIVE_POLL_MS = 75 * 1000;

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

  const canAutoSync = permissionStatus === 'Granted';

  const runAutomation = useMemo(
    () =>
      async (reason: 'startup' | 'resume' | 'state-change') => {
        if (inFlightRef.current) {
          return;
        }

        inFlightRef.current = true;
        try {
          await Promise.resolve(refreshFolderGrants());

          if (!canAutoSync) {
            setAutomationStatus('Auto sync waiting for permission');
            return;
          }

          const now = Date.now();
          const shouldSync = now - lastSyncAtMsRef.current >= SYNC_DEBOUNCE_MS;
          if (!shouldSync) {
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
      },
    [canAutoSync, cleanupRevokedGrants, refreshFolderGrants, runIncrementalMediaSync],
  );

  useEffect(() => {
    void runAutomation('startup');
  }, [runAutomation]);

  useEffect(() => {
    void runAutomation('state-change');
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
      if (appStateRef.current !== 'active') {
        return;
      }

      void runAutomation('state-change');
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
