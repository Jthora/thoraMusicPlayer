import unittest

from thora_transfer.config import Remap
from thora_transfer.playlists.matcher import (
    STATUS_MATCHED,
    STATUS_REVIEW,
    STATUS_UNRESOLVED,
    STATUS_UNSUPPORTED,
    LibraryIndex,
    LibTrack,
    Matcher,
    PlaylistContext,
)
from thora_transfer.playlists.normalize import artist_alternatives, norm_text, path_segments
from thora_transfer.playlists.parsers import PlaylistEntry


def track(track_id, source, rel_path, title, artist, album, duration_ms=200_000, isrc=None):
    return LibTrack(
        id=track_id,
        source=source,
        rel_path=rel_path,
        dest_rel=f"{source}/{rel_path}",
        title=title,
        artist=artist,
        album_artist=None,
        album=album,
        duration_ms=duration_ms,
        isrc=isrc,
        segs=path_segments(f"{source}/{rel_path}"),
        norm_title=norm_text(title),
        norm_artists=artist_alternatives(artist),
        norm_album=norm_text(album),
    )


LIBRARY = [
    track(1, "library", "Radiohead/OK Computer/01 - Airbag.flac", "Airbag", "Radiohead", "OK Computer", 284_000),
    track(2, "library", "Radiohead/OK Computer/02 - Paranoid Android.flac", "Paranoid Android", "Radiohead", "OK Computer", 383_000),
    track(3, "library", "Album A/01 - Intro.mp3", "Intro", "Band A", "Album A", 60_000),
    track(4, "library", "Album B/01 - Intro.mp3", "Intro", "Band B", "Album B", 95_000),
    track(5, "spotifyBackerUpper", "output/Daft Punk - Get Lucky.mp3", "Get Lucky", "Daft Punk", "Random Access Memories",
          369_000, isrc="USQX91300108"),
    track(6, "library", "Bowie/Heroes/03 Heroes.flac", "Heroes", "David Bowie", "Heroes", 371_000),
]


def matcher():
    index = LibraryIndex(LIBRARY, aliases={"library/Old Dupes/Airbag.flac": 1})
    remaps = [Remap("/home/jono/workspace/github/spotifyBackerUpper/", "spotifyBackerUpper/")]
    return Matcher(index, remaps, auto_accept=0.85, review=0.60)


class MatcherTests(unittest.TestCase):
    def assertMatched(self, result, track_id, rule=None):
        self.assertEqual(result.status, STATUS_MATCHED, msg=f"{result}")
        self.assertEqual(result.track.id, track_id)
        if rule:
            self.assertEqual(result.rule, rule)

    def test_exact_via_remap(self):
        entry = PlaylistEntry(0, location="/home/jono/workspace/github/spotifyBackerUpper/output/Daft Punk - Get Lucky.mp3")
        self.assertMatched(matcher().match(entry), 5, "exact")

    def test_relative_to_playlist_location(self):
        entry = PlaylistEntry(0, location="../OK Computer/02 - Paranoid Android.flac")
        context = PlaylistContext(source="library", rel_dir="Radiohead/Playlists")
        self.assertMatched(matcher().match(entry, context), 2, "exact")

    def test_moved_parent_folders_suffix(self):
        entry = PlaylistEntry(0, location="D:\\Old Music\\Radiohead\\OK Computer\\01 - Airbag.flac")
        self.assertMatched(matcher().match(entry), 1, "suffix")

    def test_format_change(self):
        entry = PlaylistEntry(0, location="/mnt/music/Radiohead/OK Computer/01 - Airbag.mp3")
        self.assertMatched(matcher().match(entry), 1, "format")

    def test_renamed_file_normalized_name(self):
        entry = PlaylistEntry(0, location="/old/OK Computer/Radiohead - Paranoid Android.mp3", duration_ms=383_500)
        self.assertMatched(matcher().match(entry), 2, "name")

    def test_ambiguous_intro_uses_hints_or_goes_to_review(self):
        bare = PlaylistEntry(0, location="/elsewhere/01 - Intro.mp3")
        self.assertEqual(matcher().match(bare).status, STATUS_REVIEW)
        hinted = PlaylistEntry(0, location="/elsewhere/01 - Intro.mp3", artist="Band B", title="Intro", duration_ms=95_000)
        self.assertMatched(matcher().match(hinted), 4)

    def test_tags_only_csv_row_and_isrc(self):
        by_tags = PlaylistEntry(0, title="Heroes - 2017 Remaster", artist="David Bowie", duration_ms=371_000)
        self.assertMatched(matcher().match(by_tags), 6, "tags")
        by_isrc = PlaylistEntry(0, title="whatever", isrc="USQX91300108")
        self.assertMatched(matcher().match(by_isrc), 5, "isrc")

    def test_remote_url_with_hint_still_matches_by_tags(self):
        entry = PlaylistEntry(0, location="https://open.spotify.com/track/x", hint="Daft Punk - Get Lucky")
        self.assertMatched(matcher().match(entry), 5, "tags")
        bare_url = PlaylistEntry(0, location="https://example.com/stream")
        self.assertEqual(matcher().match(bare_url).status, STATUS_UNSUPPORTED)

    def test_fuzzy_goes_to_review_never_auto(self):
        entry = PlaylistEntry(0, title="Paranoid Androids", artist="Radiohed")
        result = matcher().match(entry)
        self.assertEqual(result.status, STATUS_REVIEW)
        self.assertEqual(result.candidates[0].track.id, 2)

    def test_duplicate_alias_resolves_to_kept_copy(self):
        entry = PlaylistEntry(0, location="Old Dupes/Airbag.flac")
        self.assertMatched(matcher().match(entry, PlaylistContext(source="library", rel_dir="")), 1)

    def test_unknown_is_unresolved(self):
        entry = PlaylistEntry(0, location="/x/Completely Unknown.ogg", title="Nope", artist="Nobody")
        self.assertEqual(matcher().match(entry).status, STATUS_UNRESOLVED)


if __name__ == "__main__":
    unittest.main()
