import {MediaStoreTrack} from '../../native/modules';

/**
 * Fast, library-wide text ordering.
 *
 * String.prototype.localeCompare and Intl.Collator are very slow under Hermes on this phone (each
 * call goes through ICU), and sorting the whole library makes ~70,000 comparisons: profiling
 * showed several seconds of JS-thread time per re-sort, which blanked lists while scrolling.
 * Instead each string gets a sort key once (accents folded, lower case, digit runs zero-padded so
 * "Track 2" < "Track 10"), cached, and keys compare with plain < and >.
 */
const keyCache = new Map<string, string>();
const KEY_CACHE_LIMIT = 50_000;
const COMBINING_MARKS = /[̀-ͯ]/g;
const DIGIT_RUN = /\d+/g;

export function sortKey(value: string | null | undefined): string {
  const text = value ?? '';
  let key = keyCache.get(text);
  if (key === undefined) {
    key = text
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .toLowerCase()
      .trim()
      .replace(DIGIT_RUN, digits => digits.padStart(12, '0'));
    if (keyCache.size >= KEY_CACHE_LIMIT) {
      keyCache.clear();
    }
    keyCache.set(text, key);
  }
  return key;
}

export function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Natural, case- and accent-insensitive text order. */
export function compareText(left: string | null | undefined, right: string | null | undefined): number {
  return compareKeys(sortKey(left), sortKey(right));
}

const TRACK_NUMBER_PATTERNS = [
  /^(\d{1,3})\s*[.\-_:)]\s*/,
  /^(\d{1,3})\s+/,
  /^track\s*(\d{1,3})\b/i,
  /^no\.?\s*(\d{1,3})\b/i,
  /\b(\d{1,3})\s*\/\s*\d{1,3}\b/,
];

export function parseTrackNumber(text: string): number | null {
  const cleaned = text.trim();
  if (!cleaned) {
    return null;
  }
  for (const pattern of TRACK_NUMBER_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

const trackOrderCache = new WeakMap<MediaStoreTrack, number | null>();

/** The track's number from its file name ("03 - Song.mp3") or title; cached per track object. */
export function inferredTrackOrder(track: MediaStoreTrack): number | null {
  if (trackOrderCache.has(track)) {
    return trackOrderCache.get(track) ?? null;
  }
  const fromDisplayName = parseTrackNumber(track.displayName.replace(/\.[A-Za-z0-9]{2,5}$/, ''));
  const order = fromDisplayName ?? parseTrackNumber(track.title);
  trackOrderCache.set(track, order);
  return order;
}

/** Album order: numbered tracks first by number, then by title, then by URI (stable). */
export function compareTracksByTrackThenTitle(left: MediaStoreTrack, right: MediaStoreTrack): number {
  const leftOrder = inferredTrackOrder(left);
  const rightOrder = inferredTrackOrder(right);
  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftOrder !== null && rightOrder === null) {
    return -1;
  }
  if (leftOrder === null && rightOrder !== null) {
    return 1;
  }
  return compareText(left.title, right.title) || compareKeys(left.uri, right.uri);
}

/**
 * True when two song lists hold the same songs with the same metadata, in the same order. A
 * library refresh that changed nothing can then keep the previous array, so nothing derived from
 * it (sorted lists, folders, albums, artists) is rebuilt.
 */
export function sameTrackList(left: readonly MediaStoreTrack[], right: readonly MediaStoreTrack[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.uri !== b.uri ||
      a.title !== b.title ||
      a.artist !== b.artist ||
      a.album !== b.album ||
      a.durationMs !== b.durationMs ||
      a.displayName !== b.displayName ||
      a.relativePath !== b.relativePath ||
      a.sizeBytes !== b.sizeBytes ||
      a.dateModifiedEpochSeconds !== b.dateModifiedEpochSeconds
    ) {
      return false;
    }
  }
  return true;
}
