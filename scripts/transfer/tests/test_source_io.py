import os
import tempfile
import unittest
import zipfile
from pathlib import Path

from thora_transfer import source_io
from thora_transfer.config import Source
from thora_transfer.inventory import _is_excluded


class SourceIoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.data = os.urandom(300_000)  # > 2 quick-hash chunks, so head and tail both count
        (root / "folder").mkdir()
        (root / "folder" / "Artist - Song.mp3").write_bytes(self.data)
        self.zip_path = root / "liked.zip"
        with zipfile.ZipFile(self.zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("Artist - Song.mp3", self.data)
            archive.writestr("__MACOSX/._Artist - Song.mp3", b"junk")
        self.folder = Source("library", root / "folder")
        self.archive = Source("liked", self.zip_path)
        source_io._archives.clear()

    def tearDown(self):
        source_io._archives.clear()
        self.tmp.cleanup()

    def test_zip_paths_are_archive_sources(self):
        self.assertTrue(source_io.is_archive(self.archive))
        self.assertFalse(source_io.is_archive(self.folder))
        self.assertTrue(source_io.source_available(self.archive))

    def test_members_are_listed_without_mac_junk(self):
        members = list(source_io.iter_archive_members(self.archive, [], _is_excluded))
        self.assertEqual([rel for rel, _ in members], ["Artist - Song.mp3"])
        self.assertEqual(members[0][1].st_size, len(self.data))

    def test_hashes_match_between_a_plain_file_and_a_deflated_member(self):
        name = "Artist - Song.mp3"
        size = len(self.data)
        self.assertEqual(source_io.quick_hash(self.folder, name, size, 64 * 1024),
                         source_io.quick_hash(self.archive, name, size, 64 * 1024))
        self.assertEqual(source_io.full_hash(self.folder, name), source_io.full_hash(self.archive, name))

    def test_tag_target_reads_only_the_head_but_reports_the_real_size(self):
        target = source_io.tag_target(self.archive, "Artist - Song.mp3", len(self.data))
        self.assertEqual(target.seek(0, 2), len(self.data))
        target.seek(0)
        self.assertEqual(target.read(16), self.data[:16])
        self.assertIsInstance(source_io.tag_target(self.folder, "Artist - Song.mp3", len(self.data)), Path)

    def test_local_file_extracts_one_member_with_its_date_and_cleans_up(self):
        tmp_dir = Path(self.tmp.name) / "tmp"
        mtime_ns = 1_700_000_000_000_000_000
        with source_io.local_file(self.archive, "Artist - Song.mp3", mtime_ns, tmp_dir) as path:
            self.assertEqual(path.read_bytes(), self.data)
            self.assertEqual(path.stat().st_mtime_ns, mtime_ns)
        self.assertEqual(list(tmp_dir.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
