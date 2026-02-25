# Requirements Specification

This document defines normative requirements for the initial build.

## Priority Definitions

- **Must**: required for initial build acceptance
- **Should**: strong target for initial build; may ship with documented mitigation
- **Could**: optional enhancement; defer if schedule risk emerges

## Functional Requirements

### RQ-001 Library Discovery (Must)

The app must discover local audio files through Android-compatible methods and build an internal track catalog.

Acceptance criteria:

- Discovers MP3 files at minimum
- Stores indexed track records in app-local DB
- Supports rescan and updates changed records

### RQ-002 Folder-First Playback (Must)

Selecting a folder must generate a dynamic queue from tracks in that folder scope.

Acceptance criteria:

- Queue generation is deterministic under selected sort mode
- Missing/unreadable files are skipped non-fatally
- User can start playback directly from folder view

### RQ-003 Playlist File Support (Must)

The app must import playlist files and expose them in a dedicated playlists area.

Acceptance criteria:

- Supports `.m3u` and `.m3u8` in initial build
- Relative and absolute path resolution is attempted
- Unresolved entries are reported without whole-import failure

### RQ-004 User Playlist Editing (Must)

The app must allow creating, editing, and ordering user-defined playlists.

Acceptance criteria:

- Create playlist
- Add/remove tracks
- Reorder entries
- Persist changes across restarts

### RQ-005 Playback Controls (Must)

The app must support core media transport behavior.

Acceptance criteria:

- Play/pause/seek/next/previous
- Queue operations are stable under repeated actions
- Lock screen/notification controls are functional

### RQ-006 Background Playback (Must)

Playback must continue when app is backgrounded and screen is off.

Acceptance criteria:

- Foreground service used for playback
- Survives normal short background duration under device policy
- Handles audio focus and noisy-audio events

### RQ-007 Search and Organization (Must)

The app must provide searchable organization views.

Acceptance criteria:

- Search by filename/title/artist/album/folder path
- Browse by albums and artists
- Browse full songs listing

### RQ-008 Device Setup Guidance (Should)

The app should include guidance for OEM settings affecting playback reliability.

Acceptance criteria:

- Documents battery optimization and autostart setup steps
- Provides clear user-facing guidance when background restrictions are detected

## Non-Functional Requirements

### NFR-001 Reliability (Must)

- No critical crash during 30+ minute playback test
- No app crash on malformed playlist input

### NFR-002 Performance (Should)

- Queue start latency after tap should be under ~1.5s for local tracks
- UI interactions should remain responsive during incremental scan

### NFR-003 Compatibility (Must)

- App must run on current connected Xiaomi Android 15 test device
- Native dependencies must retain `armeabi-v7a` support

### NFR-004 Observability (Should)

- Structured logs for scanner/parser/playback errors
- Diagnostics for unresolved playlist entries

## Out of Scope (Initial Build)

- Cloud sync
- Streaming services
- Android Auto
- Equalizer/DSP advanced controls
- Smart playlists/rules engine

## Requirement Traceability

Each requirement should map to at least one test case in `qa-test-matrix.md` and one acceptance checklist item in `development-validation-checklist.md`.
