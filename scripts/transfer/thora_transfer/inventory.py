"""Walk configured sources (read-only) and record files + tags in state.db."""

from __future__ import annotations

import fnmatch
import os
import sqlite3
import sys
import time
from pathlib import Path

from . import classify as cls
from .config import BUILTIN_EXCLUDES, Config, Source
from .state import finish_run, start_run
from .tags import read_tags

COMMIT_EVERY = 500


def _is_excluded(rel_path: str, patterns: list[str]) -> bool:
    candidates = (rel_path, "/" + rel_path)
    return any(fnmatch.fnmatchcase(candidate, pattern) for pattern in patterns for candidate in candidates)


def iter_source_files(source: Source):
    """Yield (rel_path, DirEntry) for every non-excluded regular file. Never follows symlinks."""
    patterns = list(BUILTIN_EXCLUDES) + list(source.exclude)
    root = source.path
    errors: list[str] = []

    def on_error(error: OSError) -> None:
        errors.append(f"{error.filename}: {error.strerror}")

    for dirpath, dirnames, filenames in os.walk(root, onerror=on_error, followlinks=False):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")

        kept = []
        for dirname in dirnames:
            rel = f"{rel_dir}/{dirname}" if rel_dir else dirname
            if not _is_excluded(f"{rel}/__dir__", patterns):
                kept.append(dirname)
        dirnames[:] = sorted(kept, key=str.casefold)

        for filename in sorted(filenames, key=str.casefold):
            rel = f"{rel_dir}/{filename}" if rel_dir else filename
            if _is_excluded(rel, patterns):
                continue
            full = os.path.join(dirpath, filename)
            try:
                if os.path.islink(full):
                    continue
                stat = os.stat(full, follow_symlinks=False)
            except OSError as error:
                errors.append(f"{full}: {error.strerror}")
                continue
            yield rel, stat

    if errors:
        yield None, errors  # sentinel carrying walk errors


def run_inventory(config: Config, conn: sqlite3.Connection, only_sources: list[str] | None = None) -> dict:
    run_id = start_run(conn, "inventory")
    summary: dict = {"sources": {}, "walk_errors": []}
    selected = [item for item in config.sources if not only_sources or item.label in only_sources]
    if not selected:
        raise SystemExit("No sources selected/configured.")

    for source in selected:
        if not source.path.is_dir():
            print(f"[inventory] SKIP {source.label}: {source.path} is not mounted/readable", file=sys.stderr)
            summary["sources"][source.label] = {"error": "not mounted"}
            continue

        print(f"[inventory] {source.label}: walking {source.path}")
        counts: dict[str, int] = {}
        sizes: dict[str, int] = {}
        tag_errors = 0
        reused = 0
        processed = 0
        started = time.monotonic()
        last_print = started

        existing = {
            row["rel_path"]: (row["id"], row["size"], row["mtime_ns"])
            for row in conn.execute("SELECT id, rel_path, size, mtime_ns FROM files WHERE source = ?", (source.label,))
        }

        for rel_path, stat in iter_source_files(source):
            if rel_path is None:
                summary["walk_errors"].extend(stat)
                continue

            kind = cls.classify(rel_path.rsplit("/", 1)[-1], config.extra_playable_exts)
            ext = cls.extension_of(rel_path)
            counts[kind] = counts.get(kind, 0) + 1
            sizes[kind] = sizes.get(kind, 0) + stat.st_size
            processed += 1

            previous = existing.get(rel_path)
            if previous and previous[1] == stat.st_size and previous[2] == stat.st_mtime_ns:
                conn.execute("UPDATE files SET last_seen_run = ?, kind = ? WHERE id = ?", (run_id, kind, previous[0]))
                reused += 1
            else:
                tag = None
                if kind in (cls.KIND_AUDIO, cls.KIND_UNSUPPORTED):
                    tag = read_tags(source.path / rel_path)
                    if tag.error:
                        tag_errors += 1
                values = (
                    source.label, rel_path, stat.st_size, stat.st_mtime_ns, kind, ext,
                    tag.title if tag else None, tag.artist if tag else None,
                    tag.album_artist if tag else None, tag.album if tag else None,
                    tag.track_no if tag else None, tag.disc_no if tag else None,
                    tag.year if tag else None, tag.genre if tag else None,
                    tag.isrc if tag else None, tag.duration_ms if tag else None,
                    tag.codec if tag else None, tag.sample_rate if tag else None,
                    tag.bits_per_sample if tag else None, tag.bitrate if tag else None,
                    tag.error if tag else None, run_id,
                )
                conn.execute(
                    """
                    INSERT INTO files (source, rel_path, size, mtime_ns, kind, ext, title, artist, album_artist,
                        album, track_no, disc_no, year, genre, isrc, duration_ms, codec, sample_rate,
                        bits_per_sample, bitrate, tag_error, last_seen_run, quick_hash, full_hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                    ON CONFLICT(source, rel_path) DO UPDATE SET
                        size = excluded.size, mtime_ns = excluded.mtime_ns, kind = excluded.kind, ext = excluded.ext,
                        title = excluded.title, artist = excluded.artist, album_artist = excluded.album_artist,
                        album = excluded.album, track_no = excluded.track_no, disc_no = excluded.disc_no,
                        year = excluded.year, genre = excluded.genre, isrc = excluded.isrc,
                        duration_ms = excluded.duration_ms, codec = excluded.codec,
                        sample_rate = excluded.sample_rate, bits_per_sample = excluded.bits_per_sample,
                        bitrate = excluded.bitrate, tag_error = excluded.tag_error,
                        last_seen_run = excluded.last_seen_run, quick_hash = NULL, full_hash = NULL
                    """,
                    values,
                )

            if processed % COMMIT_EVERY == 0:
                conn.commit()
            now = time.monotonic()
            if now - last_print >= 5:
                rate = processed / max(now - started, 0.001)
                print(f"[inventory] {source.label}: {processed} files ({rate:.0f}/s, {reused} unchanged)")
                last_print = now

        removed = conn.execute(
            "DELETE FROM files WHERE source = ? AND last_seen_run != ?", (source.label, run_id)
        ).rowcount
        conn.commit()

        summary["sources"][source.label] = {
            "files": processed,
            "unchanged": reused,
            "removed_since_last_run": removed,
            "tag_errors": tag_errors,
            "by_kind": counts,
            "bytes_by_kind": sizes,
            "seconds": round(time.monotonic() - started, 1),
        }
        audio_gb = sizes.get(cls.KIND_AUDIO, 0) / 1e9
        print(
            f"[inventory] {source.label}: {processed} files, {counts.get(cls.KIND_AUDIO, 0)} playable audio "
            f"({audio_gb:.1f} GB), {counts.get(cls.KIND_UNSUPPORTED, 0)} unsupported audio, "
            f"{counts.get(cls.KIND_PLAYLIST, 0) + counts.get(cls.KIND_PLAYLIST_CANDIDATE, 0)} playlist files, "
            f"{tag_errors} tag errors, {removed} removed"
        )

    if summary["walk_errors"]:
        print(f"[inventory] {len(summary['walk_errors'])} walk error(s); see report", file=sys.stderr)
    finish_run(conn, run_id, summary)
    return summary


def source_file_path(config: Config, source_label: str, rel_path: str) -> Path:
    return config.source(source_label).path / rel_path
