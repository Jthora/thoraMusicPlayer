import {
  compareText,
  compareTracksByTrackThenTitle,
  inferredTrackOrder,
  sameTrackList,
} from '../src/features/library/sortKeys';
import {MediaStoreTrack} from '../src/native/modules';

const track = (title: string, displayName = `${title}.mp3`, uri = `content://media/${title}`): MediaStoreTrack => ({
  uri,
  title,
  artist: 'Artist',
  album: 'Album',
  durationMs: 1,
  mimeType: 'audio/mpeg',
  sizeBytes: 1,
  dateModifiedEpochSeconds: 1,
  displayName,
  relativePath: 'Music/',
});

test('text order is natural, and ignores case and accents', () => {
  const names = ['track 10', 'Track 2', 'Élan', 'apple', 'Zebra', 'elan vital'];
  expect([...names].sort(compareText)).toEqual(['apple', 'Élan', 'elan vital', 'Track 2', 'track 10', 'Zebra']);
  expect(compareText('ABBA', 'abba')).toBe(0);
});

test('album order: numbered tracks by number, then the rest by title', () => {
  const songs = [track('Outro'), track('Intro', '01 - Intro.mp3'), track('Middle', '10 Middle.mp3'), track('Second', '2. Second.mp3')];
  expect(songs.sort(compareTracksByTrackThenTitle).map(t => t.title)).toEqual(['Intro', 'Second', 'Middle', 'Outro']);
  expect(inferredTrackOrder(track('x', 'Track 7.flac'))).toBe(7);
  expect(inferredTrackOrder(track('No number'))).toBeNull();
});

test('an unchanged refresh is recognised, any metadata change is not', () => {
  const before = [track('A'), track('B')];
  const same = before.map(t => ({...t}));
  expect(sameTrackList(before, same)).toBe(true);
  expect(sameTrackList(before, [same[0], {...same[1], album: 'Other'}])).toBe(false);
  expect(sameTrackList(before, [same[0]])).toBe(false);
});
