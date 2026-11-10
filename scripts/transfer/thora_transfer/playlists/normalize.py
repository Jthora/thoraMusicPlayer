"""Text/path normalization shared by every matching rule.

Keep in sync with docs/production/playlist-matching-spec.md (the in-app importer
implements the same rules).
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# Version noise that does not change which recording a playlist meant.
# Deliberately NOT stripped: live, remix, mix, edit, acoustic, demo, instrumental, mono/stereo.
_BRACKET_NOISE = re.compile(
    r"[\(\[\{]\s*(?:[^\)\]\}]*\bremaster(?:ed)?\b[^\)\]\}]*|explicit|clean|deluxe(?:\s+(?:edition|version))?"
    r"|bonus(?:\s+track)?|album\s+version|original\s+version)\s*[\)\]\}]",
    re.IGNORECASE,
)
_DASH_REMASTER = re.compile(
    r"\s+-\s+(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+(?:version|edition|\d{4}))*\s*$",
    re.IGNORECASE,
)
_BRACKET_FEAT = re.compile(r"[\(\[\{]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\)\]\}]*[\)\]\}]", re.IGNORECASE)
_TRAILING_FEAT = re.compile(r"\s+(?:feat\.?|ft\.?|featuring)\s+.*$", re.IGNORECASE)
_NON_ALNUM = re.compile(r"[^0-9a-z]+")
_TRACK_PREFIX = re.compile(
    r"^\s*(?:(?:cd|disc|disk)\s*\d{1,2}\s*[-_. ]\s*)?(?:\d{1,2}[-.])?\d{1,3}(?:\s*[-_.)]\s*|\s+)(?=\S)",
    re.IGNORECASE,
)
_ARTIST_SPLIT = re.compile(r"\s*(?:,|;|/|&|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*", re.IGNORECASE)


def fold(text: str) -> str:
    """NFKD, drop accents, casefold."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return stripped.casefold()


def norm_text(text: str | None) -> str:
    if not text:
        return ""
    value = _DASH_REMASTER.sub("", text)
    value = _BRACKET_NOISE.sub(" ", value)
    value = _BRACKET_FEAT.sub(" ", value)
    value = _TRAILING_FEAT.sub("", value)
    value = fold(value).replace("&", " and ")
    value = _NON_ALNUM.sub(" ", value)
    return " ".join(value.split())


def strip_extension(name: str) -> str:
    dot = name.rfind(".")
    if 0 < dot and len(name) - dot <= 6:
        return name[:dot]
    return name


def strip_track_prefix(stem: str) -> str:
    stripped = _TRACK_PREFIX.sub("", stem, count=1)
    return stripped if stripped.strip() else stem


def stem_variants(stem: str) -> set[str]:
    """Normalized forms of a filename stem: raw, without track number, without 'Artist - ' prefix."""
    variants = {norm_text(stem)}
    without_number = strip_track_prefix(stem)
    variants.add(norm_text(without_number))
    if " - " in without_number:
        variants.add(norm_text(without_number.split(" - ", 1)[1]))
        variants.add(norm_text(without_number.rsplit(" - ", 1)[1]))
    return {variant for variant in variants if variant}


def artist_alternatives(artist: str | None) -> list[str]:
    if not artist:
        return []
    full = norm_text(artist)
    parts = [norm_text(part) for part in _ARTIST_SPLIT.split(artist)]
    seen: list[str] = []
    for value in [full, *parts]:
        if value and value not in seen:
            seen.append(value)
    return seen


def split_artist_title(text: str | None) -> tuple[str | None, str | None]:
    """'Artist - Title' -> (artist, title). No dash -> (None, text)."""
    if not text:
        return None, None
    cleaned = text.strip()
    if " - " in cleaned:
        artist, title = cleaned.split(" - ", 1)
        return artist.strip() or None, title.strip() or None
    return None, cleaned or None


def similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    direct = SequenceMatcher(None, left, right).ratio()
    sorted_left = " ".join(sorted(left.split()))
    sorted_right = " ".join(sorted(right.split()))
    reordered = SequenceMatcher(None, sorted_left, sorted_right).ratio()
    return max(direct, reordered)


def clean_location(raw: str) -> tuple[str, bool]:
    """Normalize a playlist location. Returns (path, is_remote_url)."""
    from urllib.parse import unquote, urlparse

    value = raw.strip().strip('"')
    lowered = value.lower()
    if lowered.startswith(("http://", "https://", "spotify:", "ftp://", "smb://", "rtsp://")):
        return value, True
    if lowered.startswith("file:"):
        parsed = urlparse(value)
        value = unquote(parsed.path)
        if parsed.netloc and parsed.netloc.lower() not in ("", "localhost"):
            value = f"//{parsed.netloc}{value}"
    value = value.replace("\\", "/")
    if re.match(r"^/?[A-Za-z]:/", value):  # Windows drive letter
        value = value.split(":", 1)[1]
    value = unicodedata.normalize("NFC", value)
    while "//" in value[1:]:
        value = value[0] + value[1:].replace("//", "/")
    return value, False


def path_segments(path: str) -> list[str]:
    """Casefolded NFC segments with '.' and '..' resolved."""
    stack: list[str] = []
    for part in path.replace("\\", "/").split("/"):
        part = part.strip()
        if not part or part == ".":
            continue
        if part == "..":
            if stack:
                stack.pop()
            continue
        stack.append(unicodedata.normalize("NFC", part).casefold())
    return stack
