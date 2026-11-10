"""Read audio tags + stream info. mutagen first, ffprobe as fallback. Read-only."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

try:  # mutagen lives in scripts/transfer/.venv
    import mutagen  # type: ignore

    HAVE_MUTAGEN = True
except ImportError:  # pragma: no cover - exercised via doctor
    mutagen = None
    HAVE_MUTAGEN = False

FFPROBE = shutil.which("ffprobe")


@dataclass
class TagInfo:
    title: str | None = None
    artist: str | None = None
    album_artist: str | None = None
    album: str | None = None
    track_no: int | None = None
    disc_no: int | None = None
    year: int | None = None
    genre: str | None = None
    isrc: str | None = None
    duration_ms: int | None = None
    codec: str | None = None
    sample_rate: int | None = None
    bits_per_sample: int | None = None
    bitrate: int | None = None
    error: str | None = None


_NUMBER = re.compile(r"^\s*(\d{1,4})")
_YEAR = re.compile(r"(\d{4})")

_CODEC_BY_TYPE = {
    "FLAC": "flac",
    "MP3": "mp3",
    "EasyMP3": "mp3",
    "OggOpus": "opus",
    "OggVorbis": "vorbis",
    "OggFLAC": "flac",
    "WAVE": "pcm",
    "AIFF": "pcm",
    "MonkeysAudio": "ape",
    "WavPack": "wavpack",
    "DSF": "dsd",
    "DSDIFF": "dsd",
    "ASF": "wma",
    "TrueAudio": "tta",
    "Musepack": "mpc",
}


def _first(tags, *keys: str) -> str | None:
    if tags is None:
        return None
    for key in keys:
        try:
            values = tags.get(key)
        except (KeyError, ValueError, TypeError):
            values = None
        if not values:
            continue
        if isinstance(values, (list, tuple)):
            for value in values:
                text = str(value).strip()
                if text:
                    return text
        else:
            text = str(values).strip()
            if text:
                return text
    return None


def _parse_int(text: str | None) -> int | None:
    if not text:
        return None
    match = _NUMBER.match(text)
    return int(match.group(1)) if match else None


def _parse_year(text: str | None) -> int | None:
    if not text:
        return None
    match = _YEAR.search(text)
    if not match:
        return None
    year = int(match.group(1))
    return year if 1000 <= year <= 2999 else None


def read_tags(path: Path) -> TagInfo:
    if HAVE_MUTAGEN:
        info = _read_with_mutagen(path)
        if info.error is None:
            return info
        fallback = _read_with_ffprobe(path)
        if fallback.error is None:
            return fallback
        return info
    return _read_with_ffprobe(path)


def _read_with_mutagen(path: Path) -> TagInfo:
    try:
        audio = mutagen.File(str(path), easy=True)
    except Exception as error:  # mutagen raises many types on bad files
        return TagInfo(error=f"mutagen: {type(error).__name__}: {error}"[:300])
    if audio is None:
        return TagInfo(error="mutagen: unrecognized format")

    tags = audio.tags
    stream = getattr(audio, "info", None)
    codec = _CODEC_BY_TYPE.get(type(audio).__name__)
    mp4_codec = getattr(stream, "codec", None)
    if mp4_codec:
        codec = "alac" if str(mp4_codec).lower().startswith("alac") else "aac"

    length = getattr(stream, "length", None)
    return TagInfo(
        title=_first(tags, "title"),
        artist=_first(tags, "artist"),
        album_artist=_first(tags, "albumartist", "album artist", "album_artist", "band"),
        album=_first(tags, "album"),
        track_no=_parse_int(_first(tags, "tracknumber", "track")),
        disc_no=_parse_int(_first(tags, "discnumber", "disc")),
        year=_parse_year(_first(tags, "date", "originaldate", "year")),
        genre=_first(tags, "genre"),
        isrc=_first(tags, "isrc"),
        duration_ms=int(length * 1000) if length else None,
        codec=codec,
        sample_rate=getattr(stream, "sample_rate", None) or None,
        bits_per_sample=getattr(stream, "bits_per_sample", None) or None,
        bitrate=getattr(stream, "bitrate", None) or None,
    )


def _read_with_ffprobe(path: Path) -> TagInfo:
    if not FFPROBE:
        return TagInfo(error="no tag reader available (install mutagen or ffprobe)")
    try:
        completed = subprocess.run(
            [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return TagInfo(error="ffprobe: timeout")
    if completed.returncode != 0:
        return TagInfo(error=f"ffprobe: exit {completed.returncode}")
    try:
        payload = json.loads(completed.stdout.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return TagInfo(error="ffprobe: bad json")

    fmt = payload.get("format", {})
    tags = {str(key).lower(): value for key, value in (fmt.get("tags") or {}).items()}
    audio_stream = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "audio"), {}
    )
    tags.update({str(key).lower(): value for key, value in (audio_stream.get("tags") or {}).items() if str(key).lower() not in tags})

    def get(*keys: str) -> str | None:
        for key in keys:
            value = tags.get(key)
            if value and str(value).strip():
                return str(value).strip()
        return None

    duration = fmt.get("duration") or audio_stream.get("duration")
    bits = audio_stream.get("bits_per_raw_sample") or audio_stream.get("bits_per_sample")
    return TagInfo(
        title=get("title"),
        artist=get("artist"),
        album_artist=get("album_artist", "albumartist", "album artist"),
        album=get("album"),
        track_no=_parse_int(get("track", "tracknumber")),
        disc_no=_parse_int(get("disc", "discnumber")),
        year=_parse_year(get("date", "year", "originaldate")),
        genre=get("genre"),
        isrc=get("isrc", "tsrc"),
        duration_ms=int(float(duration) * 1000) if duration else None,
        codec=audio_stream.get("codec_name"),
        sample_rate=int(audio_stream["sample_rate"]) if audio_stream.get("sample_rate") else None,
        bits_per_sample=int(bits) if bits and str(bits).isdigit() and int(bits) > 0 else None,
        bitrate=int(fmt["bit_rate"]) if str(fmt.get("bit_rate", "")).isdigit() else None,
    )
