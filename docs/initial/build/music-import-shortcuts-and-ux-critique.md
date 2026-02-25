# Music Import Notes, Shortcuts, and UX Critique

Date: 2026-02-22

## 1) Source Music References (spotifyBackerUpper)

Primary source root:

- `/home/jono/workspace/github/spotifyBackerUpper`

Observed inventory snapshot:

- Audio files: `~5,155`
- Audio size: `~29.25 GB`
- Playlist-like files: `~187`

Largest top-level audio locations:

- `output` (`~16.06 GB`, `~1,738` files)
- `liked_songs_17jul2025` (`~5.20 GB`, `~1,321` files)
- `playlist_downloads` (`~5.19 GB`, `~1,352` files)
- `downloads` (`~2.62 GB`, `~713` files)

Playlist files to import are present (example):

- `/home/jono/workspace/github/spotifyBackerUpper/output/playlists/*.m3u8`

## 2) Shortcut References

Use these shell variables to avoid typing long paths repeatedly:

```bash
export MUSIC_SRC_ROOT="/home/jono/workspace/github/spotifyBackerUpper"
export MUSIC_SRC_OUTPUT="$MUSIC_SRC_ROOT/output"
export MUSIC_SRC_PLAYLISTS="$MUSIC_SRC_ROOT/output/playlists"
export MUSIC_SRC_LIKED="$MUSIC_SRC_ROOT/liked_songs_17jul2025"
export MUSIC_SRC_PL_DL="$MUSIC_SRC_ROOT/playlist_downloads"
export MUSIC_SRC_DOWNLOADS="$MUSIC_SRC_ROOT/downloads"

export MUSIC_DST_ROOT="/sdcard/Music/spotifyBackerUpper"
```

Quick checks:

```bash
adb shell df -h /sdcard
adb shell ls -la "$MUSIC_DST_ROOT" || true
```

## 3) Staged Transfer Commands (Recommended)

### Stage A (fastest first-use)

```bash
adb shell mkdir -p "$MUSIC_DST_ROOT"
adb push "$MUSIC_SRC_OUTPUT" "$MUSIC_DST_ROOT/output"
adb push "$MUSIC_SRC_PLAYLISTS" "$MUSIC_DST_ROOT/playlists"
```

### Stage B (expand library)

```bash
adb push "$MUSIC_SRC_LIKED" "$MUSIC_DST_ROOT/liked_songs_17jul2025"
adb push "$MUSIC_SRC_PL_DL" "$MUSIC_DST_ROOT/playlist_downloads"
```

### Stage C (full archive)

```bash
adb push "$MUSIC_SRC_DOWNLOADS" "$MUSIC_DST_ROOT/downloads"
```

## 4) In-App Steps to Load Immediately

1. Open app.
2. Tap `Request Audio Permission`.
3. Tap `Pick Folder Root` and select `/sdcard/Music/spotifyBackerUpper`.
4. Run scan/index actions.
5. Import `.m3u/.m3u8` from copied playlists folder.
6. Use Search/Browse or Folder Queue to play.

## 5) UX Critique (Current App)

Current UI is functionally strong but UX is not production-standard for a music app.

Main issues:

- Single long page with all tools/panels mixes setup, diagnostics, scanning, queue, playback, reliability, and admin actions.
- No clear first-run funnel to “play music now”.
- No bottom tab navigation or persistent app-level IA (Information Architecture).
- Critical controls are easy to miss due to scroll depth.
- Language feels engineer-facing in many places (`scan`, `sync`, diagnostics-heavy labels).

First-open UX gap:

- Typical user intent: **grant access → see songs → tap play**.
- Current flow: user must understand many panels and decide between multiple technical actions before playback.

Consecutive-use UX gap:

- Music apps usually reopen into Library/Home/Now Playing context.
- Current app re-exposes full operational surface each time, increasing friction for routine listening.

## 6) What Typical Music Apps Do

Typical first-open:

1. Welcome screen with one main CTA (`Allow Music Access`).
2. Optional source selection (device folders, imports).
3. Automatic scan progress view.
4. Immediate landing in playable Library view.

Typical ongoing UX:

- Bottom tabs: `Home`, `Library`, `Search`, `Playlists`, `Now Playing` (or mini-player).
- Persistent mini-player bar with play/pause + current track.
- Settings in top-right or profile tab.
- Reliability/debug/advanced tools hidden in `Settings > Advanced`.

## 7) High-Impact IA Redesign (Minimal to Implement First)

Phase 1 (must-have):

- Add navigation with tabs: `Library`, `Search`, `Playlists`, `Now Playing`, `Settings`.
- Make first-run wizard:
  - Permission request
  - Folder selection
  - Initial scan
  - Auto-navigate to Library
- Keep reliability/test panels behind `Settings > Advanced`.

Phase 2:

- Add empty-state CTAs in each tab (`No songs yet → Scan now`).
- Add recent/most-played shortcuts on Home/Library top section.

## 8) UX Success Criteria (Play Right Away)

- New user reaches first playback in <= 3 taps after app open.
- Returning user reaches playback controls in <= 1 tap from any tab.
- No critical music action requires scrolling through non-music diagnostic panels.
