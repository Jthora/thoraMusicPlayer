import {useEffect, useMemo, useState} from 'react';

import {
  IdleTestSession,
  OemSetupStatus,
  ReliabilityChecklistItem,
  ReliabilityEvent,
  SetupValidationReport,
  SetupValidationSnapshot,
  oemSetup,
  reliabilityChecklist,
} from '../../native/modules';
import {shareValidationReportText} from './reportShare';
import {deriveVerificationReadiness} from './readinessStatus';
import {buildRetestSummaryMessage} from './retestSummary';
import {buildSetupDeltaMessage} from './setupDelta';
import {buildValidationBundleText} from './validationBundle';

const initialStatus: OemSetupStatus = {
  manufacturer: '',
  model: '',
  batteryOptimized: true,
  isXiaomiFamily: false,
  autostartSettingsAvailable: false,
};

const STALE_AFTER_SEC = 15 * 60;

type FreshnessState = {
  setupStatus: string;
  events: string;
  snapshots: string;
  idleSessions: string;
  checklist: string;
  report: string;
  staleCount: number;
  summary: string;
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

export function useDeviceSetupGuidance() {
  const [statusText, setStatusText] = useState('Checking device setup...');
  const [diagnosticText, setDiagnosticText] = useState('');
  const [setupStatus, setSetupStatus] = useState<OemSetupStatus>(initialStatus);
  const [events, setEvents] = useState<ReliabilityEvent[]>([]);
  const [snapshots, setSnapshots] = useState<SetupValidationSnapshot[]>([]);
  const [validationReport, setValidationReport] = useState<SetupValidationReport | null>(null);
  const [idleTestSessions, setIdleTestSessions] = useState<IdleTestSession[]>([]);
  const [checklistItems, setChecklistItems] = useState<ReliabilityChecklistItem[]>([]);
  const [setupStatusRefreshedAtSec, setSetupStatusRefreshedAtSec] = useState(0);
  const verificationReadiness = deriveVerificationReadiness(checklistItems, idleTestSessions, snapshots);

  const setOperationStatus = (message: string) => {
    setStatusText(message);
    setDiagnosticText('');
  };

  const setFailureStatus = (message: string, error: unknown) => {
    setStatusText(message);
    setDiagnosticText(`${message} (${getErrorMessage(error)})`);
  };

  const dataFreshness = useMemo<FreshnessState>(() => {
    const nowSec = Math.floor(Date.now() / 1000);

    const formatAge = (label: string, timestampSec: number): {text: string; stale: boolean} => {
      if (timestampSec <= 0) {
        return {text: `${label}: no data`, stale: true};
      }

      const ageSec = Math.max(0, nowSec - timestampSec);
      const stale = ageSec >= STALE_AFTER_SEC;
      if (ageSec < 60) {
        return {text: `${label}: ${ageSec}s ago (${stale ? 'STALE' : 'fresh'})`, stale};
      }

      if (ageSec < 3600) {
        return {text: `${label}: ${Math.floor(ageSec / 60)}m ago (${stale ? 'STALE' : 'fresh'})`, stale};
      }

      return {text: `${label}: ${Math.floor(ageSec / 3600)}h ago (${stale ? 'STALE' : 'fresh'})`, stale};
    };

    const eventsUpdatedAtSec = events[0]?.timestampSec ?? 0;
    const snapshotsUpdatedAtSec = snapshots[0]?.timestampSec ?? 0;
    const idleUpdatedAtSec = idleTestSessions[0]?.startedAtSec ?? 0;
    const checklistUpdatedAtSec = checklistItems[0]?.updatedAtSec ?? 0;
    const reportUpdatedAtSec = validationReport?.generatedAtSec ?? 0;

    const setupStatusAge = formatAge('Setup status', setupStatusRefreshedAtSec);
    const eventsAge = formatAge('Events', eventsUpdatedAtSec);
    const snapshotsAge = formatAge('Snapshots', snapshotsUpdatedAtSec);
    const idleAge = formatAge('Idle sessions', idleUpdatedAtSec);
    const checklistAge = formatAge('Checklist', checklistUpdatedAtSec);
    const reportAge = formatAge('Report', reportUpdatedAtSec);

    const staleCount = [setupStatusAge, eventsAge, snapshotsAge, idleAge, checklistAge, reportAge]
      .filter(item => item.stale).length;

    return {
      setupStatus: setupStatusAge.text,
      events: eventsAge.text,
      snapshots: snapshotsAge.text,
      idleSessions: idleAge.text,
      checklist: checklistAge.text,
      report: reportAge.text,
      staleCount,
      summary: staleCount == 0 ? 'Reliability data freshness: all fresh' : `Reliability data freshness: ${staleCount} stale dataset(s)`,
    };
  }, [checklistItems, events, idleTestSessions, setupStatusRefreshedAtSec, snapshots, validationReport?.generatedAtSec]);

  const refreshSetupStatus = async () => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      const next = await oemSetup.getDeviceSetupStatus();
      setSetupStatus(next);
      setSetupStatusRefreshedAtSec(Math.floor(Date.now() / 1000));
      setOperationStatus(next.batteryOptimized ? 'Battery optimization active' : 'Battery optimization disabled for app');
    } catch (error) {
      setFailureStatus('Failed to read device setup status', error);
    }
  };

  const refreshEvents = async () => {
    if (!oemSetup) {
      return;
    }

    try {
      const rows = await oemSetup.getReliabilityEvents(20);
      setEvents(rows);
    } catch (error) {
      setFailureStatus('Failed to load reliability events', error);
    }
  };

  const refreshSnapshots = async () => {
    if (!oemSetup) {
      return;
    }

    try {
      const rows = await oemSetup.getSetupValidationSnapshots(20);
      setSnapshots(rows);
    } catch (error) {
      setFailureStatus('Failed to load setup validation snapshots', error);
    }
  };

  const refreshChecklist = async () => {
    if (!reliabilityChecklist) {
      return;
    }

    try {
      const rows = await reliabilityChecklist.getChecklist();
      setChecklistItems(rows);
    } catch (error) {
      setFailureStatus('Failed to load reliability checklist', error);
    }
  };

  useEffect(() => {
    void refreshSetupStatus();
    void refreshEvents();
    void refreshSnapshots();
    void refreshIdleTestSessions();
    void refreshChecklist();
  }, []);

  const refreshIdleTestSessions = async () => {
    if (!oemSetup) {
      return;
    }

    try {
      const rows = await oemSetup.getIdleTestSessions(20);
      setIdleTestSessions(rows);
    } catch (error) {
      setFailureStatus('Failed to load idle test sessions', error);
    }
  };

  const openBatteryOptimizationSettings = async () => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      await oemSetup.openBatteryOptimizationSettings();
      await oemSetup.recordReliabilityEvent('OPEN_BATTERY_SETTINGS', 'Opened battery optimization settings');
      setOperationStatus('Opened battery optimization settings');
      await refreshEvents();
    } catch (error) {
      setFailureStatus('Failed to open battery optimization settings', error);
    }
  };

  const openAutostartSettings = async () => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      await oemSetup.openAutostartSettings();
      await oemSetup.recordReliabilityEvent('OPEN_AUTOSTART_SETTINGS', 'Opened autostart/background settings');
      setOperationStatus('Opened autostart/background settings');
      await refreshEvents();
    } catch (error) {
      setFailureStatus('Failed to open autostart/background settings', error);
    }
  };

  const recordEvent = async (eventCode: string, message: string) => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      await oemSetup.recordReliabilityEvent(eventCode, message);
      setOperationStatus(`Recorded event: ${eventCode}`);
      await refreshEvents();
    } catch (error) {
      setFailureStatus('Failed to record reliability event', error);
    }
  };

  const captureSnapshot = async (label: string) => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      await oemSetup.captureSetupValidationSnapshot(label);
      setOperationStatus(`Captured setup snapshot: ${label}`);
      await refreshSetupStatus();
      await refreshSnapshots();
    } catch (error) {
      setFailureStatus('Failed to capture setup snapshot', error);
    }
  };

  const refreshValidationReport = async () => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      const report = await oemSetup.getSetupValidationReport();
      setValidationReport(report);
      setOperationStatus(`Validation report generated at ${report.generatedAtSec}`);
    } catch (error) {
      setFailureStatus('Failed to generate validation report', error);
    }
  };

  const startIdleTestSession = async (label: string, expectedMinutes: number) => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      const session = await oemSetup.startIdleTestSession(label, expectedMinutes);
      setOperationStatus(`Idle test started: ${session.label}`);
      await recordEvent('IDLE_TEST_STARTED', `${session.sessionId} (${session.expectedMinutes} min)`);
      await refreshIdleTestSessions();
    } catch (error) {
      setFailureStatus('Failed to start idle test session', error);
    }
  };

  const completeIdleTestSession = async (sessionId: string, outcome: string, notes: string) => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      const session = await oemSetup.completeIdleTestSession(sessionId, outcome, notes);
      setOperationStatus(`Idle test ${session.status}: ${session.label}`);
      await recordEvent('IDLE_TEST_COMPLETED', `${session.sessionId} ${session.status} ${session.notes}`);
      await refreshIdleTestSessions();
    } catch (error) {
      setFailureStatus('Failed to complete idle test session', error);
    }
  };

  const setChecklistItem = async (key: string, passed: boolean, notes: string) => {
    if (!reliabilityChecklist) {
      setOperationStatus('Checklist module unavailable');
      return;
    }

    try {
      await reliabilityChecklist.setChecklistItem(key, passed, notes);
      setOperationStatus(`Checklist updated: ${key}`);
      await refreshChecklist();
    } catch (error) {
      setFailureStatus('Failed to update reliability checklist', error);
    }
  };

  const recordRetestRunSummary = async (notes: string) => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      const summaryMessage = buildRetestSummaryMessage(checklistItems, idleTestSessions, notes);
      await oemSetup.recordReliabilityEvent('RETEST_RUN_SUMMARY', summaryMessage);
      await captureSnapshot('retest_summary');
      await refreshValidationReport();
      await refreshEvents();
      setOperationStatus('Recorded retest summary and refreshed report');
    } catch (error) {
      setFailureStatus('Failed to record retest summary', error);
    }
  };

  const shareValidationReport = async () => {
    const text = validationReport?.reportText?.trim() ?? '';
    if (!text) {
      setOperationStatus('No report available to share');
      return;
    }

    try {
      await shareValidationReportText(text);
      setOperationStatus('Validation report shared');
    } catch (error) {
      setFailureStatus('Failed to share validation report', error);
    }
  };

  const evaluateSetupDelta = async () => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      const summary = buildSetupDeltaMessage(snapshots);
      await oemSetup.recordReliabilityEvent('SETUP_DELTA_EVALUATED', summary);
      setOperationStatus('Setup before/after delta evaluated');
      await refreshEvents();
    } catch (error) {
      setFailureStatus('Failed to evaluate setup delta', error);
    }
  };

  const shareValidationBundle = async () => {
    if (!oemSetup) {
      setOperationStatus('OEM setup module unavailable');
      return;
    }

    try {
      const bundleText = buildValidationBundleText(
        validationReport,
        checklistItems,
        idleTestSessions,
        events,
        snapshots,
      );
      await oemSetup.recordReliabilityEvent('VALIDATION_BUNDLE_CREATED', `chars=${bundleText.length}`);
      await shareValidationReportText(bundleText);
      setOperationStatus('Validation bundle shared');
      await refreshEvents();
    } catch (error) {
      setFailureStatus('Failed to share validation bundle', error);
    }
  };

  return {
    statusText,
    diagnosticText,
    setupStatus,
    events,
    snapshots,
    validationReport,
    idleTestSessions,
    checklistItems,
    dataFreshness,
    verificationReadiness,
    refreshSetupStatus,
    openBatteryOptimizationSettings,
    openAutostartSettings,
    recordEvent,
    refreshEvents,
    refreshSnapshots,
    captureSnapshot,
    refreshValidationReport,
    refreshIdleTestSessions,
    startIdleTestSession,
    completeIdleTestSession,
    refreshChecklist,
    setChecklistItem,
    recordRetestRunSummary,
    shareValidationReport,
    evaluateSetupDelta,
    shareValidationBundle,
  };
}
