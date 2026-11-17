"""Uniform access to source files, whether they sit in a folder or inside a zip archive.

A source whose `path` is a .zip file is an archive source: its members are its files
(rel_path = member name). Members are usually deflated, so they can't be seeked cheaply:
readers stream them, tag reading looks only at the head, and a push extracts one member at a
time to a temp file that is deleted right after (the Mac has very little free disk).
"""

from __future__ import annotations

import hashlib
import io
import os
import shutil
import time
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, Callable, Iterator

# Junk that zips made on a Mac carry.
ARCHIVE_EXCLUDES = ("__MACOSX/**", "**/._*")
TAG_HEAD_BYTES = 1024 * 1024  # ID3v2 (cover art included) + the first MPEG frame / Xing header

_archives: dict[Path, zipfile.ZipFile] = {}


def is_archive(source) -> bool:
    return source.path.suffix.lower() == ".zip"


def source_available(source) -> bool:
    return source.path.is_file() if is_archive(source) else source.path.is_dir()


def _archive(path: Path) -> zipfile.ZipFile:
    archive = _archives.get(path)
    if archive is None:
        archive = zipfile.ZipFile(path)
        _archives[path] = archive
    return archive


class MemberStat:
    """The two os.stat fields inventory uses, for a zip member."""

    __slots__ = ("st_size", "st_mtime_ns")

    def __init__(self, size: int, mtime_ns: int):
        self.st_size = size
        self.st_mtime_ns = mtime_ns


def iter_archive_members(source, patterns: list[str], is_excluded: Callable[[str, list[str]], bool]):
    for info in _archive(source.path).infolist():
        if info.is_dir():
            continue
        rel = info.filename
        if is_excluded(rel, patterns + list(ARCHIVE_EXCLUDES)):
            continue
        mtime = time.mktime(info.date_time + (0, 0, -1))
        yield rel, MemberStat(info.file_size, int(mtime * 1_000_000_000))


@contextmanager
def open_source(source, rel_path: str) -> Iterator[BinaryIO]:
    if is_archive(source):
        with _archive(source.path).open(rel_path) as handle:
            yield handle
    else:
        with (source.path / rel_path).open("rb") as handle:
            yield handle


class HeadWithSize(io.RawIOBase):
    """The first bytes of a file, reporting the file's true size; reads past the head return
    zeros. Enough for tag readers (they need the header and the size, not the audio)."""

    def __init__(self, head: bytes, size: int, name: str):
        super().__init__()
        self._head = head
        self._size = size
        self._pos = 0
        self.name = name

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = 0) -> int:
        base = {0: 0, 1: self._pos, 2: self._size}[whence]
        self._pos = max(0, base + offset)
        return self._pos

    def readinto(self, buffer) -> int:
        count = max(0, min(len(buffer), self._size - self._pos))
        chunk = self._head[self._pos:self._pos + count]
        chunk += b"\0" * (count - len(chunk))
        buffer[:count] = chunk
        self._pos += count
        return count


def tag_target(source, rel_path: str, size: int):
    """What to hand the tag reader: a Path for plain files, a head-only file object for members."""
    if not is_archive(source):
        return source.path / rel_path
    with open_source(source, rel_path) as handle:
        head = handle.read(TAG_HEAD_BYTES)
    return HeadWithSize(head, size, rel_path)


def quick_hash(source, rel_path: str, size: int, chunk: int) -> str:
    """sha1(size + first chunk + last chunk): identical for a plain file and a member with the same bytes."""
    digest = hashlib.sha1(str(size).encode())
    if not is_archive(source):
        with (source.path / rel_path).open("rb") as handle:
            digest.update(handle.read(chunk))
            if size > chunk * 2:
                handle.seek(-chunk, 2)
                digest.update(handle.read(chunk))
        return digest.hexdigest()
    head = b""
    tail = b""
    with open_source(source, rel_path) as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            if len(head) < chunk:
                head += block[: chunk - len(head)]
            tail = (tail + block)[-chunk:]
    digest.update(head)
    if size > chunk * 2:
        digest.update(tail)
    return digest.hexdigest()


def full_hash(source, rel_path: str) -> str:
    digest = hashlib.sha256()
    with open_source(source, rel_path) as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


@contextmanager
def local_file(source, rel_path: str, mtime_ns: int, tmp_dir: Path) -> Iterator[Path]:
    """A local path to push: the file itself, or one member extracted to tmp_dir (deleted after)."""
    if not is_archive(source):
        yield source.path / rel_path
        return
    tmp_dir.mkdir(parents=True, exist_ok=True)
    out = tmp_dir / f"member-{hashlib.sha1(rel_path.encode()).hexdigest()[:12]}{Path(rel_path).suffix}"
    try:
        with open_source(source, rel_path) as src, out.open("wb") as dst:
            shutil.copyfileobj(src, dst, 1024 * 1024)
        os.utime(out, ns=(mtime_ns, mtime_ns))
        yield out
    finally:
        out.unlink(missing_ok=True)
