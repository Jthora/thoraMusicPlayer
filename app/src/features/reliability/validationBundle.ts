import {
  IdleTestSession,
  ReliabilityChecklistItem,
  ReliabilityEvent,
  SetupValidationReport,
  SetupValidationSnapshot,
} from '../../native/modules';

function summarizeChecklist(items: ReliabilityChecklistItem[]): string {
  if (items.length === 0) {
    return 'none';
  }

  return items
    .map(item => `${item.key}:${item.passed ? 'PASS' : 'PENDING'}`)
    .join(',');
}

function summarizeLatestIdleSession(sessions: IdleTestSession[]): string {
  const session = sessions[0];
  if (!session) {
    return 'none';
  }

  return `${session.sessionId}:${session.status}:${session.expectedMinutes}m`;
}

function summarizeLatestEvents(events: ReliabilityEvent[]): string {
  if (events.length === 0) {
    return 'none';
  }

  return events
    .slice(0, 3)
    .map(event => `${event.eventCode}@${event.timestampSec}`)
    .join(',');
}

function summarizeSnapshots(snapshots: SetupValidationSnapshot[]): string {
  if (snapshots.length === 0) {
    return 'none';
  }

  return snapshots
    .slice(0, 3)
    .map(snapshot => `${snapshot.label}@${snapshot.timestampSec}`)
    .join(',');
}

export function buildValidationBundleText(
  report: SetupValidationReport | null,
  checklistItems: ReliabilityChecklistItem[],
  idleTestSessions: IdleTestSession[],
  events: ReliabilityEvent[],
  snapshots: SetupValidationSnapshot[],
): string {
  const generatedAt = report?.generatedAtSec ?? 0;
  const reportPreview = (report?.reportText ?? '').split('\n').slice(0, 4).join(' | ');

  return [
    `bundle.generatedAt=${generatedAt}`,
    `bundle.checklist=${summarizeChecklist(checklistItems)}`,
    `bundle.idle=${summarizeLatestIdleSession(idleTestSessions)}`,
    `bundle.events=${summarizeLatestEvents(events)}`,
    `bundle.snapshots=${summarizeSnapshots(snapshots)}`,
    `bundle.reportPreview=${reportPreview || 'none'}`,
  ].join('\n');
}
