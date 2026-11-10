"""Build a fake 'NAS' tree with real tagged audio + broken playlists, for end-to-end runs.

Usage: python tests/make_fixture.py <out_dir>
Then point a test config's [[sources]] at <out_dir>/library and <out_dir>/spotifyBackerUpper.
"""

from __future__ import annotations

import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

TRACKS = [
    # (relative path, title, artist, album, track, seconds, extra metadata)
    ("library/Radiohead/OK Computer/01 - Airbag.flac", "Airbag", "Radiohead", "OK Computer", 1, 4, {}),
    ("library/Radiohead/OK Computer/02 - Paranoid Android.flac", "Paranoid Android", "Radiohead", "OK Computer", 2, 6, {}),
    ("library/Album A/01 - Intro.mp3", "Intro", "Band A", "Album A", 1, 2, {}),
    ("library/Album B/01 - Intro.mp3", "Intro", "Band B", "Album B", 1, 3, {}),
    ("library/Bowie/Heroes/03 Heroes.opus", "Heroes", "David Bowie", "Heroes", 3, 5, {}),
    ("library/Odd/What?.mp3", "What", "Odd Band", "Odd", 1, 2, {}),
    ("library/Odd/What_.mp3", "What Underscore", "Odd Band", "Odd", 2, 3, {}),
    ("library/Odd/Beyonce\u0301 Song.mp3", "Song", "Beyonce\u0301", "Odd", 3, 2, {}),
    ("spotifyBackerUpper/output/Daft Punk - Get Lucky.mp3", "Get Lucky", "Daft Punk", "Random Access Memories", 8, 5,
     {"TSRC": "USQX91300108"}),
    ("spotifyBackerUpper/liked_songs/Heroes - 2017 Remaster.mp3", "Heroes - 2017 Remaster", "David Bowie", "Heroes", 3, 5, {}),
]

CODEC_ARGS = {
    ".flac": ["-c:a", "flac"],
    ".mp3": ["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3"],
    ".opus": ["-c:a", "libopus", "-b:a", "96k"],
}


def make_audio(path: Path, title, artist, album, track, seconds, extra) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frequency = 200 + (hash(title) % 600)
    metadata = {"title": title, "artist": artist, "album": album, "track": str(track), "date": "1997", "genre": "Rock", **extra}
    command = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={seconds}"]
    for key, value in metadata.items():
        command += ["-metadata", f"{key}={value}"]
    command += CODEC_ARGS[path.suffix] + [str(path)]
    subprocess.run(command, check=True)


def main(out_dir: str) -> None:
    root = Path(out_dir)
    if root.exists():
        shutil.rmtree(root)
    for rel, title, artist, album, track, seconds, extra in TRACKS:
        make_audio(root / rel, title, artist, album, track, seconds, extra)

    airbag = root / "library/Radiohead/OK Computer/01 - Airbag.flac"
    (root / "library/Dupes").mkdir(parents=True)
    shutil.copy2(airbag, root / "library/Dupes/Airbag copy.flac")  # byte-identical duplicate
    (root / "library/Old").mkdir(parents=True)
    (root / "library/Old/rare.ape").write_bytes(b"MAC \x96\x0f" + b"\0" * 2048)  # unsupported format
    (root / "library/Radiohead/OK Computer/cover.jpg").write_bytes(b"\xff\xd8\xff\xe0" + b"\0" * 512)
    (root / "library/Radiohead/OK Computer/._01 - Airbag.flac").write_bytes(b"\0\x05\x16\x07")  # AppleDouble junk
    (root / "library/@eaDir/junk").mkdir(parents=True)
    (root / "library/@eaDir/junk/thumb.jpg").write_bytes(b"x")
    (root / "library/.DS_Store").write_bytes(b"x")

    playlists = root / "spotifyBackerUpper/playlists"
    playlists.mkdir(parents=True)
    # Old Linux absolute paths -> needs the remap.
    (playlists / "old linux.m3u").write_text(
        "#EXTM3U\n"
        "#EXTINF:5,Daft Punk - Get Lucky\n"
        "/home/jono/workspace/github/spotifyBackerUpper/output/Daft Punk - Get Lucky.mp3\n"
        "#EXTINF:5,David Bowie - Heroes\n"
        "/home/jono/workspace/github/spotifyBackerUpper/liked_songs/Heroes - 2017 Remaster.mp3\n",
        encoding="utf-8",
    )
    library_playlists = root / "library/Playlists"
    library_playlists.mkdir(parents=True)
    # Moved folders, changed format (mp3 -> flac), relative entry, ambiguous Intro, unknown, URL.
    (library_playlists / "moved and renamed.m3u8").write_text(
        "#EXTM3U\n#PLAYLIST:Moved And Renamed\n"
        "D:\\Old Music\\Radiohead\\OK Computer\\01 - Airbag.mp3\n"
        "../Album B/01 - Intro.mp3\n"
        "/somewhere/else/01 - Intro.mp3\n"
        "#EXTINF:6,Radiohead - Paranoid Android\n"
        "/old/stuff/Radiohead - Paranoid Android.mp3\n"
        "/gone/Never Existed.mp3\n"
        "https://example.com/stream.mp3\n",
        encoding="utf-8",
    )
    (library_playlists / "liked.csv").write_text(
        '"Track URI","Track Name","Artist Name(s)","Album Name","Track Duration (ms)","ISRC"\n'
        '"spotify:track:1","Get Lucky (feat. Pharrell Williams)","Daft Punk, Pharrell Williams","Random Access Memories","5000","USQX91300108"\n'
        '"spotify:track:2","Heroes - 2017 Remaster","David Bowie","Heroes","5000",""\n'
        '"spotify:track:3","Paranoid Androids","Radiohed","OK Computer","6000",""\n',
        encoding="utf-8",
    )
    (library_playlists / "mix.xspf").write_text(
        '<?xml version="1.0"?><playlist version="1" xmlns="http://xspf.org/ns/0/"><title>XSPF Mix</title><trackList>'
        "<track><location>file:///Volumes/old/Bowie/Heroes/03%20Heroes.mp3</location><title>Heroes</title>"
        "<creator>David Bowie</creator></track></trackList></playlist>",
        encoding="utf-8",
    )
    (library_playlists / "radio.pls").write_text(
        "[playlist]\nFile1=C:\\Music\\Album A\\01 - Intro.mp3\nTitle1=Band A - Intro\nLength1=2\nNumberOfEntries=1\n",
        encoding="utf-8",
    )
    library_xml = {
        "Tracks": {
            "10": {"Name": "Airbag", "Artist": "Radiohead", "Album": "OK Computer", "Total Time": 4000,
                   "Location": "file:///Users/old/Music/iTunes/Radiohead/OK%20Computer/01%20Airbag.m4a"},
        },
        "Playlists": [
            {"Name": "Library", "Master": True, "Playlist Items": [{"Track ID": 10}]},
            {"Name": "iTunes Faves", "Playlist Items": [{"Track ID": 10}]},
        ],
    }
    (library_playlists / "Library.xml").write_bytes(plistlib.dumps(library_xml))
    print(f"fixture written to {root}")


if __name__ == "__main__":
    main(sys.argv[1])
