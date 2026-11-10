"""Optional push selection: only the files repaired playlists reference, plus chosen folders.

Without a [selection] table in the config, everything planned is selected (the original behaviour).
With one, `push` only sends:
  - every file a playlist entry was matched to by the last `playlists` run (when playlists = true)
  - every audio file under the listed folders, written as "<source label>/<folder inside the source>"
Exact duplicates are mapped to the single copy the plan pushes, so selection never sends a file twice.
"""

from __future__ import annotations

import sqlite3
import sys
from collections import defaultdict

from .config import Config


def _duplicate_targets(conn: sqlite3.Connection) -> dict[int, int]:
    return {
        int(row["file_id"]): int(row["duplicate_of"])
        for row in conn.execute("SELECT file_id, duplicate_of FROM plan WHERE duplicate_of IS NOT NULL")
    }


def folder_file_ids(conn: sqlite3.Connection, folder: str) -> set[int]:
    label, _, inside = folder.partition("/")
    prefix = inside.strip("/").casefold()
    ids = set()
    for row in conn.execute("SELECT id, rel_path FROM files WHERE source = ? AND kind = 'audio'", (label,)):
        rel = row["rel_path"].casefold()
        if not prefix or rel.startswith(prefix + "/"):
            ids.add(int(row["id"]))
    return ids


def playlist_file_ids(conn: sqlite3.Connection) -> set[int]:
    return {int(row["file_id"]) for row in conn.execute("SELECT DISTINCT file_id FROM playlist_matches")}


def selected_file_ids(config: Config, conn: sqlite3.Connection, verbose: bool = False) -> set[int] | None:
    """File ids to push, or None when the config has no selection (push everything planned)."""
    selection = config.selection
    if selection is None:
        return None
    duplicates = _duplicate_targets(conn)
    ids: set[int] = set()
    if selection.playlists:
        from_playlists = playlist_file_ids(conn)
        if not from_playlists:
            print("[selection] no playlist matches recorded yet: run `playlists` first", file=sys.stderr)
        ids |= from_playlists
    for folder in selection.folders:
        found = folder_file_ids(conn, folder)
        if not found:
            print(f"[selection] folder {folder!r} matches no audio files (check spelling and case)", file=sys.stderr)
        ids |= found
    resolved = {duplicates.get(file_id, file_id) for file_id in ids}
    if verbose:
        print_selection_summary(config, conn, resolved)
    return resolved


def print_selection_summary(config: Config, conn: sqlite3.Connection, ids: set[int]) -> None:
    selection = config.selection
    if selection is None:
        return
    sizes = {int(row["id"]): int(row["size"]) for row in conn.execute("SELECT id, size FROM files WHERE kind = 'audio'")}
    duplicates = _duplicate_targets(conn)

    def gigabytes(file_ids: set[int]) -> float:
        return sum(sizes.get(duplicates.get(i, i), 0) for i in file_ids) / 1e9

    print("[selection] what push will send:")
    if selection.playlists:
        from_playlists = playlist_file_ids(conn)
        print(f"  playlist-referenced tracks: {len(from_playlists)} ({gigabytes(from_playlists):.1f} GB)")
    per_source: dict[str, list[str]] = defaultdict(list)
    for folder in selection.folders:
        per_source[folder.partition("/")[0]].append(folder)
    for folders in per_source.values():
        for folder in folders:
            found = folder_file_ids(conn, folder)
            print(f"  {folder}: {len(found)} tracks ({gigabytes(found):.1f} GB)")
    print(f"  total after removing overlaps and duplicates: {len(ids)} tracks ({gigabytes(ids):.1f} GB)")
