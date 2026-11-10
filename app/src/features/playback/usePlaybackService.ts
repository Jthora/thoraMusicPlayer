import {useState} from 'react';

import {playbackControl} from '../../native/modules';
import {useStableCallback} from '../../platform/hooks/useStableCallback';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unknown error';
}

export function usePlaybackService() {
  const [serviceStatus, setServiceStatus] = useState('Idle');

  const startService = useStableCallback(async () => {
    if (!playbackControl) {
      setServiceStatus('Unavailable');
      return;
    }

    try {
      await playbackControl.startPlaybackService();
      setServiceStatus('Running');
    } catch (error) {
      setServiceStatus(`Start failed (${getErrorMessage(error)})`);
    }
  });

  const stopService = useStableCallback(async () => {
    if (!playbackControl) {
      setServiceStatus('Unavailable');
      return;
    }

    try {
      const stopped = await playbackControl.stopPlaybackService();
      setServiceStatus(stopped ? 'Stopped' : 'Not running');
    } catch (error) {
      setServiceStatus(`Stop failed (${getErrorMessage(error)})`);
    }
  });

  return {
    serviceStatus,
    startService,
    stopService,
  };
}
