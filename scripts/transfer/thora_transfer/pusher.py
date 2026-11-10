"""Push planned files to the phone, verify sizes, resume safely, rescan MediaStore."""

from __future__ import annotations

import hashlib
import os
import shlex
import shutil
import sqlite3
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

from .adb import Adb, AdbError
from .config import TRANSCODE_PROFILES, Config
from .planner import ACTION_COPY, ACTION_TRANSCODE, PUSHABLE_ACTIONS
from .selection import selected_file_ids
from .state import finish_run, start_run


def _planned_rows(conn: sqlite3.Connection, only_sources: list[str] | None, selected: set[int] | None = None) -> list[sqlite3.Row]:
    rows = conn.execute(
        """
        SELECT p.dest_rel, p.action, p.note, f.id AS file_id, f.source, f.rel_path, f.size, f.mtime_ns
        FROM plan p JOIN files f ON f.id = p.file_id
        WHERE p.action IN (?, ?)
        ORDER BY p.dest_rel
        """,
        PUSHABLE_ACTIONS,
    ).fetchall()
    if only_sources:
        rows = [row for row in rows if row["source"] in only_sources]
    if selected is not None:
        rows = [row for row in rows if row["file_id"] in selected]
    return rows


def _record_push(conn: sqlite3.Connection, row: sqlite3.Row, device_size: int) -> None:
    conn.execute(
        """
        INSERT INTO pushes(dest_rel, file_id, src_size, src_mtime_ns, device_size, pushed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(dest_rel) DO UPDATE SET file_id = excluded.file_id, src_size = excluded.src_size,
            src_mtime_ns = excluded.src_mtime_ns, device_size = excluded.device_size, pushed_at = excluded.pushed_at
        """,
        (row["dest_rel"], row["file_id"], row["size"], row["mtime_ns"], device_size, int(time.time())),
    )


def _transcode(config: Config, src: Path, row: sqlite3.Row) -> Path:
    profile = (row["note"] or "").split(";")[0].strip()
    codec_args, ext = TRANSCODE_PROFILES[profile]
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found for transcoding")
    config.tmp_dir.mkdir(parents=True, exist_ok=True)
    out = config.tmp_dir / f"transcode-{row['file_id']}.{ext}"
    completed = subprocess.run(
        [ffmpeg, "-nostdin", "-v", "error", "-y", "-i", str(src), "-map", "0:a:0", "-map_metadata", "0", *codec_args, str(out)],
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        out.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg failed: {completed.stderr.decode('utf-8', 'replace')[-300:]}")
    mtime = row["mtime_ns"] / 1e9
    os.utime(out, (mtime, mtime))
    return out


def _md5_local(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_push(
    config: Config,
    conn: sqlite3.Connection,
    adb: Adb,
    only_sources: list[str] | None = None,
    dry_run: bool = False,
    verify_hash: bool = False,
    max_gb: float | None = None,
    scan: bool = True,
) -> dict:
    root = config.phone_root
    selected = selected_file_ids(config, conn, verbose=True)
    rows = _planned_rows(conn, only_sources, selected)
    if not rows:
        raise SystemExit("Nothing planned (or nothing selected). Run `inventory`, `plan` and `playlists` first.")

    print(f"[push] listing existing files under {root} ...")
    device = adb.list_files(root)
    pushes = {row["dest_rel"]: row for row in conn.execute("SELECT * FROM pushes")}

    todo: list[sqlite3.Row] = []
    already = 0
    for row in rows:
        remote = f"{root}/{row['dest_rel']}"
        on_device = device.get(remote)
        record = pushes.get(row["dest_rel"])
        if on_device and record and record["src_size"] == row["size"] and record["src_mtime_ns"] == row["mtime_ns"] \
                and on_device.size == record["device_size"]:
            already += 1
            continue
        if on_device and row["action"] == ACTION_COPY and on_device.size == row["size"] \
                and abs(on_device.mtime - row["mtime_ns"] // 1_000_000_000) <= 2:
            _record_push(conn, row, on_device.size)  # adopt a file pushed earlier by other means
            already += 1
            continue
        todo.append(row)
    conn.commit()

    pending = sum(row["size"] for row in todo)
    if max_gb is not None:
        limit = int(max_gb * 1e9)
        selected, used = [], 0
        for row in todo:
            if used + row["size"] > limit:
                break
            selected.append(row)
            used += row["size"]
        todo, pending = selected, used

    free = adb.free_bytes("/sdcard")
    budget = free - int(config.headroom_gb * 1e9)
    print(
        f"[push] {already} already on phone, {len(todo)} to push ({pending / 1e9:.2f} GB); "
        f"phone free {free / 1e9:.1f} GB, budget {budget / 1e9:.1f} GB"
    )
    if pending > budget:
        raise SystemExit(
            "[push] Not enough space on the phone. Use --source <label>, --max-gb N, or a transcode profile."
        )
    if dry_run:
        for row in todo[:40]:
            print(f"  + {row['dest_rel']}  ({row['size'] / 1e6:.1f} MB{', ' + row['action'] if row['action'] != ACTION_COPY else ''})")
        if len(todo) > 40:
            print(f"  ... and {len(todo) - 40} more")
        return {"dry_run": True, "to_push": len(todo), "bytes": pending, "already": already}

    run_id = start_run(conn, "push")
    by_dir: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in todo:
        by_dir[row["dest_rel"].rpartition("/")[0]].append(row)
    adb.mkdirs([f"{root}/{directory}" if directory else root for directory in by_dir])

    pushed = 0
    pushed_bytes = 0
    failures: list[str] = []
    started = time.monotonic()
    try:
        for index, (directory, group) in enumerate(sorted(by_dir.items()), start=1):
            remote_dir = f"{root}/{directory}" if directory else root
            batch_started = time.monotonic()
            expected: dict[str, tuple[sqlite3.Row, int, Path]] = {}

            same_name: list[sqlite3.Row] = []
            for row in group:
                src = config.source(row["source"]).path / row["rel_path"]
                remote = f"{root}/{row['dest_rel']}"
                if row["action"] == ACTION_TRANSCODE:
                    out: Path | None = None
                    try:
                        out = _transcode(config, src, row)
                        adb.push_file(str(out), remote)
                        expected[remote] = (row, out.stat().st_size, src)
                    except (RuntimeError, AdbError, OSError) as error:
                        failures.append(f"{row['dest_rel']}: {error}")
                    finally:
                        if out is not None:
                            out.unlink(missing_ok=True)  # Mac disk is tight: never keep transcodes
                    continue
                expected[remote] = (row, row["size"], src)
                if row["rel_path"].rpartition("/")[2] == row["dest_rel"].rpartition("/")[2]:
                    same_name.append(row)
                else:
                    try:
                        adb.push_file(str(src), remote)
                    except AdbError as error:
                        failures.append(f"{row['dest_rel']}: {error}")

            if same_name:
                try:
                    adb.push_into_dir(
                        [str(config.source(row["source"]).path / row["rel_path"]) for row in same_name], remote_dir
                    )
                except AdbError as error:
                    print(f"[push] batch error in {directory}: {error}; retrying files individually", file=sys.stderr)
                    for row in same_name:
                        try:
                            adb.push_file(str(config.source(row["source"]).path / row["rel_path"]), f"{root}/{row['dest_rel']}")
                        except AdbError as inner:
                            failures.append(f"{row['dest_rel']}: {inner}")

            stats = adb.stat_files(list(expected))
            for remote, (row, size, src) in expected.items():
                found = stats.get(remote)
                if not found or found.size != size:
                    if row["action"] == ACTION_COPY:
                        try:  # never trust --sync after an interrupted write; re-push explicitly
                            adb.push_file(str(src), remote)
                            found = adb.stat_files([remote]).get(remote)
                        except AdbError as error:
                            failures.append(f"{row['dest_rel']}: {error}")
                            continue
                    if not found or found.size != size:
                        failures.append(f"{row['dest_rel']}: size mismatch on phone ({found.size if found else 'missing'} != {size})")
                        continue
                _record_push(conn, row, found.size)
                pushed += 1
                pushed_bytes += size

            if verify_hash and expected:
                remote, (row, _, src) = next(iter(expected.items()))
                if row["action"] == ACTION_COPY:
                    device_md5 = adb.shell(f"md5sum {shlex.quote(remote)}").split()[:1]
                    if not device_md5 or device_md5[0] != _md5_local(src):
                        failures.append(f"{row['dest_rel']}: md5 mismatch")

            conn.commit()
            elapsed = max(time.monotonic() - batch_started, 0.001)
            batch_bytes = sum(size for _, size, _ in expected.values())
            total_rate = pushed_bytes / max(time.monotonic() - started, 0.001) / 1e6
            print(
                f"[push] [{index}/{len(by_dir)}] {directory or '.'}: {len(group)} file(s), "
                f"{batch_bytes / 1e6:.0f} MB @ {batch_bytes / elapsed / 1e6:.1f} MB/s (avg {total_rate:.1f} MB/s)"
            )
    except KeyboardInterrupt:
        conn.commit()
        print("\n[push] interrupted; progress saved. Re-run `push` to resume.", file=sys.stderr)
        raise

    scan_result = None
    if scan and pushed:
        print("[push] asking MediaStore to rescan ...")
        scan_result = adb.media_scan()

    summary = {
        "pushed": pushed,
        "pushed_bytes": pushed_bytes,
        "already_on_phone": already,
        "failures": failures,
        "seconds": round(time.monotonic() - started, 1),
        "media_scan": scan_result,
    }
    finish_run(conn, run_id, summary)
    print(f"[push] done: {pushed} pushed ({pushed_bytes / 1e9:.2f} GB), {len(failures)} failure(s)")
    for failure in failures[:20]:
        print(f"  ! {failure}", file=sys.stderr)
    return summary


def run_prune(config: Config, conn: sqlite3.Connection, adb: Adb, apply: bool = False) -> dict:
    root = config.phone_root
    planned = {
        f"{root}/{row['dest_rel']}"
        for row in conn.execute("SELECT dest_rel FROM plan WHERE action IN (?, ?)", PUSHABLE_ACTIONS)
    }
    if not planned:
        raise SystemExit("Refusing to prune with an empty plan (it would delete everything).")
    protected = f"{root}/_playlists/"
    device = adb.list_files(root)
    extra = sorted(path for path in device if path not in planned and not path.startswith(protected))
    print(f"[prune] {len(extra)} file(s) on the phone under {root} are not in the current plan")
    for path in extra[:50]:
        print(f"  - {path}")
    if len(extra) > 50:
        print(f"  ... and {len(extra) - 50} more")
    if not apply:
        print("[prune] dry run. Re-run with --apply to delete them.")
        return {"would_delete": len(extra)}
    adb.remove_files(extra)
    conn.executemany(
        "DELETE FROM pushes WHERE dest_rel = ?", [(path[len(root) + 1 :],) for path in extra]
    )
    conn.commit()
    adb.remove_empty_dirs(root)
    adb.media_scan()
    print(f"[prune] deleted {len(extra)} file(s) and rescanned")
    return {"deleted": len(extra)}
