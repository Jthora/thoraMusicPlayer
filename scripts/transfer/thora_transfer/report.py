"""`report`: what's on the NAS, what's planned, what's on the phone, what MediaStore sees."""

from __future__ import annotations

import json
import sqlite3
import time
from collections import Counter, defaultdict

from . import classify as cls
from .adb import Adb, AdbError, device_relative_prefix
from .config import Config
from .planner import PUSHABLE_ACTIONS


def run_report(config: Config, conn: sqlite3.Connection, adb: Adb | None) -> dict:
    report: dict = {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "sources": {}}

    for row in conn.execute("SELECT source, kind, COUNT(*) AS n, SUM(size) AS bytes FROM files GROUP BY source, kind"):
        report["sources"].setdefault(row["source"], {})[row["kind"]] = {"files": row["n"], "bytes": row["bytes"] or 0}

    codecs = Counter()
    hires = 0
    for row in conn.execute("SELECT codec, sample_rate, bits_per_sample FROM files WHERE kind = ?", (cls.KIND_AUDIO,)):
        codecs[row["codec"] or "unknown"] += 1
        if (row["sample_rate"] or 0) > 48000 or (row["bits_per_sample"] or 0) > 16:
            hires += 1
    report["codecs"] = dict(codecs.most_common())
    report["hires_tracks"] = hires

    report["unsupported_examples"] = [
        f"{row['source']}/{row['rel_path']}"
        for row in conn.execute("SELECT source, rel_path FROM files WHERE kind = ? LIMIT 25", (cls.KIND_UNSUPPORTED,))
    ]
    report["tag_errors"] = conn.execute("SELECT COUNT(*) FROM files WHERE tag_error IS NOT NULL AND kind = ?",
                                        (cls.KIND_AUDIO,)).fetchone()[0]
    report["missing_core_tags"] = conn.execute(
        "SELECT COUNT(*) FROM files WHERE kind = ? AND (title IS NULL OR artist IS NULL OR album IS NULL)",
        (cls.KIND_AUDIO,),
    ).fetchone()[0]

    actions = defaultdict(lambda: {"files": 0, "bytes": 0})
    for row in conn.execute("SELECT p.action, COUNT(*) AS n, SUM(f.size) AS bytes FROM plan p JOIN files f ON f.id = p.file_id GROUP BY p.action"):
        actions[row["action"]] = {"files": row["n"], "bytes": row["bytes"] or 0}
    report["plan"] = dict(actions)
    report["renamed_for_phone"] = conn.execute("SELECT COUNT(*) FROM plan WHERE note LIKE '%renamed%' OR note LIKE '%collision%'").fetchone()[0]

    planned = conn.execute(
        "SELECT COUNT(*) FROM plan WHERE action IN (?, ?)", PUSHABLE_ACTIONS
    ).fetchone()[0]
    pushed = conn.execute("SELECT COUNT(*) FROM pushes").fetchone()[0]
    report["transfer"] = {"planned_files": planned, "recorded_pushes": pushed}

    if adb is not None:
        try:
            device_files = adb.list_files(config.phone_root)
            audio_on_phone = [path for path in device_files if cls.classify(path.rsplit("/", 1)[-1]) == cls.KIND_AUDIO]
            report["phone"] = {
                "files_under_root": len(device_files),
                "audio_under_root": len(audio_on_phone),
                "bytes_under_root": sum(item.size for item in device_files.values()),
                "mediastore_audio_rows": adb.media_count(device_relative_prefix(config.phone_root)),
                "free_bytes": adb.free_bytes("/sdcard"),
            }
        except AdbError as error:
            report["phone"] = {"error": str(error)}

    for row in conn.execute("SELECT command, finished_at, summary_json FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 6"):
        report.setdefault("recent_runs", []).append(
            {"command": row["command"], "finished_at": row["finished_at"], "summary": json.loads(row["summary_json"] or "{}")}
        )

    out_dir = config.reports_dir / time.strftime("%Y%m%d-%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    print("thora-transfer report")
    for label, kinds in report["sources"].items():
        audio = kinds.get(cls.KIND_AUDIO, {"files": 0, "bytes": 0})
        print(f"  {label}: {audio['files']} playable ({audio['bytes'] / 1e9:.1f} GB), "
              f"{kinds.get(cls.KIND_UNSUPPORTED, {}).get('files', 0)} unsupported, "
              f"{kinds.get(cls.KIND_PLAYLIST, {}).get('files', 0) + kinds.get(cls.KIND_PLAYLIST_CANDIDATE, {}).get('files', 0)} playlist files")
    if report["codecs"]:
        print("  codecs: " + ", ".join(f"{codec}={count}" for codec, count in report["codecs"].items()) + f"; hi-res={hires}")
    print(f"  tag problems: {report['tag_errors']} unreadable, {report['missing_core_tags']} missing title/artist/album")
    print("  plan: " + ", ".join(f"{action}={values['files']}" for action, values in report["plan"].items()))
    print(f"  transfer: {pushed}/{planned} planned files recorded as pushed")
    phone = report.get("phone")
    if phone and "error" not in phone:
        print(f"  phone: {phone['audio_under_root']} audio files under {config.phone_root}, "
              f"MediaStore sees {phone['mediastore_audio_rows']}, {phone['free_bytes'] / 1e9:.1f} GB free")
        if phone["mediastore_audio_rows"] < phone["audio_under_root"]:
            print("  note: MediaStore is behind the files on disk; run `push` again (it rescans) or wait a minute")
    print(f"  saved: {out_dir / 'report.json'}")
    return report


def pull_playlists(config: Config, adb: Adb) -> str:
    remote = f"{config.phone_playlists_dir}/exported"
    target = config.state_dir / "playlists" / "pulled" / time.strftime("%Y%m%d-%H%M%S")
    target.mkdir(parents=True, exist_ok=True)
    listing = adb.list_files(remote)
    if not listing:
        print(f"[pull-playlists] nothing under {remote} (export playlists from the app first)")
        return str(target)
    adb.pull(remote + "/.", str(target))
    print(f"[pull-playlists] pulled {len(listing)} file(s) to {target}")
    return str(target)
