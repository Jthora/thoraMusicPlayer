import {SetupValidationSnapshot} from '../../native/modules';

function findSnapshot(snapshots: SetupValidationSnapshot[], label: string): SetupValidationSnapshot | undefined {
  return snapshots.find(item => item.label === label);
}

function describeBatteryDelta(
  baseline: SetupValidationSnapshot,
  postSetup: SetupValidationSnapshot,
): string {
  if (baseline.batteryOptimized && !postSetup.batteryOptimized) {
    return 'battery=IMPROVED';
  }

  if (!baseline.batteryOptimized && postSetup.batteryOptimized) {
    return 'battery=REGRESSED';
  }

  return `battery=UNCHANGED(${postSetup.batteryOptimized ? 'optimized' : 'exempted'})`;
}

function describeAutostartDelta(
  baseline: SetupValidationSnapshot,
  postSetup: SetupValidationSnapshot,
): string {
  if (!baseline.autostartSettingsAvailable && postSetup.autostartSettingsAvailable) {
    return 'autostart=IMPROVED';
  }

  if (baseline.autostartSettingsAvailable && !postSetup.autostartSettingsAvailable) {
    return 'autostart=REGRESSED';
  }

  return `autostart=UNCHANGED(${postSetup.autostartSettingsAvailable ? 'available' : 'unknown'})`;
}

export function buildSetupDeltaMessage(snapshots: SetupValidationSnapshot[]): string {
  const baseline = findSnapshot(snapshots, 'baseline');
  const postSetup = findSnapshot(snapshots, 'post_setup');

  if (!baseline || !postSetup) {
    return 'setup-delta=INSUFFICIENT_SNAPSHOTS';
  }

  return [
    `setup-delta=[${describeBatteryDelta(baseline, postSetup)};${describeAutostartDelta(baseline, postSetup)}]`,
    `baselineTs=${baseline.timestampSec}`,
    `postSetupTs=${postSetup.timestampSec}`,
  ].join(' ');
}
