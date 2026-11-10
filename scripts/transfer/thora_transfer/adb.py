"""Thin adb wrapper. All device paths are quoted for the device shell."""

from __future__ import annotations

import shlex
import shutil
import subprocess
from dataclasses import dataclass

ARG_BYTES_BUDGET = 96_000  # keep each adb shell/push command line well under limits


class AdbError(Exception):
    pass


@dataclass
class DeviceFile:
    size: int
    mtime: int


def adb_binary() -> str:
    path = shutil.which("adb")
    if not path:
        raise AdbError("adb not found on PATH (expected /opt/homebrew/share/android-commandlinetools/platform-tools/adb)")
    return path


def list_devices() -> list[tuple[str, str]]:
    completed = subprocess.run([adb_binary(), "devices"], capture_output=True, text=True, check=False)
    devices = []
    for line in completed.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            devices.append((parts[0], parts[1]))
    return devices


class Adb:
    def __init__(self, serial: str | None):
        self.binary = adb_binary()
        devices = list_devices()
        ready = [serial_id for serial_id, state in devices if state == "device"]
        if serial:
            state = dict(devices).get(serial)
            if state != "device":
                raise AdbError(f"Device {serial} is not ready (state: {state or 'not connected'}). Devices: {devices}")
            self.serial = serial
        elif len(ready) == 1:
            self.serial = ready[0]
        else:
            raise AdbError(f"Need exactly one ready device or device_serial in config. Devices: {devices}")

    def _run(self, args: list[str], timeout: float | None = None, check: bool = True) -> subprocess.CompletedProcess:
        completed = subprocess.run(
            [self.binary, "-s", self.serial, *args], capture_output=True, timeout=timeout, check=False
        )
        if check and completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", "replace").strip()
            stdout = completed.stdout.decode("utf-8", "replace").strip()
            raise AdbError(f"adb {' '.join(args[:3])}... failed ({completed.returncode}): {stderr or stdout}")
        return completed

    def shell(self, command: str, timeout: float | None = 300, check: bool = True) -> str:
        completed = self._run(["shell", command], timeout=timeout, check=check)
        return completed.stdout.decode("utf-8", "replace")

    def getprop(self, name: str) -> str:
        return self.shell(f"getprop {shlex.quote(name)}").strip()

    def free_bytes(self, path: str = "/sdcard") -> int:
        output = self.shell(f"df -k {shlex.quote(path)}")
        lines = [line for line in output.splitlines() if line.strip()]
        if len(lines) < 2:
            raise AdbError(f"Unexpected df output: {output!r}")
        fields = lines[-1].split()
        return int(fields[3]) * 1024

    def list_files(self, root: str) -> dict[str, DeviceFile]:
        """Map absolute device path -> size/mtime for every file under root."""
        quoted = shlex.quote(root)
        output = self.shell(
            f"if [ -d {quoted} ]; then find {quoted} -type f -exec stat -c '%s|%Y|%n' {{}} +; fi",
            timeout=900,
        )
        files: dict[str, DeviceFile] = {}
        for line in output.splitlines():
            parts = line.split("|", 2)
            if len(parts) != 3 or not parts[0].isdigit():
                continue
            files[parts[2]] = DeviceFile(size=int(parts[0]), mtime=int(parts[1]))
        return files

    def stat_files(self, paths: list[str]) -> dict[str, DeviceFile]:
        result: dict[str, DeviceFile] = {}
        for chunk in _chunk_args(paths):
            quoted = " ".join(shlex.quote(item) for item in chunk)
            output = self.shell(f"stat -c '%s|%Y|%n' {quoted} 2>/dev/null; true")
            for line in output.splitlines():
                parts = line.split("|", 2)
                if len(parts) == 3 and parts[0].isdigit():
                    result[parts[2]] = DeviceFile(size=int(parts[0]), mtime=int(parts[1]))
        return result

    def mkdirs(self, directories: list[str]) -> None:
        for chunk in _chunk_args(sorted(set(directories))):
            self.shell("mkdir -p " + " ".join(shlex.quote(item) for item in chunk))

    def push_into_dir(self, local_files: list[str], remote_dir: str, timeout: float | None = None) -> None:
        """Push files that keep their basename into an existing remote directory."""
        for chunk in _chunk_args(local_files):
            self._run(["push", "-q", "-Z", *chunk, remote_dir.rstrip("/") + "/"], timeout=timeout)

    def push_file(self, local_file: str, remote_path: str, timeout: float | None = None) -> None:
        self._run(["push", "-q", "-Z", local_file, remote_path], timeout=timeout)

    def pull(self, remote_path: str, local_path: str) -> None:
        self._run(["pull", "-a", remote_path, local_path], timeout=None)

    def remove_files(self, paths: list[str]) -> None:
        for chunk in _chunk_args(paths):
            self.shell("rm -f " + " ".join(shlex.quote(item) for item in chunk))

    def remove_empty_dirs(self, root: str) -> None:
        quoted = shlex.quote(root)
        self.shell(f"if [ -d {quoted} ]; then find {quoted} -mindepth 1 -type d -empty -delete; fi; true")

    def media_scan(self) -> str:
        return self.shell(
            "content call --uri content://media --method scan_volume --arg external_primary", timeout=1800
        ).strip()

    def media_count(self, relative_prefix: str) -> int:
        """Count MediaStore audio rows whose relative_path starts with relative_prefix (e.g. 'Music/Thora/')."""
        safe_prefix = relative_prefix.replace("'", "''")
        where = f"relative_path LIKE '{safe_prefix}%'"
        output = self.shell(
            "content query --uri content://media/external/audio/media --projection _id --where "
            + shlex.quote(where),
            timeout=300,
        )
        return sum(1 for line in output.splitlines() if line.startswith("Row:"))


def _chunk_args(items: list[str], budget: int = ARG_BYTES_BUDGET, max_items: int = 400):
    chunk: list[str] = []
    used = 0
    for item in items:
        cost = len(item.encode("utf-8")) + 3
        if chunk and (used + cost > budget or len(chunk) >= max_items):
            yield chunk
            chunk, used = [], 0
        chunk.append(item)
        used += cost
    if chunk:
        yield chunk


def device_relative_prefix(phone_root: str) -> str:
    """'/sdcard/Music/Thora' -> 'Music/Thora/' (MediaStore relative_path form)."""
    root = phone_root.rstrip("/")
    for prefix in ("/sdcard/", "/storage/emulated/0/", "/storage/self/primary/"):
        if root.startswith(prefix):
            return root[len(prefix):] + "/"
    return root.lstrip("/") + "/"
