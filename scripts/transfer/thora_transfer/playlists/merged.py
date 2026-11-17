"""[[playlists.merged]]: one playlist made from several generated ones (e.g. a single "Liked Songs"
from the Jul 2025 and Mar 2026 liked-songs downloads).

- Each song appears once. Playlists listed first win, so list the one with the best copies first.
  Entries are the same song when they point at the same file, or when their artist and title tags
  match and their lengths are within 2 s.
- Order follows the download logs given in `order_logs`. SpotifyBackerUpper wrote those in
  Spotify's own liked order, newest first. Songs missing from every log were liked after the logs
  were written, so they come first, in download order (oldest file first). Their downloader walked
  the same newest-first list.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from ..naming import sanitize_component

SAME_RECORDING_TOLERANCE_MS = 2_000
_LOG_LINE = re.compile(r"^[\d\- :.]+:\s*(.*?)\s+-\s+https?://open\.spotify\.com/track/\S+\s*$")
_COPY_SUFFIX = re.compile(r"__\d+$")


@dataclass
class _Entry:
    extinf: str
    location: str
    dest_rel: str
    title: str
    artist: str
    duration_ms: int
    mtime_ns: int
    keys: set[str]


def name_key(text: str) -> str:
    """'Aurora, Naimee Coleman - Ordinary World (feat. Naimee Coleman)' and the log's
    'Aurora Naimee Coleman - Ordinary World feat. Naimee Coleman' give the same key."""
    return re.sub(r"[\W_]+", " ", text.casefold()).strip()


def read_m3u8(path: Path) -> list[tuple[str, str]]:
    """(#EXTINF line or "", location) for each entry."""
    entries: list[tuple[str, str]] = []
    extinf = ""
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line.startswith("#EXTINF"):
            extinf = line
        elif line and not line.startswith("#"):
            entries.append((extinf, line))
            extinf = ""
    return entries


def read_order_log(path: Path) -> dict[str, int]:
    """Key -> position (0 = newest like) from a SpotifyBackerUpper successful_downloads.txt."""
    order: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = _LOG_LINE.match(line)
        if match:
            order.setdefault(name_key(match.group(1)), len(order))
    return order


def _file_info(conn: sqlite3.Connection) -> dict[str, sqlite3.Row]:
    """dest_rel -> the copied file's row, plus `alias_paths`: every source file that is this file."""
    rows = {}
    for row in conn.execute(
        "SELECT f.id, f.rel_path, f.title, f.artist, f.duration_ms, f.mtime_ns, p.dest_rel "
        "FROM files f JOIN plan p ON p.file_id = f.id WHERE p.action = 'copy' AND p.dest_rel IS NOT NULL"
    ):
        rows[row["dest_rel"]] = row
    return rows


def _alias_paths(conn: sqlite3.Connection) -> dict[int, list[str]]:
    aliases: dict[int, list[str]] = {}
    for file_id, rel_path in conn.execute(
        "SELECT p.duplicate_of, f.rel_path FROM plan p JOIN files f ON f.id = p.file_id WHERE p.duplicate_of IS NOT NULL"
    ):
        aliases.setdefault(file_id, []).append(rel_path)
    return aliases


def _stem_key(rel_path: str) -> str:
    return name_key(_COPY_SUFFIX.sub("", Path(rel_path).stem))


def build_merged(conn: sqlite3.Connection, out_dir: Path, name: str, sources: list[str],
                 order_logs: list[Path]) -> tuple[Path, int, int] | None:
    files = _file_info(conn)
    aliases = _alias_paths(conn)
    order: dict[str, int] = {}
    for log in order_logs:
        if log.is_file():
            for key, position in read_order_log(log).items():
                order.setdefault(key, len(order) + position)

    chosen: list[_Entry] = []
    seen_paths: set[str] = set()
    by_tags: dict[tuple[str, str], list[_Entry]] = {}
    read = 0
    for source in sources:
        path = out_dir / f"{sanitize_component(source)}.m3u8"
        if not path.is_file():
            print(f"[playlists] merged {name!r}: no generated playlist {source!r}; skipped")
            continue
        for extinf, location in read_m3u8(path):
            read += 1
            dest_rel = location[3:] if location.startswith("../") else location
            if dest_rel in seen_paths:
                continue
            seen_paths.add(dest_rel)
            row = files.get(dest_rel)
            keys = {_stem_key(dest_rel)}
            if row is not None:
                keys.add(_stem_key(row["rel_path"]))
                keys.update(_stem_key(alias) for alias in aliases.get(row["id"], []))
            entry = _Entry(extinf, location, dest_rel,
                           (row["title"] if row else "") or "", (row["artist"] if row else "") or "",
                           (row["duration_ms"] if row else 0) or 0, (row["mtime_ns"] if row else 0) or 0, keys)
            tag_key = (entry.artist.strip().casefold(), entry.title.strip().casefold())
            if all(tag_key):
                same = by_tags.setdefault(tag_key, [])
                match = next((other for other in same
                              if abs(other.duration_ms - entry.duration_ms) <= SAME_RECORDING_TOLERANCE_MS), None)
                if match is not None:
                    match.keys |= entry.keys  # the kept copy inherits this copy's log position
                    continue
                same.append(entry)
            chosen.append(entry)

    if not chosen:
        return None

    def position(entry: _Entry) -> int | None:
        found = [order[key] for key in entry.keys if key in order]
        return min(found) if found else None

    newer = sorted((e for e in chosen if position(e) is None), key=lambda e: e.mtime_ns)
    logged = sorted((e for e in chosen if position(e) is not None), key=lambda e: position(e))
    lines = ["#EXTM3U", f"#PLAYLIST:{name}"]
    for entry in newer + logged:
        if entry.extinf:
            lines.append(entry.extinf)
        lines.append(entry.location)
    out_file = out_dir / f"{sanitize_component(name)}.m3u8"
    out_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_file, len(chosen), len(newer)
