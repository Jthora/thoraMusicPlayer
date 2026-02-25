# App Baseline Architecture and MVP Scope

## Product Goal

Provide reliable offline playback of a long-lived personal music archive with two equal but distinct paradigms:

1. **Folders (Primary)**: folders become dynamic runtime playlists
2. **Playlists (Secondary)**: imported playlist files and user-authored playlists

## Architectural Priorities

- Keep playback resilient even when metadata is incomplete
- Make folder behavior deterministic and transparent
- Keep parser/scanner/playback concerns decoupled
- Keep data model migration-friendly for future features

## Core Functional Areas

- Library ingestion and indexing
- Playback engine and queue management
- Folder-based browsing and playback
- Playlist-file import/parsing and user playlist editing
- Search and metadata-based browsing

## Proposed Module Topology

- `app/ui`: screens, navigation, presentation models
- `app/domain/playback`: queue model, playback commands, session state
- `app/domain/library`: tracks/albums/artists/folders queries
- `app/domain/playlists`: playlist import/export and edit operations
- `app/domain/search`: index query orchestration and ranking
- `app/data/scanner`: MediaStore + SAF scanning and delta detection
- `app/data/parser`: m3u/pls/xspf parser adapters and diagnostics
- `app/data/storage`: local DB and schema migrations
- `app/platform/android`: permissions, intents, foreground service bridge

This naming is illustrative; implementation may adapt naming while preserving boundary intent.

## Suggested Data Model

- `Track` (uri/path, title, artist, album, duration, trackNo, mime, mtime, size)
- `Folder` (path/tree metadata, track count)
- `PlaylistFile` (source uri/path, format, parse status, entry count)
- `PlaylistEntry` (ordered track references, unresolved diagnostics)
- `UserPlaylist` (editable list, persisted in app DB)
- `ScanSnapshot` (last scan time, scan strategy, delta stats)

### Expanded entity requirements

- `Track.id`: stable primary key independent of transient URI changes when possible
- `Track.pathOrUri`: canonicalized value used for resolver matching
- `Track.contentHash` (optional): future dedup enhancement
- `Folder.id`: normalized path key
- `PlaylistEntry.status`: `resolved` | `unresolved` | `duplicate` | `missing`
- `ScanSnapshot.delta`: counts for `added/updated/removed/skipped/error`

## Storage/Index Strategy

Use a hybrid approach:

- MediaStore query for broad discovery and core metadata
- SAF-granted roots for folder-first deterministic navigation and playback
- App-local DB for normalized search index, playlist state, and unresolved path tracking

### Data flow summary

1. Scanner pulls source records from MediaStore and SAF roots
2. Normalizer canonicalizes paths/URIs and metadata fields
3. DB upserts entities and relationships
4. Search index materialization updates tokenized fields
5. UI queries consume indexed snapshots and not raw scans

## Playback Engine Requirements

- Background playback via foreground service
- Queue APIs: add/replace/reorder/remove
- Audio focus handling and noisy-audio events (headphone disconnect)
- Notification + lockscreen controls
- Resume from last queue/state

Additional required behaviors:

- Handle noisy-audio transitions (headphone unplug) safely
- Handle transient/permanent audio focus loss according to Android policy
- Maintain queue pointer integrity through insert/remove operations
- Provide idempotent command handling for duplicate user taps

## Folder Queue Generation Rules

When user selects a folder, queue generation must:

1. Enumerate eligible tracks under selected folder scope
2. Apply active sort mode and optional recursive depth policy
3. Exclude unreadable/missing items with non-fatal diagnostics
4. Construct queue atomically to avoid partial playback states

Default sort precedence (when metadata is sparse):

1. Track number (if valid)
2. Filename lexical order
3. Last modified time as tie-breaker

## MVP Feature Scope

### Included

- Scan local audio and index core metadata
- Folders page with dynamic queue generation
- Now Playing + Queue
- Basic search (title/artist/album/file/folder)
- Playlist import for `.m3u/.m3u8`
- Basic user playlist create/edit

MVP quality bars:

- No critical crash during core browse/play actions
- Queue operations remain consistent under rapid user interaction
- Library scan remains responsive with progress indication

### Deferred

- Equalizer
- Android Auto
- Smart playlists/rules engine
- Advanced artwork fetching pipeline

Deferred but predesigned:

- Playlist export options beyond `.m3u8`
- Cross-device sync of user playlists
- Advanced DSP/equalization controls

## Architecture Boundaries

- Keep scanner isolated from playback engine
- Keep playlist parser isolated from UI layer
- Keep queue state in a single source of truth
- Keep path resolution and SAF URI handling in dedicated utility layer

Boundary guardrails:

- UI layer cannot directly mutate DB records without domain use-cases
- Scanner cannot call playback APIs
- Parser emits diagnostics objects, not UI strings
- Storage layer returns typed models rather than view-specific shapes

## Suggested Milestones

1. Baseline app launch + playback service integration
2. Scanner/index + folder browse/play
3. Playlist file import + user playlist editor
4. Search and library organization screens
5. Hardening against OEM background limits and storage edge-cases

## Performance and Reliability Targets (Initial)

- Cold app start to interactive home: target < 3s on test device
- Queue start latency after tap: target < 1.5s for local tracks
- Incremental rescan on small deltas: target < 10s (archive size dependent)
- Continuous playback endurance: 30+ minutes without critical failure

## Observability Requirements

- Structured logs for scanner, parser, playback commands, and permission outcomes
- Persistent non-PII diagnostics for unresolved playlist entries
- Crash reports categorized by module (`scanner`, `parser`, `playback`, `storage`, `ui`)
