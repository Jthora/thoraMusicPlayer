#!/usr/bin/env python3
"""Tho'ra on-device test harness (Redmi A3 over USB).

Drives the real app through adb: system media keys (the same MediaSession path Bluetooth,
the lock screen and the notification use), the UI via uiautomator, and Android's own process
records. Nothing here needs root or a debuggable build.

Commands:
  fixtures   generate tagged test tracks (plus one corrupt file) and push them to the phone
  functional playback checklist: start, position, pause/resume, seek, next/previous, repeat,
             shuffle, corrupt-file skip, notification, kill + media-button resume, Doze, UI churn
  soak       play for N minutes with the screen off, sampling memory, threads and playback
  cleanup    remove the fixtures from the phone

Every run writes a report directory (JSON + Markdown + raw logs). Music volume is set to 0
for the run and restored afterwards.
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

PKG = "com.thoraplayer"
ACTIVITY = f"{PKG}/.MainActivity"
DEVICE_FIXTURE_DIR = "/sdcard/Music/Thora-test"
DIAG_LOG = f"/sdcard/Android/data/{PKG}/files/diagnostics/events.jsonl"
UI_DUMP = "/sdcard/thora-ui.xml"
FIXTURE_COUNT = 12
FIXTURE_SECONDS = 30
CORRUPT_INDEX = 5
FIXTURE_ARTIST = "Thora Fixtures"
FIXTURE_ALBUM = "Thora Device Test"
DEFAULT_ADB = "/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


def title_of(index: int) -> str:
    return f"Thora Test {index:02d}"


# ---------------------------------------------------------------------------------------------
# adb


class CheckFailed(Exception):
    pass


class Adb:
    def __init__(self, serial: str | None):
        self.binary = shutil.which("adb") or DEFAULT_ADB
        devices = self._devices()
        ready = [s for s, state in devices if state == "device"]
        if serial:
            if serial not in ready:
                sys.exit(f"Device {serial} not ready; adb sees {devices}")
            self.serial = serial
        elif len(ready) == 1:
            self.serial = ready[0]
        else:
            sys.exit(f"Need exactly one device (or --serial); adb sees {devices}")

    def _devices(self) -> list[tuple[str, str]]:
        out = subprocess.run([self.binary, "devices"], capture_output=True, text=True).stdout
        return [tuple(line.split()[:2]) for line in out.splitlines()[1:] if len(line.split()) >= 2]

    def run(self, *args: str, timeout: float = 120, check: bool = True) -> str:
        completed = subprocess.run(
            [self.binary, "-s", self.serial, *args], capture_output=True, timeout=timeout
        )
        out = completed.stdout.decode("utf-8", "replace")
        if check and completed.returncode != 0:
            err = completed.stderr.decode("utf-8", "replace").strip()
            raise CheckFailed(f"adb {' '.join(args)[:120]} failed: {err or out.strip()}")
        return out

    def shell(self, command: str, timeout: float = 120, check: bool = True) -> str:
        return self.run("shell", command, timeout=timeout, check=check)

    def key(self, name: str) -> None:
        self.shell(f"cmd media_session dispatch {name}")

    def keyevent(self, code: str) -> None:
        self.shell(f"input keyevent {code}")


# ---------------------------------------------------------------------------------------------
# Session state from `dumpsys media_session`


@dataclass
class Session:
    state: str
    position_ms: int
    title: str | None
    active: bool
    controllers: int | None = None

    @property
    def playing(self) -> bool:
        return self.state == "PLAYING"


_STATE_NAMES = {
    "0": "NONE", "1": "STOPPED", "2": "PAUSED", "3": "PLAYING", "4": "FAST_FORWARDING",
    "5": "REWINDING", "6": "BUFFERING", "7": "ERROR", "8": "CONNECTING",
    "9": "SKIPPING_TO_PREVIOUS", "10": "SKIPPING_TO_NEXT", "11": "SKIPPING_TO_QUEUE_ITEM",
}


def session(adb: Adb) -> Session | None:
    """Our session's state with the position projected to now (dumpsys + uptime in one call)."""
    out = adb.shell("dumpsys media_session; echo THORA_UPTIME $(cut -d' ' -f1 /proc/uptime)")
    uptime_ms = 0
    match = re.search(r"THORA_UPTIME ([\d.]+)", out)
    if match:
        uptime_ms = int(float(match.group(1)) * 1000)
    blocks = re.split(r"\n(?=  \S)", out)
    block = next((b for b in blocks if f"package={PKG}" in b), None)
    if block is None:
        return None
    state_match = re.search(
        r"state=PlaybackState \{state=(?:([A-Z_]+)\((\d+)\)|(\d+))?, position=(-?\d+),"
        r" buffered position=-?\d+, speed=([\d.]+), updated=(\d+)",
        block,
    )
    controllers_match = re.search(r"controllers: (\d+)", block)
    controllers = int(controllers_match.group(1)) if controllers_match else None
    if not state_match:
        return Session(state="NONE", position_ms=0, title=None, active="active=true" in block, controllers=controllers)
    name, num_a, num_b, position, speed, updated = state_match.groups()
    state = name or _STATE_NAMES.get(num_a or num_b or "0", "UNKNOWN")
    position_ms = int(position)
    if state == "PLAYING" and uptime_ms:
        position_ms += int((uptime_ms - int(updated)) * float(speed))
    title = None
    meta = re.search(r"metadata: size=\d+, description=([^\n]*)", block)
    if meta:
        title = meta.group(1).split(", ")[0].strip() or None
    return Session(state=state, position_ms=position_ms, title=title, active="active=true" in block, controllers=controllers)


def wait_for(description: str, probe: Callable[[], object], timeout: float, interval: float = 0.5):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = probe()
        if last:
            return last
        time.sleep(interval)
    raise CheckFailed(f"timed out after {timeout:.0f}s waiting for {description} (last: {last!r})")


def wait_session(adb: Adb, description: str, predicate: Callable[[Session], bool], timeout: float = 15) -> Session:
    def probe():
        s = session(adb)
        return s if s and predicate(s) else None

    try:
        return wait_for(description, probe, timeout)
    except CheckFailed as error:
        raise CheckFailed(f"{error}; session now: {session(adb)}") from None


# ---------------------------------------------------------------------------------------------
# UI via uiautomator


@dataclass
class Node:
    text: str
    rid: str
    desc: str
    bounds: tuple[int, int, int, int]

    @property
    def center(self) -> tuple[int, int]:
        x1, y1, x2, y2 = self.bounds
        return (x1 + x2) // 2, (y1 + y2) // 2


def ui_nodes(adb: Adb) -> list[Node]:
    """The current screen. While music plays the progress bar keeps the UI from ever idling, which
    makes uiautomator fail; then pause for the dump and resume, rather than give up."""
    try:
        return _dump_nodes(adb, attempts=2)
    except CheckFailed:
        s = session(adb)
        if not (s and s.playing):
            raise
    adb.key("pause")
    try:
        return _dump_nodes(adb, attempts=4)
    finally:
        adb.key("play")


def _dump_nodes(adb: Adb, attempts: int) -> list[Node]:
    # Delete the old dump first: when uiautomator can't get an idle UI it fails without rewriting
    # the file, and reading it would return a stale screen.
    for _ in range(attempts):
        out = adb.shell(f"rm -f {UI_DUMP}; uiautomator dump {UI_DUMP} >/dev/null 2>&1; cat {UI_DUMP} 2>/dev/null", check=False)
        start = out.find("<?xml")
        if start >= 0:
            root = ET.fromstring(out[start:].strip())
            nodes = []
            for el in root.iter("node"):
                numbers = [int(n) for n in re.findall(r"-?\d+", el.get("bounds", ""))]
                if len(numbers) == 4:
                    nodes.append(Node(el.get("text", ""), el.get("resource-id", ""), el.get("content-desc", ""), tuple(numbers)))
            return nodes
        time.sleep(1)
    raise CheckFailed("uiautomator dump failed repeatedly")


def find(nodes: list[Node], *, text: str | None = None, prefix: str | None = None, rid: str | None = None, desc: str | None = None) -> Node | None:
    for node in nodes:
        if not visible(node):
            continue
        if text is not None and node.text != text:
            continue
        if prefix is not None and not node.text.startswith(prefix):
            continue
        if rid is not None and node.rid != rid:
            continue
        if desc is not None and node.desc != desc:
            continue
        return node
    return None


def tap(adb: Adb, node: Node) -> None:
    x, y = node.center
    adb.shell(f"input tap {x} {y}")


def visible(node: Node) -> bool:
    x1, y1, x2, y2 = node.bounds
    return x2 > x1 and y2 > y1  # rows scrolled out of a list come back with inverted bounds


def text_inside(nodes: list[Node], container: Node) -> str:
    """A button's label: its own content-desc if set, else the first visible text inside it."""
    if container.desc:
        return container.desc
    x1, y1, x2, y2 = container.bounds
    for node in nodes:
        nx1, ny1, nx2, ny2 = node.bounds
        if node.text and visible(node) and nx1 >= x1 and ny1 >= y1 and nx2 <= x2 and ny2 <= y2:
            return node.text
    return ""


# ---------------------------------------------------------------------------------------------
# Process / memory probes


def pid_of(adb: Adb) -> int | None:
    out = adb.shell(f"pidof {PKG}", check=False).strip()
    return int(out.split()[0]) if out else None


def threads_of(adb: Adb, pid: int) -> int | None:
    out = adb.shell(f"ls /proc/{pid}/task 2>/dev/null | wc -l", check=False).strip()
    return int(out) if out.isdigit() and int(out) > 0 else None


def meminfo(adb: Adb) -> dict[str, int]:
    """App Summary from dumpsys meminfo, in KB."""
    out = adb.shell(f"dumpsys meminfo {PKG}", check=False)
    result: dict[str, int] = {}
    patterns = {
        "pss_kb": r"TOTAL PSS:\s+(\d+)",
        "rss_kb": r"TOTAL RSS:\s+(\d+)",
        "java_heap_kb": r"Java Heap:\s+(\d+)",
        "native_heap_kb": r"Native Heap:\s+(\d+)",
        "graphics_kb": r"Graphics:\s+(\d+)",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, out)
        if match:
            result[key] = int(match.group(1))
    if "pss_kb" not in result:
        match = re.search(r"TOTAL\s+(\d+)", out)
        if match:
            result["pss_kb"] = int(match.group(1))
    return result


def exit_records(adb: Adb) -> list[dict[str, str]]:
    out = adb.shell(f"dumpsys activity exit-info {PKG}", check=False)
    records = []
    for match in re.finditer(r"timestamp=(\S+ \S+) pid=(\d+).*?reason=(\d+) \(([^)]*)\).*?description=([^\n]*?) state=", out, re.S):
        records.append({"timestamp": match.group(1), "pid": match.group(2), "reason": match.group(4), "description": match.group(5)})
    return records


def device_now(adb: Adb) -> str:
    return adb.shell("date '+%Y-%m-%d %H:%M:%S.000'").strip()


def music_volume(adb: Adb) -> int | None:
    out = adb.shell("cmd media_session volume --stream 3 --get", check=False)
    match = re.search(r"volume is (\d+)", out)
    return int(match.group(1)) if match else None


def set_music_volume(adb: Adb, value: int) -> None:
    adb.shell(f"cmd media_session volume --stream 3 --set {value}", check=False)


def diagnostics_lines(adb: Adb) -> list[dict]:
    out = adb.shell(f"cat {DIAG_LOG} 2>/dev/null", check=False)
    rows = []
    for line in out.splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


# ---------------------------------------------------------------------------------------------
# Reporting


@dataclass
class Result:
    name: str
    status: str  # pass | fail | skip
    seconds: float
    detail: str = ""
    data: dict = field(default_factory=dict)


class Run:
    def __init__(self, adb: Adb, out_dir: Path, kind: str):
        self.adb = adb
        self.dir = out_dir / f"{datetime.now():%Y%m%d-%H%M%S}-{kind}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.results: list[Result] = []
        self.induced_crash_pids: set[str] = set()
        self.expected_exit_reasons: set[str] = set()  # e.g. force-stops the run itself issued
        self.started_device_time = device_now(adb)
        self.started_exit_records = {r["timestamp"] for r in exit_records(adb)}
        self.volume_before = music_volume(adb)
        self.night_before = (re.search(r"Night mode: (\w+)", adb.shell("cmd uimode night", check=False)) or [None, None])[1]
        atexit.register(self.restore_device)

    def restore_device(self) -> None:
        """Put back what the run changed on the phone; safe to call more than once."""
        if self.volume_before is not None:
            set_music_volume(self.adb, self.volume_before)
        if self.night_before in ("yes", "no", "auto"):
            self.adb.shell(f"cmd uimode night {self.night_before}", check=False)

    def check(self, name: str, fn: Callable[[], dict | None]) -> Result:
        started = time.monotonic()
        try:
            data = fn() or {}
            result = Result(name, data.pop("_status", "pass"), time.monotonic() - started, data.pop("_detail", ""), data)
        except CheckFailed as error:
            result = Result(name, "fail", time.monotonic() - started, str(error))
        except Exception as error:  # a harness bug must not hide the rest of the run
            result = Result(name, "fail", time.monotonic() - started, f"{type(error).__name__}: {error}")
        self.results.append(result)
        mark = {"pass": "PASS", "fail": "FAIL", "skip": "SKIP"}[result.status]
        print(f"[{mark}] {name} ({result.seconds:.1f}s) {result.detail}", flush=True)
        return result

    def finish(self, extra: dict | None = None) -> int:
        adb = self.adb
        adb.keyevent("KEYCODE_WAKEUP")
        self.restore_device()
        logcat = adb.shell(f"logcat -d -v threadtime -T {shlex.quote(self.started_device_time)}", check=False, timeout=120)
        (self.dir / "logcat.txt").write_text(logcat)
        diagnostics = diagnostics_lines(adb)
        (self.dir / "diagnostics.jsonl").write_text("\n".join(json.dumps(r) for r in diagnostics))
        def induced(line: str) -> bool:
            fields = line.split()
            return (len(fields) > 2 and fields[2] in self.induced_crash_pids) or any(
                f"pid {pid}" in line or f"PID: {pid}" in line or f"({pid})" in line for pid in self.induced_crash_pids)

        problems = [
            line for line in logcat.splitlines()
            if (("FATAL EXCEPTION" in line or f"ANR in {PKG}" in line or "Fatal signal" in line)
                or (f"{PKG}" in line and "has died" in line))
            and not induced(line)
        ]
        new_exits = [r for r in exit_records(adb) if r["timestamp"] not in self.started_exit_records
                     and r["pid"] not in self.induced_crash_pids and r["reason"] not in self.expected_exit_reasons]
        summary = {
            "device_started": self.started_device_time,
            "results": [asdict(r) for r in self.results],
            "logcat_problems": problems[:50],
            "process_exits_during_run": new_exits,
            "diagnostics_errors": [r for r in diagnostics if r.get("level") in ("error", "fatal")][-50:],
            **(extra or {}),
        }
        (self.dir / "summary.json").write_text(json.dumps(summary, indent=2))
        lines = [f"# Tho'ra device run {self.dir.name}", ""]
        lines += [f"- **{r.status.upper()}** {r.name} ({r.seconds:.1f}s) {r.detail}" for r in self.results]
        lines += ["", f"Logcat problems: {len(problems)}", f"Process exits during run: {len(new_exits)}"]
        lines += [f"  - {e['timestamp']} pid {e['pid']} {e['reason']}: {e['description']}" for e in new_exits]
        (self.dir / "summary.md").write_text("\n".join(lines) + "\n")
        print(f"\nLogcat problems: {len(problems)}; process exits during run: {len(new_exits)}")
        for exit_ in new_exits:
            print(f"  exit: {exit_}")
        print(f"Report: {self.dir}")
        failed = [r for r in self.results if r.status == "fail"]
        return 1 if failed or problems else 0


# ---------------------------------------------------------------------------------------------
# Fixtures


def write_corrupt_mp3(template: Path, target: Path, size: int = 400_000) -> None:
    """A valid ID3v2 tag followed by printable-ASCII noise: MediaStore indexes it, no extractor can play it."""
    data = template.read_bytes()
    if data[:3] != b"ID3":
        raise RuntimeError("template has no ID3v2 header")
    tag_size = 10 + ((data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F))
    noise = bytes(random.Random(5).randrange(0x20, 0x7F) for _ in range(size))
    target.write_bytes(data[:tag_size] + noise)


def cmd_fixtures(args, adb: Adb) -> int:
    formats = [
        ("mp3", ["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3"]),
        ("flac", ["-c:a", "flac"]),
        ("m4a", ["-c:a", "aac", "-b:a", "128k"]),
        ("opus", ["-c:a", "libopus", "-b:a", "96k"]),
    ]
    with tempfile.TemporaryDirectory(prefix="thora-fixtures-") as tmp:
        work = Path(tmp)
        files = []
        for index in range(1, FIXTURE_COUNT + 1):
            ext, codec = formats[(index - 1) % len(formats)]
            if index == CORRUPT_INDEX:
                ext, codec = formats[0]
            title = title_of(index) + (" - corrupt" if index == CORRUPT_INDEX else "")
            target = work / f"{title}.{ext}"
            seconds = 1 if index == CORRUPT_INDEX else FIXTURE_SECONDS
            subprocess.run(
                [
                    FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", f"sine=frequency={200 + 40 * index}:duration={seconds}:sample_rate=44100",
                    "-af", "volume=0.05",
                    "-metadata", f"title={title}", "-metadata", f"artist={FIXTURE_ARTIST}",
                    "-metadata", f"album={FIXTURE_ALBUM}", "-metadata", f"track={index}",
                    *codec, str(target),
                ],
                check=True,
            )
            if index == CORRUPT_INDEX:
                write_corrupt_mp3(target, target)
            files.append(target)
        adb.shell(f"mkdir -p {shlex.quote(DEVICE_FIXTURE_DIR)}")
        adb.run("push", *map(str, files), DEVICE_FIXTURE_DIR + "/", timeout=300)
    adb.shell("content call --uri content://media --method scan_volume --arg external_primary", timeout=300)
    rows = adb.shell(
        "content query --uri content://media/external/audio/media --projection title:duration "
        f"--where \"relative_path='Music/Thora-test/'\"",
        check=False,
    )
    indexed = [line for line in rows.splitlines() if line.startswith("Row:")]
    print(f"Pushed {len(files)} fixtures to {DEVICE_FIXTURE_DIR}; MediaStore indexed {len(indexed)}:")
    for line in indexed:
        print("  " + line)
    return 0 if len(indexed) == len(files) else 1


# Playlists that reference the fixtures every way real playlists do. Expected results per playlist
# (what the app's importer must report in the diagnostics log after importing them).
PLAYLIST_DIR = f"{DEVICE_FIXTURE_DIR}/_playlists"
PLAYLIST_EXPECTATIONS = {
    "Thora Ladder": {"entries": 8, "matched": 5, "unresolved": 1, "unsupported": 1, "duplicates": 1,
                     "reasons": {"EXACT_PATH": 3, "PATH_SUFFIX": 1, "FORMAT_CHANGE": 1, "TAG_MATCH": 1}},
    "[Old] Winamp Style": {"entries": 2, "matched": 2, "unresolved": 0, "unsupported": 0, "duplicates": 0,
                           "reasons": {"UNIQUE_FILENAME": 2}},
    "Thora PLS": {"entries": 2, "matched": 2, "unresolved": 0, "unsupported": 0, "duplicates": 0},
    "Thora XSPF": {"entries": 1, "matched": 1, "unresolved": 0, "unsupported": 0, "duplicates": 0},
    "Fusion Girl Test": {"entries": 2, "matched": 2, "unresolved": 0, "unsupported": 0, "duplicates": 0},
}


def write_playlist_fixtures(work: Path) -> list[tuple[Path, str]]:
    """Returns (local file, device folder) pairs."""
    files = []

    def add(name: str, data: bytes, sub: str = "") -> None:
        folder = work / sub if sub else work
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
        files.append((folder / name, f"{PLAYLIST_DIR}/{sub}".rstrip("/")))

    add("Thora Ladder.m3u8", "\n".join([
        "#EXTM3U", "#PLAYLIST:Thora Ladder",
        "../Thora Test 01.mp3",                                             # EXACT_PATH (relative)
        "/storage/emulated/0/Music/Thora-test/Thora Test 02.flac",          # EXACT_PATH (absolute)
        "C:\\Users\\Jordan\\Music\\Thora-test\\Thora Test 03.m4a",        # PATH_SUFFIX (old Windows box)
        "../Thora Test 06.mp3",                                             # FORMAT_CHANGE (now .flac)
        "#EXTINF:30,Thora Fixtures - Thora Test 07", "lost/renamed track.mp3",  # TAG_MATCH
        "https://example.com/stream.mp3",                                   # unsupported
        "../Not Here.mp3",                                                  # unresolved
        "../Thora Test 01.mp3",                                             # duplicate
        "",
    ]).encode("utf-8"))
    add("[Old] Winamp Style.m3u", "\r\n".join([
        "#EXTM3U",
        "#EXTINF:30,Thora Fixtures - Thora Test 08\u2026",                # "…" is byte 0x85 in Windows-1252
        "D:\\Music Backup\\Old Folder\\Thora Test 08.opus",               # UNIQUE_FILENAME, tags agree
        "Media\\All Music\\Thora Test 09.mp3",                            # UNIQUE_FILENAME, distinctive name
        "",
    ]).encode("windows-1252"))
    add("Thora PLS.pls", "\n".join([
        "[playlist]", "File1=../Thora Test 10.flac", "Title1=Thora Fixtures - Thora Test 10", "Length1=30",
        "File2=../Thora Test 11.m4a", "NumberOfEntries=2", "Version=2", "",
    ]).encode("utf-8"))
    add("Thora XSPF.xspf", (
        '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">'
        "<title>Thora XSPF</title><trackList><track>"
        "<location>file:///storage/emulated/0/Music/Thora-test/Thora%20Test%2012.opus</location>"
        "<title>Thora Test 12</title><creator>Thora Fixtures</creator><duration>30000</duration>"
        "</track></trackList></playlist>\n").encode("utf-8"))
    add("playlist.m3u8", "\ufeff#EXTM3U\n# Generated automatically\n../../Thora Test 04.opus\n../../Thora Test 01.mp3\n".encode("utf-8"),
        sub="Fusion_Girl_Test")
    return files


def cmd_playlist_fixtures(args, adb: Adb) -> int:
    with tempfile.TemporaryDirectory(prefix="thora-playlists-") as tmp:
        files = write_playlist_fixtures(Path(tmp))
        for local, folder in files:
            adb.shell(f"mkdir -p {shlex.quote(folder)}")
            adb.run("push", str(local), folder + "/", timeout=60)
    print(f"Pushed {len(files)} test playlists to {PLAYLIST_DIR}. Import them in the app (Import Playlists,")
    print("select all of them), then run: thora_devicetest.py verify-playlists")
    return 0


def cmd_verify_playlists(args, adb: Adb) -> int:
    """Compare the importer's diagnostics-log entries against PLAYLIST_EXPECTATIONS."""
    imports = {}
    for row in diagnostics_lines(adb):
        if row.get("tag") == "playlist" and row.get("msg") == "import" and row.get("playlist"):
            imports[row["playlist"]] = row  # latest import wins
    failures = 0
    for name, expected in PLAYLIST_EXPECTATIONS.items():
        got = imports.get(name)
        if not got:
            print(f"[FAIL] {name}: not imported (no diagnostics entry)")
            failures += 1
            continue
        problems = [f"{key} {got.get(key)} != {value}" for key, value in expected.items()
                    if key != "reasons" and got.get(key) != value]
        reasons = dict(item.split("=") for item in str(got.get("reasons", "")).split(",") if "=" in item)
        for reason, count in expected.get("reasons", {}).items():
            if int(reasons.get(reason, 0)) != count:
                problems.append(f"reason {reason}={reasons.get(reason, 0)} (want {count})")
        status = "FAIL" if problems else "PASS"
        failures += bool(problems)
        print(f"[{status}] {name}: matched {got.get('matched')}/{got.get('entries')} reasons {got.get('reasons')}"
              + (f" -- {'; '.join(problems)}" if problems else ""))
        if got.get("firstUnresolved"):
            print(f"         unresolved: {got['firstUnresolved']}")
    return 1 if failures else 0


def cmd_cleanup(args, adb: Adb) -> int:
    adb.shell(f"rm -rf {shlex.quote(DEVICE_FIXTURE_DIR)}")
    adb.shell("content call --uri content://media --method scan_volume --arg external_primary", timeout=300)
    print(f"Removed {DEVICE_FIXTURE_DIR} and rescanned MediaStore.")
    return 0


# ---------------------------------------------------------------------------------------------
# App driving


def launch(adb: Adb) -> dict:
    for permission in ("android.permission.READ_MEDIA_AUDIO", "android.permission.POST_NOTIFICATIONS"):
        adb.shell(f"pm grant {PKG} {permission}", check=False)
    out = adb.shell(f"am start -W -n {ACTIVITY}")
    total = re.search(r"TotalTime: (\d+)", out)
    wait_for("the tab bar", lambda: find(ui_nodes(adb), desc="LIBRARY"), timeout=30, interval=1)
    return {"launch_total_ms": int(total.group(1)) if total else None, "launch_state": (re.search(r"LaunchState: (\w+)", out) or [None, None])[1]}


def open_all_songs(adb: Adb) -> list[Node]:
    nodes = ui_nodes(adb)
    tab = find(nodes, desc="LIBRARY")
    if tab:
        tap(adb, tab)
        time.sleep(1)
    nodes = ui_nodes(adb)
    chip = find(nodes, text="ALL SONGS")
    if not chip:
        # The library view is remembered across launches; ALL SONGS is the last pill of a
        # horizontally scrolling row, off-screen to the right. Drag the row left to reveal it.
        row = find(nodes, text="PLAYLISTS") or find(nodes, desc="PLAYLISTS")
        if row:
            y = row.center[1]
            for _ in range(3):
                adb.shell(f"input swipe 680 {y} 120 {y} 250")
                time.sleep(0.8)
                chip = find(ui_nodes(adb), text="ALL SONGS")
                if chip:
                    break
    if chip:
        tap(adb, chip)
        time.sleep(1)
    return ui_nodes(adb)


def play_fixture(adb: Adb, index: int) -> Session:
    """Start the All Songs queue (sorted by name) at a fixture, through the UI like a user would."""
    require_unlocked(adb)
    target = title_of(index)

    def locate():
        nodes = open_all_songs(adb)
        return find(nodes, text=target) or find(nodes, prefix=target)

    node = wait_for(f"'{target}' in All Songs (library sync)", locate, timeout=90, interval=3)
    tap(adb, node)
    return wait_session(adb, f"playing {target}", lambda s: s.playing and (s.title or "").startswith(target))


def library_pill(adb: Adb, label: str) -> Node:
    """A LIBRARY view pill (PLAYLISTS … ALL SONGS); the row scrolls sideways, so drag it as needed."""
    for direction in ("right", "right", "left", "left", "left"):
        nodes = ui_nodes(adb)
        node = find(nodes, text=label)
        if node:
            return node
        anchor = next((find(nodes, text=x) for x in ("PLAYLISTS", "ALBUMS", "ARTISTS", "FOLDERS", "ALL SONGS")
                       if find(nodes, text=x)), None)
        y = anchor.center[1] if anchor else 93
        start, end = (120, 680) if direction == "right" else (680, 120)
        adb.shell(f"input swipe {start} {y} {end} {y} 250")
        time.sleep(0.8)
    raise CheckFailed(f"library pill {label!r} not found")


def open_playlist(adb: Adb, name: str) -> list[Node]:
    """LIBRARY -> PLAYLISTS -> the named playlist (scrolling inside the playlist list)."""
    tab = find(ui_nodes(adb), desc="LIBRARY")
    if tab:
        tap(adb, tab)
        time.sleep(1.2)
    back = find(ui_nodes(adb), text="← back")
    if back:
        tap(adb, back)
        time.sleep(1.2)
    tap(adb, library_pill(adb, "PLAYLISTS"))
    time.sleep(1.2)
    for _ in range(80):
        nodes = ui_nodes(adb)
        node = find(nodes, text=name)
        if node:
            tap(adb, node)
            time.sleep(2)
            return ui_nodes(adb)
        rows = [n for n in nodes if n.text.startswith("Tracks:")]
        top = min((n.bounds[1] for n in rows), default=300)
        bottom = max((n.bounds[3] for n in rows), default=900)
        adb.shell(f"input swipe 360 {bottom - 20} 360 {top + 20} 500")
        time.sleep(0.7)
    raise CheckFailed(f"playlist {name!r} not found")


def mode_button(adb: Adb, rid: str) -> tuple[Node, str]:
    require_unlocked(adb)
    nodes = ui_nodes(adb)
    button = find(nodes, rid=rid)
    if not button:
        raise CheckFailed(f"button {rid} not on screen")
    return button, text_inside(nodes, button)


def set_mode(adb: Adb, rid: str, wanted: str, attempts: int = 4) -> None:
    for _ in range(attempts):
        button, label = mode_button(adb, rid)
        if label == wanted:
            return
        tap(adb, button)
        time.sleep(1)
    raise CheckFailed(f"{rid} never showed {wanted!r} (last {mode_button(adb, rid)[1]!r})")


def ensure_playing(adb: Adb) -> Session:
    s = session(adb)
    if s and s.playing:
        return s
    if s and (s.title or "").startswith("Thora Test"):
        adb.key("play")
        return wait_session(adb, "playing after play key", lambda x: x.playing)
    launch(adb)
    return play_fixture(adb, 1)


def foreground_service(adb: Adb) -> bool:
    out = adb.shell(f"dumpsys activity services {PKG}", check=False)
    return "isForeground=true" in out


def require_unlocked(adb: Adb) -> None:
    out = adb.shell("dumpsys window", check=False)
    if "isKeyguardShowing=true" in out:
        raise CheckFailed("the phone is on its lock screen: unlock it (adb cannot unlock a PIN/pattern)")


def go_home_screen(adb: Adb) -> None:
    adb.keyevent("KEYCODE_HOME")


# ---------------------------------------------------------------------------------------------
# Functional checklist


def cmd_functional(args, adb: Adb) -> int:
    run = Run(adb, Path(args.out).expanduser(), "functional")
    set_music_volume(adb, 0)
    adb.keyevent("KEYCODE_WAKEUP")
    adb.shell("wm dismiss-keyguard", check=False)
    ctx: dict = {}

    def install():
        if not args.apk:
            return {"_status": "skip", "_detail": "no --apk given; testing the installed build"}
        out = adb.run("install", "-r", args.apk, timeout=600)
        if "Success" not in out:
            raise CheckFailed(out.strip())
        version = re.search(r"versionName=(\S+)", adb.shell(f"dumpsys package {PKG}"))
        return {"_detail": f"installed {version.group(1) if version else '?'}"}

    def cold_launch():
        adb.shell(f"am force-stop {PKG}")
        data = launch(adb)
        ctx["pid"] = pid_of(adb)
        return {"_detail": f"cold start {data['launch_total_ms']} ms", **data}

    def start_playback():
        s = play_fixture(adb, 1)
        return {"_detail": f"{s.title} at {s.position_ms} ms"}

    def position_advances():
        a = wait_session(adb, "playing", lambda s: s.playing)
        time.sleep(4)
        b = wait_session(adb, "playing", lambda s: s.playing)
        delta = b.position_ms - a.position_ms
        if not 2_500 <= delta <= 5_500:
            raise CheckFailed(f"position moved {delta} ms in ~4 s")
        return {"_detail": f"+{delta} ms in 4 s"}

    def pause_resume_keeps_position():
        adb.key("pause")
        paused = wait_session(adb, "paused", lambda s: s.state == "PAUSED")
        time.sleep(3)
        still = session(adb)
        if not still or abs(still.position_ms - paused.position_ms) > 300:
            raise CheckFailed(f"position drifted while paused: {paused.position_ms} -> {still and still.position_ms}")
        adb.key("play")
        resumed = wait_session(adb, "playing again", lambda s: s.playing)
        if resumed.position_ms < paused.position_ms - 500 or resumed.position_ms > paused.position_ms + 3_000:
            raise CheckFailed(f"resumed at {resumed.position_ms} ms, paused at {paused.position_ms} ms")
        return {"_detail": f"paused {paused.position_ms} ms, resumed {resumed.position_ms} ms"}

    def seek_keys():
        before = wait_session(adb, "playing", lambda s: s.playing)
        adb.key("fast-forward")
        after_ff = wait_session(adb, "seek forward", lambda s: s.position_ms >= before.position_ms + 8_000, timeout=5)
        adb.key("rewind")
        after_rw = wait_session(adb, "seek back", lambda s: s.position_ms <= after_ff.position_ms - 3_000, timeout=5)
        return {"_detail": f"{before.position_ms} -> ff {after_ff.position_ms} -> rw {after_rw.position_ms} ms"}

    def next_previous():
        adb.key("next")
        nxt = wait_session(adb, title_of(2), lambda s: (s.title or "").startswith(title_of(2)))
        adb.key("previous")
        prev = wait_session(adb, title_of(1), lambda s: (s.title or "").startswith(title_of(1)))
        return {"_detail": f"{nxt.title} then {prev.title}"}

    def corrupt_file_skipped():
        for index in (2, 3, 4):
            adb.key("next")
            wait_session(adb, title_of(index), lambda s, i=index: (s.title or "").startswith(title_of(i)))
        adb.key("fast-forward")
        adb.key("fast-forward")
        landed = wait_session(adb, f"skip past corrupt {title_of(CORRUPT_INDEX)} to {title_of(6)}",
                              lambda s: s.playing and (s.title or "").startswith(title_of(6)), timeout=30)
        errors = [r for r in diagnostics_lines(adb) if r.get("msg") == "player_error"]
        if not errors or errors[-1].get("skipped") is not True:
            raise CheckFailed(f"no skipped player_error in diagnostics (got {errors[-1:]})")
        return {"_detail": f"landed on {landed.title}; logged {errors[-1].get('code')}"}

    def repeat_one():
        ensure_playing(adb)
        adb.shell(f"am start -n {ACTIVITY}")
        set_mode(adb, "mini-mode-repeat", "↺1")
        current = wait_session(adb, "playing", lambda s: s.playing)
        adb.key("fast-forward")
        wait_session(adb, "seek toward the end", lambda s: s.position_ms >= 12_000, timeout=5)
        adb.key("fast-forward")
        looped = wait_session(adb, "track restarted", lambda s: s.playing and s.title == current.title and s.position_ms < 8_000, timeout=25)
        return {"_detail": f"{looped.title} looped to {looped.position_ms} ms"}

    def repeat_all_then_shuffle():
        ensure_playing(adb)
        set_mode(adb, "mini-mode-repeat", "↺")
        set_mode(adb, "mini-mode-random", "↭")
        seen = []
        for _ in range(6):
            adb.key("next")
            time.sleep(1.2)
            s = session(adb)
            seen.append(s.title if s else None)
        set_mode(adb, "mini-mode-random", "→")
        numbers = [int(t.split()[2]) for t in seen if t and t.startswith("Thora Test")]
        sequential = all(b == a + 1 for a, b in zip(numbers, numbers[1:]))
        if len(numbers) >= 4 and sequential:
            raise CheckFailed(f"shuffle on but order was sequential: {seen}")
        return {"_detail": f"order {seen}"}

    def notification():
        out = adb.shell("dumpsys notification --noredact")
        records = [chunk for chunk in out.split("NotificationRecord(") if f"pkg={PKG}" in chunk]
        media = [chunk for chunk in records if "MediaStyle" in chunk or "mediaSession" in chunk or "android.mediaSession" in chunk]
        if not media:
            raise CheckFailed(f"no media notification ({len(records)} notifications from {PKG})")
        title = re.search(r"android\.title=\w+ \(([^)]*)\)", media[0])
        has_intent = "contentIntent=PendingIntent" in media[0]
        if not has_intent:
            raise CheckFailed("media notification has no content intent (tap would not open the app)")
        return {"_detail": f"title={title.group(1) if title else '?'}; opens app on tap"}

    def kill_and_resume():
        ensure_playing(adb)
        adb.key("pause")
        paused = wait_session(adb, "paused", lambda s: s.state == "PAUSED")
        go_home_screen(adb)
        before = pid_of(adb)
        # Media3 keeps a paused player's service in the foreground for a while (the system won't
        # kill it); once that ends the process is an ordinary background process the low-memory
        # killer may take. Wait for that point, then kill it the same way.
        fgs_seconds = 0.0
        if args.fgs_wait > 0:
            waited_from = time.monotonic()
            wait_for("paused service to leave the foreground", lambda: not foreground_service(adb),
                     timeout=args.fgs_wait * 60, interval=15)
            fgs_seconds = time.monotonic() - waited_from
            adb.shell(f"am kill {PKG}")
        if pid_of(adb) == before:
            # The system's media controls keep a paused player's process alive, so `am kill` can't
            # take it. Crash it instead: an abrupt death with no onDestroy, like the low-memory killer.
            # Android then shows a crash dialog and holds the process until it is closed.
            run.induced_crash_pids.add(str(before))
            adb.shell(f"am crash {PKG}", check=False)
            time.sleep(2)
            close = find(_dump_nodes(adb, attempts=3), text="Close app")
            if close:
                tap(adb, close)
        wait_for("the old process to die", lambda: pid_of(adb) != before, timeout=15)
        session_after_kill = session(adb)
        time.sleep(3)
        adb.key("play")
        resumed = wait_session(adb, "media-button resume after process death",
                               lambda s: s.playing and s.title == paused.title, timeout=20)
        drift = resumed.position_ms - paused.position_ms
        if abs(drift) > 4_000:
            raise CheckFailed(f"resumed {paused.title} at {resumed.position_ms} ms, paused at {paused.position_ms} ms")
        return {"_detail": f"{'left foreground after %.0fs; ' % fgs_seconds if fgs_seconds else ''}killed pid {before}; "
                           f"media key restarted pid {pid_of(adb)} and resumed {resumed.title} at {resumed.position_ms} ms "
                           f"(paused {paused.position_ms})",
                "fgs_seconds_after_pause": round(fgs_seconds), "session_after_kill": str(session_after_kill)}

    def doze_keeps_playing():
        ensure_playing(adb)
        adb.keyevent("KEYCODE_SLEEP")
        adb.shell("dumpsys battery unplug; dumpsys deviceidle force-idle", check=False)
        try:
            start = session(adb)
            seconds = args.doze_seconds
            time.sleep(seconds)
            end = session(adb)
            idle = adb.shell("dumpsys deviceidle get deep", check=False).strip()
        finally:
            adb.shell("dumpsys deviceidle unforce; dumpsys battery reset", check=False)
            adb.keyevent("KEYCODE_WAKEUP")
            adb.shell("wm dismiss-keyguard", check=False)
        if not end or not end.playing:
            raise CheckFailed(f"not playing after {seconds}s in Doze ({idle}): {end}")
        return {"_detail": f"still playing after {seconds}s in Doze (deep={idle}); now {end.title}"}

    def ui_churn():
        ensure_playing(adb)
        pid_before = pid_of(adb)
        for _ in range(args.churn):
            go_home_screen(adb)
            time.sleep(0.7)
            adb.shell(f"am start -n {ACTIVITY}")
            time.sleep(1.2)
        for mode in ("yes", "no"):
            adb.shell(f"cmd uimode night {mode}", check=False)
            time.sleep(2)
        run.restore_device()
        adb.shell(f"am send-trim-memory {PKG} RUNNING_CRITICAL", check=False)
        time.sleep(2)
        pid_after = pid_of(adb)
        if pid_after != pid_before:
            raise CheckFailed(f"process restarted during UI churn ({pid_before} -> {pid_after})")
        s = wait_session(adb, "still playing", lambda s: s.playing, timeout=10)
        nodes = ui_nodes(adb)
        if not find(nodes, desc="LIBRARY"):
            raise CheckFailed("UI not showing the tab bar after churn")
        return {"_detail": f"{args.churn} background/foreground cycles + night mode + trim; still playing {s.title}"}

    def ui_matches_player():
        adb.shell(f"am start -n {ACTIVITY}")
        time.sleep(2)
        s = session(adb)
        if not s or not s.title:
            raise CheckFailed("no session title")
        nodes = ui_nodes(adb)
        if not find(nodes, prefix=s.title):
            raise CheckFailed(f"UI does not show the playing track {s.title!r}")
        return {"_detail": f"UI shows {s.title}"}

    checks = [
        ("install", install),
        ("cold launch + permissions", cold_launch),
        ("start playback from All Songs", start_playback),
        ("position advances", position_advances),
        ("pause/resume keeps position", pause_resume_keeps_position),
        ("seek forward/back keys", seek_keys),
        ("next/previous keys", next_previous),
        ("corrupt file skipped", corrupt_file_skipped),
        ("repeat one loops", repeat_one),
        ("repeat all + shuffle order", repeat_all_then_shuffle),
        ("media notification", notification),
        ("UI churn (bg/fg, night mode, trim)", ui_churn),
        ("process death -> media-button resume", kill_and_resume),
        ("UI reflects player after resume", ui_matches_player),
        ("Doze keeps playing (locks the screen: runs last)", doze_keeps_playing),
    ]
    only = set(args.only.split(",")) if args.only else None
    for name, fn in checks:
        if only and not any(token in name for token in only):
            continue
        run.check(name, fn)
    adb.key("pause")
    return run.finish({"memory_end": meminfo(adb), "pid_end": pid_of(adb)})


# ---------------------------------------------------------------------------------------------
# Performance


def gfx_stats(adb: Adb) -> dict:
    out = adb.shell(f"dumpsys gfxinfo {PKG}", check=False)
    stats: dict = {}
    for key, pattern in {
        "frames": r"Total frames rendered: (\d+)",
        "janky": r"Janky frames: (\d+)",
        "janky_pct": r"Janky frames: \d+ \(([\d.]+)%\)",
        "p50_ms": r"50th percentile: (\d+)ms",
        "p90_ms": r"90th percentile: (\d+)ms",
        "p95_ms": r"95th percentile: (\d+)ms",
        "p99_ms": r"99th percentile: (\d+)ms",
        "slow_ui_thread": r"Number Slow UI thread: (\d+)",
        "deadline_missed": r"Number Frame deadline missed: (\d+)",
    }.items():
        match = re.search(pattern, out)
        if match:
            stats[key] = float(match.group(1)) if "." in match.group(1) else int(match.group(1))
    return stats


def median(values: list[float]) -> float | None:
    ordered = sorted(v for v in values if v is not None)
    return ordered[len(ordered) // 2] if ordered else None


def cmd_perf(args, adb: Adb) -> int:
    run = Run(adb, Path(args.out).expanduser(), "perf")
    run.expected_exit_reasons.add("USER REQUESTED")  # the cold-start runs force-stop the app
    set_music_volume(adb, 0)
    adb.keyevent("KEYCODE_WAKEUP")
    results: dict = {}

    def startup():
        cold, warm = [], []
        for _ in range(args.repeats):
            adb.shell(f"am force-stop {PKG}")
            time.sleep(1)
            out = adb.shell(f"am start -W -n {ACTIVITY}")
            cold.append(int((re.search(r"TotalTime: (\d+)", out) or [0, 0])[1]))
            time.sleep(3)
        for _ in range(args.repeats):
            go_home_screen(adb)
            time.sleep(1.5)
            out = adb.shell(f"am start -W -n {ACTIVITY}")
            warm.append(int((re.search(r"TotalTime: (\d+)", out) or [0, 0])[1]))
            time.sleep(1.5)
        results["cold_start_ms"] = {"median": median(cold), "max": max(cold), "runs": cold}
        results["warm_start_ms"] = {"median": median(warm), "max": max(warm), "runs": warm}
        return {"_detail": f"cold median {median(cold)} ms (max {max(cold)}), warm median {median(warm)} ms"}

    def library_size():
        nodes = open_all_songs(adb)
        chip = next((n.text for n in nodes if n.text.startswith("ALL SONGS:")), None)
        results["all_songs_label"] = chip
        return {"_detail": chip or "library size not shown"}

    def ui_frames():
        require_unlocked(adb)
        nodes = ui_nodes(adb)
        tabs = [find(nodes, desc=name) for name in ("HOME", "SEARCH", "LIBRARY", "CREATE", "SETTINGS")]
        tabs = [t for t in tabs if t]
        adb.shell(f"dumpsys gfxinfo {PKG} reset", check=False)
        for _ in range(2):
            for tab in tabs:
                tap(adb, tab)
                time.sleep(0.8)
        results["tab_switch_frames"] = gfx_stats(adb)
        library = find(nodes, desc="LIBRARY")
        if library:
            tap(adb, library)
            time.sleep(1.5)
        adb.shell(f"dumpsys gfxinfo {PKG} reset", check=False)
        for direction in ((360, 1100, 360, 300), (360, 300, 360, 1100)):
            for _ in range(args.swipes):
                adb.shell("input swipe %d %d %d %d 180" % direction)
                time.sleep(0.25)
        results["scroll_frames"] = gfx_stats(adb)
        t, sc = results["tab_switch_frames"], results["scroll_frames"]
        return {"_detail": f"tabs: {t.get('janky_pct')}% janky, p90 {t.get('p90_ms')} ms, p99 {t.get('p99_ms')} ms; "
                           f"scroll: {sc.get('janky_pct')}% janky, p90 {sc.get('p90_ms')} ms, p99 {sc.get('p99_ms')} ms"}

    def playback_latency():
        before = len(diagnostics_lines(adb))
        for _ in range(3):
            # A real playlist when the library has one (fixtures sink out of view in a big library).
            try:
                open_playlist(adb, args.playlist)
                tap(adb, find(ui_nodes(adb), rid="playlist-play-all"))
                wait_session(adb, "playlist playing", lambda s: s.playing)
            except CheckFailed:
                play_fixture(adb, 1)
            adb.key("pause")
            time.sleep(1.5)
        for _ in range(5):
            adb.key("next")
            time.sleep(2)
        for _ in range(3):
            adb.key("pause")
            time.sleep(1.5)
            adb.key("play")
            time.sleep(2)
        adb.key("pause")
        rows = [r for r in diagnostics_lines(adb)[before:] if r.get("msg") == "start_latency"]
        by_reason: dict[str, list[int]] = {}
        for row in rows:
            by_reason.setdefault(str(row.get("reason")), []).append(int(row.get("ms", 0)))
        results["start_latency_ms"] = {k: {"median": median(v), "max": max(v), "n": len(v)} for k, v in by_reason.items()}
        if not rows:
            raise CheckFailed("no start_latency entries (needs v1.1.0+ with latency logging)")
        return {"_detail": ", ".join(f"{k}: median {v['median']} ms (max {v['max']}, n={v['n']})"
                                     for k, v in results["start_latency_ms"].items())}

    def memory():
        results["memory"] = meminfo(adb)
        return {"_detail": f"PSS {results['memory'].get('pss_kb', 0) // 1024} MB"}

    for name, fn in (("startup", startup), ("library size", library_size), ("UI frames (tabs, scroll)", ui_frames),
                     ("playback start latency", playback_latency), ("memory", memory)):
        run.check(name, fn)
    (run.dir / "perf.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
    return run.finish({"perf": results})


# ---------------------------------------------------------------------------------------------
# Soak


def slope_per_hour(points: list[tuple[float, float]]) -> float | None:
    if len(points) < 3:
        return None
    n = len(points)
    mean_t = sum(t for t, _ in points) / n
    mean_v = sum(v for _, v in points) / n
    denom = sum((t - mean_t) ** 2 for t, _ in points)
    if denom == 0:
        return None
    return sum((t - mean_t) * (v - mean_v) for t, v in points) / denom * 3600


def cmd_soak(args, adb: Adb) -> int:
    run = Run(adb, Path(args.out).expanduser(), f"soak{args.minutes}m")
    set_music_volume(adb, 0)
    adb.keyevent("KEYCODE_WAKEUP")
    adb.shell("wm dismiss-keyguard", check=False)

    def prepare():
        s = session(adb)
        if not s or not (s.title or "").startswith("Thora Test"):
            launch(adb)
            play_fixture(adb, 1)
        else:
            adb.key("play")
        note = ""
        try:
            require_unlocked(adb)
            adb.shell(f"am start -n {ACTIVITY}")
            time.sleep(2)
            set_mode(adb, "mini-mode-repeat", "↺")
            set_mode(adb, "mini-mode-random", "→")
        except CheckFailed as error:
            note = f" (modes not set: {error}; the verdict still catches a stopped queue)"
        s = wait_session(adb, "playing", lambda s: s.playing)
        return {"_detail": f"repeat all from {s.title}{note}"}

    if run.check("prepare soak (repeat all)", prepare).status == "fail":
        return run.finish()

    if args.screen_off:
        adb.keyevent("KEYCODE_SLEEP")
    samples = []
    csv_lines = ["elapsed_s,pid,state,title,position_ms,pss_kb,java_heap_kb,native_heap_kb,threads,controllers"]
    started = time.monotonic()
    deadline = started + args.minutes * 60
    print(f"Soaking {args.minutes} min, sampling every {args.interval}s...", flush=True)
    while time.monotonic() < deadline:
        elapsed = time.monotonic() - started
        pid = pid_of(adb)
        s = session(adb)
        mem = meminfo(adb) if pid else {}
        threads = threads_of(adb, pid) if pid else None
        sample = {
            "t": round(elapsed, 1), "pid": pid, "state": s.state if s else "NO_SESSION",
            "title": s.title if s else None, "position_ms": s.position_ms if s else None,
            "threads": threads, "controllers": s.controllers if s else None, **mem,
        }
        samples.append(sample)
        csv_lines.append(",".join(str(sample.get(k, "")) for k in
                                  ("t", "pid", "state", "title", "position_ms", "pss_kb", "java_heap_kb", "native_heap_kb", "threads", "controllers")))
        if len(samples) % 10 == 1:
            print(f"  t={elapsed/60:5.1f}m pid={pid} {sample['state']} {sample['title']} pss={mem.get('pss_kb', 0)//1024}MB threads={threads}", flush=True)
        time.sleep(max(0.0, args.interval - (time.monotonic() - started - elapsed)))
    (run.dir / "samples.csv").write_text("\n".join(csv_lines) + "\n")
    adb.keyevent("KEYCODE_WAKEUP")

    pids = {s["pid"] for s in samples}
    playing = sum(1 for s in samples if s["state"] == "PLAYING")
    transitions = sum(1 for a, b in zip(samples, samples[1:]) if a["title"] != b["title"])
    warm = [s for s in samples if s["t"] >= min(300, args.minutes * 60 / 4) and s.get("pss_kb")]
    pss_slope = slope_per_hour([(s["t"], s["pss_kb"] / 1024) for s in warm])
    java_slope = slope_per_hour([(s["t"], s["java_heap_kb"] / 1024) for s in warm if s.get("java_heap_kb")])
    native_slope = slope_per_hour([(s["t"], s["native_heap_kb"] / 1024) for s in warm if s.get("native_heap_kb")])
    thread_values = [s["threads"] for s in samples if s["threads"]]
    controller_values = [s["controllers"] for s in samples if s.get("controllers") is not None]
    pss_values = [s["pss_kb"] / 1024 for s in samples if s.get("pss_kb")]
    stats = {
        "minutes": args.minutes,
        "samples": len(samples),
        "pids": sorted(p for p in pids if p),
        "playing_ratio": round(playing / len(samples), 4) if samples else 0,
        "track_changes_seen": transitions,
        "pss_mb": {"start": round(pss_values[0], 1), "end": round(pss_values[-1], 1), "max": round(max(pss_values), 1)} if pss_values else None,
        "pss_slope_mb_per_hour": round(pss_slope, 2) if pss_slope is not None else None,
        "java_heap_slope_mb_per_hour": round(java_slope, 2) if java_slope is not None else None,
        "native_heap_slope_mb_per_hour": round(native_slope, 2) if native_slope is not None else None,
        "threads": {"start": thread_values[0], "end": thread_values[-1], "max": max(thread_values)} if thread_values else None,
        "session_controllers": {"start": controller_values[0], "end": controller_values[-1], "max": max(controller_values)} if controller_values else None,
    }

    def verdict():
        problems = []
        if len(stats["pids"]) != 1 or None in pids:
            problems.append(f"process changed or vanished: {stats['pids']}")
        if stats["playing_ratio"] < 0.97:
            problems.append(f"playing only {stats['playing_ratio']:.1%} of samples")
        if stats["pss_slope_mb_per_hour"] is not None and stats["pss_slope_mb_per_hour"] > args.max_slope:
            problems.append(f"PSS grows {stats['pss_slope_mb_per_hour']} MB/h (limit {args.max_slope})")
        if stats["threads"] and stats["threads"]["end"] - stats["threads"]["start"] > 8:
            problems.append(f"threads grew {stats['threads']['start']} -> {stats['threads']['end']}")
        expected_changes = args.minutes * 60 / FIXTURE_SECONDS * 0.5
        if transitions < expected_changes:
            problems.append(f"only {transitions} track changes seen (expected >= {expected_changes:.0f})")
        if problems:
            raise CheckFailed("; ".join(problems))
        return {"_detail": json.dumps(stats)}

    run.check(f"soak {args.minutes} min", verdict)
    adb.key("pause")
    print(json.dumps(stats, indent=2))
    return run.finish({"soak": stats})


# ---------------------------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--serial", help="adb serial (default: the only connected device)")
    parser.add_argument("--out", default="~/ThoraTransfer/devicetest", help="report directory root")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("fixtures", help="generate and push test tracks")
    sub.add_parser("cleanup", help="remove test tracks from the phone")
    sub.add_parser("playlist-fixtures", help="push test playlists that reference the fixtures every way")
    sub.add_parser("verify-playlists", help="check the app's import results for the test playlists")
    perf = sub.add_parser("perf", help="startup, frame rendering and playback start latency")
    perf.add_argument("--repeats", type=int, default=5)
    perf.add_argument("--swipes", type=int, default=8)
    perf.add_argument("--playlist", default="Fusion Girl", help="playlist used for the start-latency runs")
    functional = sub.add_parser("functional", help="playback checklist")
    functional.add_argument("--apk", help="install this APK first (in-place update)")
    functional.add_argument("--only", help="comma-separated substrings of check names to run")
    functional.add_argument("--doze-seconds", type=int, default=60)
    functional.add_argument("--churn", type=int, default=15, help="background/foreground cycles")
    functional.add_argument("--fgs-wait", type=float, default=0,
                            help="minutes to wait for a paused service to leave the foreground before killing (0 = crash it right away)")
    soak = sub.add_parser("soak", help="long playback run with resource sampling")
    soak.add_argument("--minutes", type=float, default=60)
    soak.add_argument("--interval", type=float, default=30, help="seconds between samples")
    soak.add_argument("--max-slope", type=float, default=6.0, help="max PSS growth, MB/hour")
    soak.add_argument("--screen-on", dest="screen_off", action="store_false", help="keep the screen on")
    args = parser.parse_args()
    adb = Adb(args.serial)
    handler = {"fixtures": cmd_fixtures, "cleanup": cmd_cleanup, "functional": cmd_functional, "soak": cmd_soak,
               "playlist-fixtures": cmd_playlist_fixtures, "verify-playlists": cmd_verify_playlists, "perf": cmd_perf}[args.command]
    return handler(args, adb)


if __name__ == "__main__":
    sys.exit(main())
