"""Phone-safe path naming.

Android shared storage is case-insensitive and FAT-compatible in practice, so
destination names are NFC-normalized, stripped of FAT-illegal characters,
trimmed of trailing dots/spaces, and limited to 255 UTF-8 bytes per component.
"""

from __future__ import annotations

import re
import unicodedata

_ILLEGAL = re.compile(r'[<>:"\\|?*\x00-\x1f\x7f]')
MAX_COMPONENT_BYTES = 255


def _truncate_utf8(text: str, max_bytes: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    return encoded[:max_bytes].decode("utf-8", "ignore")


def sanitize_component(name: str) -> str:
    cleaned = unicodedata.normalize("NFC", name)
    cleaned = _ILLEGAL.sub("_", cleaned)
    cleaned = cleaned.strip(" ")
    cleaned = cleaned.rstrip(". ")
    if not cleaned or cleaned in {".", ".."}:
        cleaned = "_"

    if len(cleaned.encode("utf-8")) > MAX_COMPONENT_BYTES:
        dot = cleaned.rfind(".")
        ext = cleaned[dot:] if 0 < dot and len(cleaned) - dot <= 10 else ""
        stem = cleaned[: len(cleaned) - len(ext)] if ext else cleaned
        stem = _truncate_utf8(stem, MAX_COMPONENT_BYTES - len(ext.encode("utf-8"))).rstrip(". ")
        cleaned = (stem or "_") + ext
    return cleaned


def sanitize_rel_path(rel_path: str) -> str:
    parts = [part for part in rel_path.replace("\\", "/").split("/") if part not in {"", "."}]
    return "/".join(sanitize_component(part) for part in parts)


def with_suffix_counter(rel_path: str, counter: int) -> str:
    """'a/b/song.flac' + 2 -> 'a/b/song (2).flac'."""
    directory, _, name = rel_path.rpartition("/")
    dot = name.rfind(".")
    if dot > 0:
        name = f"{name[:dot]} ({counter}){name[dot:]}"
    else:
        name = f"{name} ({counter})"
    return f"{directory}/{name}" if directory else name


def collision_key(rel_path: str) -> str:
    return unicodedata.normalize("NFC", rel_path).casefold()


def replace_extension(rel_path: str, new_ext: str) -> str:
    directory, _, name = rel_path.rpartition("/")
    dot = name.rfind(".")
    stem = name[:dot] if dot > 0 else name
    name = f"{stem}.{new_ext}"
    return f"{directory}/{name}" if directory else name
