import {useState} from 'react';
import {Button, FlatList, StyleSheet, Text, TextInput, View} from 'react-native';

import {MediaStoreTrack, ScanDiagnostic, SyncStatus} from '../../native/modules';
import {useIndexedLibrary} from './useIndexedLibrary';

type IndexedLibraryPanelProps = {
  onRefreshStats: () => Promise<void>;
  onSearch: (query: string) => Promise<void>;
  status: string;
  stats: {
    totalTracks: number;
    distinctRoots: number;
    snapshotCount: number;
  };
  results: MediaStoreTrack[];
  latestSync: SyncStatus | null;
  diagnostics: ScanDiagnostic[];
  onRefreshLatestSync: () => Promise<void>;
  onRunIncrementalMediaSync: () => Promise<void>;
  onRunIncrementalSafSync: () => Promise<void>;
};

export function IndexedLibraryPanel(props: IndexedLibraryPanelProps) {
  const {
    onRefreshStats,
    onSearch,
    status,
    stats,
    results,
    latestSync,
    diagnostics,
    onRefreshLatestSync,
    onRunIncrementalMediaSync,
    onRunIncrementalSafSync,
  } = props;
  const [query, setQuery] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Indexed Library: {status}</Text>
      <Text style={styles.meta}>Tracks: {stats.totalTracks} • Roots: {stats.distinctRoots} • Snapshots: {stats.snapshotCount}</Text>
      <View style={styles.buttonWrap}>
        <Button title="Refresh Index Stats" onPress={() => { void onRefreshStats(); }} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Run Incremental MediaStore Sync" onPress={() => { void onRunIncrementalMediaSync(); }} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Run Incremental SAF Sync" onPress={() => { void onRunIncrementalSafSync(); }} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Refresh Latest Sync Status" onPress={() => { void onRefreshLatestSync(); }} />
      </View>
      <Text style={styles.meta}>
        Latest Sync: {latestSync ? `#${latestSync.snapshotId} ${latestSync.sourceType} +${latestSync.insertedCount}/~${latestSync.updatedCount}/-${latestSync.removedCount}` : 'n/a'}
      </Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search indexed tracks"
      />
      <View style={styles.buttonWrap}>
        <Button title="Search Indexed Library" onPress={() => { void onSearch(query); }} />
      </View>
      <FlatList
        scrollEnabled={false}
        style={styles.list}
        data={results}
        keyExtractor={item => item.uri}
        renderItem={({item}) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.itemMeta} numberOfLines={1}>{item.artist} • {item.album}</Text>
          </View>
        )}
      />
      <FlatList
        scrollEnabled={false}
        style={styles.diagnosticsList}
        data={diagnostics}
        keyExtractor={(item, index) => `${item.code}-${index}`}
        renderItem={({item}) => (
          <Text style={styles.diagItem} numberOfLines={2}>
            {(item.level ?? 'INFO').toUpperCase()}: {item.code} — {item.message}
          </Text>
        )}
      />
    </View>
  );
}

export function useIndexedLibraryPanelState() {
  return useIndexedLibrary();
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 8,
    gap: 8,
  },
  label: {
    fontSize: 14,
  },
  meta: {
    fontSize: 12,
  },
  buttonWrap: {
    width: '100%',
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    width: '100%',
    fontSize: 13,
  },
  list: {
    width: '100%',
  },
  diagnosticsList: {
    width: '100%',
  },
  diagItem: {
    fontSize: 11,
    marginBottom: 6,
  },
  itemRow: {
    marginBottom: 8,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  itemMeta: {
    fontSize: 12,
  },
});
