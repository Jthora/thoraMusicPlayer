# Phase 7 — Cross-Flow Tap Budget Verification

Date: 2026-02-22  
Scope: Post-Phase-6 UX structure (`Library`, `Search`, `Playlists`, `Now Playing`, `Settings`)

## Method

- Verification based on current shipped interaction paths in shell/panel code and active UI structure.
- Tap count includes deliberate UI presses only (typing text is excluded).
- Counts are measured from each flow’s natural entry surface (not cold app launch unless stated).

## Flow Results

### 1) First play from Library (ready state)

Preconditions:
- `permissionStatus=Granted`
- at least one granted folder
- `songs.length > 0`
- app lands on `Library` tab

Path:
1. Tap `PLAY FROM LIBRARY`.

Observed behavior:
- Library handler calls `browseSongs()`, then moves to `Now Playing` and triggers `playFromBrowse()`.

Tap count:
- **1 tap**

Target check:
- PASS (`<= 4` warm-path target and `<= 5` launch target envelope)

---

### 2) Resume playback when paused queue exists

Preconditions:
- `currentTrack` exists
- playback is paused
- mini player dock is visible

Path A (global quickest path):
1. Tap mini-player primary control (`▶`).

Path B (from Now Playing):
1. Tap `PLAY` on `Now Playing` panel.

Tap count:
- **1 tap** (both paths)

Target check:
- PASS (`<= 1`)

---

### 3) Add from Search to selected playlist

Preconditions:
- a playlist is already selected (`selectedPlaylistId !== null`)
- user is in `Search` tab

Path:
1. Tap `RUN SEARCH`.
2. Tap row `ADD` on desired result.

Tap count:
- **2 taps**

Target check:
- PASS (`<= 2`)

---

### 4) Play from Playlist Detail

Preconditions:
- user is in `Playlists` tab with a selected playlist
- `Playlists Detail` sub-page is open

Observed current behavior:
- Playlist detail rows now expose explicit `PLAY` action.
- Long-press sheet includes `PLAY FROM HERE` as primary action.
- Playback path is wired by loading playlist entries into active queue and starting playback from selected position.

Path:
1. Tap `PLAY` on desired playlist detail row.

Tap count:
- **1 tap**

Target check:
- PASS

## Phase 7 Summary

- PASS: 4 of 4 target flows (first-play, resume, add-to-playlist, playlist-detail play).
- Residual gap closed by explicit playlist-detail playback wiring in shell + playlist panel.

## Gate Evidence (current pass)

- `npm run test:p0:prioritize` → `P0_BLOCKER_SUMMARY=CLEAR`, `TOTAL_BLOCKERS=0`
- `npm run test:p0:debug` → `P0_DEBUG_BUNDLE=PASS`
- UI automation lanes remain skip-by-default policy (`RUN_UI_AUTOMATION=1` to opt in).
