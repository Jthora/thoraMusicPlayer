"""Classify files by extension."""

from __future__ import annotations

# Decodable on Android 13+ through platform codecs / Media3 extractors.
PLAYABLE_AUDIO = {
    "mp3", "flac", "m4a", "aac", "mp4", "ogg", "oga", "opus", "wav", "mka", "amr", "3gp",
}

# Audio the phone can't play without extra decoders. Reported, never pushed.
UNSUPPORTED_AUDIO = {
    "ape", "wv", "dsf", "dff", "wma", "aif", "aiff", "aifc", "tak", "tta", "mpc", "ra", "rm", "ac3", "dts",
}

PLAYLIST_EXTS = {"m3u", "m3u8", "pls", "xspf", "wpl"}

# Need sniffing: only some CSV/XML files are playlists.
PLAYLIST_CANDIDATE_EXTS = {"csv", "xml", "plist"}  # plist: FLAC Player+ (iOS) playlist export

ARTWORK_EXTS = {"jpg", "jpeg", "png", "webp", "gif", "bmp"}

KIND_AUDIO = "audio"
KIND_UNSUPPORTED = "audio_unsupported"
KIND_PLAYLIST = "playlist"
KIND_PLAYLIST_CANDIDATE = "playlist_candidate"
KIND_ARTWORK = "artwork"
KIND_OTHER = "other"


def extension_of(name: str) -> str:
    dot = name.rfind(".")
    if dot <= 0 or dot == len(name) - 1:
        return ""
    return name[dot + 1 :].lower()


def classify(name: str, extra_playable: set[str] | None = None) -> str:
    ext = extension_of(name)
    if ext in PLAYABLE_AUDIO or (extra_playable and ext in extra_playable):
        return KIND_AUDIO
    if ext in UNSUPPORTED_AUDIO:
        return KIND_UNSUPPORTED
    if ext in PLAYLIST_EXTS:
        return KIND_PLAYLIST
    if ext in PLAYLIST_CANDIDATE_EXTS:
        return KIND_PLAYLIST_CANDIDATE
    if ext in ARTWORK_EXTS:
        return KIND_ARTWORK
    return KIND_OTHER
