# QA + Acceptance Matrix

## Core Startup
- App launches directly into music experience.
- No setup-first dead-end surface on open.
- Permission prompt behavior remains valid.

## Navigation
- Tabs present and functional: Home, Search, Your Library, Create, Settings.
- No tab transition crash/redbox.

## Home
- Sections visible: Recently Added, Last Played, Popular Songs.
- Empty states are actionable and non-blocking.

## Your Library
- Defaults to All Songs every time.
- Pills switch correctly.
- All Songs sort modes produce correct ordering:
  - Name, Album, Artist, Last Played, Most Played, Length

## Search
- Dropdown scope filtering works for each option.
- All scope includes songs/albums/artists/playlists.

## Playback Modes
- Stop at End, Repeat, Repeat-1, Random all behave as specified.
- Behavior consistent across manual and automatic transitions.

## Create
- Playlist can be created and populated from songs.

## Theme
- Preset change applies globally.
- Custom theme applies and persists after restart.

## Regression
- Existing playlist import/manage actions unaffected.
- No new runtime crashes in stress navigation loop.
