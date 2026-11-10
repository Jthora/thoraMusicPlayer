# Playlist matching spec

Written for: whoever implements or changes playlist matching, on the Mac (`scripts/transfer/thora_transfer/playlists/`) or in the app (`PlaylistImporter.kt`, P4).

Both implementations must follow these rules so a playlist resolves to the same tracks on either side. The Python implementation is the reference, and its tests (`scripts/transfer/tests/test_matcher.py`) are the expected-behavior table.

## Normalization

| Function | Rule |
|---|---|
| `fold(s)` | NFKD, drop combining marks, casefold |
| `norm_text(s)` | Remove version noise: `- 2011 Remaster`-style dash suffixes, and `(…remaster…)`, `(explicit)`, `(clean)`, `(deluxe …)`, `(bonus track)`, `(album version)`, `(original version)` in any bracket type. Remove `(feat. …)`/`(ft. …)`/`(with …)` and a trailing ` feat. …`. Then `fold`, `&`→`and`, non-alphanumerics→space, collapse spaces. **Keep** live/remix/mix/edit/acoustic/demo/instrumental/mono/stereo, because they are different recordings. |
| `strip_track_prefix(stem)` | Remove one leading track/disc number: `01 `, `01 - `, `01. `, `1-01 `, `CD1-01 `. A 4-digit number alone (e.g. `1979`) is not a track number. |
| `stem_variants(stem)` | `{norm(stem), norm(no-track-number stem)}`, plus, if the no-number stem contains ` - `, the part after the first and after the last ` - ` (this drops an `Artist - ` prefix). Matching on any shared variant is allowed. |
| `artist_alternatives(a)` | `norm(a)` plus each part split on `, ; / & and x feat. ft. featuring`. |
| `clean_location(raw)` | Decode `file://` URIs (percent-decoding; a non-local host becomes `//host/…`). Backslashes→`/`, drop the Windows drive letter, NFC. `http(s)`, `spotify:`, `ftp`, `smb`, `rtsp` count as remote. |
| `path_segments(p)` | Split on `/`, resolve `.`/`..`, NFC, casefold each segment. |
| `similarity(a, b)` | max(SequenceMatcher ratio of the strings, ratio of the token-sorted strings). |

Library tracks are identified by `<source label>/<relative path>`. The phone stores them at `<phone_root>/<same path after sanitization>`.

## Ladder

Try the rules in order. A rule **accepts** when its best candidate scores ≥ `auto_accept` (0.85) and beats the runner-up by ≥ 0.04. Otherwise its candidates go into a shared pool and matching continues. If nothing accepts: pool best ≥ `review` (0.60) gives **review**, below that gives **unresolved**. A remote URL with no candidates is **unsupported**.

**Duration adjustment** (whenever both durations are known): ≤3 s: +0.05; ≤10 s: 0; ≤30 s: −0.10; more: −0.25.

**Affinity** is the mean of title similarity and best artist similarity between the entry's hints and the track's tags. It is "unknown" when the entry has no hints, and "neutral" means 0.5.

1. **exact.** Check location forms in this order:
   - each matching `[[playlists.remap]]` (longest `from` first)
   - for relative entries, the entry resolved against the playlist's own folder
   - the raw location

   A full-path hit scores 1.0. A unique hit on the library-relative path (without the source label) scores 0.99. A unique hit after dropping the first segment of the location (old root folder) scores 0.98 and is labeled `suffix`.
2. **suffix.** Candidates are tracks with the same basename (casefolded).
   - ≥2 trailing segments in common: 0.93, +0.02 per extra segment, max +0.04. Subtract 0.10 if affinity is known and < 0.5.
   - basename unique in the library: 0.90 if affinity is unknown or ≥ 0.6, else 0.70.
   - otherwise: 0.78 + 0.14·affinity.

   Then apply the duration adjustment, capped at 0.99.
3. **format.**
   - Same parent folder and stem, any extension: 0.91 + duration adjustment.
   - If there is none, the same stem in any folder: (0.80 if unique, else 0.70) + 0.10·affinity(neutral) + duration adjustment.
4. **name.** Tracks sharing any stem variant score 0.76 + 0.12·max(sim(entry parent, track parent), sim(entry parent, track album)) + 0.06·affinity(neutral) + duration adjustment.
5. **tags.**
   - A unique ISRC match scores 0.99.
   - Otherwise take tracks with exactly the same `norm_text(title)` and score 0.68 + 0.24·best artist similarity. Use 0.5 for the artist similarity if either side lacks an artist.
   - Add +0.03 if the albums are ≥ 0.85 similar, and +0.05 if the raw titles are equal (casefold). This bonus breaks ties between two copies of the same recording.
   - Then apply the duration adjustment.
6. **fuzzy.** Shortlist tracks that share tokens (≥3 characters) of the title and first artist, keeping the top 300. Discard any with title similarity < 0.6. Score 0.55·title sim + 0.35·artist sim + 0.10 + duration adjustment, capped at `auto_accept − 0.01`. **Fuzzy never auto-accepts.**

Paths of skipped byte-identical duplicates are indexed as aliases of the kept copy.

## Output and decisions

- Canonical `.m3u8`:
  - `#EXTM3U`
  - `#PLAYLIST:<name>`
  - `#EXTINF:<sec>,<artist> - <title>` followed by `../<phone-relative path>`, for each matched entry
  - `#THORA-REVIEW:`, `#THORA-UNRESOLVED:`, `#THORA-UNSUPPORTED:` and `#THORA-SKIPPED:` comment lines preserve the original text of everything else.
- Decision key: `(playlist_key, entry_key)`.
  - `playlist_key` is `<source>:<rel_path>` (with `#<name>` appended for multi-playlist files like iTunes XML) or `file:<abs path>`.
  - `entry_key` is the first 16 hex chars of `sha1(location|artist|title|album|duration_ms|isrc)`.
  - A decision is either a chosen track or *skip*.
