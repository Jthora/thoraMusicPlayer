/**
 * The live playback position must not re-render big parents: before 2026-11-10 the app shell
 * held the display clock and re-rendered all 2,600 lines of it twice a second during playback.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {NativeModules} from 'react-native';

const playingSnapshot = () => ({
  isPlaying: true,
  playWhenReady: true,
  playbackState: 'ready',
  positionMs: 10_250,
  durationMs: 200_000,
  capturedAtEpochMs: Date.now(),
  queueIndex: 0,
  queueLength: 1,
  currentUri: 'content://media/1',
  repeatMode: 'off',
  shuffle: false,
  speed: 1,
});

NativeModules.PlaybackControl = {
  getPlaybackState: jest.fn(async () => playingSnapshot()),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms));

beforeAll(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
});

describe('msUntilNextSecond', () => {
  const {msUntilNextSecond} = require('../src/features/playback/playbackEvents');
  const clock = {positionMs: 10_250, capturedAtEpochMs: 1_000, isPlaying: true, speed: 1, durationMs: 200_000};

  it('waits until the displayed second changes', () => {
    expect(msUntilNextSecond(clock, 1_000)).toBe(750);
    expect(msUntilNextSecond(clock, 1_700)).toBe(50); // 10_950 -> 50 ms left
  });

  it('accounts for playback speed and never spins faster than 50 ms', () => {
    expect(msUntilNextSecond({...clock, speed: 2}, 1_000)).toBe(375);
    expect(msUntilNextSecond({...clock, positionMs: 10_999}, 1_000)).toBe(50);
  });
});

describe('render cost while playing', () => {
  it('useNowPlayingState does not re-render its host as the position advances', async () => {
    const {useNowPlayingState} = require('../src/features/playback/useNowPlayingState');
    let renders = 0;
    function Host() {
      renders += 1;
      useNowPlayingState({queue: [], activeIndex: 0});
      return null;
    }
    const renderer = ReactTestRenderer.create(<Host />);
    await wait(300); // initial snapshot arrives
    const settled = renders;
    await wait(2_500);
    renderer.unmount();
    expect(settled).toBeLessThanOrEqual(3);
    expect(renders).toBe(settled); // no ticking in the host
  }, 10_000);

  it('LivePosition re-renders only its own subtree, about once per displayed second', async () => {
    const {LivePosition} = require('../src/features/playback/LivePosition');
    const clock = {positionMs: 10_250, capturedAtEpochMs: Date.now(), isPlaying: true, speed: 1, durationMs: 200_000};
    const seen: number[] = [];
    const renderer = ReactTestRenderer.create(
      <LivePosition clock={clock}>
        {(positionMs: number) => {
          seen.push(positionMs);
          return null;
        }}
      </LivePosition>,
    );
    await wait(2_400);
    renderer.unmount();
    // Mount + effect sync, then ticks at ~0.75 s and ~1.75 s.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.length).toBeLessThanOrEqual(5);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(11_900);
  }, 10_000);

  it('LivePosition stays still while paused', async () => {
    const {LivePosition} = require('../src/features/playback/LivePosition');
    const clock = {positionMs: 5_000, capturedAtEpochMs: Date.now(), isPlaying: false, speed: 1, durationMs: 200_000};
    let renders = 0;
    const renderer = ReactTestRenderer.create(
      <LivePosition clock={clock}>
        {() => {
          renders += 1;
          return null;
        }}
      </LivePosition>,
    );
    await wait(1_500);
    renderer.unmount();
    expect(renders).toBeLessThanOrEqual(2);
  }, 10_000);
});
