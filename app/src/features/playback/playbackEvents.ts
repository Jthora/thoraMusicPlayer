import {useEffect, useState} from 'react';
import {NativeEventEmitter, NativeModules} from 'react-native';

import {PlaybackRepeatMode, PlaybackSnapshot, playbackControl} from '../../native/modules';

export type EndMode = 'stop' | 'repeat_all' | 'repeat_one';

let emitter: NativeEventEmitter | null = null;

/** One shared emitter for the native player's events (PLAYBACK_EVENTS). */
export function getPlaybackEmitter(): NativeEventEmitter | null {
  if (!playbackControl) {
    return null;
  }
  if (!emitter) {
    emitter = new NativeEventEmitter(NativeModules.PlaybackControl);
  }
  return emitter;
}

/**
 * What the UI needs to show a live position. It changes only on native player events
 * (play, pause, seek, track change), so holding it doesn't re-render anything per second.
 */
export type PlaybackClock = Pick<PlaybackSnapshot, 'positionMs' | 'capturedAtEpochMs' | 'isPlaying' | 'speed' | 'durationMs'>;

const MIN_TICK_MS = 50;

/** Live position from the last native snapshot, without asking native every second. */
export function projectPositionMs(snapshot: PlaybackClock, nowMs: number): number {
  let position = Math.max(0, snapshot.positionMs);
  if (snapshot.isPlaying) {
    position += Math.max(0, nowMs - snapshot.capturedAtEpochMs) * (snapshot.speed > 0 ? snapshot.speed : 1);
  }
  return snapshot.durationMs > 0 ? Math.min(position, snapshot.durationMs) : position;
}

/** Milliseconds until the projected position next crosses a whole second (the time label's resolution). */
export function msUntilNextSecond(clock: PlaybackClock, nowMs: number): number {
  const speed = clock.speed > 0 ? clock.speed : 1;
  const remainder = 1000 - (projectPositionMs(clock, nowMs) % 1000);
  return Math.max(MIN_TICK_MS, Math.ceil(remainder / speed));
}

/**
 * The current position, re-rendering only the calling component, once per displayed second and
 * only while audio is advancing. Keep this out of big parents (the app shell) so they don't
 * re-render with every tick.
 */
export function useLivePositionMs(clock: PlaybackClock | null): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    if (!clock?.isPlaying) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNowMs(Date.now());
        schedule();
      }, msUntilNextSecond(clock, Date.now()));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [clock]);
  return clock ? projectPositionMs(clock, nowMs) : 0;
}

export function endModeFromRepeat(mode: PlaybackRepeatMode | undefined): EndMode {
  if (mode === 'all') {
    return 'repeat_all';
  }
  if (mode === 'one') {
    return 'repeat_one';
  }
  return 'stop';
}

export function repeatFromEndMode(mode: EndMode): PlaybackRepeatMode {
  if (mode === 'repeat_all') {
    return 'all';
  }
  if (mode === 'repeat_one') {
    return 'one';
  }
  return 'off';
}

/** The repeat button cycles stop -> repeat all -> repeat one -> stop. */
export function nextEndMode(mode: EndMode): EndMode {
  if (mode === 'stop') {
    return 'repeat_all';
  }
  if (mode === 'repeat_all') {
    return 'repeat_one';
  }
  return 'stop';
}
