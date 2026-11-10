"""Resolve playlist entries against the planned library (the matching ladder).

Rules, in order (first confident, unambiguous hit wins):
  1 exact     path equals a library path after remaps / relative-to-playlist resolution
  2 suffix    longest matching trailing path segments (moved parent folders)
  3 format    same folder + stem, different extension (mp3 -> flac)
  4 name      normalized filename stem, disambiguated by folder/album + duration
  5 tags      ISRC, or artist + title (+ duration / album bonuses)
  6 fuzzy     similarity over shared tokens -> review only, never auto-accepted
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field

from ..config import Config, Remap
from ..planner import ACTION_SKIP_DUPLICATE, PUSHABLE_ACTIONS
from .normalize import (
    artist_alternatives,
    clean_location,
    norm_text,
    path_segments,
    similarity,
    split_artist_title,
    stem_variants,
    strip_extension,
)
from .parsers import PlaylistEntry

STATUS_MATCHED = "matched"
STATUS_REVIEW = "review"
STATUS_UNRESOLVED = "unresolved"
STATUS_UNSUPPORTED = "unsupported"

AMBIGUITY_MARGIN = 0.04


@dataclass
class LibTrack:
    id: int
    source: str
    rel_path: str
    dest_rel: str
    title: str | None
    artist: str | None
    album_artist: str | None
    album: str | None
    duration_ms: int | None
    isrc: str | None
    segs: list[str]
    norm_title: str
    norm_artists: list[str]
    norm_album: str


@dataclass
class Candidate:
    track: LibTrack
    score: float
    rule: str


@dataclass
class MatchResult:
    status: str
    rule: str | None = None
    score: float = 0.0
    track: LibTrack | None = None
    candidates: list[Candidate] = field(default_factory=list)


def _trailing_common(left: list[str], right: list[str]) -> int:
    count = 0
    for a, b in zip(reversed(left), reversed(right)):
        if a != b:
            break
        count += 1
    return count


class LibraryIndex:
    def __init__(self, tracks: list[LibTrack], aliases: dict[str, int] | None = None):
        self.tracks = {track.id: track for track in tracks}
        self.full: dict[str, int] = {}
        self.rel_only: dict[str, list[int]] = defaultdict(list)
        self.by_basename: dict[str, list[int]] = defaultdict(list)
        self.by_stem: dict[str, list[int]] = defaultdict(list)
        self.by_variant: dict[str, list[int]] = defaultdict(list)
        self.by_title: dict[str, list[int]] = defaultdict(list)
        self.by_isrc: dict[str, list[int]] = defaultdict(list)
        self.by_token: dict[str, set[int]] = defaultdict(set)

        for track in tracks:
            self._index_path(track.id, track.segs, primary=True)
            if track.norm_title:
                self.by_title[track.norm_title].append(track.id)
            if track.isrc:
                self.by_isrc[track.isrc.upper().replace("-", "")].append(track.id)
            for token in set(track.norm_title.split()) | {t for a in track.norm_artists for t in a.split()}:
                if len(token) >= 3:
                    self.by_token[token].add(track.id)

        # Paths of skipped exact duplicates resolve to the kept copy.
        for path, keeper in (aliases or {}).items():
            if keeper in self.tracks:
                self._index_path(keeper, path_segments(path), primary=False)

    def _index_path(self, track_id: int, segs: list[str], primary: bool) -> None:
        if not segs:
            return
        self.full.setdefault("/".join(segs), track_id)
        rel = "/".join(segs[1:])
        if rel and track_id not in self.rel_only[rel]:
            self.rel_only[rel].append(track_id)
        basename = segs[-1]
        if track_id not in self.by_basename[basename]:
            self.by_basename[basename].append(track_id)
        parent = segs[-2] if len(segs) > 1 else ""
        stem_key = f"{parent}/{strip_extension(basename)}"
        if track_id not in self.by_stem[stem_key]:
            self.by_stem[stem_key].append(track_id)
        bare_stem = f"*/{strip_extension(basename)}"
        if track_id not in self.by_stem[bare_stem]:
            self.by_stem[bare_stem].append(track_id)
        for variant in stem_variants(strip_extension(basename)):
            if track_id not in self.by_variant[variant]:
                self.by_variant[variant].append(track_id)

    @classmethod
    def from_state(cls, conn: sqlite3.Connection) -> "LibraryIndex":
        rows = conn.execute(
            """
            SELECT f.id, f.source, f.rel_path, f.title, f.artist, f.album_artist, f.album, f.duration_ms, f.isrc,
                   p.action, p.dest_rel, p.duplicate_of
            FROM files f JOIN plan p ON p.file_id = f.id
            WHERE f.kind = 'audio'
            """
        ).fetchall()
        if not rows:
            raise SystemExit("No planned audio. Run `inventory` and `plan` before `playlists`.")
        tracks: list[LibTrack] = []
        aliases: dict[str, int] = {}
        for row in rows:
            source_path = f"{row['source']}/{row['rel_path']}"
            if row["action"] == ACTION_SKIP_DUPLICATE and row["duplicate_of"]:
                aliases[source_path] = int(row["duplicate_of"])
                continue
            if row["action"] not in PUSHABLE_ACTIONS:
                continue
            tracks.append(
                LibTrack(
                    id=int(row["id"]),
                    source=row["source"],
                    rel_path=row["rel_path"],
                    dest_rel=row["dest_rel"],
                    title=row["title"],
                    artist=row["artist"],
                    album_artist=row["album_artist"],
                    album=row["album"],
                    duration_ms=row["duration_ms"],
                    isrc=row["isrc"],
                    segs=path_segments(source_path),
                    norm_title=norm_text(row["title"]),
                    norm_artists=artist_alternatives(row["artist"]) + artist_alternatives(row["album_artist"]),
                    norm_album=norm_text(row["album"]),
                )
            )
        return cls(tracks, aliases)


@dataclass
class PlaylistContext:
    """Where the playlist file itself lives, for resolving relative entries."""

    source: str | None = None
    rel_dir: str | None = None


class Matcher:
    def __init__(self, index: LibraryIndex, remaps: list[Remap], auto_accept: float, review: float):
        self.index = index
        self.remaps = sorted(remaps, key=lambda remap: len(remap.from_prefix), reverse=True)
        self.auto_accept = auto_accept
        self.review = review

    # ---- scoring helpers -------------------------------------------------
    @staticmethod
    def _duration_adjust(entry_ms: int | None, track_ms: int | None) -> float:
        if not entry_ms or not track_ms:
            return 0.0
        diff = abs(entry_ms - track_ms) / 1000
        if diff <= 3:
            return 0.05
        if diff <= 10:
            return 0.0
        if diff <= 30:
            return -0.10
        return -0.25

    def _tag_affinity(self, entry: PlaylistEntry, track: LibTrack) -> float | None:
        """0..1: how well the entry's text hints agree with the track's tags. None = entry has no hints."""
        scores = []
        if entry.title and track.norm_title:
            scores.append(similarity(norm_text(entry.title), track.norm_title))
        entry_artists = artist_alternatives(entry.artist)
        if entry_artists and track.norm_artists:
            scores.append(max(similarity(a, b) for a in entry_artists for b in track.norm_artists))
        return sum(scores) / len(scores) if scores else None

    def _affinity_or_neutral(self, entry: PlaylistEntry, track: LibTrack) -> float:
        value = self._tag_affinity(entry, track)
        return 0.5 if value is None else value

    def _pick(self, candidates: list[Candidate]) -> MatchResult | None:
        """Accept the best candidate if it's confident and clearly ahead of the runner-up."""
        if not candidates:
            return None
        best_by_track: dict[int, Candidate] = {}
        for candidate in candidates:
            current = best_by_track.get(candidate.track.id)
            if current is None or candidate.score > current.score:
                best_by_track[candidate.track.id] = candidate
        ranked = sorted(best_by_track.values(), key=lambda item: item.score, reverse=True)
        best = ranked[0]
        runner_up = ranked[1].score if len(ranked) > 1 else 0.0
        if best.score >= self.auto_accept and best.score - runner_up >= AMBIGUITY_MARGIN:
            return MatchResult(STATUS_MATCHED, best.rule, round(best.score, 3), best.track, ranked[:3])
        return None

    # ---- the ladder ------------------------------------------------------
    def _location_forms(self, location: str, context: PlaylistContext) -> list[list[str]]:
        forms: list[list[str]] = []
        folded = location.casefold()
        for remap in self.remaps:
            if folded.startswith(remap.from_prefix.casefold()):
                forms.append(path_segments(remap.to_prefix + "/" + location[len(remap.from_prefix):]))
        if not location.startswith("/") and context.source is not None:
            base = f"{context.source}/{context.rel_dir}" if context.rel_dir else context.source
            forms.append(path_segments(f"{base}/{location}"))
        forms.append(path_segments(location))
        unique: list[list[str]] = []
        for form in forms:
            if form and form not in unique:
                unique.append(form)
        return unique

    def match(self, entry: PlaylistEntry, context: PlaylistContext | None = None) -> MatchResult:
        context = context or PlaylistContext()
        index = self.index
        pool: list[Candidate] = []

        location = None
        remote = False
        if entry.location:
            location, remote = clean_location(entry.location)
            if remote:
                location = None

        if entry.title is None and entry.hint:
            artist, title = split_artist_title(entry.hint)
            entry.artist = entry.artist or artist
            entry.title = title

        if location:
            forms = self._location_forms(location, context)

            # 1 exact
            for segs in forms:
                track_id = index.full.get("/".join(segs))
                if track_id is not None:
                    track = index.tracks[track_id]
                    return MatchResult(STATUS_MATCHED, "exact", 1.0, track, [Candidate(track, 1.0, "exact")])
                rel_ids = index.rel_only.get("/".join(segs), [])
                if len(rel_ids) == 1:
                    track = index.tracks[rel_ids[0]]
                    return MatchResult(STATUS_MATCHED, "exact", 0.99, track, [Candidate(track, 0.99, "exact")])
                if len(segs) > 1:
                    # Old root folder differs but the whole library-relative path is intact.
                    rel_ids = index.rel_only.get("/".join(segs[1:]), [])
                    if len(rel_ids) == 1:
                        track = index.tracks[rel_ids[0]]
                        return MatchResult(STATUS_MATCHED, "suffix", 0.98, track, [Candidate(track, 0.98, "suffix")])

            segs = forms[-1]
            basename = segs[-1]

            # 2 suffix
            suffix_candidates: list[Candidate] = []
            basename_ids = index.by_basename.get(basename, [])
            for track_id in basename_ids:
                track = index.tracks[track_id]
                common = max(_trailing_common(form, track.segs) for form in forms)
                affinity = self._tag_affinity(entry, track)
                if common >= 2:
                    score = 0.93 + min(common - 2, 2) * 0.02
                    if affinity is not None and affinity < 0.5:
                        score -= 0.10
                elif len(basename_ids) == 1:
                    # Only file with this name anywhere: trust it unless the entry's hints disagree.
                    score = 0.90 if affinity is None or affinity >= 0.6 else 0.70
                else:
                    score = 0.78 + 0.14 * (affinity if affinity is not None else 0.0)
                score += self._duration_adjust(entry.duration_ms, track.duration_ms)
                suffix_candidates.append(Candidate(track, min(score, 0.99), "suffix"))
            picked = self._pick(suffix_candidates)
            if picked:
                return picked
            pool.extend(suffix_candidates)

            # 3 format change (same folder + stem, different extension)
            stem = strip_extension(basename)
            parent = segs[-2] if len(segs) > 1 else ""
            format_candidates = []
            for track_id in index.by_stem.get(f"{parent}/{stem}", []):
                track = index.tracks[track_id]
                score = 0.91 + self._duration_adjust(entry.duration_ms, track.duration_ms)
                format_candidates.append(Candidate(track, score, "format"))
            if not format_candidates:
                bare = index.by_stem.get(f"*/{stem}", [])
                for track_id in bare:
                    track = index.tracks[track_id]
                    score = (0.80 if len(bare) == 1 else 0.70) + 0.10 * self._affinity_or_neutral(entry, track)
                    score += self._duration_adjust(entry.duration_ms, track.duration_ms)
                    format_candidates.append(Candidate(track, score, "format"))
            picked = self._pick(format_candidates)
            if picked:
                return picked
            pool.extend(format_candidates)

            # 4 normalized name
            name_candidates = []
            seen: set[int] = set()
            entry_parent = norm_text(parent)
            for variant in stem_variants(stem):
                for track_id in index.by_variant.get(variant, []):
                    if track_id in seen:
                        continue
                    seen.add(track_id)
                    track = index.tracks[track_id]
                    track_parent = norm_text(track.segs[-2]) if len(track.segs) > 1 else ""
                    context_sim = max(similarity(entry_parent, track_parent), similarity(entry_parent, track.norm_album))
                    score = 0.76 + 0.12 * context_sim + 0.06 * self._affinity_or_neutral(entry, track)
                    score += self._duration_adjust(entry.duration_ms, track.duration_ms)
                    name_candidates.append(Candidate(track, score, "name"))
            picked = self._pick(name_candidates)
            if picked:
                return picked
            pool.extend(name_candidates)

        # 5 tags
        if entry.isrc:
            ids = index.by_isrc.get(entry.isrc.upper().replace("-", ""), [])
            if len(ids) == 1:
                track = index.tracks[ids[0]]
                return MatchResult(STATUS_MATCHED, "isrc", 0.99, track, [Candidate(track, 0.99, "isrc")])

        if entry.title:
            title_key = norm_text(entry.title)
            entry_artists = artist_alternatives(entry.artist)
            entry_album = norm_text(entry.album)
            tag_candidates = []
            for track_id in index.by_title.get(title_key, []):
                track = index.tracks[track_id]
                if entry_artists and track.norm_artists:
                    artist_sim = max(similarity(a, b) for a in entry_artists for b in track.norm_artists)
                else:
                    artist_sim = 0.5
                score = 0.68 + 0.24 * artist_sim
                if entry_album and track.norm_album and similarity(entry_album, track.norm_album) >= 0.85:
                    score += 0.03
                # Same recording in two places: prefer the copy whose raw title matches exactly.
                if track.title and track.title.strip().casefold() == entry.title.strip().casefold():
                    score += 0.05
                score += self._duration_adjust(entry.duration_ms, track.duration_ms)
                tag_candidates.append(Candidate(track, score, "tags"))
            picked = self._pick(tag_candidates)
            if picked:
                return picked
            pool.extend(tag_candidates)

            # 6 fuzzy (review only)
            tokens = [token for token in title_key.split() if len(token) >= 3]
            for alternative in entry_artists[:1]:
                tokens += [token for token in alternative.split() if len(token) >= 3]
            candidate_ids: dict[int, int] = defaultdict(int)
            for token in tokens:
                for track_id in index.by_token.get(token, ()):
                    candidate_ids[track_id] += 1
            shortlist = sorted(candidate_ids, key=lambda track_id: candidate_ids[track_id], reverse=True)[:300]
            for track_id in shortlist:
                track = index.tracks[track_id]
                title_sim = similarity(title_key, track.norm_title)
                if title_sim < 0.6:
                    continue
                artist_sim = (
                    max(similarity(a, b) for a in entry_artists for b in track.norm_artists)
                    if entry_artists and track.norm_artists
                    else 0.5
                )
                score = 0.55 * title_sim + 0.35 * artist_sim + 0.10
                score += self._duration_adjust(entry.duration_ms, track.duration_ms)
                pool.append(Candidate(track, min(score, self.auto_accept - 0.01), "fuzzy"))

        if remote and not pool:
            return MatchResult(STATUS_UNSUPPORTED, "remote")

        best_by_track: dict[int, Candidate] = {}
        for candidate in pool:
            current = best_by_track.get(candidate.track.id)
            if current is None or candidate.score > current.score:
                best_by_track[candidate.track.id] = candidate
        ranked = sorted(best_by_track.values(), key=lambda item: item.score, reverse=True)[:3]
        if ranked and ranked[0].score >= self.review:
            return MatchResult(STATUS_REVIEW, ranked[0].rule, round(ranked[0].score, 3), None, ranked)
        return MatchResult(STATUS_UNRESOLVED, None, round(ranked[0].score, 3) if ranked else 0.0, None, ranked)


def build_matcher(config: Config, conn: sqlite3.Connection) -> Matcher:
    return Matcher(LibraryIndex.from_state(conn), config.remaps, config.auto_accept_score, config.review_score)
