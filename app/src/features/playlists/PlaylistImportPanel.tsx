import {useMemo} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';

import {PlaylistEntryDiagnostic, PlaylistImportResult} from '../../native/modules';
import {AppButton} from '../../ui/components/AppButton';
import {SectionCard} from '../../ui/components/SectionCard';
import {StatusChip} from '../../ui/components/StatusChip';
import {radii, spacing} from '../../ui/theme';
import {ThemeColors, useTheme} from '../../ui/themeRuntime';

type PlaylistImportPanelProps = {
  status: string;
  latestImport: PlaylistImportResult;
  onImport: () => Promise<void>;
  onRefreshLatest: () => Promise<void>;
  onRetryLatest: () => Promise<void>;
};

function formatDiagnostic(item: PlaylistEntryDiagnostic): string {
  const line = item.lineNumber > 0 ? `L${item.lineNumber}` : 'L?';
  return `${line} ${item.reasonCode}: ${item.entryText}`;
}

export function PlaylistImportPanel(props: PlaylistImportPanelProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {status, latestImport, onImport, onRefreshLatest, onRetryLatest} = props;
  const statusTone = status.toLowerCase().includes('error')
    ? 'danger'
    : status.toLowerCase().includes('running')
      ? 'warning'
      : 'neutral';

  return (
    <SectionCard title="Import Playlists" subtitle="Pick one or more .m3u, .m3u8, .pls or .xspf files. Each becomes a playlist; songs not in the library are listed below.">
      <StatusChip label={`IMPORT: ${status}`} tone={statusTone} />
      <View style={styles.row}>
        <View style={styles.buttonWrap}>
          <AppButton title="IMPORT PLAYLISTS" onPress={() => void onImport()} variant="primary" />
        </View>
        <View style={styles.buttonWrap}>
          <AppButton title="REFRESH" onPress={() => void onRefreshLatest()} />
        </View>
        <View style={styles.buttonWrap}>
          <AppButton
            title="RETRY RESOLVE"
            onPress={() => void onRetryLatest()}
            disabled={!latestImport.sourceUri}
          />
        </View>
      </View>
      <Text style={styles.meta}>
        Last: {latestImport.sourceName || '-'}
        {latestImport.playlistName ? ` → playlist "${latestImport.playlistName}"` : ''}
      </Text>
      <Text style={styles.meta}>
        Entries: {latestImport.totalEntries} • Resolved: {latestImport.resolvedCount} • Unresolved: {latestImport.unresolvedCount}
      </Text>
      <Text style={styles.meta}>
        Duplicate: {latestImport.duplicateCount} • Unsupported: {latestImport.unsupportedCount}
      </Text>
      <FlatList
        scrollEnabled={false}
        style={styles.list}
        data={latestImport.diagnostics.filter(item => item.status !== 'duplicate').slice(0, 10)}
        keyExtractor={(item, index) => `${item.lineNumber}-${item.reasonCode}-${index}`}
        renderItem={({item}) => (
          <Text style={styles.diagnostic} numberOfLines={1}>{formatDiagnostic(item)}</Text>
        )}
      />
    </SectionCard>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    buttonWrap: {
      flex: 1,
    },
    meta: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    list: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      padding: spacing.sm,
    },
    diagnostic: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 4,
    },
  });
}
