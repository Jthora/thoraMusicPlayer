import {useState} from 'react';

import {mediaLibrary, MediaStoreTrack, ScanDiagnostic} from '../../native/modules';
import {useStableCallback} from '../../platform/hooks/useStableCallback';

export function useSafRootScan() {
  const [scanStatus, setScanStatus] = useState('Idle');
  const [tracks, setTracks] = useState<MediaStoreTrack[]>([]);
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostic[]>([]);

  const scanSafRoots = useStableCallback(async (limitPerRoot = 100) => {
    if (!mediaLibrary) {
      setScanStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      setScanStatus('Scanning SAF roots...');
      const result = await mediaLibrary.indexSafRoots(limitPerRoot);
      setTracks(result.tracks);
      setDiagnostics(result.diagnostics);
      const summary = result.indexSummary;
      setScanStatus(
        summary
          ? `SAF indexed ${summary.inserted + summary.updated}/${summary.scanned} across ${result.rootCount} root(s)`
          : `SAF scan complete: ${result.trackCount} track(s) across ${result.rootCount} root(s)`,
      );
    } catch {
      setScanStatus('SAF scan failed');
    }
  });

  return {
    scanStatus,
    tracks,
    diagnostics,
    scanSafRoots,
  };
}
