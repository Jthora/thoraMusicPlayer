"""`doctor` (local readiness) and `nas-check` (mounted share sanity + throughput)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import classify as cls
from .adb import Adb, AdbError, list_devices
from .config import Config, ConfigError, load_config
from .inventory import iter_source_files
from .tags import FFPROBE, HAVE_MUTAGEN


def _line(ok: bool | None, label: str, detail: str = "") -> bool:
    mark = {True: "OK  ", False: "FAIL", None: "WARN"}[ok]
    print(f"  [{mark}] {label}{': ' + detail if detail else ''}")
    return ok is not False


def run_doctor(config_path: str | None) -> bool:
    print("thora-transfer doctor")
    healthy = True
    healthy &= _line(sys.version_info >= (3, 11), "python >= 3.11", sys.version.split()[0])
    healthy &= _line(True if HAVE_MUTAGEN else None, "mutagen (fast tag reading)",
                     "installed" if HAVE_MUTAGEN else "missing: run scripts/transfer/setup.sh while online")
    healthy &= _line(True if FFPROBE else (None if HAVE_MUTAGEN else False), "ffprobe (fallback tags)", FFPROBE or "missing")
    _line(True if shutil.which("ffmpeg") else None, "ffmpeg (only needed for transcode profiles)",
          shutil.which("ffmpeg") or "missing")

    config: Config | None = None
    try:
        config = load_config(config_path)
        _line(True, "config", str(config.path))
    except ConfigError as error:
        healthy &= _line(False, "config", str(error).splitlines()[0])

    try:
        devices = list_devices()
        _line(bool(devices), "adb devices", ", ".join(f"{serial}={state}" for serial, state in devices) or "none")
        adb = Adb(config.device_serial if config else None)
        model = adb.getprop("ro.product.model")
        release = adb.getprop("ro.build.version.release")
        free = adb.free_bytes("/sdcard")
        _line(True, "phone", f"{adb.serial} {model} Android {release}, {free / 1e9:.1f} GB free")
    except AdbError as error:
        healthy &= _line(False, "phone", str(error))

    state_dir = config.state_dir if config else Path.home()
    probe = state_dir if state_dir.exists() else Path.home()
    usage = shutil.disk_usage(probe)
    _line(True if usage.free > 2e9 else None, "Mac free space", f"{usage.free / 1e9:.1f} GB at {probe} (music is never staged here)")

    if config:
        for source in config.sources:
            mounted = source.path.is_dir()
            _line(True if mounted else None, f"source {source.label}", f"{source.path} {'mounted' if mounted else 'not mounted yet'}")
    print("ready." if healthy else "not ready: fix FAIL items above.")
    return healthy


def _mount_info(path: Path) -> tuple[str, str, str] | None:
    """(device, mount_point, details) for the mount containing path, from `mount` output."""
    completed = subprocess.run(["mount"], capture_output=True, text=True, check=False)
    best = None
    target = str(path.resolve())
    for line in completed.stdout.splitlines():
        if " on " not in line:
            continue
        device, rest = line.split(" on ", 1)
        mount_point, _, details = rest.partition(" (")
        if target == mount_point or target.startswith(mount_point.rstrip("/") + "/"):
            if best is None or len(mount_point) > len(best[1]):
                best = (device, mount_point, details.rstrip(")"))
    return best


def run_nas_check(config: Config, sample_mb: int = 200) -> bool:
    print("thora-transfer nas-check")
    all_ok = True
    for source in config.sources:
        print(f"source {source.label}: {source.path}")
        if not source.path.is_dir():
            all_ok &= _line(False, "mounted", "path missing. Mount the share (Finder: Go > Connect to Server > smb://HOST/SHARE)")
            continue
        info = _mount_info(source.path)
        if info:
            device, mount_point, details = info
            fs_type = details.split(",")[0].strip()
            read_only = "read-only" in details
            _line(True, "mount", f"{device} on {mount_point} ({fs_type})")
            _line(True if read_only else None, "read-only",
                  "yes" if read_only else "no: the tool never writes, but a read-only mount is safer (mount_smbfs -o rdonly)")
            if fs_type not in ("smbfs", "afpfs", "nfs", "webdav"):
                _line(None, "network share", f"filesystem is {fs_type}; expected a network mount")
        try:
            top = sorted(os.listdir(source.path))[:10]
            _line(True, "readable", f"top entries: {', '.join(top) if top else '(empty)'}")
        except OSError as error:
            all_ok &= _line(False, "readable", str(error))
            continue

        # Throughput: read the first few audio files found (read-only), up to sample_mb.
        budget = sample_mb * 1024 * 1024
        read = 0
        started = time.monotonic()
        files_checked = 0
        for rel_path, stat in iter_source_files(source):
            if rel_path is None or cls.classify(rel_path) != cls.KIND_AUDIO:
                continue
            try:
                with (source.path / rel_path).open("rb") as handle:
                    while read < budget:
                        block = handle.read(4 * 1024 * 1024)
                        if not block:
                            break
                        read += len(block)
            except OSError as error:
                _line(None, "read sample", f"{rel_path}: {error}")
            files_checked += 1
            if read >= budget or files_checked >= 20:
                break
        elapsed = max(time.monotonic() - started, 0.001)
        if read:
            rate = read / elapsed / 1e6
            _line(True if rate > 20 else None, "read throughput",
                  f"{rate:.0f} MB/s over {read / 1e6:.0f} MB ({files_checked} file(s)); USB to the phone is usually ~20-40 MB/s")
        else:
            _line(None, "read throughput", "no playable audio found to sample")
    return all_ok
