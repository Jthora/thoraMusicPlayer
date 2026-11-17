import {AlbumGroup, ArtistGroup, MediaStoreTrack} from '../../native/modules';
import {compareText} from './sortKeys';

/**
 * Albums and artists built from the songs themselves (the whole library is in memory anyway).
 * Grouping follows what people expect from a music app rather than raw tag strings:
 * - an album is its name, whatever the case or spacing, and is credited to its main artist or
 *   "Various artists" (soundtracks, compilations);
 * - an artist list has one entry per artist: "A feat. B" and ID3's "A/B" count for both A and B;
 * - songs without an album or artist tag are kept together at the end instead of disappearing.
 */

export const UNKNOWN_ALBUM = 'Unknown album';
export const UNKNOWN_ARTIST = 'Unknown artist';
export const VARIOUS_ARTISTS = 'Various artists';

export type LibraryAlbum = AlbumGroup & {key: string; tracks: MediaStoreTrack[]};
export type LibraryArtist = ArtistGroup & {key: string; tracks: MediaStoreTrack[]};

const PLACEHOLDERS = new Set(['', 'unknown', '<unknown>', 'null', 'unknown album', 'unknown artist']);
const FEATURING = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/** Case, width and spacing don't make a different name. */
export function nameKey(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isPlaceholder(value: string | null | undefined): boolean {
  return PLACEHOLDERS.has(nameKey(value));
}

export function albumKey(album: string | null | undefined): string {
  return isPlaceholder(album) ? nameKey(UNKNOWN_ALBUM) : nameKey(album);
}

export function artistKey(artist: string | null | undefined): string {
  return isPlaceholder(artist) ? nameKey(UNKNOWN_ARTIST) : nameKey(artist);
}

/** "A feat. B", "A/B" (ID3's multi-artist separator) and "A; B" credit A and B. "AC/DC" stays one name. */
export function splitArtistCredit(credit: string | null | undefined): string[] {
  if (isPlaceholder(credit)) {
    return [UNKNOWN_ARTIST];
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of (credit ?? '').split(FEATURING)) {
    const slashed = part.split('/').map(piece => piece.trim());
    const pieces = slashed.length > 1 && slashed.every(piece => piece.length >= 3) ? slashed : [part];
    for (const piece of pieces) {
      for (const name of piece.split(';')) {
        const trimmed = name.trim().replace(/^\(+|\)+$/g, '').trim();
        const key = nameKey(trimmed);
        if (trimmed && !seen.has(key)) {
          seen.add(key);
          names.push(trimmed);
        }
      }
    }
  }
  return names.length > 0 ? names : [(credit ?? '').trim()];
}

/** The spelling used most often (first seen on a tie). */
function mostCommon(counts: Map<string, number>): string {
  let best = '';
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return best;
}

function bump(counts: Map<string, number>, value: string) {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

/** The album's main artist, or "Various artists" when no artist has at least half of its songs. */
function albumArtistLabel(tracks: readonly MediaStoreTrack[]): string {
  const byKey = new Map<string, {count: number; spellings: Map<string, number>}>();
  for (const track of tracks) {
    const primary = splitArtistCredit(track.artist)[0];
    const key = artistKey(primary);
    const entry = byKey.get(key) ?? {count: 0, spellings: new Map()};
    entry.count += 1;
    bump(entry.spellings, primary);
    byKey.set(key, entry);
  }
  let top: {count: number; spellings: Map<string, number>} | undefined;
  byKey.forEach(entry => {
    if (!top || entry.count > top.count) {
      top = entry;
    }
  });
  if (!top) {
    return UNKNOWN_ARTIST;
  }
  return top.count * 2 >= tracks.length ? mostCommon(top.spellings) : VARIOUS_ARTISTS;
}

type Group = {spellings: Map<string, number>; tracks: MediaStoreTrack[]};

/** "The Prodigy" sorts under P. */
function sortName(name: string): string {
  return name.replace(/^the\s+/i, '');
}

function byName<T extends {key: string}>(unknownKey: string, nameOf: (item: T) => string) {
  return (left: T, right: T) => {
    if ((left.key === unknownKey) !== (right.key === unknownKey)) {
      return left.key === unknownKey ? 1 : -1;
    }
    return compareText(sortName(nameOf(left)), sortName(nameOf(right)));
  };
}

export function groupAlbums(
  songs: readonly MediaStoreTrack[],
  compareTracks: (left: MediaStoreTrack, right: MediaStoreTrack) => number,
): LibraryAlbum[] {
  const groups = new Map<string, Group>();
  for (const track of songs) {
    const key = albumKey(track.album);
    const group: Group = groups.get(key) ?? {spellings: new Map(), tracks: []};
    bump(group.spellings, isPlaceholder(track.album) ? UNKNOWN_ALBUM : track.album.trim());
    group.tracks.push(track);
    groups.set(key, group);
  }
  const albums: LibraryAlbum[] = [];
  groups.forEach((group, key) => {
    const tracks = group.tracks.sort(compareTracks);
    albums.push({
      key,
      album: mostCommon(group.spellings),
      trackCount: tracks.length,
      sampleArtist: albumArtistLabel(tracks),
      tracks,
    });
  });
  return albums.sort(byName(nameKey(UNKNOWN_ALBUM), album => album.album));
}

export function groupArtists(
  songs: readonly MediaStoreTrack[],
  compareTracks: (left: MediaStoreTrack, right: MediaStoreTrack) => number,
): LibraryArtist[] {
  const groups = new Map<string, Group>();
  for (const track of songs) {
    for (const name of splitArtistCredit(track.artist)) {
      const key = artistKey(name);
      const group: Group = groups.get(key) ?? {spellings: new Map(), tracks: []};
      bump(group.spellings, name);
      group.tracks.push(track);
      groups.set(key, group);
    }
  }
  const byAlbumThenTrack = (left: MediaStoreTrack, right: MediaStoreTrack) =>
    compareText(albumKey(left.album), albumKey(right.album)) || compareTracks(left, right);
  const artists: LibraryArtist[] = [];
  groups.forEach((group, key) => {
    const tracks = group.tracks.sort(byAlbumThenTrack);
    artists.push({
      key,
      artist: mostCommon(group.spellings),
      trackCount: tracks.length,
      albumCount: new Set(tracks.map(track => albumKey(track.album))).size,
      tracks,
    });
  });
  return artists.sort(byName(nameKey(UNKNOWN_ARTIST), artist => artist.artist));
}
