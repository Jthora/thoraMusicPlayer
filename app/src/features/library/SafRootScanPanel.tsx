import {Button, FlatList, StyleSheet, Text, View} from 'react-native';

import {MediaStoreTrack, ScanDiagnostic} from '../../native/modules';

type SafRootScanPanelProps = {
  scanStatus: string;
  tracks: MediaStoreTrack[];
  diagnostics: ScanDiagnostic[];
  onScan: () => void;
};

export function SafRootScanPanel({scanStatus, tracks, diagnostics, onScan}: SafRootScanPanelProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>SAF Root Scan: {scanStatus}</Text>
      <View style={styles.buttonWrap}>
        <Button title="Scan SAF Roots (100/root)" onPress={onScan} />
      </View>
      <Text style={styles.meta}>Tracks discovered: {tracks.length}</Text>
      <Text style={styles.meta}>Diagnostics: {diagnostics.length}</Text>
      <FlatList
        scrollEnabled={false}
        style={styles.diagnosticsList}
        data={diagnostics}
        keyExtractor={(item, index) => `${item.code}-${item.root}-${index}`}
        renderItem={({item}) => (
          <Text style={styles.diagnosticItem} numberOfLines={2}>
            {item.code}: {item.message}
          </Text>
        )}
      />
    </View>
  );
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
  buttonWrap: {
    width: '100%',
  },
  meta: {
    fontSize: 12,
  },
  diagnosticsList: {
    width: '100%',
  },
  diagnosticItem: {
    fontSize: 11,
    marginBottom: 6,
  },
});
