import plistlib
import unittest
from pathlib import Path

from thora_transfer.playlists.parsers import NotAPlaylist, parse_file


def parse(name: str, content):
    data = content.encode("utf-8") if isinstance(content, str) else content
    return parse_file(Path(name), data=data)


class ParserTests(unittest.TestCase):
    def test_m3u_with_extinf_and_name(self):
        (playlist,) = parse("road.m3u8", "#EXTM3U\n#PLAYLIST:Road Trip\n#EXTINF:215,Artist - Song\nMusic/a.mp3\nb.flac\n")
        self.assertEqual(playlist.name, "Road Trip")
        self.assertEqual(len(playlist.entries), 2)
        first = playlist.entries[0]
        self.assertEqual((first.location, first.artist, first.title, first.duration_ms), ("Music/a.mp3", "Artist", "Song", 215000))
        self.assertIsNone(playlist.entries[1].title)

    def test_m3u_cp1252_fallback(self):
        (playlist,) = parse("old.m3u", "Café/song.mp3\n".encode("cp1252"))
        self.assertEqual(playlist.entries[0].location, "Café/song.mp3")

    def test_pls(self):
        (playlist,) = parse("x.pls", "[playlist]\nFile1=/a/b.mp3\nTitle1=Art - T\nLength1=100\nNumberOfEntries=1\n")
        entry = playlist.entries[0]
        self.assertEqual((entry.location, entry.artist, entry.title, entry.duration_ms), ("/a/b.mp3", "Art", "T", 100000))

    def test_xspf(self):
        xml = """<?xml version="1.0"?><playlist version="1" xmlns="http://xspf.org/ns/0/"><title>Mix</title>
        <trackList><track><location>file:///m/a.flac</location><title>A</title><creator>B</creator>
        <album>C</album><duration>1000</duration></track></trackList></playlist>"""
        (playlist,) = parse("m.xspf", xml)
        self.assertEqual(playlist.name, "Mix")
        entry = playlist.entries[0]
        self.assertEqual((entry.location, entry.title, entry.artist, entry.album, entry.duration_ms),
                         ("file:///m/a.flac", "A", "B", "C", 1000))

    def test_wpl(self):
        xml = '<?wpl version="1.0"?><smil><head><title>W</title></head><body><seq><media src="..\\x\\y.wma"/></seq></body></smil>'
        (playlist,) = parse("w.wpl", xml)
        self.assertEqual((playlist.name, playlist.entries[0].location), ("W", "..\\x\\y.wma"))

    def test_exportify_csv(self):
        csv_text = ('"Track URI","Track Name","Artist Name(s)","Album Name","Track Duration (ms)","ISRC"\n'
                    '"spotify:track:1","Song","A, B","Alb","201000","USX1"\n')
        (playlist,) = parse("liked.csv", csv_text)
        entry = playlist.entries[0]
        self.assertEqual((entry.title, entry.artist, entry.album, entry.duration_ms, entry.isrc),
                         ("Song", "A, B", "Alb", 201000, "USX1"))

    def test_csv_without_track_columns_is_not_a_playlist(self):
        with self.assertRaises(NotAPlaylist):
            parse("budget.csv", "date,amount\n2024-01-01,5\n")

    def test_itunes_xml(self):
        library = {
            "Tracks": {"1": {"Name": "T", "Artist": "A", "Album": "L", "Total Time": 1000, "Location": "file:///x/t.m4a"}},
            "Playlists": [
                {"Name": "Library", "Master": True, "Playlist Items": [{"Track ID": 1}]},
                {"Name": "Faves", "Playlist Items": [{"Track ID": 1}]},
            ],
        }
        playlists = parse("Library.xml", plistlib.dumps(library))
        self.assertEqual([item.name for item in playlists], ["Faves"])
        self.assertEqual(playlists[0].entries[0].title, "T")


if __name__ == "__main__":
    unittest.main()
