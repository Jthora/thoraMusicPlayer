# Second Pass Robustness Audit

Date: 2026-02-22  
Scope: Second static/manual audit pass focused on transactional integrity, persistence durability, and concurrency/race behavior across Kotlin stores/modules and React Native hooks.

## Method (Pass 2)

- Deep-read of native persistence paths:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/LibraryIndexStore.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/UserPlaylistStore.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/PlaylistImportPersistence.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/StorageAccessModule.kt`
- Traced bridge call paths through:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/MediaLibraryModule.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/PlaylistImporter.kt`
- Reviewed JS hook orchestration and potential re-entrancy in:
  - `app/src/features/playlists/useUserPlaylists.ts`
  - `app/src/features/library/useIndexedLibrary.ts`
  - `app/src/features/playlists/usePlaylistImport.ts`

## Summary

- Critical findings: 2
- High findings: 3
- Medium findings: 3
- Low findings: 1

Main risk theme in pass 2: incremental sync deletion semantics can remove valid records when scans are partial/limited, and playlist mutation paths are vulnerable to lost-update races under concurrent operations.

---

## Findings

### P2-001 (Critical) — Incremental sync can delete valid rows after partial scan limits
- Severity: Critical
- Area: Data integrity / index retention
- Evidence:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/MediaLibraryModule.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/LibraryIndexStore.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/MediaLibraryScanner.kt`
- Detail:
  - `runIncrementalMediaStoreSync(limit)` and `runIncrementalSafSync(limitPerRoot)` permit bounded scans.
  - `LibraryIndexStore.syncIncremental` always calls `removeMissingTracksForSource(...)`, deleting all existing rows not present in `seenUris`.
  - `MediaLibraryScanner` emits `ROOT_LIMIT_REACHED` diagnostics, but deletion still proceeds in the same transaction.
- Risk:
  - Any intentionally bounded incremental sync can prune valid, unscanned tracks (silent data loss in index).
- Recommendation:
  - Gate deletion behind a “full coverage” contract per source/root.
  - If scan is partial, skip deletion and emit explicit partial-scan snapshot flag.

### P2-002 (Critical) — SAF sync root identity collapse can trigger cross-root deletion
- Severity: Critical
- Area: Multi-root transactional correctness
- Evidence:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/MediaLibraryModule.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/LibraryIndexStore.kt`
- Detail:
  - SAF incremental calls `syncIncremental(..., sourceType = "SAF", sourceRoot = "TREE", tracks = allRootsMerged)`.
  - Deletion scope in `removeMissingTracksForSource` is keyed by `(source_type, source_root)`; all SAF roots share one synthetic root key.
- Risk:
  - Root-specific partial visibility/revoked grants can remove entries from other roots because all rows are in one deletion bucket.
- Recommendation:
  - Persist true root identity per track and sync each root independently (or pass root-qualified sourceRoot values).
  - Perform root-scoped deletion only when that specific root scan is complete.

### P2-003 (High) — Playlist reorder path is read-modify-write and race-prone
- Severity: High
- Area: Concurrency / lost updates
- Evidence: `app/android/app/src/main/java/com/androidmusicplayerapp/UserPlaylistStore.kt`
- Detail:
  - `moveTrack` reads the full playlist via `getPlaylistEntries` (outside write transaction), then begins transaction and rewrites rows.
  - Concurrent `addTrack`/`removeTrack`/`moveTrack` calls can interleave and overwrite each other’s updates.
- Risk:
  - User-visible reorder anomalies and silent loss of one mutation under rapid actions.
- Recommendation:
  - Move read+rewrite into one transaction with write lock semantics.
  - Add optimistic version check (playlist revision) to reject stale reorder attempts.

### P2-004 (High) — Foreign-key assumptions are unsafe without explicit enforcement
- Severity: High
- Area: Referential integrity
- Evidence:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/UserPlaylistStore.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/LibraryIndexStore.kt`
- Detail:
  - Tables define foreign keys, but SQLite foreign key enforcement is off unless explicitly enabled.
  - Stores do not enable `PRAGMA foreign_keys = ON` in open/config callbacks.
- Risk:
  - Orphaned child rows can accumulate (playlist entries or diagnostics), degrading consistency.
- Recommendation:
  - Enable FK constraints in DB configuration (`onConfigure`) and add cascading/deletion behavior intentionally.

### P2-005 (High) — Invalid playlist IDs can create orphan or hidden state
- Severity: High
- Area: Input validation / integrity
- Evidence:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/MediaLibraryModule.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/UserPlaylistStore.kt`
- Detail:
  - Bridge methods cast playlist IDs from JS doubles and directly mutate rows.
  - Store methods do not assert playlist existence before insert/update/delete operations.
- Risk:
  - Invalid IDs can succeed partially (especially if FK enforcement is off), creating unreachable entries.
- Recommendation:
  - Validate playlist existence at method entry and fail with explicit error code.

### P2-006 (Medium) — SharedPreferences set updates are non-transactional and can lose writes
- Severity: Medium
- Area: Persistence durability / concurrent updates
- Evidence:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/StorageAccessModule.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/OemSetupModule.kt`
- Detail:
  - Multiple features perform read-modify-write over `StringSet` + `apply()`.
  - Concurrent operations can race and overwrite updates; `apply()` is async and not crash-atomic for immediate process death.
- Risk:
  - Missing grants/events/snapshots under contention or abrupt process termination.
- Recommendation:
  - Use SQLite/Room for append-heavy audit logs and guarded updates.
  - If prefs remain, synchronize critical updates and use deterministic ordered serialization.

### P2-007 (Medium) — Playlist import history save is not strongly durable
- Severity: Medium
- Area: Crash consistency
- Evidence: `app/android/app/src/main/java/com/androidmusicplayerapp/PlaylistImportPersistence.kt`
- Detail:
  - Latest import summary writes via `apply()` without commit acknowledgment.
- Risk:
  - Recent import diagnostics can be missing after abrupt termination.
- Recommendation:
  - Use `commit()` for this user-visible summary or migrate history to SQLite with transaction.

### P2-008 (Medium) — JS playlist hook has overlapping async refresh/select races
- Severity: Medium
- Area: JS state coherence
- Evidence: `app/src/features/playlists/useUserPlaylists.ts`
- Detail:
  - `refreshPlaylists`, `createPlaylist`, `selectPlaylist`, and mutation handlers can overlap without in-flight/sequence guards.
  - Late responses can overwrite newer selected playlist/entries state.
- Risk:
  - UI state flicker, stale entry lists, and confusing status text under rapid interactions.
- Recommendation:
  - Introduce request tokens/sequence IDs and ignore stale completions.
  - Add per-operation in-flight guards for conflicting actions.

### P2-009 (Low) — Sync diagnostics omit machine-readable “partial/full coverage” flag
- Severity: Low
- Area: Operability / observability
- Evidence:
  - `app/android/app/src/main/java/com/androidmusicplayerapp/MediaLibraryScanner.kt`
  - `app/android/app/src/main/java/com/androidmusicplayerapp/LibraryIndexStore.kt`
- Detail:
  - Partial conditions are present as warning text, but snapshot rows do not encode a normalized coverage field.
- Risk:
  - Harder to enforce safe deletion policy and automate alerting/reporting.
- Recommendation:
  - Add structured snapshot fields (e.g., `coverage_mode=FULL|PARTIAL`, `root_limit_reached_count`).

---

## Prioritized Remediation Queue (Recommended)

1. P2-001 + P2-002: Redesign incremental delete semantics and root scoping before any wider rollout.
2. P2-003 + P2-004 + P2-005: Hardening of playlist transactional and referential integrity guarantees.
3. P2-006 + P2-007: Move high-value mutable prefs state to transactional persistence.
4. P2-008: Add JS-side operation sequencing/in-flight guards to remove user-visible race artifacts.
5. P2-009: Add explicit sync-coverage telemetry to support safe policy enforcement.

## Suggested Pass 3 Focus

- Failure-injection test pass for partial scans, revoked grants mid-sync, and process kill during writes.
- Native+JS concurrency stress harness for repeated playlist mutations and sync/mutation overlap.
- Verification that new deletion rules prevent false removals while still pruning stale records on full scans.
