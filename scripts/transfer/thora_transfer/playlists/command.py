"""`playlists` command: discover, parse, repair, write canonical M3U8 + review files, optionally push."""

from __future__ import annotations

import csv
import fnmatch
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from .. import classify as cls
from ..config import BUILTIN_EXCLUDES, Config
from ..inventory import _is_excluded
from ..naming import sanitize_component
from ..state import finish_run, start_run
from .matcher import (
    STATUS_MATCHED,
    STATUS_REVIEW,
    STATUS_UNRESOLVED,
    STATUS_UNSUPPORTED,
    Candidate,
    LibraryIndex,
    MatchResult,
    Matcher,
    PlaylistContext,
)
from .parsers import NotAPlaylist, ParsedPlaylist, PlaylistEntry, parse_file

SKIP_DECISION = -1


@dataclass
class PlaylistSource:
    key: str
    path: Path
    context: PlaylistContext
    forced_format: str | None = None


def entry_key(entry: PlaylistEntry) -> str:
    raw = "|".join(
        str(part or "") for part in (entry.location, entry.artist, entry.title, entry.album, entry.duration_ms, entry.isrc)
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def discover(config: Config, conn: sqlite3.Connection, inputs: list[str]) -> list[PlaylistSource]:
    found: list[PlaylistSource] = []
    for row in conn.execute(
        "SELECT source, rel_path, kind FROM files WHERE kind IN (?, ?) ORDER BY source, rel_path",
        (cls.KIND_PLAYLIST, cls.KIND_PLAYLIST_CANDIDATE),
    ):
        try:
            source = config.source(row["source"])
        except Exception:
            continue
        rel_dir = row["rel_path"].rpartition("/")[0]
        found.append(
            PlaylistSource(
                key=f"{row['source']}:{row['rel_path']}",
                path=source.path / row["rel_path"],
                context=PlaylistContext(source=row["source"], rel_dir=rel_dir),
            )
        )

    def add_path(path: Path, forced: str | None = None) -> None:
        found.append(PlaylistSource(key=f"file:{path.resolve()}", path=path, context=PlaylistContext(), forced_format=forced))

    for directory in config.playlist_extra_dirs:
        if not directory.is_dir():
            print(f"[playlists] extra dir missing: {directory}", file=sys.stderr)
            continue
        for dirpath, dirnames, filenames in os.walk(directory):
            rel_dir = os.path.relpath(dirpath, directory).replace(os.sep, "/")
            dirnames[:] = [d for d in dirnames if not _is_excluded(f"{rel_dir}/{d}/__dir__", list(BUILTIN_EXCLUDES))]
            for filename in sorted(filenames):
                kind = cls.classify(filename)
                if kind in (cls.KIND_PLAYLIST, cls.KIND_PLAYLIST_CANDIDATE) and not filename.startswith("._"):
                    add_path(Path(dirpath) / filename)

    for item in inputs:
        path = Path(os.path.expanduser(item))
        if path.is_dir():
            for child in sorted(path.rglob("*")):
                if child.is_file() and cls.classify(child.name) in (cls.KIND_PLAYLIST, cls.KIND_PLAYLIST_CANDIDATE):
                    add_path(child)
        elif path.is_file():
            ext = path.suffix.lower().lstrip(".")
            add_path(path, "text" if ext == "txt" else None)
        else:
            print(f"[playlists] input not found: {path}", file=sys.stderr)
    return found


def load_decisions(conn: sqlite3.Connection) -> dict[tuple[str, str], int]:
    return {
        (row["playlist_key"], row["entry_key"]): row["chosen_file_id"]
        for row in conn.execute("SELECT * FROM playlist_decisions")
    }


def apply_review_file(conn: sqlite3.Connection, index: LibraryIndex, review_csv: Path) -> int:
    """Read the `choice` column: 1/2/3 = candidate, 'skip', or a phone-relative dest path."""
    by_dest = {track.dest_rel.casefold(): track.id for track in index.tracks.values()}
    applied = 0
    with review_csv.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            choice = (row.get("choice") or "").strip()
            if not choice:
                continue
            chosen: int | None
            if choice.lower() == "skip":
                chosen = SKIP_DECISION
            elif choice in ("1", "2", "3"):
                cand_id = (row.get(f"cand{choice}_id") or "").strip()
                chosen = int(cand_id) if cand_id.isdigit() else None
            else:
                chosen = by_dest.get(choice.strip("/").casefold())
            if chosen is None:
                print(f"[playlists] review row {row.get('playlist_name')}#{row.get('entry_index')}: "
                      f"cannot resolve choice {choice!r}", file=sys.stderr)
                continue
            conn.execute(
                """
                INSERT INTO playlist_decisions(playlist_key, entry_key, chosen_file_id, decided_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(playlist_key, entry_key) DO UPDATE SET
                    chosen_file_id = excluded.chosen_file_id, decided_at = excluded.decided_at
                """,
                (row["playlist_key"], row["entry_key"], chosen, int(time.time())),
            )
            applied += 1
    conn.commit()
    return applied


def _extinf(entry: PlaylistEntry, result: MatchResult) -> str:
    track = result.track
    duration_ms = (track.duration_ms if track else None) or entry.duration_ms
    seconds = round(duration_ms / 1000) if duration_ms else -1
    artist = (track.artist if track else None) or entry.artist or ""
    title = (track.title if track else None) or entry.title or ""
    label = f"{artist} - {title}" if artist and title else (title or artist or "")
    return f"#EXTINF:{seconds},{label}".replace("\n", " ")


def _comment(tag: str, entry: PlaylistEntry) -> str:
    return f"#THORA-{tag}:{entry.original()}".replace("\n", " ")


_NAME_KEY = re.compile(r"[^0-9a-z]+")
_PLAYLIST_FILE_FORMATS = ("m3u", "m3u8")


def tags_agree(entry: PlaylistEntry, track) -> bool:
    """Cross-check for review candidates: the entry's title must appear in the track's title or file
    name, and its artist (any credited artist) in the track's artist tags or path. Without an
    artist, durations must agree within 5 s. Lengths 15 s+ apart are different versions."""
    from .normalize import artist_alternatives, norm_text

    title = norm_text(entry.title) if entry.title else ""
    if not title and entry.location:
        title = norm_text(Path(entry.location.replace("\\", "/")).stem)
    if not title:
        return False
    stem = norm_text(Path(track.rel_path).stem)
    if title not in track.norm_title and title not in stem:
        return False
    if entry.duration_ms and track.duration_ms and abs(entry.duration_ms - track.duration_ms) > 15_000:
        return False
    artists = [a for a in artist_alternatives(entry.artist) if a] if entry.artist else []
    if artists:
        haystack = " ".join(track.norm_artists + [norm_text(track.rel_path)])
        return any(artist in haystack for artist in artists)
    return bool(entry.duration_ms and track.duration_ms and abs(entry.duration_ms - track.duration_ms) <= 5_000)


def playlist_name_key(name: str) -> str:
    """Names that differ only in case, punctuation, underscores or curly quotes are the same playlist."""
    return _NAME_KEY.sub("", name.casefold().replace("\u2019", "'").replace("_", " "))


def _is_under(path: Path, folder: Path | None) -> bool:
    if folder is None:
        return False
    try:
        path.resolve().relative_to(folder.resolve())
        return True
    except ValueError:
        return False


def _rank(source: PlaylistSource, parsed: ParsedPlaylist, rosters_dir: Path | None) -> int:
    """Lower wins when several playlists share a name: recovered Spotify roster > file > folder."""
    if parsed.fmt == "csv" and _is_under(source.path, rosters_dir):
        return 0
    if parsed.fmt == "folder":
        return 2
    return 1


def _is_album_list(source: PlaylistSource, parsed: ParsedPlaylist) -> bool:
    """An m3u shipped inside an album folder that only lists that folder's files by bare name.
    The folder itself shows in the app, so a playlist would only duplicate it. Spotify's
    <Playlist>/playlist.m3u8 looks the same but is a real playlist, recognised by its file name."""
    if parsed.fmt not in _PLAYLIST_FILE_FORMATS or source.context.source is None:
        return False
    if source.path.stem.casefold() == "playlist":
        return False
    locations = [entry.location or "" for entry in parsed.entries]
    return bool(locations) and all(location and "/" not in location and "\\" not in location for location in locations)


def folder_playlists(config: Config, conn: sqlite3.Connection) -> list[tuple[PlaylistSource, ParsedPlaylist, str]]:
    """[playlists] folder_playlists: each matching folder that has audio but no playlist file becomes a playlist."""
    found: list[tuple[PlaylistSource, ParsedPlaylist, str]] = []
    for spec, display_name in config.folder_playlists:
        label, _, pattern = spec.partition("/")
        try:
            source = config.source(label)
        except Exception:
            print(f"[playlists] folder_playlists: unknown source in {spec!r}", file=sys.stderr)
            continue
        audio: dict[str, list[str]] = {}
        has_playlist: set[str] = set()
        for row in conn.execute("SELECT rel_path, kind FROM files WHERE source = ?", (label,)):
            folder, _, name = row["rel_path"].rpartition("/")
            if row["kind"] == cls.KIND_AUDIO:
                audio.setdefault(folder, []).append(name)
            elif row["kind"] == cls.KIND_PLAYLIST:
                has_playlist.add(folder)
        for folder in sorted(audio, key=str.casefold):
            if folder in has_playlist or not fnmatch.fnmatchcase(folder.casefold(), pattern.casefold()):
                continue
            entries = [PlaylistEntry(index=i, location=name) for i, name in enumerate(sorted(audio[folder], key=str.casefold))]
            name = display_name if display_name and not any(ch in pattern for ch in "*?[") else \
                folder.rpartition("/")[2].replace("_", " ").strip()
            key = f"folder:{label}/{folder}"
            found.append((PlaylistSource(key=key, path=source.path / folder,
                                         context=PlaylistContext(source=label, rel_dir=folder)),
                          ParsedPlaylist(name=name, fmt="folder", entries=entries), key))
    return found


def collect_playlists(config: Config, conn: sqlite3.Connection, sources: list[PlaylistSource]):
    """Parse every playlist, add folder playlists, drop album track lists and lower-ranked same-name copies."""
    collected: list[tuple[PlaylistSource, ParsedPlaylist, str]] = []
    not_playlists = 0
    album_lists = 0
    for source in sources:
        try:
            parsed_list = parse_file(source.path, forced_format=source.forced_format)
        except NotAPlaylist:
            not_playlists += 1
            continue
        except (OSError, ValueError, SyntaxError) as error:  # ET.ParseError subclasses SyntaxError
            print(f"[playlists] cannot read {source.path}: {error}", file=sys.stderr)
            continue
        for parsed in parsed_list:
            if not parsed.entries:
                continue
            if _is_album_list(source, parsed):
                album_lists += 1
                continue
            key = source.key if len(parsed_list) == 1 else f"{source.key}#{parsed.name}"
            collected.append((source, parsed, key))
    collected += folder_playlists(config, conn)
    if album_lists:
        print(f"[playlists] skipped {album_lists} album track list(s) (bare file names beside their album)")

    rosters_dir = config.spotify_rosters_dir
    best: dict[str, int] = {}
    for source, parsed, _ in collected:
        name_key = playlist_name_key(parsed.name)
        rank = _rank(source, parsed, rosters_dir)
        best[name_key] = min(rank, best.get(name_key, rank))
    kept, superseded = [], []
    for source, parsed, key in collected:
        name_key = playlist_name_key(parsed.name)
        if _rank(source, parsed, rosters_dir) > best[name_key]:
            superseded.append(f"{parsed.name} ({source.key}) by a newer/better copy")
        else:
            kept.append((source, parsed, key))
    return kept, not_playlists, superseded


def run_playlists(
    config: Config,
    conn: sqlite3.Connection,
    inputs: list[str] | None = None,
    apply_review: str | None = None,
) -> dict:
    run_id = start_run(conn, "playlists")
    index = LibraryIndex.from_state(conn)
    matcher = Matcher(index, config.remaps, config.auto_accept_score, config.review_score)

    if apply_review:
        applied = apply_review_file(conn, index, Path(os.path.expanduser(apply_review)))
        print(f"[playlists] applied {applied} review decision(s)")
    decisions = load_decisions(conn)

    sources = discover(config, conn, inputs or [])
    if not sources:
        print("[playlists] no playlist files found in sources, extra_dirs, or inputs")

    out_dir = config.playlists_out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.m3u8"):
        stale.unlink()
    report_dir = config.reports_dir / time.strftime("%Y%m%d-%H%M%S") / "playlists"
    report_dir.mkdir(parents=True, exist_ok=True)

    review_rows: list[dict] = []
    unresolved_rows: list[dict] = []
    matched_files: list[tuple[str, str, int]] = []
    per_playlist: list[dict] = []
    used_names: set[str] = set()
    totals = {"playlists": 0, "entries": 0, STATUS_MATCHED: 0, STATUS_REVIEW: 0, STATUS_UNRESOLVED: 0, STATUS_UNSUPPORTED: 0, "skipped": 0}
    rules: dict[str, int] = {}

    collected, not_playlists, superseded = collect_playlists(config, conn, sources)
    for line in superseded:
        print(f"[playlists] superseded: {line}")
    for source, parsed, playlist_key in collected:
        lines = ["#EXTM3U", f"#PLAYLIST:{parsed.name}"]
        stats = {STATUS_MATCHED: 0, STATUS_REVIEW: 0, STATUS_UNRESOLVED: 0, STATUS_UNSUPPORTED: 0, "skipped": 0}

        for entry in parsed.entries:
            key = entry_key(entry)
            decision = decisions.get((playlist_key, key))
            if decision == SKIP_DECISION:
                stats["skipped"] += 1
                lines.append(_comment("SKIPPED", entry))
                continue
            if decision is not None and decision in index.tracks:
                track = index.tracks[decision]
                result = MatchResult(STATUS_MATCHED, "decision", 1.0, track, [Candidate(track, 1.0, "decision")])
            else:
                result = matcher.match(entry, source.context)
                if (result.status == STATUS_REVIEW and config.accept_review_when_tags_agree and result.candidates
                        and tags_agree(entry, result.candidates[0].track)):
                    top = result.candidates[0]
                    result = MatchResult(STATUS_MATCHED, "review-agrees", top.score, top.track, result.candidates)

            stats[result.status] += 1
            if result.status == STATUS_MATCHED:
                rules[result.rule or "?"] = rules.get(result.rule or "?", 0) + 1
                matched_files.append((playlist_key, key, result.track.id))
                lines.append(_extinf(entry, result))
                lines.append(f"../{result.track.dest_rel}")
                continue

            lines.append(_comment(result.status.upper(), entry))
            row = {
                "playlist_key": playlist_key,
                "playlist_name": parsed.name,
                "entry_index": entry.index + 1,
                "entry_key": key,
                "original": entry.original(),
                "hint": " | ".join(part for part in (entry.artist, entry.title, entry.album) if part),
                "status": result.status,
                "choice": "",
            }
            for position in range(3):
                candidate = result.candidates[position] if position < len(result.candidates) else None
                row[f"cand{position + 1}"] = candidate.track.dest_rel if candidate else ""
                row[f"cand{position + 1}_score"] = f"{candidate.score:.2f}" if candidate else ""
                row[f"cand{position + 1}_rule"] = candidate.rule if candidate else ""
                row[f"cand{position + 1}_id"] = candidate.track.id if candidate else ""
            (review_rows if result.status == STATUS_REVIEW else unresolved_rows).append(row)

        base = sanitize_component(parsed.name) or "playlist"
        name = base
        if name.casefold() in used_names:
            label = source.context.source or "extra"
            name = sanitize_component(f"{base} ({label})")
            counter = 2
            while name.casefold() in used_names:
                name = sanitize_component(f"{base} ({label} {counter})")
                counter += 1
        used_names.add(name.casefold())
        out_file = out_dir / f"{name}.m3u8"
        out_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

        totals["playlists"] += 1
        totals["entries"] += len(parsed.entries)
        for status, count in stats.items():
            totals[status] += count
        per_playlist.append({"name": parsed.name, "file": out_file.name, "source": source.key, "format": parsed.fmt,
                             "entries": len(parsed.entries), **stats})

    fieldnames = ["playlist_name", "entry_index", "status", "original", "hint", "choice",
                  "cand1", "cand1_score", "cand1_rule", "cand2", "cand2_score", "cand2_rule",
                  "cand3", "cand3_score", "cand3_rule", "cand1_id", "cand2_id", "cand3_id",
                  "playlist_key", "entry_key"]
    for filename, rows in (("review.csv", review_rows), ("unresolved.csv", unresolved_rows)):
        with (report_dir / filename).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    summary = {"totals": totals, "rules": rules, "not_playlists": not_playlists, "playlists": per_playlist,
               "out_dir": str(out_dir), "report_dir": str(report_dir)}
    (report_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    conn.execute("DELETE FROM playlist_matches")
    conn.executemany(
        "INSERT OR REPLACE INTO playlist_matches(playlist_key, entry_key, file_id) VALUES (?, ?, ?)", matched_files
    )
    finish_run(conn, run_id, {"totals": totals, "rules": rules})

    print(
        f"[playlists] {totals['playlists']} playlist(s), {totals['entries']} entries: "
        f"{totals[STATUS_MATCHED]} matched, {totals[STATUS_REVIEW]} need review, "
        f"{totals[STATUS_UNRESOLVED]} unresolved, {totals[STATUS_UNSUPPORTED]} unsupported (URLs), "
        f"{totals['skipped']} skipped by decision"
    )
    if rules:
        print("[playlists] matched by rule: " + ", ".join(f"{rule}={count}" for rule, count in sorted(rules.items())))
    print(f"[playlists] output: {out_dir}")
    if review_rows:
        print(
            f"[playlists] review: {report_dir / 'review.csv'}\n"
            f"            fill the 'choice' column (1/2/3, skip, or a phone path) then run:\n"
            f"            thora-transfer playlists --apply-review {report_dir / 'review.csv'}"
        )
    return summary


def push_playlists(config: Config, adb) -> int:
    files = sorted(config.playlists_out_dir.glob("*.m3u8"))
    if not files:
        print("[playlists] nothing to push; run `playlists` first")
        return 0
    adb.mkdirs([config.phone_playlists_dir])
    adb.push_into_dir([str(path) for path in files], config.phone_playlists_dir)
    print(f"[playlists] pushed {len(files)} playlist(s) to {config.phone_playlists_dir}")
    return len(files)
