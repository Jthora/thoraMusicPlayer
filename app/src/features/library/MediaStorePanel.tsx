import {Button, FlatList, StyleSheet, Text, View} from 'react-native';

import {MediaStoreTrack} from '../../native/modules';

type MediaStorePanelProps = {
  scanStatus: string;
  tracks: MediaStoreTrack[];
  onScan: () => void;
  onLoadMore: () => void;
  hasMore: boolean;
};

export function MediaStorePanel({scanStatus, tracks, onScan, onLoadMore, hasMore}: MediaStorePanelProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>MediaStore Scan: {scanStatus}</Text>
      <View style={styles.buttonWrap}>
        <Button title="Scan MediaStore (Top 50)" onPress={onScan} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Load More MediaStore" onPress={onLoadMore} disabled={!hasMore} />
      </View>
      <FlatList
        scrollEnabled={false}
        style={styles.trackList}
        data={tracks}
        keyExtractor={item => item.uri}
        renderItem={({item}) => (
          <View style={styles.trackRow}>
            <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.meta} numberOfLines={1}>{item.artist} • {item.album}</Text>
            <Text style={styles.meta} numberOfLines={1}>{item.displayName || item.relativePath}</Text>
          </View>
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
  trackList: {
    width: '100%',
  },
  trackRow: {
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
  },
});
