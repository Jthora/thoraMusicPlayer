import unittest
from pathlib import Path

from thora_transfer.playlists.command import PlaylistSource, _is_album_list, _rank, playlist_name_key
from thora_transfer.playlists.matcher import PlaylistContext
from thora_transfer.playlists.parsers import ParsedPlaylist, PlaylistEntry, parse_file


def playlist(fmt, *locations, name="x"):
    return ParsedPlaylist(name=name, fmt=fmt, entries=[PlaylistEntry(index=i, location=loc) for i, loc in enumerate(locations)])


def nas_source(path):
    return PlaylistSource(key=f"library:{path}", path=Path("/nas") / path, context=PlaylistContext(source="library", rel_dir=str(Path(path).parent)))


class PlaylistCollectionTest(unittest.TestCase):
    def test_name_key_ignores_case_quotes_underscores_punctuation(self):
        self.assertEqual(playlist_name_key("Jono Tho’ra"), playlist_name_key("Jono_Tho'ra"))
        self.assertEqual(playlist_name_key("Go+ Action"), playlist_name_key("Go_Action"))
        self.assertNotEqual(playlist_name_key("[Official] - FusionGirl"), playlist_name_key("Fusion Girl"))

    def test_album_track_lists_are_skipped_but_spotify_playlists_are_not(self):
        album = playlist("m3u", "01-kid cudi-in my dreams.mp3", "02-kid cudi-soundtrack 2 my life.mp3")
        self.assertTrue(_is_album_list(nas_source("All Music/Kid Cudi/00-kid cudi-man on the moon.m3u"), album))
        spotify = playlist("m3u8", "ACDC - Thunderstruck.mp3")
        self.assertFalse(_is_album_list(nas_source("SpotifyBackerUpper/playlist_downloads/Roadtrip/playlist.m3u8"), spotify))
        winamp = playlist("m3u", "C:\\Users\\Jordan\\Desktop\\Average-Girl.mp3", "Media\\All Music\\x.mp3")
        self.assertFalse(_is_album_list(nas_source("Winamp Playlists copy/FusionGirl.m3u"), winamp))
        extra = PlaylistSource(key="file:/x.m3u", path=Path("/x.m3u"), context=PlaylistContext())
        self.assertFalse(_is_album_list(extra, album))  # files given explicitly are always kept

    def test_recovered_spotify_roster_outranks_files_and_folders(self):
        rosters = Path("/state/spotify/rosters")
        roster = PlaylistSource(key="file:/state/spotify/rosters/Canorbius.csv", path=rosters / "Canorbius.csv", context=PlaylistContext())
        self.assertLess(_rank(roster, playlist("csv"), rosters), _rank(nas_source("a/playlist.m3u8"), playlist("m3u8"), rosters))
        self.assertLess(_rank(nas_source("a/playlist.m3u8"), playlist("m3u8"), rosters), _rank(nas_source("a"), playlist("folder"), rosters))
        other_csv = PlaylistSource(key="file:/elsewhere/x.csv", path=Path("/elsewhere/x.csv"), context=PlaylistContext())
        self.assertEqual(_rank(other_csv, playlist("csv"), rosters), 1)

    def test_spotify_playlist_file_is_named_after_its_folder(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "All_American_Roadtrip_by_Baum" / "playlist.m3u8"
            path.parent.mkdir()
            path.write_bytes("\ufeff#EXTM3U\n# Generated automatically\nACDC - Thunderstruck.mp3\n".encode("utf-8"))
            parsed = parse_file(path)
            self.assertEqual(parsed[0].name, "All American Roadtrip by Baum")
            self.assertEqual([e.location for e in parsed[0].entries], ["ACDC - Thunderstruck.mp3"])


if __name__ == "__main__":
    unittest.main()
