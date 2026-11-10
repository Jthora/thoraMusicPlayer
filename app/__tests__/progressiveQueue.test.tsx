/**
 * Long queues start with a window around the tapped track and fill in behind the music:
 * PLAY ALL on a 1,320-song playlist took ~1.1 s from tap to sound when sent whole.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {DeviceEventEmitter, NativeModules} from 'react-native';

const track = (i: number) => ({
  uri: `content://media/${i}`,
  title: `Song ${i}`,
  artist: 'A',
  album: 'B',
  durationMs: 1000,
  mimeType: 'audio/mpeg',
  sizeBytes: 1,
  dateModifiedEpochSeconds: 1,
  displayName: `${i}.mp3`,
  relativePath: 'Music/',
});
const range = (from: number, to: number) => Array.from({length: to - from}, (_, i) => track(from + i));

const calls: Array<[string, unknown[]]> = [];
let releaseInsert: (() => void) | null = null;
let holdInserts = false;

NativeModules.PlaybackControl = {
  setQueue: jest.fn(async (...args: unknown[]) => {
    calls.push(['setQueue', args]);
    return true;
  }),
  insertQueueItems: jest.fn(async (...args: unknown[]) => {
    calls.push(['insert', args]);
    if (holdInserts) {
      await new Promise<void>(resolve => {
        releaseInsert = resolve;
      });
    }
    return true;
  }),
  getQueue: jest.fn(async () => []),
  getPlaybackState: jest.fn(async () => ({queueIndex: -1})),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

const flush = () => new Promise<void>(resolve => setTimeout(() => resolve(), 0));
const playerStartsPlaying = () => DeviceEventEmitter.emit('ThoraPlaybackState', {isPlaying: true});

function mountQueue() {
  const {useFolderQueue} = require('../src/features/queue/useFolderQueue');
  const hook: {current: ReturnType<typeof useFolderQueue> | null} = {current: null};
  function Host() {
    hook.current = useFolderQueue();
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Host />);
  });
  return {hook, renderer};
}

beforeEach(() => {
  calls.length = 0;
  holdInserts = false;
  releaseInsert = null;
});

const sizes = (args: unknown[]) => (args[1] as unknown[]).length;

test('a long queue starts with a window from the tapped track, then fills in after and before it', async () => {
  const {hook, renderer} = mountQueue();
  await ReactTestRenderer.act(async () => {
    await hook.current!.loadQueueAndStart(range(0, 300), 100, 'test');
    await flush();
  });
  expect(calls.map(([kind]) => kind)).toEqual(['setQueue']); // nothing else until audio starts
  await ReactTestRenderer.act(async () => {
    playerStartsPlaying();
    await flush();
    await flush();
  });
  ReactTestRenderer.act(() => renderer.unmount());

  const [kind, args] = calls[0];
  expect(kind).toBe('setQueue');
  const head = args[0] as Array<{uri: string}>;
  expect(head).toHaveLength(40);
  expect(head[0].uri).toBe('content://media/100');
  expect(args.slice(1)).toEqual([0, 0, true]);

  expect(calls[1][0]).toBe('insert');
  expect(calls[1][1][0]).toBe(-1); // append what follows the window
  expect(sizes(calls[1][1])).toBe(160);
  expect((calls[1][1][1] as Array<{uri: string}>)[0].uri).toBe('content://media/140');

  expect(calls[2][0]).toBe('insert');
  expect(calls[2][1][0]).toBe(0); // then everything before the tapped track, at the front
  expect(sizes(calls[2][1])).toBe(100);
  expect(calls).toHaveLength(3);
});

test('short queues are sent whole, as before', async () => {
  const {hook, renderer} = mountQueue();
  await ReactTestRenderer.act(async () => {
    await hook.current!.loadQueueAndStart(range(0, 50), 7, 'test');
    await flush();
  });
  ReactTestRenderer.act(() => renderer.unmount());
  expect(calls).toHaveLength(1);
  expect((calls[0][1][0] as unknown[]).length).toBe(50);
  expect(calls[0][1].slice(1)).toEqual([7, 0, true]);
});

test('starting another queue stops the old fill, so its tracks never reach the new queue', async () => {
  const {hook, renderer} = mountQueue();
  holdInserts = true;
  await ReactTestRenderer.act(async () => {
    await hook.current!.loadQueueAndStart(range(0, 300), 100, 'first');
    playerStartsPlaying();
    await flush();
    await flush(); // first fill is now waiting inside its "append" insert
  });
  holdInserts = false;
  await ReactTestRenderer.act(async () => {
    await hook.current!.loadQueueAndStart(range(1000, 1050), 0, 'second');
    releaseInsert?.();
    await flush();
    await flush();
  });
  ReactTestRenderer.act(() => renderer.unmount());

  const kinds = calls.map(([kind, args]) => `${kind}:${kind === 'insert' ? String(args[0]) : (args[0] as unknown[]).length}`);
  // first head, first append (already in flight), second queue; the first fill's "before" never runs.
  expect(kinds).toEqual(['setQueue:40', 'insert:-1', 'setQueue:50']);
});
