import {useEffect, useState} from 'react';
import {PermissionsAndroid, Platform} from 'react-native';
import {useStableCallback} from '../../platform/hooks/useStableCallback';

export function useAudioPermission() {
  const [permissionStatus, setPermissionStatus] = useState('Checking...');

  const refreshAudioPermissionStatus = useStableCallback(async () => {
    if (Platform.OS !== 'android') {
      const status = 'Not required on this platform';
      setPermissionStatus(status);
      return status;
    }

    const isGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
    );
    const status = isGranted ? 'Granted' : 'Not granted';
    setPermissionStatus(status);
    return status;
  });

  useEffect(() => {
    void refreshAudioPermissionStatus();
  }, [refreshAudioPermissionStatus]);

  const requestAudioPermission = useStableCallback(async () => {
    if (Platform.OS !== 'android') {
      const status = 'Not required on this platform';
      setPermissionStatus(status);
      return status;
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
    );
    const status = result === PermissionsAndroid.RESULTS.GRANTED ? 'Granted' : 'Denied';
    setPermissionStatus(status);
    return status;
  });

  return {
    permissionStatus,
    requestAudioPermission,
    refreshAudioPermissionStatus,
  };
}
