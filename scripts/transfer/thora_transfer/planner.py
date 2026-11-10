"""Turn the inventory into a transfer plan: destinations, duplicates, collisions, capacity."""

from __future__ import annotations

import hashlib
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

from . import classify as cls
from .config import TRANSCODE_PROFILES, Config
from .naming import collision_key, replace_extension, sanitize_rel_path, with_suffix_counter
from .state import finish_run, start_run

QUICK_CHUNK = 64 * 1024

ACTION_COPY = "copy"
ACTION_TRANSCODE = "transcode"
ACTION_SKIP_DUPLICATE = "skip_duplicate"
ACTION_SKIP_UNSUPPORTED = "skip_unsupported"
PUSHABLE_ACTIONS = (ACTION_COPY, ACTION_TRANSCODE)


def quick_hash(path: Path, size: int) -> str:
    digest = hashlib.sha1(str(size).encode())
    with path.open("rb") as handle:
        digest.update(handle.read(QUICK_CHUNK))
        if size > QUICK_CHUNK * 2:
            handle.seek(-QUICK_CHUNK, 2)
            digest.update(handle.read(QUICK_CHUNK))
    return digest.hexdigest()


def full_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


_SCRATCH_WORDS = re.compile(
    r"(?:^|[^a-z])(?:copy|copies|dupes?|duplicates?|backup|backups|old|temp|tmp|misc|unsorted|new folder|to sort)(?:$|[^a-z])",
    re.IGNORECASE,
)
_NUMBERED_COPY = re.compile(r"(?:\s\(\d+\)|[\s_-]copy\d*)$", re.IGNORECASE)


def canonical_score(row: sqlite3.Row) -> float:
    """Higher = more likely the 'real' location when byte-identical copies exist."""
    parts = row["rel_path"].split("/")
    folders, filename = parts[:-1], parts[-1]
    stem = filename.rsplit(".", 1)[0]
    score = min(len(folders), 3) * 1.0  # Artist/Album/Track beats a loose file
    if any(_SCRATCH_WORDS.search(folder) for folder in folders) or _SCRATCH_WORDS.search(stem):
        score -= 5
    if _NUMBERED_COPY.search(stem):
        score -= 3
    album = (row["album"] or "").casefold().strip()
    if album and folders and folders[-1].casefold().strip() == album:
        score += 2
    if re.match(r"^\d{1,3}\D", stem):
        score += 0.5
    return score


def _estimate_transcoded_bytes(duration_ms: int | None, profile: str) -> int:
    kbps = {"opus192": 192, "opus128": 128, "aac256": 256}.get(profile, 256)
    seconds = (duration_ms or 240_000) / 1000
    return int(seconds * kbps * 1000 / 8 * 1.03)


def build_plan(config: Config, conn: sqlite3.Connection) -> dict:
    run_id = start_run(conn, "plan")
    order = {source.label: index for index, source in enumerate(config.sources)}
    rows = [
        row
        for row in conn.execute(
            "SELECT * FROM files WHERE kind IN (?, ?)", (cls.KIND_AUDIO, cls.KIND_UNSUPPORTED)
        )
        if row["source"] in order
    ]
    rows.sort(key=lambda row: (order[row["source"]], row["rel_path"].casefold()))

    actions: dict[int, dict] = {}
    hash_errors: list[str] = []

    for row in rows:
        if row["kind"] == cls.KIND_UNSUPPORTED:
            actions[row["id"]] = {"action": ACTION_SKIP_UNSUPPORTED, "dest_rel": None, "dup": None, "note": row["ext"]}

    # Exact-duplicate detection: size -> quick hash -> full hash.
    audio = [row for row in rows if row["kind"] == cls.KIND_AUDIO]
    by_size: dict[int, list[sqlite3.Row]] = defaultdict(list)
    for row in audio:
        by_size[row["size"]].append(row)

    def hashed(row: sqlite3.Row, column: str) -> str | None:
        if row[column]:
            return row[column]
        path = config.source(row["source"]).path / row["rel_path"]
        try:
            value = quick_hash(path, row["size"]) if column == "quick_hash" else full_hash(path)
        except OSError as error:
            hash_errors.append(f"{row['source']}/{row['rel_path']}: {error}")
            return None
        conn.execute(f"UPDATE files SET {column} = ? WHERE id = ?", (value, row["id"]))
        return value

    duplicate_of: dict[int, int] = {}
    for size, group in by_size.items():
        if len(group) < 2:
            continue
        by_quick: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in group:
            value = hashed(row, "quick_hash")
            if value:
                by_quick[value].append(row)
        for quick_group in by_quick.values():
            if len(quick_group) < 2:
                continue
            by_full: dict[str, list[sqlite3.Row]] = defaultdict(list)
            for row in quick_group:
                value = hashed(row, "full_hash")
                if value:
                    by_full[value].append(row)
            for full_group in by_full.values():
                if len(full_group) < 2:
                    continue
                # Source priority first, then the most canonical-looking path.
                ranked = sorted(
                    full_group,
                    key=lambda item: (order[item["source"]], -canonical_score(item), item["rel_path"].casefold()),
                )
                keeper = ranked[0]
                for other in ranked[1:]:
                    duplicate_of[other["id"]] = keeper["id"]
    conn.commit()

    taken: dict[str, int] = {}
    renamed = 0
    for row in audio:
        if row["id"] in duplicate_of:
            keeper = duplicate_of[row["id"]]
            actions[row["id"]] = {"action": ACTION_SKIP_DUPLICATE, "dest_rel": None, "dup": keeper, "note": None}
            continue

        source = config.source(row["source"])
        dest = f"{source.label}/{sanitize_rel_path(row['rel_path'])}"
        action = ACTION_COPY
        note = None
        is_lossless = row["ext"] in ("flac", "wav") or (row["codec"] or "") in ("alac", "pcm", "flac")
        if source.transcode and is_lossless:
            action = ACTION_TRANSCODE
            dest = replace_extension(dest, TRANSCODE_PROFILES[source.transcode][1])
            note = source.transcode

        if dest != f"{source.label}/{row['rel_path']}":
            note = (note + "; " if note else "") + "renamed for phone"
        key = collision_key(dest)
        if key in taken:
            counter = 2
            candidate = with_suffix_counter(dest, counter)
            while collision_key(candidate) in taken:
                counter += 1
                candidate = with_suffix_counter(dest, counter)
            dest = candidate
            key = collision_key(dest)
            note = (note + "; " if note else "") + "case/name collision"
            renamed += 1
        taken[key] = row["id"]
        actions[row["id"]] = {"action": action, "dest_rel": dest, "dup": None, "note": note}

    conn.execute("DELETE FROM plan")
    conn.executemany(
        "INSERT INTO plan(file_id, dest_rel, action, duplicate_of, note) VALUES (?, ?, ?, ?, ?)",
        [(file_id, item["dest_rel"], item["action"], item["dup"], item["note"]) for file_id, item in actions.items()],
    )
    conn.commit()

    summary = summarize_plan(config, conn)
    summary["collisions_renamed"] = renamed
    summary["hash_errors"] = hash_errors
    finish_run(conn, run_id, summary)
    return summary


def summarize_plan(config: Config, conn: sqlite3.Connection) -> dict:
    per_source: dict[str, dict] = {}
    pending_bytes = 0
    on_device = 0
    for row in conn.execute(
        """
        SELECT f.source, f.size, f.mtime_ns, f.duration_ms, p.action, p.dest_rel, p.note,
               s.src_size AS pushed_size, s.src_mtime_ns AS pushed_mtime
        FROM plan p JOIN files f ON f.id = p.file_id
        LEFT JOIN pushes s ON s.dest_rel = p.dest_rel
        """
    ):
        stats = per_source.setdefault(row["source"], defaultdict(int))
        stats[f"{row['action']}_count"] += 1
        stats[f"{row['action']}_bytes"] += row["size"]
        if row["action"] in PUSHABLE_ACTIONS:
            already = row["pushed_size"] == row["size"] and row["pushed_mtime"] == row["mtime_ns"]
            if already:
                on_device += 1
            else:
                if row["action"] == ACTION_TRANSCODE:
                    pending_bytes += _estimate_transcoded_bytes(row["duration_ms"], row["note"].split(";")[0])
                else:
                    pending_bytes += row["size"]
    return {
        "per_source": {label: dict(values) for label, values in per_source.items()},
        "pending_bytes": pending_bytes,
        "files_already_on_device": on_device,
    }


def print_plan_summary(config: Config, summary: dict, free_bytes: int | None) -> bool:
    print("[plan] per source:")
    for label, stats in summary["per_source"].items():
        copy_gb = stats.get("copy_bytes", 0) / 1e9
        print(
            f"  {label}: copy {stats.get('copy_count', 0)} ({copy_gb:.1f} GB), "
            f"transcode {stats.get('transcode_count', 0)}, "
            f"duplicates skipped {stats.get('skip_duplicate_count', 0)}, "
            f"unsupported skipped {stats.get('skip_unsupported_count', 0)}"
        )
    if summary.get("collisions_renamed"):
        print(f"[plan] {summary['collisions_renamed']} destination name collision(s) renamed with ' (n)'")
    if summary.get("hash_errors"):
        print(f"[plan] {len(summary['hash_errors'])} file(s) could not be hashed (NAS read errors)", file=sys.stderr)

    pending_gb = summary["pending_bytes"] / 1e9
    print(f"[plan] still to push: {pending_gb:.1f} GB ({summary['files_already_on_device']} file(s) already on phone)")
    if free_bytes is None:
        print("[plan] phone not connected: capacity not checked")
        return True
    budget = free_bytes - int(config.headroom_gb * 1e9)
    print(f"[plan] phone free: {free_bytes / 1e9:.1f} GB, headroom {config.headroom_gb:.0f} GB -> budget {budget / 1e9:.1f} GB")
    if summary["pending_bytes"] > budget:
        print(
            "[plan] DOES NOT FIT. Options: drop or narrow a source (exclude globs), push one source at a time "
            "with `push --source`, or set `transcode = \"opus192\"` on a lossless-heavy source.",
            file=sys.stderr,
        )
        return False
    print("[plan] fits.")
    return True
