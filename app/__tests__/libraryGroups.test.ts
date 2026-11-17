import {
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  VARIOUS_ARTISTS,
  albumKey,
  groupAlbums,
  groupArtists,
  splitArtistCredit,
} from '../src/features/library/libraryGroups';
import {MediaStoreTrack} from '../src/native/modules';

let nextId = 1;
const song = (title: string, artist: string, album: string): MediaStoreTrack => ({
  uri: `content://media/${nextId++}`,
  title,
  artist,
  album,
  durationMs: 200_000,
  mimeType: 'audio/mpeg',
  sizeBytes: 1,
  dateModifiedEpochSeconds: 1,
  displayName: `${title}.mp3`,
  relativePath: 'Music/Thora/library/',
});
const byTitle = (left: MediaStoreTrack, right: MediaStoreTrack) => left.title.localeCompare(right.title);

describe('splitArtistCredit', () => {
  test('credits every artist of a collaboration', () => {
    expect(splitArtistCredit('Dr Dre feat Snoop Dog')).toEqual(['Dr Dre', 'Snoop Dog']);
    expect(splitArtistCredit('Junkie XL feat. Peter Tosh')).toEqual(['Junkie XL', 'Peter Tosh']);
    expect(splitArtistCredit('2 Unlimited/Mason')).toEqual(['2 Unlimited', 'Mason']);
    expect(splitArtistCredit('A; B; a')).toEqual(['A', 'B']);
  });

  test('keeps names that only look like collaborations', () => {
    expect(splitArtistCredit('AC/DC')).toEqual(['AC/DC']);
    expect(splitArtistCredit('Simon & Garfunkel')).toEqual(['Simon & Garfunkel']);
    expect(splitArtistCredit('Earth, Wind & Fire')).toEqual(['Earth, Wind & Fire']);
  });

  test('missing artists are "Unknown artist"', () => {
    expect(splitArtistCredit('<unknown>')).toEqual([UNKNOWN_ARTIST]);
    expect(splitArtistCredit('')).toEqual([UNKNOWN_ARTIST]);
  });
});

describe('groupAlbums', () => {
  const songs = [
    song('Bounce', 'Artist One', 'GTA: San Andreas'),
    song('Radio X', 'Artist Two', 'GTA: San Andreas'),
    song('K-Rose', 'Artist Three', 'gta: san  andreas'),
    song('Solo B', 'Fatboy Slim', 'Palookaville'),
    song('Solo A', 'Fatboy Slim feat. Damon Albarn', 'Palookaville'),
    song('No tag', 'Someone', 'Unknown album'),
    song('Null tag', 'Someone', ''),
    song('Fat of the Land', 'The Prodigy', 'The Fat of the Land'),
  ];
  const albums = groupAlbums(songs, byTitle);

  test('one album per name, whatever the case or spacing', () => {
    const gta = albums.find(album => album.key === albumKey('GTA: San Andreas'))!;
    expect(gta.trackCount).toBe(3);
    expect(gta.album).toBe('GTA: San Andreas');
  });

  test('credits the main artist, or Various artists for compilations', () => {
    expect(albums.find(album => album.album === 'Palookaville')!.sampleArtist).toBe('Fatboy Slim');
    expect(albums.find(album => album.album === 'GTA: San Andreas')!.sampleArtist).toBe(VARIOUS_ARTISTS);
  });

  test('untagged songs share one Unknown album, listed last; "The" is ignored when sorting', () => {
    expect(albums.map(album => album.album)).toEqual(['The Fat of the Land', 'GTA: San Andreas', 'Palookaville', UNKNOWN_ALBUM]);
    expect(albums[albums.length - 1].trackCount).toBe(2);
  });

  test('album songs are in track order', () => {
    expect(albums.find(album => album.album === 'Palookaville')!.tracks.map(track => track.title)).toEqual(['Solo A', 'Solo B']);
  });
});

describe('groupArtists', () => {
  const songs = [
    song('One', 'Fatboy Slim', 'B Album'),
    song('Two', 'Fatboy Slim feat. Damon Albarn', 'A Album'),
    song('Three', 'fatboy slim', 'A Album'),
    song('Four', 'AC/DC', 'Back in Black'),
  ];
  const artists = groupArtists(songs, byTitle);

  test('featured artists get the song too, and case does not split an artist', () => {
    expect(artists.map(artist => [artist.artist, artist.trackCount, artist.albumCount])).toEqual([
      ['AC/DC', 1, 1],
      ['Damon Albarn', 1, 1],
      ['Fatboy Slim', 3, 2],
    ]);
  });

  test("an artist's songs are grouped by album", () => {
    expect(artists.find(artist => artist.artist === 'Fatboy Slim')!.tracks.map(track => track.title)).toEqual([
      'Three',
      'Two',
      'One',
    ]);
  });
});
