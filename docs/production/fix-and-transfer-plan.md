# Plan: Tho'ra — fix roadmap, NAS → phone transfer, playlist recreation

## Status (2026-11-05)
- **Phase 0: done**, except pre-fetching Media3. That happens at the start of P2, and must happen while online.
- **Transfer + playlist tooling: built and verified.** All 27 unit tests pass. A full end-to-end run on the A3 (into `/sdcard/Music/Thora-test`, removed afterwards) checked:
  - push, verify and resume
  - prune
  - mtime preservation (`adb push` keeps the NAS mtime)
  - MediaStore count matching the files on disk
  - playlist repair across 7 formats, including the review round trip

  Runbook: `scripts/transfer/README.md`.
- **P1: done.** Results:
  - hook APIs use stable callbacks (`app/src/platform/hooks/useStableCallback.ts`)
  - the orchestrator is the single sync owner
  - JS no longer advances tracks or pushes position
  - the initial empty queue no longer wipes native's queue

  `app/__tests__/renderBudget.test.tsx` measures 2 s idle at 11 commits / 1 sync / 3 grant calls, down from 1,640 / 94 / 914. Not yet exercised on the device.
- **P2: code written, native build blocked by disk space.** Media3 1.9.3 is pinned. It's the newest release that builds with compileSdk 35 and doesn't pull in the Kotlin 2.2 stdlib.
  - Native:
    - `PlaybackService.kt` is a MediaSessionService + ExoPlayer: skip-on-error, play stats recorded natively, playback resumption.
    - `PlaybackQueueStore.kt` persists the queue, position and modes.
    - `PlaybackControlModule.kt` wraps a MediaController and emits `ThoraPlaybackState` / `ThoraQueueChanged` / `ThoraPlayerError`.
    - The manifest exports the service and adds `MediaButtonReceiver` and `WAKE_LOCK`.
    - minSdk 33.
  - JS:
    - `useNowPlayingState.ts` is event-driven with no polling.
    - `useFolderQueue.ts` mirrors the native queue and migrates the old MMKV queue once.
    - tsc, eslint and jest (24 tests) are clean.
  - The first `./gradlew :app:compileDebugKotlin` failed with ENOSPC (the Mac had 9.5 GB free; Gradle cache plus swap filled it), so the Kotlin is **not compiled yet**.
  - Next: free ≥15 GB, compile, install on the A3, then run the P2 device checklist.
- **Stabilization + redeploy (2026-11-09), in progress:**
  - `:app:compileDebugKotlin` now **passes** (P2 Kotlin compiles cleanly). Builds use a scratchpad wrapper: `--no-daemon`, in-process Kotlin, 2 workers, CMake job pool capped at 2, release lint skipped, abort below 1.2 GB free.
  - Found on the phone: the installed build (v1.0, May 3) is a Metro-dependent dev build, and its APK lacks the MMKV native lib, so `kvStore` ran on the in-memory fallback (theme/tab/search state lost each launch). Redeploy as a **release build** (JS embedded, signed with the same debug key → in-place update). App data backed up to the session scratchpad first.
  - Added: `ThoraDiagnostics.kt` (crash handler, ApplicationExitInfo history, player errors → `Android/data/com.thoraplayer/files/diagnostics/events.jsonl`, 512 KB × 2), JS `installGlobalErrorLogging` (isolated JS errors after mount no longer kill the process/music; error storms still restart), `AppErrorBoundary`, kvStore backend reporting, scan-history pruning (last 50 snapshots), version 1.1.0 (code 2). jest 32/32, tsc, eslint clean.
  - Device harness: `scripts/device-tests/thora_devicetest.py` (`fixtures`, `functional`, `soak`, `cleanup`). Fixtures are on the phone in `/sdcard/Music/Thora-test` (12 tracks, #05 corrupt).
  - Blocked on Mac disk again (~3 GB free, 12 GB swap): the release build needs more. After freeing space: `assembleRelease` → `functional --apk …` → `soak --minutes 60` → `cleanup`.
- **2026-11-10: v1.1.0 deployed + P2 verified on the A3.**
  - Builds: `scripts/build/build-android.sh :app:assembleRelease` (low-memory wrapper; ~4 min cold, ~1 min incremental).
  - All 15 functional device checks pass, including process death → media-button resume at the saved position, and 60 s of deep Doze. MMKV now works on the phone (`kvStore: mmkv`).
  - Media3 keeps a paused service in the foreground for ~10 min, and system media controls keep the process alive after that.
  - Harness lessons: uiautomator dumps fail while the progress bar animates (pause to read the UI); `am crash` shows a dialog that has to be closed; the phone has a PIN, so the screen-off Doze check runs last.
- **Playlist recovery (in progress):**
  - NAS `//agent@LS220D8F9.local/dataDrive_4TB`, reached over SMB (this macOS has no AFP client).
  - Music lives in `Music/` (~200 GB, mostly `All Music`), `Music/SpotifyBackerUpper` (3,400 tracks, 14 GB) and `Data Archive/Music` (207 GB).
  - Playlists:
    - 37 Winamp `.m3u` (old `C:\Users\Jordan\…` paths)
    - ~40 Spotify `playlist.m3u8`
    - FLAC Player+ `playlist.plist` (2 playlists)
    - ~110 album track lists (skipped)
  - Spotify: the account is gone but the playlists are still public. `thora-transfer spotify-rosters` recovers each roster from its public embed page (up to 100 tracks, plus the page's true item count). The IDs of all 76 playlists come from the 2025 backup zip's logs (`~/ThoraTransfer/spotify/playlist-rosters.json`).
  - Transfer tool additions:
    - `[selection]`: push only the songs playlists use, plus chosen folders
    - `folder_playlists`
    - name precedence: recovered roster > NAS file > folder
    - album-list skipping
    - FLAC Player+ plist parsing
    - line splitting that ignores U+0085
  - App importer rewritten (`PlaylistResolver.kt`):
    - It now creates or refreshes the playlist (before, it never did).
    - It matches exact path → path suffix → format change → tags → unique filename.
    - m3u/m3u8/pls/xspf, Windows-1252 fallback, multi-file picker.
  - Repair result:
    - 147 playlists and 6,896 entries; 6,429 matched (93%), 179 review, 288 not on the NAS.
    - Review matches are accepted only when artist and title agree (`accept_review_when_tags_agree`).
    - Selection: 4,953 tracks / 26.1 GB, approved by the user. Push started 15:49 at ~9 MB/s.
  - Next: `playlists --push` → import `_playlists/*.m3u8` in the app → speed tests on the real library.
- **App fixes from this pass:**
  - The production UI could not open or play a playlist (tapping only set the CREATE target). LIBRARY → PLAYLISTS now has a detail view with PLAY ALL, SHUFFLE, tap-to-play and a virtualized list. Verified on the A3.
  - Performance:
    - The playback clock moved out of the app shell (`LivePosition`, ticks once per displayed second), so the shell no longer re-renders twice a second while playing.
    - Visited tabs stay mounted via React 19.2 `<Activity>`: tab-switch p90 dropped from 129 ms to 69 ms.
    - MediaStore sync skips unchanged rows (a fingerprint map instead of rewriting every row on each start or resume) and logs `mediastore_sync` timings.
    - Playback `start_latency` is logged: skip and new queue take 135–196 ms on the A3.
  - Known limits for P3: browsing is capped at 500 songs (All Songs shows 80); the first visit to each tab still mounts.
- **On the phone (16:20–16:55):**
  - Push done: 4,953 files / 26.1 GB, 0 failures, 23.5 MB/s, nothing staged on the Mac.
  - 147 playlists imported in the app in 102 s: 6,400 of 6,429 entries resolved (99.5%), 6,407 of them by exact path.
  - Fusion Girl shows 77 songs; Liked Songs (Jul 2025) shows 1,320.
- **Speed on the real library (4,965 songs):**
  - Startup and sync:
    - Cold start 526 ms, warm 114 ms.
    - First sync: 0.86 s query + 3.5 s DB to insert 4,934 tracks.
    - Unchanged startup sync: ~0.76 s query + ~1.05 s DB with zero writes.
  - Playback:
    - Start (Fusion Girl, 77 songs) ~190–210 ms.
    - Long queues load progressively (`PROGRESSIVE_QUEUE_*`): 1,320-song PLAY ALL went from ~1.1 s to ~0.25 s, tap to sound. The rest of the queue fills in after audio starts.
    - Skips cost 195–245 ms on a short queue but 325–410 ms on a 1,320-song queue: something is O(n) per transition, probably the Media3 legacy queue being published to 7 system controllers. Needs a profileable build to confirm.
  - UI:
    - Scroll is 0.1% janky (p90 34 ms).
    - Tab switches are still p90 ~117 ms. Pre-mounting tabs hidden after startup made it worse (reverted), so the remaining cost is per-switch work, likely the effects that re-run when a tab is revealed (e.g., the LIBRARY playlist refresh). Next: audit those effects and profile with a profileable build plus the Hermes sampling profiler.
- **Test leftovers on the phone:** `Music/Thora-test` (12 fixtures + 5 test playlists) and 5 test playlists in the app. Remove them with `thora_devicetest.py cleanup` once testing is finished.

## Context
- **Why:** the code review found the app can't yet act as a real player: a runaway render/sync loop (measured: 1,640 commits + 94 full library syncs in 2 s idle), a broken playback engine (resume restarts the track, seek/repeat/shuffle are display-only, system controls don't change audio), a library capped at 100 songs, folder (SAF) indexing that throws `Map already consumed`, and a playlist importer that never actually creates a playlist.
- **Product goal (from you):** beat FLAC Player+ at organizing albums and playlists: easy in-app playlist building, broad import support, smart/pre-defined playlists, and repair of old playlists whose files moved, were renamed or changed format.
- **Music source:** a LAN-only network drive, reached later through a no-internet wired LAN on this Mac mini. The original dev machine stays offline, and `scripts/music-transfer-shortcuts.sh` (Linux paths, one-shot `adb push`) gets replaced.
- **Target:** this Redmi A3 only (2312CRNCCL, Android 16, 32-bit `armeabi-v7a`, 97 GB free, no SD card, `/sdcard/Music` empty). The Mac has **9.2 GB free**, so music is never staged locally; it streams NAS → Mac → phone over USB.

## Order of work
0. **Prep now while online:** this blocks everything that has to run offline later.
1. **P1:** stop the render loop. 2. **P2:** move playback to Media3. 3. **P3:** library data layer. 4. **P4:** first-class playlists. 5. **P5:** polish.
- **Transfer T1–T5** runs whenever the drive is connected and doesn't depend on the app work. Files land in MediaStore either way. Browsing past 100 songs needs P3, and importing repaired playlists in-app needs P4.

## Phase 0 — Prep (now, online)
- Add a `scripts/transfer/` Python package (stdlib plus `mutagen`) and a `scripts/transfer/.venv` with `mutagen` pinned. `ffprobe` (`/opt/homebrew/bin`) is the fallback.
- Add the Media3 dependencies (P2) early and run one `./gradlew :app:assembleDebug`, so the Gradle cache holds everything before going offline.
- Create a root `.gitignore` (none exists): `scripts/transfer/.venv/`, `scripts/transfer/thora-transfer.toml`, `__pycache__/`.
- Commit this plan as `docs/production/fix-and-transfer-plan.md`. Delete the superseded `scripts/music-transfer-shortcuts.sh`.
- `thora-transfer doctor` checks: Python ≥ 3.11 (`tomllib`), mutagen, ffprobe, adb plus authorized device `YXAECI79W8EQGE7X`, free space on the phone and the Mac.

## Transfer system — `scripts/transfer/` (`python -m thora_transfer <cmd>`)
- Config file `thora-transfer.toml`, with a committed `.example`. It holds:
  - the sources: `{label, mount_path, include/exclude}`
  - the phone root: `/sdcard/Music/Thora`
  - headroom (default 8 GB)
  - old→new path remaps for playlists
- State is a SQLite DB at `~/ThoraTransfer/state.db` (files, tags, plan, push status, playlist decisions). Reports go to `~/ThoraTransfer/reports/<ts>/`.

**T1 — Network bring-up runbook + `nas-check`:**
- Plug the cable into `en0`. If the LAN has no DHCP, set IPv4 manually with the LAN's subnet and **no router**. Then `en0` never becomes the default route and Wi-Fi internet keeps working.
- Wi-Fi is on 192.168.1.0/24. If the wired LAN uses the same subnet, turn Wi-Fi off during the transfer.
- Discover the drive with `dns-sd -B _smb._tcp`, `arp -a` and `smbutil view //host`.
- Mount **read-only**: Finder `smb://host/share` (credentials go in Keychain, never into config) or `mount_smbfs -o rdonly`.
- `nas-check` verifies the mount is readable, reports protocol and read-only status, and measures throughput. The tool only ever opens NAS files read-only.

**T2 — `inventory`:**
- Walk the sources and classify each file:
  - playable audio: mp3, flac, m4a (aac/alac), ogg, opus, wav
  - unsupported audio, reported: ape, wv, dsf/dff, wma
  - playlists: m3u/m3u8/pls/xspf/wpl/csv/xml
  - everything else is skipped
- Read tags with mutagen: title, artist, album artist, album, track/disc, year, genre, duration, codec, sample rate/bit depth.
- Incremental: files are keyed by (path, size, mtime).
- Duplicates: compare size plus a hash of the file's head and tail, and do a full hash only when those collide.

**T3 — `plan`:**
- Map each file to `/sdcard/Music/Thora/<label>/<relative path>`.
- Sanitize names to FAT-safe forms (`:*?"<>|\`, trailing dots/spaces, 255-byte components).
- Detect case-insensitive collisions, since Android shared storage is case-insensitive.
- Push one copy of each exact duplicate and record the others as aliases, so playlists still match.
- Check capacity against phone free space minus headroom. If it doesn't fit, report per-source sizes and stop. Options then: pick sources, or turn on an optional per-source transcode (e.g., FLAC→Opus 192k into a small temp dir). Transcoding is off by default.
- `--dry-run` prints the plan.

**T4 — `push`:**
- Batch files by destination folder: `adb -s <serial> push --sync -Z <files…> <dir>`.
- After each batch, verify sizes with a single `adb shell find … -exec stat -c '%s|%n' {} +`. Re-push mismatches **without** `--sync`: an interrupted push leaves a partial file with a newer mtime, which `--sync` would skip.
- Resumable from `state.db`.
- Finish with `adb shell content call --uri content://media --method scan_volume --arg external_primary` (verified on this phone).
- Optional `--verify-hash` spot-check with toybox `md5sum`.
- It never deletes. `prune` is a separate command: dry-run by default and limited to `/sdcard/Music/Thora/`.

**T5 — `report` + `pull-playlists`:**
- `report`: counts and sizes per source; unsupported files, duplicates, collisions and failures; and a MediaStore cross-check (count of files under `Music/Thora/`).
- `pull-playlists`: `adb pull` the in-app exports (`Music/Thora/_playlists/exported/`) back to the state dir. The app has `allowBackup=false`, so playlists built on the phone would otherwise be lost.

## Playlist recreation — `thora_transfer playlists`
- **Inputs:**
  - m3u/m3u8 (including `#EXTINF`), pls, xspf, wpl
  - CSV (Spotify/Exportify-style: track, artist, album, duration, ISRC)
  - Apple Music/iTunes Library XML
  - plain "Artist - Title" text
- **Matching ladder.** The first confident hit wins, and every row records which rule matched and its score.
  1. Exact path after the configured remaps (e.g., `/home/jono/workspace/github/spotifyBackerUpper/` → `spotifyBackerUpper/`).
  2. Longest path-suffix match (handles moved parent folders).
  3. Same folder and file name, different extension (handles mp3→flac).
  4. Normalized name: case, accents and punctuation, track-number prefixes, "(Remastered …)", "feat." are all ignored. Ties are broken by how similar the parent folder or album is.
  5. Tags: artist + title (± 3 s on duration, with a bonus for matching album), taken from EXTINF/CSV/XML.
  6. Fuzzy match above a threshold goes to **review** and is never auto-accepted.
- **Outputs, per playlist:**
  - A canonical UTF-8 `.m3u8` with `#EXTINF`, using paths relative to the playlist (`../<label>/…`). It's pushed to `/sdcard/Music/Thora/_playlists/`.
  - `review.csv`: edit the chosen match and re-run; decisions are saved in `state.db`.
  - An unresolved list.
  - Re-runs are idempotent.
- **Spec:** `docs/production/playlist-matching-spec.md` defines the ladder and normalization once. The in-app importer (P4) implements the same rules, so the script and app always agree.

## App fixes
### P1 — Stop the render loop (small PR)
- Wrap every hook's returned functions in `useCallback` and return a memoized object. Hooks: `useFolderGrants`, `useIndexedLibrary`, `useAudioPermission`, `useSearchBrowse`, `useUserPlaylists`, `useFolderQueue`, `useDeviceSetupGuidance`, `useMediaStoreScan`, `useSafRootScan`, `usePlaylistImport`. Read the latest state through refs where needed (e.g., `setAnchorByIndex`).
- `useBackgroundSyncOrchestrator.ts`: refresh folder grants only on startup and resume. The `ProductionAppShell.tsx` bootstrap effect runs once per permission change, guarded by a ref.
- `useNowPlayingState.ts`: remove the JS end-of-track advance and the per-second `setPlaybackProgress` push. Native completion becomes the only thing that advances tracks; otherwise fixing the loop exposes the skipped-track race. Move the side effects out of the setState updater.
- Keep the probe as `app/__tests__/renderBudget.test.tsx`. Budget for 2 s idle: ≤ ~10 commits, ≤ 2 `getFolderGrants` calls, ≤ 1 sync.

### P2 — Playback engine on Media3
- Replace `PlaybackService.kt` with a Media3 `MediaSessionService` running ExoPlayer. Native owns the queue, index, repeat (off/all/one), shuffle and position.
- `PlaybackControlModule.kt` holds a `MediaController` and posts every command to the main looper.
  - Commands: `setQueue(tracks, startIndex, startPositionMs)`, `play`/`pause`/`seekTo`/`next`/`previous`/`skipTo`, repeat/shuffle, queue move/remove/insert.
  - Events go out through `emitDeviceEvent`: `playbackState`, `mediaItemTransition`, `queueChanged`, `playerError`.
  - JS derives the display position from `{positionMs, elapsedRealtime, isPlaying}`, so there's no per-second bridge traffic.
- Media3 provides out of the box:
  - real seeking and resume-in-place
  - gapless playback
  - lowering volume for other apps (ducking) instead of pausing
  - Bluetooth, lock-screen and quick-settings controls
  - a notification with metadata that opens the app on tap
  - skipping unplayable files (with an error event) instead of stopping
- Save queue, index and position natively, so playback resumes after the process is killed.
- `useNowPlayingState.ts` becomes a thin event subscriber. Queue edits in `useFolderQueue.ts` call native, so tapping a queue row plays it. Drop the full-queue MMKV write on every track change.
- Raise `minSdk` from 24 to 33 and drop the legacy code paths.

### P3 — Library data layer
- **Scanner:**
  - Index track, disc, year, genre, album artist (stored separately), composer, bitrate, date added, and the compilation flag where available.
  - Use Kotlin data classes internally instead of `WritableMap`. This also fixes the `Map already consumed` bug in `MediaLibraryScanner.kt`.
- **Incremental sync:**
  - Use `MediaStore.getGeneration` to fetch only changed rows, and skip unchanged ones.
  - Keep only the last N snapshots and diagnostics.
  - Soft-delete tracks with a `missing_since` timestamp, so play stats and playlist links survive files briefly disappearing. Purge after N days.
- **Schema v5:** an FTS4 search table with prefix matching, and debounced search-as-you-type.
- **Queries:**
  - Paged SQL for songs, albums, artists, folders and genres, with real counts.
  - Albums keyed by (album, album artist) with compilation handling. This fixes the `GROUP BY lower(album)` merge in `LibraryBrowseReader.kt`.
  - Album tracks ordered by disc, then track.
- **Feeds:**
  - Recently Added uses date added, tie-broken by the NAS file mtime (`adb push` preserves it).
  - Most Played and Recently Played use the existing `getPopularTracks`/`getRecentlyPlayedTracks`.
  - Delete `pseudoPopularityScore`.
- **UI:**
  - Remove the 100/80/8 caps.
  - Each screen gets a single FlashList that pages with `onEndReached`, with no ScrollView wrapper.
  - Drop the `key={activeTab}` remount.
  - Split the 2,676-line `ProductionAppShell.tsx` into one screen per tab.
- **Folder (SAF) scanning:** walk folders with `DocumentsContract` child cursors, read tags with `MediaMetadataRetriever`, and drop the 100-per-folder cap. This is lower priority, since transferred music lands in MediaStore.

### P4 — Playlists first-class
- **Model** (`UserPlaylistStore.kt` migration):
  - Each playlist gets a `kind` (manual | smart | imported), `source_path`, `rules_json` and `sort`.
  - Entries keep a stable identity (full relative path, title, artist, album, duration) alongside the URI.
  - When an entry's URI vanishes, it re-resolves through the matching ladder (self-healing playlists).
- **Importer rewrite** (`PlaylistImporter.kt`):
  - Create or update the playlist, idempotent by source path.
  - Formats: m3u/m3u8/pls/xspf/csv.
  - Match on full path (`relative_path` + `display_name`). Today's `LIKE` on the folder-only `relative_path` almost never matches, and the filename fallback picks the wrong "01 - Intro.mp3".
  - Use the spec's ladder.
  - "Import folder": a folder grant on `Music/Thora/_playlists` imports everything there and re-syncs on demand.
  - A review screen for ambiguous rows.
- **Smart playlists:**
  - Rules are compiled to SQL (field/op/value, all/any, sort, limit) and update live.
  - Built-ins: Recently Added, Most Played, Recently Played, Never Played, Forgotten Favorites (many plays, none in 90 days), Often Skipped, Lossless, Hi-Res, By Decade, By Genre, Long Tracks, and an automatic playlist per folder.
- **Building UX:**
  - Multi-select in every list → add to an existing or new playlist.
  - Add a whole album, artist, folder or set of search results.
  - Add the current track from Now Playing and the mini dock.
  - Save the queue as a playlist.
  - Drag to reorder, undo for remove, and a duplicate warning.
- **Export:** write `.m3u8` (via SAF create-document) to `Music/Thora/_playlists/exported/`. `pull-playlists` brings them back to the Mac.

### P5 — Organization + robustness polish
- Artwork: MediaStore `loadThumbnail` with an LRU cache. Today a ♪ glyph stands in everywhere.
- Use typed status objects instead of parsing status strings, and log or surface errors instead of empty `catch {}` blocks.
- `kvStore.ts`: fall back to AsyncStorage (already a dependency) instead of memory.
- Font: apply it with a themed `Text` wrapper, since React 19 ignores `Text.defaultProps`.
- Move the reliability/debug tools behind a dev toggle.
- **Out of scope** (Redmi A3 only): 64-bit ABI, release keystore, R8, Play Store hardening.

## Verification
- **Transfer, before the drive exists:**
  - Build a fixture "NAS" folder with ffmpeg: tagged FLAC/MP3/Opus files, an `.ape`, duplicates, case collisions, illegal characters, and a broken playlist in each format.
  - Run `doctor → inventory → plan --dry-run → push` into `/sdcard/Music/Thora-test/`. Check sizes and the MediaStore count with `adb shell content query`, then delete the test folder.
  - Run `python -m unittest` for the normalization and the matching ladder.
- **Connection day:** `nas-check` → `inventory` → `plan --dry-run`, then review whether it fits in 97 GB minus headroom → `push` → `playlists` → `report`.
- **P1:** `renderBudget.test.tsx` and the full jest suite pass.
- **P2, on the A3:**
  - pause/resume keeps position
  - seek works
  - repeat off/all/one and shuffle work
  - Bluetooth, lock-screen and quick-settings next/previous change the audio
  - a corrupt file is skipped
  - the notification shows the title and opens the app
  - after killing the app, Bluetooth play resumes
- **P3:**
  - the index count equals the MediaStore count
  - a second sync makes 0 updates
  - same-titled albums by different artists stay separate
  - the full library scrolls smoothly
- **P4:**
  - fixture playlists resolve to the spec's expected counts
  - a file moved on the phone re-links after sync
  - smart playlists update after plays
