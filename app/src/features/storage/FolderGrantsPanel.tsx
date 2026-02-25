import {Button, FlatList, StyleSheet, Text, View} from 'react-native';

import {FolderGrant} from '../../native/modules';

type FolderGrantsPanelProps = {
  folderGrantStatus: string;
  folderGrants: FolderGrant[];
  onPickFolderRoot: () => void;
  onRefreshFolderGrants: () => void;
  onCleanupRevokedGrants: () => void;
  onRemoveGrant: (uri: string) => void;
};

export function FolderGrantsPanel(props: FolderGrantsPanelProps) {
  const {
    folderGrantStatus,
    folderGrants,
    onPickFolderRoot,
    onRefreshFolderGrants,
    onCleanupRevokedGrants,
    onRemoveGrant,
  } = props;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Folder Access: {folderGrantStatus}</Text>
      <View style={styles.buttonWrap}>
        <Button title="Pick Folder Root (SAF)" onPress={onPickFolderRoot} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Refresh Folder Grants" onPress={onRefreshFolderGrants} />
      </View>
      <View style={styles.buttonWrap}>
        <Button title="Cleanup Revoked Grants" onPress={onCleanupRevokedGrants} />
      </View>
      <FlatList
        scrollEnabled={false}
        style={styles.grantsList}
        data={folderGrants}
        keyExtractor={item => item.uri}
        renderItem={({item}) => (
          <View style={styles.grantRow}>
            <Text style={styles.grantText} numberOfLines={1}>
              {item.granted ? '✅' : '⚠️'} {item.uri}
            </Text>
            <Button title="Remove" onPress={() => onRemoveGrant(item.uri)} />
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
  grantsList: {
    width: '100%',
  },
  grantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  grantText: {
    flex: 1,
    fontSize: 12,
  },
});
