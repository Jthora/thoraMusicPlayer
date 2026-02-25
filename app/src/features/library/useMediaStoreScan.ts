import {useState} from 'react';

import {mediaLibrary, MediaStoreTrack} from '../../native/modules';

export function useMediaStoreScan() {
  const [scanStatus, setScanStatus] = useState('Idle');
  const [tracks, setTracks] = useState<MediaStoreTrack[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const scanMediaStore = async (limit = 50) => {
    if (!mediaLibrary) {
      setScanStatus('MediaLibrary module unavailable');
      return;
    }

    try {
      setScanStatus('Scanning...');
      const page = await mediaLibrary.indexMediaStorePage(limit, 0);
      setTracks(page.items);
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
      const summary = page.indexSummary;
      setScanStatus(
        summary
          ? `Indexed ${summary.inserted + summary.updated}/${summary.scanned} (${page.items.length}/${page.totalCount})`
          : `Scan complete: ${page.items.length}/${page.totalCount} track(s)`,
      );
    } catch {
      setScanStatus('Scan failed');
    }
  };

  const loadMoreMediaStore = async (limit = 50) => {
    if (!mediaLibrary || !hasMore) {
      return;
    }

    try {
      setScanStatus('Loading next page...');
      const page = await mediaLibrary.indexMediaStorePage(limit, nextOffset);
      setTracks(current => [...current, ...page.items]);
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
      const summary = page.indexSummary;
      setScanStatus(
        summary
          ? `Indexed page: +${summary.inserted + summary.updated}/${summary.scanned} (loaded ${page.nextOffset}/${page.totalCount})`
          : `Scan loaded: ${page.nextOffset}/${page.totalCount} track(s)`,
      );
    } catch {
      setScanStatus('Load more failed');
    }
  };

  return {
    scanStatus,
    tracks,
    hasMore,
    scanMediaStore,
    loadMoreMediaStore,
  };
}
