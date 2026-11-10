"""Parse playlist files into a common model. Formats: m3u/m3u8, pls, xspf, wpl, csv, iTunes XML, text."""

from __future__ import annotations

import csv
import io
import plistlib
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from .normalize import split_artist_title


@dataclass
class PlaylistEntry:
    index: int
    location: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    duration_ms: int | None = None
    isrc: str | None = None
    hint: str | None = None  # raw human-readable description (EXTINF text etc.)

    def original(self) -> str:
        if self.location:
            return self.location
        parts = [part for part in (self.artist, self.title) if part]
        return " - ".join(parts) if parts else (self.hint or "")


@dataclass
class ParsedPlaylist:
    name: str
    fmt: str
    entries: list[PlaylistEntry] = field(default_factory=list)


class NotAPlaylist(Exception):
    pass


_LINE_BREAK = re.compile(r"\r\n|\n|\r")


def _lines(text: str) -> list[str]:
    """Split on real line endings only. str.splitlines() also splits on U+0085 (NEL), which is
    what byte 0x85 ("…" in Windows-1252) becomes when a legacy playlist falls back to latin-1."""
    return _LINE_BREAK.split(text)


def decode_text(data: bytes, prefer_utf8: bool = False) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", "replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", "replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        if prefer_utf8:
            return data.decode("utf-8", "replace")
    try:
        return data.decode("cp1252")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def parse_file(path: Path, data: bytes | None = None, forced_format: str | None = None) -> list[ParsedPlaylist]:
    raw = data if data is not None else path.read_bytes()
    ext = forced_format or path.suffix.lower().lstrip(".")
    stem = path.stem
    if stem.casefold() == "playlist" and path.parent.name:
        # Spotify downloads are "<Playlist_Name>/playlist.m3u8": the folder is the name.
        stem = path.parent.name.replace("_", " ").strip()
    if ext in ("m3u", "m3u8"):
        return [parse_m3u(decode_text(raw, prefer_utf8=ext == "m3u8"), stem, ext)]
    if ext == "pls":
        return [parse_pls(decode_text(raw), stem)]
    if ext == "xspf":
        return [parse_xspf(raw, stem)]
    if ext == "wpl":
        return [parse_wpl(raw, stem)]
    if ext == "csv":
        return [parse_csv(decode_text(raw), stem)]
    if ext == "xml":
        return parse_itunes_xml(raw)
    if ext == "plist":
        return parse_flacplayer_plist(raw)
    if ext == "txt" or ext == "text":
        return [parse_text(decode_text(raw), stem)]
    raise NotAPlaylist(f"unsupported playlist format: {ext}")


_EXTINF = re.compile(r"^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$", re.IGNORECASE)


def parse_m3u(text: str, name: str, fmt: str = "m3u") -> ParsedPlaylist:
    playlist = ParsedPlaylist(name=name, fmt=fmt)
    pending_duration: int | None = None
    pending_text: str | None = None
    for line in _lines(text):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            upper = stripped.upper()
            if upper.startswith("#PLAYLIST:"):
                playlist.name = stripped.split(":", 1)[1].strip() or playlist.name
            elif upper.startswith("#EXTINF"):
                match = _EXTINF.match(stripped)
                if match:
                    seconds = float(match.group(1)) if match.group(1) else -1
                    pending_duration = int(seconds * 1000) if seconds > 0 else None
                    pending_text = match.group(2).strip() or None
            continue
        artist, title = split_artist_title(pending_text)
        playlist.entries.append(
            PlaylistEntry(
                index=len(playlist.entries),
                location=stripped,
                title=title,
                artist=artist,
                duration_ms=pending_duration,
                hint=pending_text,
            )
        )
        pending_duration, pending_text = None, None
    return playlist


def parse_pls(text: str, name: str) -> ParsedPlaylist:
    files: dict[int, str] = {}
    titles: dict[int, str] = {}
    lengths: dict[int, int] = {}
    for line in _lines(text):
        match = re.match(r"^\s*(File|Title|Length)(\d+)\s*=\s*(.*)$", line, re.IGNORECASE)
        if not match:
            continue
        key, number, value = match.group(1).lower(), int(match.group(2)), match.group(3).strip()
        if key == "file":
            files[number] = value
        elif key == "title":
            titles[number] = value
        elif key == "length" and re.fullmatch(r"-?\d+", value) and int(value) > 0:
            lengths[number] = int(value) * 1000
    playlist = ParsedPlaylist(name=name, fmt="pls")
    for number in sorted(files):
        artist, title = split_artist_title(titles.get(number))
        playlist.entries.append(
            PlaylistEntry(
                index=len(playlist.entries),
                location=files[number],
                title=title,
                artist=artist,
                duration_ms=lengths.get(number),
                hint=titles.get(number),
            )
        )
    return playlist


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def parse_xspf(data: bytes, name: str) -> ParsedPlaylist:
    root = ET.fromstring(data)
    playlist = ParsedPlaylist(name=name, fmt="xspf")
    for child in root:
        if _local(child.tag) == "title" and (child.text or "").strip():
            playlist.name = child.text.strip()
    for element in root.iter():
        if _local(element.tag) != "track":
            continue
        values: dict[str, str] = {}
        for child in element:
            key = _local(child.tag)
            if key not in values and (child.text or "").strip():
                values[key] = child.text.strip()
        duration = values.get("duration")
        playlist.entries.append(
            PlaylistEntry(
                index=len(playlist.entries),
                location=values.get("location"),
                title=values.get("title"),
                artist=values.get("creator"),
                album=values.get("album"),
                duration_ms=int(duration) if duration and duration.isdigit() else None,
            )
        )
    return playlist


def parse_wpl(data: bytes, name: str) -> ParsedPlaylist:
    root = ET.fromstring(data)
    playlist = ParsedPlaylist(name=name, fmt="wpl")
    for element in root.iter():
        key = _local(element.tag)
        if key == "title" and (element.text or "").strip():
            playlist.name = element.text.strip()
        elif key == "media" and element.get("src"):
            playlist.entries.append(
                PlaylistEntry(
                    index=len(playlist.entries),
                    location=element.get("src"),
                    title=element.get("trackTitle"),
                    artist=element.get("trackArtist"),
                    album=element.get("albumTitle"),
                )
            )
    return playlist


_CSV_COLUMNS = {
    "title": ("track name", "title", "name", "song", "track", "song name", "track title"),
    "artist": ("artist name(s)", "artist", "artists", "artist name", "artist(s)"),
    "album": ("album name", "album", "album title"),
    "duration": ("track duration (ms)", "duration (ms)", "duration_ms", "duration", "length", "time"),
    "location": ("location", "path", "file", "filename", "file path", "filepath"),
    "isrc": ("isrc",),
}


def _parse_duration(header: str, value: str) -> int | None:
    value = value.strip()
    if not value:
        return None
    if ":" in value:
        parts = [part for part in value.split(":") if part.strip().isdigit()]
        if not parts:
            return None
        seconds = 0
        for part in parts:
            seconds = seconds * 60 + int(part)
        return seconds * 1000
    try:
        number = float(value)
    except ValueError:
        return None
    if "ms" in header or number > 10_000:
        return int(number)
    return int(number * 1000)


def parse_csv(text: str, name: str) -> ParsedPlaylist:
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    try:
        header = [cell.strip().casefold() for cell in next(reader)]
    except StopIteration:
        raise NotAPlaylist("empty csv")

    columns: dict[str, int] = {}
    for field_name, aliases in _CSV_COLUMNS.items():
        for alias in aliases:
            if alias in header:
                columns[field_name] = header.index(alias)
                break
    if "location" not in columns and "title" not in columns:
        raise NotAPlaylist("csv has no title/location column")

    def cell(row: list[str], key: str) -> str | None:
        position = columns.get(key)
        if position is None or position >= len(row):
            return None
        value = row[position].strip()
        return value or None

    playlist = ParsedPlaylist(name=name, fmt="csv")
    duration_header = header[columns["duration"]] if "duration" in columns else ""
    for row in reader:
        if not any(part.strip() for part in row):
            continue
        duration_text = cell(row, "duration")
        playlist.entries.append(
            PlaylistEntry(
                index=len(playlist.entries),
                location=cell(row, "location"),
                title=cell(row, "title"),
                artist=cell(row, "artist"),
                album=cell(row, "album"),
                duration_ms=_parse_duration(duration_header, duration_text) if duration_text else None,
                isrc=cell(row, "isrc"),
            )
        )
    return playlist


def parse_flacplayer_plist(data: bytes) -> list[ParsedPlaylist]:
    """FLAC Player+ (iOS) playlist.plist: {playlist name: [file name, ...]}."""
    try:
        playlists = plistlib.loads(data)
    except Exception as error:  # plistlib raises several types
        raise NotAPlaylist(f"not a plist: {error}")
    if not isinstance(playlists, dict) or not playlists or not all(isinstance(v, list) for v in playlists.values()):
        raise NotAPlaylist("plist is not a FLAC Player+ playlist export")
    result = []
    for name, files in playlists.items():
        entries = [
            PlaylistEntry(index=index, location=str(item))
            for index, item in enumerate(files)
            if isinstance(item, str) and item.strip()
        ]
        result.append(ParsedPlaylist(name=str(name), fmt="flacplayer-plist", entries=entries))
    return result


def parse_itunes_xml(data: bytes) -> list[ParsedPlaylist]:
    try:
        library = plistlib.loads(data)
    except Exception as error:  # plistlib raises several types
        raise NotAPlaylist(f"not a plist: {error}")
    if not isinstance(library, dict) or "Tracks" not in library:
        raise NotAPlaylist("xml is not an iTunes/Music library export")

    tracks = library.get("Tracks", {})
    result: list[ParsedPlaylist] = []
    for item in library.get("Playlists", []):
        if item.get("Master") or item.get("Distinguished Kind") or item.get("Folder") or item.get("Visible") is False:
            continue
        playlist = ParsedPlaylist(name=str(item.get("Name", "Playlist")), fmt="itunes-xml")
        for entry in item.get("Playlist Items", []):
            track = tracks.get(str(entry.get("Track ID")), {})
            if not track:
                continue
            total_time = track.get("Total Time")
            playlist.entries.append(
                PlaylistEntry(
                    index=len(playlist.entries),
                    location=track.get("Location"),
                    title=track.get("Name"),
                    artist=track.get("Artist"),
                    album=track.get("Album"),
                    duration_ms=int(total_time) if total_time else None,
                )
            )
        if playlist.entries:
            result.append(playlist)
    return result


def parse_text(text: str, name: str) -> ParsedPlaylist:
    """One 'Artist - Title' per line. Only used when explicitly requested."""
    playlist = ParsedPlaylist(name=name, fmt="text")
    for line in _lines(text):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        artist, title = split_artist_title(stripped)
        playlist.entries.append(PlaylistEntry(index=len(playlist.entries), title=title, artist=artist, hint=stripped))
    return playlist
