import {
  endModeFromRepeat,
  nextEndMode,
  projectPositionMs,
  repeatFromEndMode,
} from '../src/features/playback/playbackEvents';
import {normalizeEndMode} from '../src/features/playback/useNowPlayingState';
import {PlaybackSnapshot} from '../src/native/modules';

const snapshot = (overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  isPlaying: true,
  playWhenReady: true,
  playbackState: 'ready',
  positionMs: 10_000,
  durationMs: 200_000,
  capturedAtEpochMs: 1_000_000,
  queueIndex: 0,
  queueLength: 3,
  currentUri: 'content://media/1',
  repeatMode: 'off',
  shuffle: false,
  speed: 1,
  ...overrides,
});

describe('playback helpers', () => {
  test('normalizes end mode safely', () => {
    expect(normalizeEndMode('stop')).toBe('stop');
    expect(normalizeEndMode('repeat_all')).toBe('repeat_all');
    expect(normalizeEndMode('repeat_one')).toBe('repeat_one');
    expect(normalizeEndMode('invalid')).toBe('stop');
    expect(normalizeEndMode(undefined)).toBe('stop');
  });

  test('projects live position from the last native snapshot', () => {
    expect(projectPositionMs(snapshot(), 1_002_500)).toBe(12_500);
    expect(projectPositionMs(snapshot({isPlaying: false}), 1_090_000)).toBe(10_000);
    expect(projectPositionMs(snapshot({speed: 2}), 1_001_000)).toBe(12_000);
  });

  test('projection never runs past the end or backwards', () => {
    expect(projectPositionMs(snapshot({positionMs: 199_000}), 1_010_000)).toBe(200_000);
    expect(projectPositionMs(snapshot(), 999_000)).toBe(10_000);
  });

  test('maps native repeat modes to the UI end modes and back', () => {
    expect(endModeFromRepeat('off')).toBe('stop');
    expect(endModeFromRepeat('all')).toBe('repeat_all');
    expect(endModeFromRepeat('one')).toBe('repeat_one');
    expect(endModeFromRepeat(undefined)).toBe('stop');
    expect(repeatFromEndMode('stop')).toBe('off');
    expect(repeatFromEndMode('repeat_all')).toBe('all');
    expect(repeatFromEndMode('repeat_one')).toBe('one');
  });

  test('repeat button cycles stop -> all -> one -> stop', () => {
    expect(nextEndMode('stop')).toBe('repeat_all');
    expect(nextEndMode('repeat_all')).toBe('repeat_one');
    expect(nextEndMode('repeat_one')).toBe('stop');
  });
});
