import {useEffect, useMemo, useState} from 'react';
import {AppState} from 'react-native';

import {MediaStoreTrack, PLAYBACK_EVENTS, PlaybackSnapshot, playbackControl} from '../../native/modules';
import {useStableCallback} from '../../platform/hooks/useStableCallback';
import {
  EndMode,
  PlaybackClock,
  endModeFromRepeat,
  getPlaybackEmitter,
  nextEndMode,
  projectPositionMs,
  repeatFromEndMode,
} from './playbackEvents';

export type {EndMode} from './playbackEvents';

type UseNowPlayingStateInput = {
  queue: MediaStoreTrack[];
  activeIndex: number;
};

export function normalizeEndMode(value: string | undefined): EndMode {
  if (value === 'repeat_all' || value === 'repeat_one') {
    return value;
  }
  return 'stop';
}

const SEEK_STEP_MS = 10_000;

/**
 * Thin view of the native player. Native (Media3) owns queue position, repeat/shuffle and the
 * real playback clock; this hook subscribes to its snapshots and forwards commands. It returns a
 * `clock` that changes only on player events; render the live position with <LivePosition> /
 * useLivePositionMs near where it's shown, so callers don't re-render every second.
 * Play stats are recorded natively by the service.
 */
export function useNowPlayingState(input: UseNowPlayingStateInput) {
  const {queue, activeIndex} = input;
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot | null>(null);

  const refresh = useStableCallback(async () => {
    if (!playbackControl) {
      return;
    }
    try {
      setSnapshot(await playbackControl.getPlaybackState());
    } catch {
    }
  });

  useEffect(() => {
    const emitter = getPlaybackEmitter();
    if (!emitter) {
      return;
    }
    const subscription = emitter.addListener(PLAYBACK_EVENTS.state, (next: PlaybackSnapshot) => {
      setSnapshot(next);
    });
    void refresh();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void refresh();
      }
    });
    return () => {
      subscription.remove();
      appState.remove();
    };
  }, [refresh]);

  const isPlaying = Boolean(snapshot?.playWhenReady) && snapshot?.playbackState !== 'ended';

  const nativeIndex = snapshot && snapshot.queueIndex >= 0 ? snapshot.queueIndex : activeIndex;
  // Prefer the track native says is playing: while a long queue is still filling in, the index
  // and the mirrored JS queue can briefly disagree.
  const currentUri = snapshot?.currentUri ?? null;
  const currentTrack = useMemo(() => {
    const byIndex = queue[nativeIndex];
    if (!currentUri || byIndex?.uri === currentUri) {
      return byIndex;
    }
    return queue.find(track => track.uri === currentUri) ?? byIndex;
  }, [queue, nativeIndex, currentUri]);
  const durationMs = snapshot && snapshot.durationMs > 0 ? snapshot.durationMs : Math.max(0, currentTrack?.durationMs ?? 0);
  const clock = useMemo<PlaybackClock | null>(
    () =>
      snapshot
        ? {
            positionMs: snapshot.positionMs,
            capturedAtEpochMs: snapshot.capturedAtEpochMs,
            isPlaying: snapshot.isPlaying,
            speed: snapshot.speed,
            durationMs,
          }
        : null,
    [snapshot, durationMs],
  );
  const currentPositionMs = () => (clock ? projectPositionMs(clock, Date.now()) : 0);
  const endMode = endModeFromRepeat(snapshot?.repeatMode);
  const randomEnabled = Boolean(snapshot?.shuffle);

  // Optimistic local update so the progress bar moves immediately; the native event confirms.
  const applyLocalSeek = (targetMs: number) => {
    setSnapshot(current => (current ? {...current, positionMs: targetMs, capturedAtEpochMs: Date.now()} : current));
  };

  const togglePlayPause = useStableCallback(async () => {
    if (!playbackControl || !currentTrack) {
      return;
    }
    await playbackControl.togglePlayPause().catch(() => false);
  });

  const seekTo = useStableCallback((targetMs: number) => {
    if (!playbackControl || !currentTrack) {
      return;
    }
    const bounded = Math.max(0, durationMs > 0 ? Math.min(targetMs, durationMs) : targetMs);
    applyLocalSeek(bounded);
    void playbackControl.seekTo(bounded).catch(() => false);
  });

  const seekBy = useStableCallback((deltaMs: number) => {
    seekTo(currentPositionMs() + deltaMs);
  });

  const setProgressRatio = useStableCallback((ratio: number) => {
    if (durationMs > 0) {
      seekTo(Math.round(durationMs * Math.max(0, Math.min(1, ratio))));
    }
  });

  const skipNext = useStableCallback(async () => {
    await playbackControl?.next().catch(() => false);
  });

  const skipPrevious = useStableCallback(async () => {
    await playbackControl?.previous().catch(() => false);
  });

  const cycleEndMode = useStableCallback(() => {
    void playbackControl?.setRepeatMode(repeatFromEndMode(nextEndMode(endMode))).catch(() => false);
  });

  const toggleRandomEnabled = useStableCallback(() => {
    void playbackControl?.setShuffle(!randomEnabled).catch(() => false);
  });

  return {
    currentTrack,
    isPlaying,
    endMode,
    randomEnabled,
    clock,
    durationMs,
    seekStepMs: SEEK_STEP_MS,
    playerError: snapshot?.error ?? null,
    togglePlayPause,
    seekBy,
    skipNext,
    skipPrevious,
    setProgressRatio,
    cycleEndMode,
    toggleRandomEnabled,
  };
}
