import {IdleTestSession, ReliabilityChecklistItem, SetupValidationSnapshot} from '../../native/modules';

export type VerificationReadiness = {
  level: 'READY' | 'IN_PROGRESS' | 'BLOCKED';
  summary: string;
};

function hasSnapshot(snapshots: SetupValidationSnapshot[], label: string): boolean {
  return snapshots.some(item => item.label === label);
}

function latestIdleOutcome(idleSessions: IdleTestSession[]): 'PASS' | 'FAIL' | 'NONE' | 'RUNNING' {
  const latest = idleSessions[0];
  if (!latest) {
    return 'NONE';
  }

  if (latest.status === 'PASS') {
    return 'PASS';
  }

  if (latest.status === 'FAIL') {
    return 'FAIL';
  }

  if (latest.status === 'RUNNING') {
    return 'RUNNING';
  }

  return 'NONE';
}

export function deriveVerificationReadiness(
  checklistItems: ReliabilityChecklistItem[],
  idleSessions: IdleTestSession[],
  snapshots: SetupValidationSnapshot[],
): VerificationReadiness {
  const checklistComplete = checklistItems.length > 0 && checklistItems.every(item => item.passed);
  const baselineCaptured = hasSnapshot(snapshots, 'baseline');
  const postSetupCaptured = hasSnapshot(snapshots, 'post_setup');
  const idleOutcome = latestIdleOutcome(idleSessions);

  if (idleOutcome === 'FAIL') {
    return {
      level: 'BLOCKED',
      summary: 'Latest idle/doze session failed; fix and retest required.',
    };
  }

  if (checklistComplete && baselineCaptured && postSetupCaptured && idleOutcome === 'PASS') {
    return {
      level: 'READY',
      summary: 'Checklist complete, snapshots captured, and latest idle/doze session passed.',
    };
  }

  const pendingParts: string[] = [];
  if (!checklistComplete) {
    pendingParts.push('checklist');
  }
  if (!baselineCaptured || !postSetupCaptured) {
    pendingParts.push('snapshots');
  }
  if (idleOutcome === 'NONE') {
    pendingParts.push('idle session');
  }
  if (idleOutcome === 'RUNNING') {
    pendingParts.push('idle completion');
  }

  return {
    level: 'IN_PROGRESS',
    summary: `Pending: ${pendingParts.join(', ') || 'validation updates'}.`,
  };
}
