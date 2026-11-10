"""Load and validate thora-transfer.toml."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "thora-transfer.toml"

# Junk that NAS boxes and macOS sprinkle over shares. Always excluded.
BUILTIN_EXCLUDES = (
    "**/.DS_Store",
    "**/._*",
    "**/.AppleDouble/**",
    "**/.AppleDB/**",
    "**/@eaDir/**",
    "**/#recycle/**",
    "**/#snapshot/**",
    "**/.Trash*/**",
    "**/$RECYCLE.BIN/**",
    "**/System Volume Information/**",
    "**/Thumbs.db",
    "**/desktop.ini",
    "**/.thumbnails/**",
)


class ConfigError(Exception):
    pass


@dataclass
class Source:
    label: str
    path: Path
    exclude: list[str] = field(default_factory=list)
    transcode: str | None = None  # e.g. "opus192"; None = copy as-is


@dataclass
class Selection:
    """Push only playlist-referenced files plus these folders ("<label>/<path inside source>")."""

    playlists: bool = True
    folders: list[str] = field(default_factory=list)


@dataclass
class Remap:
    from_prefix: str
    to_prefix: str


@dataclass
class Config:
    path: Path
    state_dir: Path
    phone_root: str
    headroom_gb: float
    device_serial: str | None
    sources: list[Source]
    remaps: list[Remap]
    playlist_extra_dirs: list[Path]
    auto_accept_score: float
    review_score: float
    extra_playable_exts: set[str]
    selection: Selection | None = None
    # (["<label>/<folder glob>", display name or None]) folders that become playlists
    folder_playlists: list[tuple[str, str | None]] = field(default_factory=list)
    spotify_rosters_dir: Path | None = None
    # Accept a review candidate when the entry's artist and title agree with it (tags_agree).
    accept_review_when_tags_agree: bool = False

    @property
    def db_path(self) -> Path:
        return self.state_dir / "state.db"

    @property
    def reports_dir(self) -> Path:
        return self.state_dir / "reports"

    @property
    def playlists_out_dir(self) -> Path:
        return self.state_dir / "playlists" / "out"

    @property
    def tmp_dir(self) -> Path:
        return self.state_dir / "tmp"

    @property
    def phone_playlists_dir(self) -> str:
        return f"{self.phone_root}/_playlists"

    def source(self, label: str) -> Source:
        for item in self.sources:
            if item.label == label:
                return item
        raise ConfigError(f"Unknown source label: {label}")


def _expand(value: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(value)))


def _validate_label(label: str) -> str:
    cleaned = label.strip()
    if not cleaned or "/" in cleaned or cleaned.startswith(".") or cleaned.startswith("_"):
        raise ConfigError(
            f"Invalid source label {label!r}: must be non-empty, no '/', and not start with '.' or '_'"
        )
    return cleaned


def resolve_config_path(explicit: str | None) -> Path:
    if explicit:
        return _expand(explicit)
    env = os.environ.get("THORA_TRANSFER_CONFIG")
    if env:
        return _expand(env)
    return DEFAULT_CONFIG_PATH


def load_config(explicit: str | None = None) -> Config:
    path = resolve_config_path(explicit)
    if not path.exists():
        raise ConfigError(
            f"Config not found: {path}\n"
            f"Copy {DEFAULT_CONFIG_PATH.with_name('thora-transfer.example.toml')} to {DEFAULT_CONFIG_PATH} and edit it."
        )

    with path.open("rb") as handle:
        raw = tomllib.load(handle)

    phone_root = str(raw.get("phone_root", "/sdcard/Music/Thora")).rstrip("/")
    if not (phone_root.startswith("/sdcard/") or phone_root.startswith("/storage/")):
        raise ConfigError("phone_root must live under /sdcard/ or /storage/")

    sources: list[Source] = []
    seen_labels: set[str] = set()
    for entry in raw.get("sources", []):
        label = _validate_label(str(entry.get("label", "")))
        if label.casefold() in seen_labels:
            raise ConfigError(f"Duplicate source label: {label}")
        seen_labels.add(label.casefold())
        if "path" not in entry:
            raise ConfigError(f"Source {label} is missing 'path'")
        transcode = entry.get("transcode")
        if transcode is not None and transcode not in TRANSCODE_PROFILES:
            raise ConfigError(
                f"Source {label}: unknown transcode profile {transcode!r} (known: {', '.join(TRANSCODE_PROFILES)})"
            )
        sources.append(
            Source(
                label=label,
                path=_expand(str(entry["path"])),
                exclude=[str(item) for item in entry.get("exclude", [])],
                transcode=transcode,
            )
        )

    playlists = raw.get("playlists", {})
    remaps = [
        Remap(from_prefix=str(item["from"]), to_prefix=str(item.get("to", "")))
        for item in playlists.get("remap", [])
    ]

    auto_accept = float(playlists.get("auto_accept_score", 0.85))
    review = float(playlists.get("review_score", 0.60))
    if not 0 < review < auto_accept <= 1:
        raise ConfigError("Need 0 < playlists.review_score < playlists.auto_accept_score <= 1")

    formats = raw.get("formats", {})

    selection = None
    if "selection" in raw:
        selection_raw = raw["selection"]
        folders = [str(item).strip().strip("/") for item in selection_raw.get("folders", [])]
        for folder in folders:
            label = folder.split("/", 1)[0]
            if label.casefold() not in seen_labels:
                raise ConfigError(f"selection folder {folder!r}: {label!r} is not a source label")
        selection = Selection(playlists=bool(selection_raw.get("playlists", True)), folders=folders)

    return Config(
        path=path,
        state_dir=_expand(str(raw.get("state_dir", "~/ThoraTransfer"))),
        phone_root=phone_root,
        headroom_gb=float(raw.get("headroom_gb", 8)),
        device_serial=(str(raw["device_serial"]).strip() or None) if raw.get("device_serial") else None,
        sources=sources,
        remaps=remaps,
        playlist_extra_dirs=[_expand(str(item)) for item in playlists.get("extra_dirs", [])],
        auto_accept_score=auto_accept,
        review_score=review,
        extra_playable_exts={str(item).lower().lstrip(".") for item in formats.get("extra_playable", [])},
        selection=selection,
        folder_playlists=[
            (str(item["path"]), item.get("name")) if isinstance(item, dict) else (str(item), None)
            for item in playlists.get("folder_playlists", [])
        ],
        spotify_rosters_dir=_expand(str(playlists["spotify_rosters_dir"])) if playlists.get("spotify_rosters_dir") else None,
        accept_review_when_tags_agree=bool(playlists.get("accept_review_when_tags_agree", False)),
    )


# name -> (ffmpeg codec args, output extension)
TRANSCODE_PROFILES: dict[str, tuple[list[str], str]] = {
    "opus192": (["-c:a", "libopus", "-b:a", "192k", "-vbr", "on"], "opus"),
    "opus128": (["-c:a", "libopus", "-b:a", "128k", "-vbr", "on"], "opus"),
    "aac256": (["-c:a", "aac", "-b:a", "256k"], "m4a"),
}
