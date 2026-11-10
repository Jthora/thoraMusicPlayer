import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from thora_transfer.config import Config, Selection, Source
from thora_transfer.selection import selected_file_ids
from thora_transfer.state import connect


def make_config(selection):
    return Config(
        path=Path("x.toml"), state_dir=Path("."), phone_root="/sdcard/Music/Thora", headroom_gb=8,
        device_serial=None, sources=[Source("library", Path("/nas/Music")), Source("archive", Path("/nas/Archive"))],
        remaps=[], playlist_extra_dirs=[], auto_accept_score=0.85, review_score=0.6, extra_playable_exts=set(),
        selection=selection,
    )


class SelectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = connect(Path(self.tmp.name) / "state.db")
        files = [
            (1, "library", "Touhou/01 Song.mp3"),
            (2, "library", "touhou/Disc 2/02 Song.flac"),
            (3, "library", "Touhou Extra/03 Song.mp3"),  # same prefix text, different folder
            (4, "archive", "Nujabes/01 Aruarian.mp3"),
            (5, "archive", "Mixes/copy of Aruarian.mp3"),  # exact duplicate of 4
            (6, "library", "Other/06.mp3"),
        ]
        for file_id, source, rel in files:
            self.conn.execute(
                "INSERT INTO files(id, source, rel_path, size, mtime_ns, kind, ext, last_seen_run) VALUES (?, ?, ?, ?, 0, 'audio', 'mp3', 1)",
                (file_id, source, rel, 1_000_000 * file_id),
            )
            duplicate_of = 4 if file_id == 5 else None
            action = "skip_duplicate" if duplicate_of else "copy"
            self.conn.execute(
                "INSERT INTO plan(file_id, dest_rel, action, duplicate_of) VALUES (?, ?, ?, ?)",
                (file_id, f"{source}/{rel}", action, duplicate_of),
            )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_no_selection_means_everything(self):
        self.assertIsNone(selected_file_ids(make_config(None), self.conn))

    def test_folders_match_case_insensitively_on_whole_components(self):
        ids = selected_file_ids(make_config(Selection(playlists=False, folders=["library/Touhou"])), self.conn)
        self.assertEqual(ids, {1, 2})

    def test_playlist_matches_map_duplicates_to_the_pushed_copy(self):
        self.conn.execute("INSERT INTO playlist_matches VALUES ('p', 'a', 5)")
        self.conn.execute("INSERT INTO playlist_matches VALUES ('p', 'b', 6)")
        ids = selected_file_ids(make_config(Selection(playlists=True, folders=["archive/Nujabes"])), self.conn)
        self.assertEqual(ids, {4, 6})

    def test_playlists_flag_off_ignores_matches(self):
        self.conn.execute("INSERT INTO playlist_matches VALUES ('p', 'b', 6)")
        config = make_config(Selection(playlists=False, folders=[]))
        self.assertEqual(selected_file_ids(config, self.conn), set())
        self.assertEqual(selected_file_ids(replace(config, selection=Selection(True, [])), self.conn), {6})


if __name__ == "__main__":
    unittest.main()
