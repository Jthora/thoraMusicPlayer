import {useEffect, useRef, useState} from 'react';

import {
  FolderQueueResult,
  MediaStoreTrack,
  PLAYBACK_EVENTS,
  PlaybackSnapshot,
  ScanDiagnostic,
  mediaLibrary,
  playbackControl,
} from '../../native/modules';
import {kvStore} from '../../platform/storage/kvStore';
import {logDiagnostic} from '../../platform/diagnostics';
import {useStableCallback} from '../../platform/hooks/useStableCallback';
import {getPlaybackEmitter} from '../playback/playbackEvents';

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

/** Pre-Media3 JS-persisted queue. Read once to migrate into the native queue, then removed. */
const LEGACY_QUEUE_STORAGE_KEY = 'android_music_player.queue_state.v1';

function readLegacyQueue(): {queue: MediaStoreTrack[]; activeIndex: number} | null {
  try {
    const raw = kvStore.getItem(LEGACY_QUEUE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {queue?: unknown; activeIndex?: unknown};
    const queue = Array.isArray(parsed.queue) ? (parsed.queue as MediaStoreTrack[]) : [];
    if (queue.length === 0) {
      return null;
    }
    const activeIndex = Math.max(0, Math.min(Number(parsed.activeIndex ?? 0) || 0, queue.length - 1));
    return {queue, activeIndex};
  } catch {
    return null;
  }
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Mirror of the native queue. The native player (Media3) owns and persists the queue; every edit
 * here is sent to native (with an optimistic local update) and the mirror refreshes from
 * ThoraQueueChanged / ThoraPlaybackState events.
 */
/** Queues longer than this start with a window around the tapped track; the rest follows. */
export const PROGRESSIVE_QUEUE_THRESHOLD = 120;
export const PROGRESSIVE_QUEUE_HEAD = 40;

/** How long a background queue fill waits for audio to start before going ahead anyway. */
export const FILL_WAITS_FOR_PLAYBACK_MS = 1500;

/**
 * Resolves once the player reports it is playing (or after the timeout). Created *before* the
 * queue is sent, so the event can't be missed. Filling a long queue while the first track is
 * still starting delayed the start by ~0.5 s on the A3.
 */
function waitForPlaybackStart(timeoutMs: number): Promise<void> {
  const emitter = getPlaybackEmitter();
  if (!emitter) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      subscription.remove();
      clearTimeout(timer);
      resolve();
    };
    const subscription = emitter.addListener(PLAYBACK_EVENTS.state, (snapshot: PlaybackSnapshot) => {
      if (snapshot?.isPlaying) {
        finish();
      }
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

export function useFolderQueue() {
  const [status, setStatus] = useState('Idle');
  const [queueState, setQueueState] = useState<QueueState>(initialQueueState);
  // Bumped by every new queue, so a background fill of an older queue stops instead of
  // appending its tracks to the new one.
  const queueGenerationRef = useRef(0);

  const refreshQueue = useStableCallback(async () => {
    if (!playbackControl) {
      return;
    }
    try {
      const [queue, snapshot] = await Promise.all([playbackControl.getQueue(), playbackControl.getPlaybackState()]);
      setQueueState(current => ({
        ...current,
        queue,
        activeIndex: snapshot.queueIndex >= 0 ? snapshot.queueIndex : 0,
        revision: Date.now(),
      }));
    } catch {
      setStatus('Failed to read the playback queue');
    }
  });

  useEffect(() => {
    if (!playbackControl) {
      return;
    }
    const playback = playbackControl;
    void (async () => {
      try {
        const nativeQueue = await playback.getQueue();
        const legacy = readLegacyQueue();
        if (nativeQueue.length === 0 && legacy) {
          await playback.setQueue(legacy.queue, legacy.activeIndex, 0, false);
          setStatus(`Restored queue: ${legacy.queue.length} track(s)`);
        }
        kvStore.removeItem(LEGACY_QUEUE_STORAGE_KEY);
      } catch {
      }
      await refreshQueue();
    })();
  }, [refreshQueue]);

  useEffect(() => {
    const emitter = getPlaybackEmitter();
    if (!emitter) {
      return;
    }
    const queueSubscription = emitter.addListener(PLAYBACK_EVENTS.queue, () => {
      void refreshQueue();
    });
    const stateSubscription = emitter.addListener(PLAYBACK_EVENTS.state, (snapshot: PlaybackSnapshot) => {
      setQueueState(current =>
        snapshot.queueIndex < 0 || snapshot.queueIndex === current.activeIndex
          ? current
          : {...current, activeIndex: snapshot.queueIndex},
      );
    });
    return () => {
      queueSubscription.remove();
      stateSubscription.remove();
    };
  }, [refreshQueue]);

  const generateQueue = useStableCallback(async (folderPath: string, sortMode: string, anchorUri: string | null) => {
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
      await playbackControl?.setQueue(result.queue, result.anchorIndex, 0, false);

      const skipSummary = result.skippedCount > 0
        ? ` • skipped ${result.skippedCount} (${result.unreadableCount} unreadable)`
        : '';
      setStatus(`Queue ready: ${result.queueLength} track(s) from ${result.folderPath}${skipSummary}`);
    } catch {
      setStatus('Folder queue generation failed');
    }
  });

  const startFromQueue = useStableCallback(async () => {
    if (!playbackControl) {
      setStatus('Playback control unavailable');
      return;
    }

    if (queueState.queue.length === 0) {
      setStatus('No queue loaded');
      return;
    }

    try {
      await playbackControl.play();
      const track = queueState.queue[queueState.activeIndex];
      setStatus(`Playback started from queue: ${track?.title ?? 'Unknown track'}`);
    } catch {
      setStatus('Failed to start playback from queue');
    }
  });

  /** Tapping a queue row plays it. */
  const setAnchorByIndex = useStableCallback((index: number) => {
    if (index < 0 || index >= queueState.queue.length) {
      return;
    }
    setQueueState(current => (current.activeIndex === index ? current : {...current, activeIndex: index}));
    void playbackControl?.skipTo(index).catch(() => {
      setStatus('Failed to play that track');
    });
  });

  const reorderQueue = useStableCallback((fromIndex: number, toIndex: number) => {
    const length = queueState.queue.length;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= length || toIndex >= length || fromIndex === toIndex) {
      return;
    }

    setQueueState(current => {
      let nextActiveIndex = current.activeIndex;
      if (current.activeIndex === fromIndex) {
        nextActiveIndex = toIndex;
      } else if (fromIndex < current.activeIndex && toIndex >= current.activeIndex) {
        nextActiveIndex -= 1;
      } else if (fromIndex > current.activeIndex && toIndex <= current.activeIndex) {
        nextActiveIndex += 1;
      }
      return {...current, queue: moveItem(current.queue, fromIndex, toIndex), activeIndex: nextActiveIndex, revision: Date.now()};
    });
    void playbackControl?.moveQueueItem(fromIndex, toIndex).catch(() => {
      void refreshQueue();
    });
  });

  const removeFromQueue = useStableCallback((index: number) => {
    if (index < 0 || index >= queueState.queue.length) {
      return;
    }

    setQueueState(current => {
      const nextQueue = current.queue.filter((_, queueIndex) => queueIndex !== index);
      let nextActiveIndex = current.activeIndex;
      if (nextQueue.length === 0) {
        nextActiveIndex = 0;
      } else if (index < current.activeIndex) {
        nextActiveIndex -= 1;
      } else if (index === current.activeIndex) {
        nextActiveIndex = Math.min(current.activeIndex, nextQueue.length - 1);
      }
      return {...current, queue: nextQueue, activeIndex: nextActiveIndex, revision: Date.now()};
    });
    void playbackControl?.removeQueueItem(index).catch(() => {
      void refreshQueue();
    });
  });

  const fillQueueBehindPlayback = useStableCallback(async (
    generation: number,
    after: MediaStoreTrack[],
    before: MediaStoreTrack[],
    playbackStarted: Promise<void>,
  ) => {
    if (!playbackControl) {
      return;
    }
    await playbackStarted;
    const startedAt = Date.now();
    try {
      if (after.length > 0 && queueGenerationRef.current === generation) {
        await playbackControl.insertQueueItems(-1, after); // append
      }
      if (before.length > 0 && queueGenerationRef.current === generation) {
        await playbackControl.insertQueueItems(0, before); // current track keeps playing; its index shifts
      }
      if (queueGenerationRef.current === generation) {
        logDiagnostic('info', 'queue', 'fill_queue', {
          ms: String(Date.now() - startedAt),
          tracks: String(after.length + before.length),
        });
      }
    } catch (error) {
      setStatus('Only part of the queue could be loaded');
      logDiagnostic('warn', 'queue', 'fill_queue_failed', {error: String(error)});
    }
  });

  const loadQueueAndStart = useStableCallback(async (
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

    const generation = ++queueGenerationRef.current;
    try {
      // Hand-off cost (bridge + controller IPC) is part of what a tap feels like; the player logs
      // the rest as start_latency. A long queue (a 1,300-song playlist took ~1.1 s from tap to
      // sound) starts with a window from the tapped track, then fills in behind the music.
      const handoffStartedAt = Date.now();
      const progressive = queue.length > PROGRESSIVE_QUEUE_THRESHOLD;
      const head = progressive ? queue.slice(boundedIndex, boundedIndex + PROGRESSIVE_QUEUE_HEAD) : queue;
      const playbackStarted = progressive ? waitForPlaybackStart(FILL_WAITS_FOR_PLAYBACK_MS) : Promise.resolve();
      await playbackControl.setQueue(head, progressive ? 0 : boundedIndex, 0, true);
      logDiagnostic('info', 'queue', 'set_queue', {
        ms: String(Date.now() - handoffStartedAt),
        tracks: String(head.length),
        of: String(queue.length),
      });
      if (progressive) {
        void fillQueueBehindPlayback(
          generation,
          queue.slice(boundedIndex + head.length),
          queue.slice(0, boundedIndex),
          playbackStarted,
        );
      }
      const track = queue[boundedIndex];
      setStatus(`Playback started from ${sourceLabel}: ${track?.title ?? 'Unknown track'}`);
    } catch {
      setStatus(`Failed to start playback from ${sourceLabel}`);
    }
  });

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
