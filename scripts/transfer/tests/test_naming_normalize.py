import unicodedata
import unittest

from thora_transfer.naming import collision_key, sanitize_component, sanitize_rel_path, with_suffix_counter
from thora_transfer.playlists.normalize import (
    artist_alternatives,
    clean_location,
    norm_text,
    path_segments,
    split_artist_title,
    stem_variants,
)


class NamingTests(unittest.TestCase):
    def test_illegal_characters_and_trailing_dots(self):
        self.assertEqual(sanitize_component('AC/DC: "Live"?'.replace("/", "_")), "AC_DC_ _Live__")
        self.assertEqual(sanitize_component("Album..."), "Album")
        self.assertEqual(sanitize_component("  spaced  "), "spaced")
        self.assertEqual(sanitize_component("..."), "_")

    def test_nfc_normalization(self):
        decomposed = unicodedata.normalize("NFD", "Beyoncé.flac")
        self.assertEqual(sanitize_component(decomposed), unicodedata.normalize("NFC", "Beyoncé.flac"))

    def test_long_names_keep_extension_within_255_bytes(self):
        name = ("é" * 200) + ".flac"
        cleaned = sanitize_component(name)
        self.assertTrue(cleaned.endswith(".flac"))
        self.assertLessEqual(len(cleaned.encode("utf-8")), 255)

    def test_rel_path_and_counters(self):
        self.assertEqual(sanitize_rel_path("A:B/./C|D.mp3"), "A_B/C_D.mp3")
        self.assertEqual(with_suffix_counter("x/Song.flac", 2), "x/Song (2).flac")
        self.assertEqual(collision_key("A/Song.MP3"), collision_key("a/song.mp3"))


class NormalizeTests(unittest.TestCase):
    def test_version_noise_is_stripped_but_versions_are_kept(self):
        self.assertEqual(norm_text("Heroes - 2017 Remaster"), "heroes")
        self.assertEqual(norm_text("Heroes (Remastered 2017)"), "heroes")
        self.assertEqual(norm_text("Song (feat. Someone) [Explicit]"), "song")
        self.assertEqual(norm_text("Song (Live)"), "song live")
        self.assertEqual(norm_text("Song - Radio Edit"), "song radio edit")
        self.assertEqual(norm_text("Sigur Rós & Friends"), "sigur ros and friends")

    def test_stem_variants(self):
        variants = stem_variants("03 - Artist - Title")
        self.assertIn("title", variants)
        self.assertIn("artist title", variants)
        self.assertIn("99 problems", stem_variants("99 Problems"))
        self.assertIn("99 problems", stem_variants("07 - 99 Problems"))
        self.assertEqual(stem_variants("1979"), {"1979"})

    def test_artists_and_titles(self):
        self.assertEqual(split_artist_title("A - B - C"), ("A", "B - C"))
        self.assertEqual(split_artist_title("Just Title"), (None, "Just Title"))
        self.assertEqual(artist_alternatives("Daft Punk, Pharrell Williams")[:3],
                         ["daft punk pharrell williams", "daft punk", "pharrell williams"])

    def test_locations(self):
        self.assertEqual(clean_location("file:///home/jono/Music/A%20B.mp3"), ("/home/jono/Music/A B.mp3", False))
        self.assertEqual(clean_location("C:\\Music\\x.mp3"), ("/Music/x.mp3", False))
        self.assertTrue(clean_location("https://example.com/x.mp3")[1])
        self.assertEqual(path_segments("a/./b/../C.mp3"), ["a", "c.mp3"])


if __name__ == "__main__":
    unittest.main()
