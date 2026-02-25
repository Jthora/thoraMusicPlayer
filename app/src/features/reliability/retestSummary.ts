import {IdleTestSession, ReliabilityChecklistItem} from '../../native/modules';

function formatChecklist(items: ReliabilityChecklistItem[]): string {
  return items
    .map(item => `${item.key}=${item.passed ? 'PASS' : 'PENDING'}`)
    .join(', ');
}

function formatIdleSession(session: IdleTestSession | undefined): string {
  if (!session) {
    return 'none';
  }

  return `${session.sessionId}:${session.status}:${session.label}`;
}

export function buildRetestSummaryMessage(
  checklistItems: ReliabilityChecklistItem[],
  idleTestSessions: IdleTestSession[],
  notes: string,
): string {
  const latestSession = idleTestSessions[0];
  const cleanedNotes = notes.trim() || 'none';
  return `checklist[${formatChecklist(checklistItems)}] idle[${formatIdleSession(latestSession)}] notes[${cleanedNotes}]`;
}
