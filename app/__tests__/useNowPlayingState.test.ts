import {
  normalizeEndMode,
  pickRandomNextIndex,
  resolveEndOfTrackTransition,
  resolveManualNextIndex,
  resolveManualPreviousIndex,
} from '../src/features/playback/useNowPlayingState';

describe('useNowPlayingState playback helpers', () => {
  test('normalizes end mode safely', () => {
    expect(normalizeEndMode('stop')).toBe('stop');
    expect(normalizeEndMode('repeat_all')).toBe('repeat_all');
    expect(normalizeEndMode('repeat_one')).toBe('repeat_one');
    expect(normalizeEndMode('invalid')).toBe('stop');
    expect(normalizeEndMode(undefined)).toBe('stop');
  });

  test('resolves manual next/previous edge boundaries', () => {
    expect(resolveManualNextIndex(0, 3)).toBe(1);
    expect(resolveManualNextIndex(2, 3)).toBeNull();

    expect(resolveManualPreviousIndex(2)).toBe(1);
    expect(resolveManualPreviousIndex(0)).toBeNull();
  });

  test('picks random next index without repeating current', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.75);
    expect(pickRandomNextIndex(0, 2)).toBe(1);
    spy.mockRestore();
  });

  test('repeat one loops current track on completion', () => {
    const resolution = resolveEndOfTrackTransition({
      endMode: 'repeat_one',
      randomEnabled: false,
      queueLength: 5,
      activeIndex: 3,
      durationMs: 210000,
    });

    expect(resolution).toEqual({
      nextPositionMs: 0,
      nextIndex: null,
      shouldStopPlayback: false,
    });
  });

  test('repeat all wraps at queue end', () => {
    const resolution = resolveEndOfTrackTransition({
      endMode: 'repeat_all',
      randomEnabled: false,
      queueLength: 4,
      activeIndex: 3,
      durationMs: 180000,
    });

    expect(resolution).toEqual({
      nextPositionMs: 0,
      nextIndex: 0,
      shouldStopPlayback: false,
    });
  });

  test('stop mode halts at end without next index', () => {
    const resolution = resolveEndOfTrackTransition({
      endMode: 'stop',
      randomEnabled: false,
      queueLength: 2,
      activeIndex: 1,
      durationMs: 90000,
    });

    expect(resolution).toEqual({
      nextPositionMs: 90000,
      nextIndex: null,
      shouldStopPlayback: true,
    });
  });

  test('random mode selects a new index when possible', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
    const resolution = resolveEndOfTrackTransition({
      endMode: 'stop',
      randomEnabled: true,
      queueLength: 3,
      activeIndex: 0,
      durationMs: 120000,
    });

    expect(resolution).toEqual({
      nextPositionMs: 0,
      nextIndex: 2,
      shouldStopPlayback: false,
    });
    spy.mockRestore();
  });
});
