import {useEffect, useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, TextInput, View} from 'react-native';

import {
  IdleTestSession,
  ReliabilityChecklistItem,
  ReliabilityEvent,
  SetupValidationSnapshot,
} from '../../native/modules';
import {AppButton} from '../../ui/components/AppButton';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';

type DeviceSetupPanelProps = {
  statusText: string;
  diagnosticText: string;
  freshnessSummary: string;
  setupStatusFreshness: string;
  eventsFreshness: string;
  snapshotsFreshness: string;
  idleSessionsFreshness: string;
  checklistFreshness: string;
  reportFreshness: string;
  verificationReadinessLevel: string;
  verificationReadinessSummary: string;
  manufacturer: string;
  model: string;
  batteryOptimized: boolean;
  isXiaomiFamily: boolean;
  autostartSettingsAvailable: boolean;
  events: ReliabilityEvent[];
  snapshots: SetupValidationSnapshot[];
  idleTestSessions: IdleTestSession[];
  checklistItems: ReliabilityChecklistItem[];
  validationReportText: string;
  onRefreshStatus: () => Promise<void>;
  onOpenBatterySettings: () => Promise<void>;
  onOpenAutostartSettings: () => Promise<void>;
  onRecordInterruption: () => Promise<void>;
  onRecordRecovery: () => Promise<void>;
  onCaptureBaselineSnapshot: () => Promise<void>;
  onCapturePostSetupSnapshot: () => Promise<void>;
  onEvaluateSetupDelta: () => Promise<void>;
  onGenerateValidationReport: () => Promise<void>;
  onShareValidationReport: () => Promise<void>;
  onShareValidationBundle: () => Promise<void>;
  onStartIdleTestSession: (label: string, expectedMinutes: number) => Promise<void>;
  onCompleteIdleTestSession: (sessionId: string, outcome: string, notes: string) => Promise<void>;
  onSetChecklistItem: (key: string, passed: boolean, notes: string) => Promise<void>;
  onRecordRetestRunSummary: (notes: string) => Promise<void>;
};

function checklistTitle(key: string): string {
  switch (key) {
    case 'idle_transition':
      return 'Idle transition stability';
    case 'interruption_recovery':
      return 'Interruption recovery';
    case 'post_fix_retest':
      return 'Post-fix retest';
    default:
      return key;
  }
}

function formatEvent(item: ReliabilityEvent): string {
  const timestamp = new Date(item.timestampSec * 1000).toLocaleTimeString();
  return `${timestamp} ${item.eventCode}: ${item.message}`;
}

function formatSnapshot(item: SetupValidationSnapshot): string {
  const timestamp = new Date(item.timestampSec * 1000).toLocaleTimeString();
  const battery = item.batteryOptimized ? 'optimized' : 'exempted';
  const autostart = item.autostartSettingsAvailable ? 'autostart-available' : 'autostart-unknown';
  return `${timestamp} ${item.label}: ${battery}, ${autostart}`;
}

function formatIdleSession(item: IdleTestSession): string {
  const started = new Date(item.startedAtSec * 1000).toLocaleTimeString();
  const completed = item.completedAtSec > 0 ? new Date(item.completedAtSec * 1000).toLocaleTimeString() : '-';
  return `${started}/${completed} ${item.label} ${item.status} (${item.expectedMinutes}m)`;
}

export function DeviceSetupPanel(props: DeviceSetupPanelProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    statusText,
    diagnosticText,
    freshnessSummary,
    setupStatusFreshness,
    eventsFreshness,
    snapshotsFreshness,
    idleSessionsFreshness,
    checklistFreshness,
    reportFreshness,
    verificationReadinessLevel,
    verificationReadinessSummary,
    manufacturer,
    model,
    batteryOptimized,
    isXiaomiFamily,
    autostartSettingsAvailable,
    events,
    snapshots,
    idleTestSessions,
    checklistItems,
    validationReportText,
    onRefreshStatus,
    onOpenBatterySettings,
    onOpenAutostartSettings,
    onRecordInterruption,
    onRecordRecovery,
    onCaptureBaselineSnapshot,
    onCapturePostSetupSnapshot,
    onEvaluateSetupDelta,
    onGenerateValidationReport,
    onShareValidationReport,
    onShareValidationBundle,
    onStartIdleTestSession,
    onCompleteIdleTestSession,
    onSetChecklistItem,
    onRecordRetestRunSummary,
  } = props;
  const [idleLabel, setIdleLabel] = useState('doze_idle_run');
  const [idleMinutes, setIdleMinutes] = useState('30');
  const [checklistNotes, setChecklistNotes] = useState<Record<string, string>>({});
  const [retestSummaryNotes, setRetestSummaryNotes] = useState('');
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [showIdleSessionHistory, setShowIdleSessionHistory] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const runningIdleSession = idleTestSessions.find(item => item.status === 'RUNNING');
  const baselineCaptured = snapshots.some(item => item.label === 'baseline');
  const postSetupCaptured = snapshots.some(item => item.label === 'post_setup');
  const latestIdleStatus = idleTestSessions[0]?.status ?? 'NONE';

  useEffect(() => {
    const next: Record<string, string> = {};
    checklistItems.forEach(item => {
      next[item.key] = item.notes;
    });
    setChecklistNotes(next);
  }, [checklistItems]);

  return (
    <View style={styles.container} testID="reliability.panel.root">
      <Text style={styles.title} testID="reliability.panel.title">Device Setup (Xiaomi/HyperOS)</Text>
      <Text style={styles.meta} testID="reliability.status.text">{statusText}</Text>
      {diagnosticText ? <Text style={styles.meta}>Diagnostics: {diagnosticText}</Text> : null}
      <Text style={styles.meta}>{freshnessSummary}</Text>
      <Text style={styles.meta}>{setupStatusFreshness}</Text>
      <Text style={styles.meta}>{eventsFreshness}</Text>
      <Text style={styles.meta}>{snapshotsFreshness}</Text>
      <Text style={styles.meta}>{idleSessionsFreshness}</Text>
      <Text style={styles.meta}>{checklistFreshness}</Text>
      <Text style={styles.meta}>{reportFreshness}</Text>
      <Text style={styles.meta}>Verification readiness: {verificationReadinessLevel}</Text>
      <Text style={styles.meta}>{verificationReadinessSummary}</Text>
      <View style={styles.stepCard}>
        <Text style={styles.stepTitle}>Step 1: Baseline</Text>
        <Text style={styles.meta}>Device: {manufacturer || '-'} {model || '-'}</Text>
        <Text style={styles.meta}>Battery optimization: {batteryOptimized ? 'Enabled' : 'Exempted'}</Text>
        <Text style={styles.meta}>Xiaomi-family profile: {isXiaomiFamily ? 'Yes' : 'No'}</Text>
        <Text style={styles.meta}>Autostart settings detected: {autostartSettingsAvailable ? 'Yes' : 'No'}</Text>
        <Text style={styles.meta}>Baseline snapshot: {baselineCaptured ? 'Captured' : 'Pending'}</Text>

        <Text style={styles.pathTitle}>Battery setup path</Text>
        <Text style={styles.pathText}>Settings → Apps → Manage apps → Tho'ra Player → Battery saver → No restrictions</Text>

        <Text style={styles.pathTitle}>Autostart setup path</Text>
        <Text style={styles.pathText}>Settings → Apps → Permissions → Autostart → Tho'ra Player (enable)</Text>

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton title="REFRESH STATUS" onPress={() => void onRefreshStatus()} />
          </View>
          <View style={styles.buttonWrap}>
            <AppButton title="OPEN BATTERY SETTINGS" onPress={() => void onOpenBatterySettings()} />
          </View>
          <View style={styles.buttonWrap}>
            <AppButton title="OPEN AUTOSTART" onPress={() => void onOpenAutostartSettings()} />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton title="LOG INTERRUPTION" onPress={() => void onRecordInterruption()} />
          </View>
          <View style={styles.buttonWrap}>
            <AppButton title="LOG RECOVERY" onPress={() => void onRecordRecovery()} />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton testID="reliability.captureBaseline" title="CAPTURE BASELINE" onPress={() => void onCaptureBaselineSnapshot()} />
          </View>
        </View>
      </View>

      <View style={styles.stepCard}>
        <Text style={styles.stepTitle}>Step 2: Post-Setup</Text>
        <Text style={styles.meta}>Post-setup snapshot: {postSetupCaptured ? 'Captured' : 'Pending'}</Text>
        <Text style={styles.meta}>Latest idle status: {latestIdleStatus}</Text>

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton testID="reliability.capturePostSetup" title="CAPTURE POST-SETUP" onPress={() => void onCapturePostSetupSnapshot()} />
          </View>
        </View>

        <Text style={styles.pathTitle}>Idle/Doze test runner</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={idleLabel}
            onChangeText={setIdleLabel}
            placeholder="Session label"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            value={idleMinutes}
            onChangeText={setIdleMinutes}
            keyboardType="number-pad"
            placeholder="Minutes"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton
              title="START IDLE TEST"
              onPress={() => void onStartIdleTestSession(idleLabel, Number(idleMinutes) || 30)}
              variant="primary"
            />
          </View>
        </View>
        {runningIdleSession ? (
          <View style={styles.row}>
            <View style={styles.buttonWrap}>
              <AppButton
                title="MARK PASS"
                onPress={() => void onCompleteIdleTestSession(runningIdleSession.sessionId, 'PASS', 'No interruption observed')}
              />
            </View>
            <View style={styles.buttonWrap}>
              <AppButton
                title="MARK FAIL"
                onPress={() => void onCompleteIdleTestSession(runningIdleSession.sessionId, 'FAIL', 'Interruption observed during idle')}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton
              title={showIdleSessionHistory ? 'HIDE IDLE SESSION HISTORY' : 'SHOW IDLE SESSION HISTORY'}
              onPress={() => setShowIdleSessionHistory(current => !current)}
            />
          </View>
        </View>
        {showIdleSessionHistory && (
          <FlatList
            scrollEnabled={false}
            style={styles.list}
            data={idleTestSessions}
            keyExtractor={item => item.sessionId}
            renderItem={({item}) => (
              <View style={styles.idleRow}>
                <Text style={styles.eventText} numberOfLines={1}>{formatIdleSession(item)}</Text>
                {item.status === 'RUNNING' && (
                  <View style={styles.row}>
                    <View style={styles.buttonWrap}>
                      <AppButton title="MARK PASS" onPress={() => void onCompleteIdleTestSession(item.sessionId, 'PASS', 'No interruption observed')} />
                    </View>
                    <View style={styles.buttonWrap}>
                      <AppButton title="MARK FAIL" onPress={() => void onCompleteIdleTestSession(item.sessionId, 'FAIL', 'Interruption observed during idle')} />
                    </View>
                  </View>
                )}
              </View>
            )}
          />
        )}

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton
              title={showChecklist ? 'HIDE RETEST CHECKLIST' : 'SHOW RETEST CHECKLIST'}
              onPress={() => setShowChecklist(current => !current)}
            />
          </View>
        </View>
        {showChecklist && (
          <>
            <FlatList
              scrollEnabled={false}
              style={styles.list}
              data={checklistItems}
              keyExtractor={item => item.key}
              renderItem={({item}) => (
                <View style={styles.idleRow}>
                  <Text style={styles.eventText}>{checklistTitle(item.key)}: {item.passed ? 'PASS' : 'PENDING'}</Text>
                  <TextInput
                    style={styles.input}
                    value={checklistNotes[item.key] ?? ''}
                    onChangeText={text => setChecklistNotes(prev => ({...prev, [item.key]: text}))}
                    placeholder="Notes"
                    placeholderTextColor={colors.textMuted}
                  />
                  <View style={styles.row}>
                    <View style={styles.buttonWrap}>
                      <AppButton title="MARK PASS" onPress={() => void onSetChecklistItem(item.key, true, checklistNotes[item.key] ?? '')} />
                    </View>
                    <View style={styles.buttonWrap}>
                      <AppButton title="MARK FAIL" onPress={() => void onSetChecklistItem(item.key, false, checklistNotes[item.key] ?? '')} />
                    </View>
                  </View>
                </View>
              )}
            />
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                value={retestSummaryNotes}
                onChangeText={setRetestSummaryNotes}
                placeholder="Retest run notes"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.row}>
              <View style={styles.buttonWrap}>
                <AppButton
                  title="RECORD RETEST SUMMARY"
                  onPress={() => void onRecordRetestRunSummary(retestSummaryNotes)}
                />
              </View>
            </View>
          </>
        )}
      </View>

      <View style={styles.stepCard}>
        <Text style={styles.stepTitle}>Step 3: Delta</Text>
        <Text style={styles.meta}>Compare baseline and post-setup before generating final report.</Text>
        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton testID="reliability.evaluateSetupDelta" title="EVALUATE SETUP DELTA" onPress={() => void onEvaluateSetupDelta()} />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton
              title={showSnapshots ? 'HIDE SNAPSHOTS' : 'SHOW SNAPSHOTS'}
              onPress={() => setShowSnapshots(current => !current)}
            />
          </View>
        </View>
        {showSnapshots && (
          <FlatList
            scrollEnabled={false}
            style={styles.list}
            data={snapshots}
            keyExtractor={(item, index) => `${item.timestampSec}-${item.label}-${index}`}
            renderItem={({item}) => (
              <Text style={styles.eventText} numberOfLines={1}>{formatSnapshot(item)}</Text>
            )}
          />
        )}
      </View>

      <View style={styles.stepCard}>
        <Text style={styles.stepTitle}>Step 4: Report</Text>
        <Text style={styles.meta}>Generate and share final reliability evidence package.</Text>
        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton testID="reliability.generateReport" title="GENERATE REPORT" onPress={() => void onGenerateValidationReport()} variant="primary" />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton title="SHARE REPORT" onPress={() => void onShareValidationReport()} />
          </View>
          <View style={styles.buttonWrap}>
            <AppButton title="SHARE BUNDLE" onPress={() => void onShareValidationBundle()} />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton
              title={showReportPreview ? 'HIDE REPORT PREVIEW' : 'SHOW REPORT PREVIEW'}
              onPress={() => setShowReportPreview(current => !current)}
            />
          </View>
        </View>
        {showReportPreview && (
          <>
            <Text style={styles.pathTitle}>Validation report preview</Text>
            <Text style={styles.pathText} numberOfLines={8}>{validationReportText || 'No report generated yet.'}</Text>
          </>
        )}

        <View style={styles.row}>
          <View style={styles.buttonWrap}>
            <AppButton
              title={showEvents ? 'HIDE EVENT LOG' : 'SHOW EVENT LOG'}
              onPress={() => setShowEvents(current => !current)}
            />
          </View>
        </View>
        {showEvents && (
          <FlatList
            scrollEnabled={false}
            style={styles.list}
            data={events}
            keyExtractor={(item, index) => `${item.timestampSec}-${item.eventCode}-${index}`}
            renderItem={({item}) => (
              <Text style={styles.eventText} numberOfLines={1}>{formatEvent(item)}</Text>
            )}
          />
        )}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      width: '100%',
      marginTop: 8,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.lg,
      backgroundColor: colors.backgroundCard,
      padding: spacing.md,
    },
    stepCard: {
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.md,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
    },
    stepTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    title: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    meta: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    pathTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    pathText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    row: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    buttonWrap: {
      flex: 1,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.textPrimary,
    },
    list: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
    },
    idleRow: {
      marginBottom: 6,
      gap: 4,
    },
    eventText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 4,
    },
  });
}
