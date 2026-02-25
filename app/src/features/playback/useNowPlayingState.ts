import {useEffect, useMemo, useRef, useState} from 'react';

import {MediaStoreTrack, mediaLibrary, playbackControl} from '../../native/modules';

type UseNowPlayingStateInput = {
  queue: MediaStoreTrack[];
  activeIndex: number;
  onSetActiveIndex: (index: number) => void;
};

export type EndMode = 'stop' | 'repeat_all' | 'repeat_one';

export function normalizeEndMode(value: string | undefined): EndMode {
  if (value === 'repeat_all') {
    return 'repeat_all';
  }

  if (value === 'repeat_one') {
    return 'repeat_one';
  }

  return 'stop';
}

export function pickRandomNextIndex(currentIndex: number, queueLength: number): number {
  if (queueLength <= 1) {
    return 0;
  }

  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * queueLength);
  }

  return nextIndex;
}

export function resolveManualNextIndex(currentIndex: number, queueLength: number): number | null {
  if (currentIndex >= queueLength - 1) {
    return null;
  }

  return currentIndex + 1;
}

export function resolveManualPreviousIndex(currentIndex: number): number | null {
  if (currentIndex <= 0) {
    return null;
  }

  return currentIndex - 1;
}

const SEEK_STEP_MS = 10_000;

type EndOfTrackResolution = {
  nextPositionMs: number;
  nextIndex: number | null;
  shouldStopPlayback: boolean;
};

export function resolveEndOfTrackTransition(params: {
  endMode: EndMode;
  randomEnabled: boolean;
  queueLength: number;
  activeIndex: number;
  durationMs: number;
}): EndOfTrackResolution {
  const {endMode, randomEnabled, queueLength, activeIndex, durationMs} = params;

  if (endMode === 'repeat_one') {
    return {
      nextPositionMs: 0,
      nextIndex: null,
      shouldStopPlayback: false,
    };
  }

  if (randomEnabled && queueLength > 1) {
    return {
      nextPositionMs: 0,
      nextIndex: pickRandomNextIndex(activeIndex, queueLength),
      shouldStopPlayback: false,
    };
  }

  if (activeIndex < queueLength - 1) {
    return {
      nextPositionMs: 0,
      nextIndex: activeIndex + 1,
      shouldStopPlayback: false,
    };
  }

  if (endMode === 'repeat_all' && queueLength > 0) {
    return {
      nextPositionMs: 0,
      nextIndex: 0,
      shouldStopPlayback: false,
    };
  }

  return {
    nextPositionMs: durationMs,
    nextIndex: null,
    shouldStopPlayback: endMode === 'stop',
  };
}

export function useNowPlayingState(input: UseNowPlayingStateInput) {
  const {queue, activeIndex, onSetActiveIndex} = input;
  const [isPlaying, setIsPlaying] = useState(false);
  const [endMode, setEndMode] = useState<EndMode>('stop');
  const [randomEnabled, setRandomEnabled] = useState(false);
  const [modesHydrated, setModesHydrated] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const controlInFlightRef = useRef(false);
  const statePollInFlightRef = useRef(false);
  const positionMsRef = useRef(0);
  const suppressPositionReconcileUntilRef = useRef(0);

  const currentTrack = useMemo(() => queue[activeIndex], [queue, activeIndex]);
  const durationMs = Math.max(0, currentTrack?.durationMs ?? 0);

  useEffect(() => {
    setPositionMs(0);
    positionMsRef.current = 0;
    suppressPositionReconcileUntilRef.current = Date.now() + 1500;
  }, [activeIndex, currentTrack?.uri]);

  useEffect(() => {
    positionMsRef.current = positionMs;
  }, [positionMs]);

  useEffect(() => {
    if (!playbackControl) {
      setModesHydrated(true);
      return;
    }

    const playback = playbackControl;

    let cancelled = false;

    const restorePlaybackModes = async () => {
      try {
        const stored = await playback.getPlaybackModes();
        if (cancelled) {
          return;
        }

        setEndMode(normalizeEndMode(stored.endMode));
        setRandomEnabled(Boolean(stored.randomEnabled));
      } catch {
      } finally {
        if (!cancelled) {
          setModesHydrated(true);
        }
      }
    };

    void restorePlaybackModes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!playbackControl || !modesHydrated) {
      return;
    }

    const playback = playbackControl;

    void playback.setPlaybackModes(endMode, randomEnabled).catch(() => {
    });
  }, [endMode, modesHydrated, randomEnabled]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = setInterval(() => {
      setPositionMs(current => {
        const next = current + 1000;
        if (durationMs > 0 && next >= durationMs) {
          recordPlaybackEvent('PLAY_COMPLETED');

          const resolution = resolveEndOfTrackTransition({
            endMode,
            randomEnabled,
            queueLength: queue.length,
            activeIndex,
            durationMs,
          });

          if (resolution.nextIndex !== null) {
            onSetActiveIndex(resolution.nextIndex);
          }

          if (resolution.shouldStopPlayback) {
            setIsPlaying(false);
          }

          positionMsRef.current = resolution.nextPositionMs;
          return resolution.nextPositionMs;
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isPlaying, durationMs, activeIndex, endMode, queue.length, randomEnabled, onSetActiveIndex]);

  useEffect(() => {
    if (!playbackControl || queue.length === 0) {
      return;
    }

    const playback = playbackControl;

    let cancelled = false;

    const syncNativePlaybackState = async () => {
      if (statePollInFlightRef.current) {
        return;
      }

      statePollInFlightRef.current = true;
      try {
        const state = await playback.getPlaybackState();
        if (!cancelled) {
          setIsPlaying(state.isPlaying);

          const canReconcileIndex =
            !controlInFlightRef.current &&
            state.queueLength === queue.length &&
            state.queueIndex >= 0 &&
            state.queueIndex < queue.length &&
            state.queueIndex !== activeIndex;

          if (canReconcileIndex) {
            onSetActiveIndex(state.queueIndex);
            setPositionMs(0);
            positionMsRef.current = 0;
            suppressPositionReconcileUntilRef.current = Date.now() + 1500;
          }

          const now = Date.now();
          const canReconcileAfterTrackChange = now >= suppressPositionReconcileUntilRef.current;
          const boundedStatePosition = Math.max(0, Math.min(state.positionMs, durationMs || state.positionMs));

          const canReconcilePosition =
            canReconcileAfterTrackChange &&
            state.queueLength === queue.length &&
            state.queueIndex === activeIndex &&
            Math.abs(boundedStatePosition - positionMsRef.current) > 1500;

          if (canReconcilePosition) {
            setPositionMs(boundedStatePosition);
            positionMsRef.current = boundedStatePosition;
          }
        }
      } catch {
      } finally {
        statePollInFlightRef.current = false;
      }
    };

    void syncNativePlaybackState();
    const timer = setInterval(() => {
      void syncNativePlaybackState();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [queue.length, activeIndex, onSetActiveIndex, durationMs]);

  useEffect(() => {
    if (!playbackControl) {
      return;
    }

    const playback = playbackControl;
    const queueIndex = queue.length > 0 ? activeIndex : -1;

    if (typeof playback.setQueueTracks === 'function') {
      void playback.setQueueTracks(
        queue.map(item => ({
          uri: item.uri,
          title: item.title,
          artist: item.artist,
          album: item.album,
          displayName: item.displayName,
          durationMs: item.durationMs,
        })),
      ).catch(() => {
      });
    }

    void playback.setQueueState(queue.length, queueIndex).catch(() => {
    });
  }, [queue, activeIndex]);

  useEffect(() => {
    if (!playbackControl) {
      return;
    }

    const playback = playbackControl;
    void playback.setPlaybackProgress(positionMs, durationMs).catch(() => {
    });
  }, [positionMs, durationMs]);

  const ensurePlaybackModule = () => {
    if (!playbackControl) {
      return false;
    }

    return true;
  };

  const recordPlaybackEvent = (eventType: 'PLAY_STARTED' | 'PLAY_COMPLETED' | 'PLAY_SKIPPED' | 'PLAY_PAUSED') => {
    if (!mediaLibrary || !currentTrack?.uri) {
      return;
    }

    void mediaLibrary.recordPlaybackEvent(currentTrack.uri, eventType, positionMs, durationMs).catch(() => {
    });
  };

  const togglePlayPause = async () => {
    if (!currentTrack || !ensurePlaybackModule() || controlInFlightRef.current) {
      return;
    }

    controlInFlightRef.current = true;

    try {
      if (isPlaying) {
        await playbackControl?.pause();
        setIsPlaying(false);
        recordPlaybackEvent('PLAY_PAUSED');
        return;
      }

      await playbackControl?.startPlaybackService();
      await playbackControl?.play();
      setIsPlaying(true);
      recordPlaybackEvent('PLAY_STARTED');
    } finally {
      controlInFlightRef.current = false;
    }
  };

  const seekBy = (deltaMs: number) => {
    setPositionMs(current => {
      const next = current + deltaMs;
      if (next < 0) {
        positionMsRef.current = 0;
        return 0;
      }

      if (durationMs > 0 && next > durationMs) {
        positionMsRef.current = durationMs;
        return durationMs;
      }

      positionMsRef.current = next;
      return next;
    });
  };

  const skipNext = async () => {
    const nextIndex = resolveManualNextIndex(activeIndex, queue.length);
    if (nextIndex === null || !ensurePlaybackModule() || controlInFlightRef.current) {
      return;
    }

    controlInFlightRef.current = true;
    try {
      recordPlaybackEvent('PLAY_SKIPPED');
      await playbackControl?.next();
      onSetActiveIndex(nextIndex);
      setPositionMs(0);
    } finally {
      controlInFlightRef.current = false;
    }
  };

  const skipPrevious = async () => {
    const previousIndex = resolveManualPreviousIndex(activeIndex);
    if (previousIndex === null || !ensurePlaybackModule() || controlInFlightRef.current) {
      return;
    }

    controlInFlightRef.current = true;
    try {
      recordPlaybackEvent('PLAY_SKIPPED');
      await playbackControl?.previous();
      onSetActiveIndex(previousIndex);
      setPositionMs(0);
    } finally {
      controlInFlightRef.current = false;
    }
  };

  const setProgressRatio = (ratio: number) => {
    if (durationMs <= 0) {
      setPositionMs(0);
      positionMsRef.current = 0;
      return;
    }

    const bounded = Math.max(0, Math.min(1, ratio));
    const next = Math.round(durationMs * bounded);
    setPositionMs(next);
    positionMsRef.current = next;
  };

  const cycleEndMode = () => {
    setEndMode(current => {
      if (current === 'stop') {
        return 'repeat_all';
      }

      if (current === 'repeat_all') {
        return 'repeat_one';
      }

      return 'stop';
    });
  };

  const toggleRandomEnabled = () => {
    setRandomEnabled(current => !current);
  };

  return {
    currentTrack,
    isPlaying,
    endMode,
    randomEnabled,
    positionMs,
    durationMs,
    seekStepMs: SEEK_STEP_MS,
    togglePlayPause,
    seekBy,
    skipNext,
    skipPrevious,
    setProgressRatio,
    cycleEndMode,
    toggleRandomEnabled,
  };
}
