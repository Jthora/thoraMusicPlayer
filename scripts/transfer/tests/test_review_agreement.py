import unittest

from thora_transfer.playlists.command import tags_agree
from thora_transfer.playlists.matcher import LibTrack
from thora_transfer.playlists.normalize import artist_alternatives, norm_text
from thora_transfer.playlists.parsers import PlaylistEntry


def lib(rel_path, title=None, artist=None, duration_ms=None):
    return LibTrack(id=1, source="library", rel_path=rel_path, dest_rel=f"library/{rel_path}", title=title, artist=artist,
                    album_artist=None, album=None, duration_ms=duration_ms, isrc=None, segs=rel_path.split("/"),
                    norm_title=norm_text(title), norm_artists=artist_alternatives(artist), norm_album="")


class ReviewAgreementTest(unittest.TestCase):
    def test_artist_and_title_in_path_are_accepted(self):
        entry = PlaylistEntry(index=0, artist="Gradius III (SNES) Music", title="Press Start")
        self.assertTrue(tags_agree(entry, lib("Classic Game Music/Gradius III (SNES) Music - Press Start.mp3")))

    def test_same_title_by_another_artist_is_rejected(self):
        entry = PlaylistEntry(index=0, artist="FreePlay Music", title="Stonehenge")
        track = lib("Black Sabbath/1983 - Born Again/02 - Stonehenge.mp3", title="Stonehenge", artist="Black Sabbath")
        self.assertFalse(tags_agree(entry, track))

    def test_tags_match_across_copies(self):
        entry = PlaylistEntry(index=0, artist="Billy Idol", title="Eyes Without A Face", duration_ms=298_000)
        track = lib("Billy Idol/Greatest hits - 06 - Eyes without a face.mp3", title="Eyes Without a Face",
                    artist="Billy Idol", duration_ms=299_000)
        self.assertTrue(tags_agree(entry, track))

    def test_without_an_artist_durations_must_agree(self):
        entry = PlaylistEntry(index=0, title="Press Start", duration_ms=12_000)
        self.assertTrue(tags_agree(entry, lib("x/Press Start.mp3", title="Press Start", duration_ms=13_500)))
        self.assertFalse(tags_agree(PlaylistEntry(index=0, title="Press Start"), lib("x/Press Start.mp3", title="Press Start")))

    def test_very_different_lengths_are_different_versions(self):
        entry = PlaylistEntry(index=0, artist="Hybrid", title="Finished Symphony", duration_ms=240_000)
        track = lib("Hybrid/Finished Symphony.mp3", title="Finished Symphony", artist="Hybrid", duration_ms=480_000)
        self.assertFalse(tags_agree(entry, track))


if __name__ == "__main__":
    unittest.main()
