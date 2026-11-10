"""CLI: python -m thora_transfer <command> [options]  (see scripts/transfer/README.md)."""

from __future__ import annotations

import argparse
import sys

from .adb import Adb, AdbError
from .config import ConfigError, load_config
from .state import connect


def _adb(config, required: bool = True):
    try:
        return Adb(config.device_serial)
    except AdbError as error:
        if required:
            raise SystemExit(f"adb: {error}")
        print(f"(phone not available: {error})", file=sys.stderr)
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="thora-transfer", description="NAS -> Mac -> Redmi A3 music transfer + playlist repair")
    parser.add_argument("--config", help="path to thora-transfer.toml (default: scripts/transfer/thora-transfer.toml)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", help="check tools, config, phone")
    nas = sub.add_parser("nas-check", help="check mounted sources: mount type, read-only, throughput")
    nas.add_argument("--sample-mb", type=int, default=200)

    inv = sub.add_parser("inventory", help="walk sources (read-only), read tags, record in state.db")
    inv.add_argument("--source", action="append", help="limit to source label (repeatable)")

    sub.add_parser("plan", help="compute phone paths, duplicates, collisions, capacity")

    push = sub.add_parser("push", help="push planned files to the phone, verify, rescan")
    push.add_argument("--source", action="append", help="limit to source label (repeatable)")
    push.add_argument("--dry-run", action="store_true")
    push.add_argument("--max-gb", type=float, help="push at most this many GB this run")
    push.add_argument("--verify-hash", action="store_true", help="md5 spot-check one file per folder")
    push.add_argument("--no-scan", action="store_true", help="skip the MediaStore rescan")

    prune = sub.add_parser("prune", help="list (or --apply delete) phone files not in the plan")
    prune.add_argument("--apply", action="store_true")

    playlists = sub.add_parser("playlists", help="repair/recreate playlists against the planned library")
    playlists.add_argument("--input", action="append", default=[], help="extra playlist file or folder (repeatable; .txt = 'Artist - Title' lines)")
    playlists.add_argument("--apply-review", help="review.csv with the 'choice' column filled in")
    playlists.add_argument("--push", action="store_true", help="push the generated .m3u8 files to <phone_root>/_playlists")

    sub.add_parser("report", help="summarize NAS, plan, phone and MediaStore state")
    rosters = sub.add_parser("spotify-rosters", help="recover public Spotify playlist rosters as CSV (no account needed)")
    rosters.add_argument("--rosters-json", default="~/ThoraTransfer/spotify/playlist-rosters.json")
    rosters.add_argument("--out", default="~/ThoraTransfer/spotify/rosters")
    rosters.add_argument("--only", action="append", help="playlist id or name (repeatable)")
    rosters.add_argument("--delay", type=float, default=1.5, help="seconds between requests")
    sub.add_parser("pull-playlists", help="adb pull playlists exported by the app back to the Mac")

    args = parser.parse_args(argv)

    if args.command == "doctor":
        from .checks import run_doctor

        return 0 if run_doctor(args.config) else 1

    if args.command == "spotify-rosters":
        from pathlib import Path

        from .spotify_rosters import fetch_rosters

        summary = fetch_rosters(Path(args.rosters_json).expanduser(), Path(args.out).expanduser(), args.delay, args.only)
        return 0 if summary["ok"] else 1

    try:
        config = load_config(args.config)
    except ConfigError as error:
        raise SystemExit(f"config: {error}")

    if args.command == "nas-check":
        from .checks import run_nas_check

        return 0 if run_nas_check(config, args.sample_mb) else 1

    conn = connect(config.db_path)
    try:
        if args.command == "inventory":
            from .inventory import run_inventory

            run_inventory(config, conn, args.source)
        elif args.command == "plan":
            from .planner import build_plan, print_plan_summary

            summary = build_plan(config, conn)
            adb = _adb(config, required=False)
            fits = print_plan_summary(config, summary, adb.free_bytes("/sdcard") if adb else None)
            return 0 if fits else 2
        elif args.command == "push":
            from .pusher import run_push

            summary = run_push(config, conn, _adb(config), args.source, args.dry_run, args.verify_hash,
                               args.max_gb, scan=not args.no_scan)
            return 1 if summary.get("failures") else 0
        elif args.command == "prune":
            from .pusher import run_prune

            run_prune(config, conn, _adb(config), apply=args.apply)
        elif args.command == "playlists":
            from .playlists.command import push_playlists, run_playlists

            run_playlists(config, conn, args.input, args.apply_review)
            if config.selection is not None:
                from .selection import selected_file_ids

                selected_file_ids(config, conn, verbose=True)
            if args.push:
                push_playlists(config, _adb(config))
        elif args.command == "report":
            from .report import run_report

            run_report(config, conn, _adb(config, required=False))
        elif args.command == "pull-playlists":
            from .report import pull_playlists

            pull_playlists(config, _adb(config))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
