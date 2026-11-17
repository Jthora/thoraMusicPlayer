import sqlite3
import tempfile
import unittest
from pathlib import Path

from thora_transfer.playlists.merged import build_merged, name_key, read_order_log


def make_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE files (id INTEGER PRIMARY KEY, rel_path TEXT, title TEXT, artist TEXT, duration_ms INTEGER, mtime_ns INTEGER);
        CREATE TABLE plan (file_id INTEGER PRIMARY KEY, dest_rel TEXT, action TEXT, duplicate_of INTEGER);
    """)
    return conn


def add(conn, file_id, rel_path, title, artist, duration_ms, mtime_ns, dest_rel=None, duplicate_of=None):
    conn.execute("INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)", (file_id, rel_path, title, artist, duration_ms, mtime_ns))
    conn.execute("INSERT INTO plan VALUES (?, ?, ?, ?)",
                 (file_id, dest_rel, "copy" if dest_rel else "skip_duplicate", duplicate_of))


class MergedPlaylistTest(unittest.TestCase):
    def test_log_and_file_names_give_the_same_key(self):
        self.assertEqual(name_key("Aurora, Naimee Coleman - Ordinary World (feat. Naimee Coleman)"),
                         name_key("Aurora Naimee Coleman - Ordinary World feat. Naimee Coleman"))

    def test_songs_once_newer_likes_first_then_log_order(self):
        conn = make_db()
        # Mar 2026 copies (best copies); "New Song" was liked after the log was written.
        add(conn, 1, "X - Old A.mp3", "Old A", "X", 100_000, 5, dest_rel="liked2026/X - Old A.mp3")
        add(conn, 2, "X - New Song.mp3", "New Song", "X", 100_000, 9, dest_rel="liked2026/X - New Song.mp3")
        add(conn, 3, "X - Old B.mp3", "Old B", "X", 100_000, 7, dest_rel="liked2026/X - Old B.mp3")
        # The Jul 2025 copy of Old B: same song, other file (lower bitrate), listed in the Jul playlist.
        add(conn, 4, "liked_songs_17jul2025/X - Old B.mp3", "Old B", "X", 100_500, 1,
            dest_rel="spotifyBackerUpper/liked_songs_17jul2025/X - Old B.mp3")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "Liked Songs (Mar 2026).m3u8").write_text(
                "#EXTM3U\n#EXTINF:100,X - Old A\n../liked2026/X - Old A.mp3\n../liked2026/X - New Song.mp3\n../liked2026/X - Old B.mp3\n",
                encoding="utf-8")
            (out / "Liked Songs (Jul 2025).m3u8").write_text(
                "#EXTM3U\n../spotifyBackerUpper/liked_songs_17jul2025/X - Old B.mp3\n", encoding="utf-8")
            log = out / "successful_downloads.txt"
            log.write_text(
                "2025-07-17 03:12:50.1: X - Old B - https://open.spotify.com/track/b\n"
                "2025-07-17 03:13:50.1: X - Old A - https://open.spotify.com/track/a\n", encoding="utf-8")
            self.assertEqual(read_order_log(log), {"x old b": 0, "x old a": 1})
            out_file, songs, newer = build_merged(conn, out, "Liked Songs",
                                                  ["Liked Songs (Mar 2026)", "Liked Songs (Jul 2025)"], [log])
            lines = [line for line in out_file.read_text(encoding="utf-8").splitlines() if not line.startswith("#")]
            self.assertEqual((songs, newer), (3, 1))
            # Old B is listed in both playlists: it appears once, as the Mar 2026 copy.
            self.assertEqual(lines, ["../liked2026/X - New Song.mp3", "../liked2026/X - Old B.mp3", "../liked2026/X - Old A.mp3"])


if __name__ == "__main__":
    unittest.main()
