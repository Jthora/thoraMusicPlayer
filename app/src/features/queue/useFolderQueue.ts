import {useEffect, useState} from 'react';

import {FolderQueueResult, ScanDiagnostic, mediaLibrary, playbackControl} from '../../native/modules';
import {kvStore} from '../../platform/storage/kvStore';

type QueueState = {
  queue: FolderQueueResult['queue'];
  activeIndex: number;
  revision: number;
  folderPath: string;
  sortMode: string;
  skippedDiagnostics: ScanDiagnostic[];
  skippedCount: number;
  unreadableCount: number;
};

const initialQueueState: QueueState = {
  queue: [],
  activeIndex: 0,
  revision: 0,
  folderPath: '',
  sortMode: 'name',
  skippedDiagnostics: [],
  skippedCount: 0,
  unreadableCount: 0,
};

const QUEUE_STATE_STORAGE_KEY = 'android_music_player.queue_state.v1';

type PersistedQueueState = {
  queue: FolderQueueResult['queue'];
  activeIndex: number;
  revision: number;
  folderPath: string;
  sortMode: string;
  skippedDiagnostics: ScanDiagnostic[];
  skippedCount: number;
  unreadableCount: number;
};

export function useFolderQueue() {
  const [status, setStatus] = useState('Idle');
  const [queueState, setQueueState] = useState<QueueState>(initialQueueState);
  const [queueStateHydrated, setQueueStateHydrated] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const raw = kvStore.getItem(QUEUE_STATE_STORAGE_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as Partial<PersistedQueueState>;
        const restoredQueue = Array.isArray(parsed.queue) ? parsed.queue : [];
        const restoredActiveIndex = Math.max(0, Math.min(Number(parsed.activeIndex ?? 0), Math.max(0, restoredQueue.length - 1)));

        setQueueState({
          queue: restoredQueue,
          activeIndex: restoredActiveIndex,
          revision: Number(parsed.revision ?? Date.now()),
          folderPath: typeof parsed.folderPath === 'string' ? parsed.folderPath : '',
          sortMode: typeof parsed.sortMode === 'string' ? parsed.sortMode : 'name',
          skippedDiagnostics: Array.isArray(parsed.skippedDiagnostics) ? parsed.skippedDiagnostics : [],
          skippedCount: Number(parsed.skippedCount ?? 0),
          unreadableCount: Number(parsed.unreadableCount ?? 0),
        });

        if (restoredQueue.length > 0) {
          setStatus(`Restored queue: ${restoredQueue.length} track(s)`);
        }
      } catch {
      } finally {
        setQueueStateHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!queueStateHydrated) {
      return;
    }

    const persist = async () => {
      try {
        const payload: PersistedQueueState = {
          queue: queueState.queue,
          activeIndex: queueState.activeIndex,
          revision: queueState.revision,
          folderPath: queueState.folderPath,
          sortMode: queueState.sortMode,
          skippedDiagnostics: queueState.skippedDiagnostics,
          skippedCount: queueState.skippedCount,
          unreadableCount: queueState.unreadableCount,
        };

        kvStore.setItem(QUEUE_STATE_STORAGE_KEY, JSON.stringify(payload));
      } catch {
      }
    };

    void persist();
  }, [queueState, queueStateHydrated]);

  const generateQueue = async (folderPath: string, sortMode: string, anchorUri: string | null) => {
    if (!mediaLibrary) {
      setStatus('MediaLibrary module unavailable');
      return;
    }

    const trimmedFolder = folderPath.trim();
    if (!trimmedFolder) {
      setStatus('Folder path is required');
      return;
    }

    try {
      setStatus('Generating folder queue...');
      const result = await mediaLibrary.generateFolderQueue(trimmedFolder, anchorUri, sortMode, 500);

      setQueueState({
        queue: result.queue,
        activeIndex: result.anchorIndex,
        revision: result.queueRevision,
        folderPath: result.folderPath,
        sortMode: result.sortMode,
        skippedDiagnostics: result.skippedDiagnostics,
        skippedCount: result.skippedCount,
        unreadableCount: result.unreadableCount,
      });

      const skipSummary = result.skippedCount > 0
        ? ` • skipped ${result.skippedCount} (${result.unreadableCount} unreadable)`
        : '';
      setStatus(`Queue ready: ${result.queueLength} track(s) from ${result.folderPath}${skipSummary}`);
    } catch {
      setStatus('Folder queue generation failed');
    }
  };

  const startFromQueue = async () => {
    if (!playbackControl) {
      setStatus('Playback control unavailable');
      return;
    }

    if (queueState.queue.length === 0) {
      setStatus('No queue loaded');
      return;
    }

    try {
      await playbackControl.startPlaybackService();
      const track = queueState.queue[queueState.activeIndex];
      setStatus(`Playback started from queue anchor: ${track?.title ?? 'Unknown track'}`);
    } catch {
      setStatus('Failed to start playback from queue');
    }
  };

  const setAnchorByIndex = (index: number) => {
    if (index < 0 || index >= queueState.queue.length) {
      return;
    }

    setQueueState(current => ({
      ...current,
      activeIndex: index,
      revision: Date.now(),
    }));
  };

  const reorderQueue = (fromIndex: number, toIndex: number) => {
    setQueueState(current => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.queue.length ||
        toIndex >= current.queue.length ||
        fromIndex === toIndex
      ) {
        return current;
      }

      const nextQueue = [...current.queue];
      const [moved] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, moved);

      let nextActiveIndex = current.activeIndex;
      if (current.activeIndex === fromIndex) {
        nextActiveIndex = toIndex;
      } else if (fromIndex < current.activeIndex && toIndex >= current.activeIndex) {
        nextActiveIndex -= 1;
      } else if (fromIndex > current.activeIndex && toIndex <= current.activeIndex) {
        nextActiveIndex += 1;
      }

      return {
        ...current,
        queue: nextQueue,
        activeIndex: nextActiveIndex,
        revision: Date.now(),
      };
    });
  };

  const removeFromQueue = (index: number) => {
    setQueueState(current => {
      if (index < 0 || index >= current.queue.length) {
        return current;
      }

      const nextQueue = current.queue.filter((_, queueIndex) => queueIndex !== index);
      let nextActiveIndex = current.activeIndex;

      if (nextQueue.length === 0) {
        nextActiveIndex = 0;
      } else if (index < current.activeIndex) {
        nextActiveIndex -= 1;
      } else if (index === current.activeIndex) {
        nextActiveIndex = Math.min(current.activeIndex, nextQueue.length - 1);
      }

      return {
        ...current,
        queue: nextQueue,
        activeIndex: nextActiveIndex,
        revision: Date.now(),
      };
    });
  };

  const loadQueueAndStart = async (
    queue: FolderQueueResult['queue'],
    activeIndex: number,
    sourceLabel: string,
  ) => {
    if (queue.length === 0) {
      setStatus('No queue loaded');
      return;
    }

    const boundedIndex = Math.max(0, Math.min(activeIndex, queue.length - 1));

    setQueueState(current => ({
      ...current,
      queue,
      activeIndex: boundedIndex,
      revision: Date.now(),
      folderPath: sourceLabel,
      sortMode: 'manual',
      skippedDiagnostics: [],
      skippedCount: 0,
      unreadableCount: 0,
    }));

    if (!playbackControl) {
      setStatus(`Queue ready from ${sourceLabel}: ${queue.length} track(s)`);
      return;
    }

    try {
      if (typeof playbackControl.setQueueTracks === 'function') {
        await playbackControl.setQueueTracks(
          queue.map(item => ({
            uri: item.uri,
            title: item.title,
            artist: item.artist,
            album: item.album,
            displayName: item.displayName,
            durationMs: item.durationMs,
          })),
        );
      }
      await playbackControl.setQueueState(queue.length, boundedIndex);
      await playbackControl.startPlaybackService();
      await playbackControl.play();
      const track = queue[boundedIndex];
      setStatus(`Playback started from ${sourceLabel}: ${track?.title ?? 'Unknown track'}`);
    } catch {
      setStatus(`Failed to start playback from ${sourceLabel}`);
    }
  };

  return {
    status,
    queueState,
    generateQueue,
    startFromQueue,
    loadQueueAndStart,
    setAnchorByIndex,
    reorderQueue,
    removeFromQueue,
  };
}
