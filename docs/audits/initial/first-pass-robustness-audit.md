# First Pass Robustness Audit

Date: 2026-02-21  
Scope: First static/manual audit pass focused on runtime error handling, edge-case behavior, race conditions, native/JS boundary safety, and test harness resilience.

## Method (Pass 1)

- Reviewed React Native feature hooks and top-level composition in `app/App.tsx`.
- Reviewed native modules and service logic in Android Kotlin bridge/services.
- Reviewed automation and validation scripts under `scripts/`.
- Looked specifically for silent failure paths, weak type assumptions, race-prone flows, brittle selectors, and evidence/reporting integrity gaps.

## Summary

- Critical findings: 1
- High findings: 5
- Medium findings: 5
- Low findings: 2

This codebase has solid functional coverage, but robustness is currently limited by broad silent error handling, weak boundary validation, and a few state-model mismatches.

---

## Findings

### F-001 (Critical) — Native reliability event/snapshot persistence can lose data
- Severity: Critical
- Area: Native persistence integrity
- Evidence: `app/android/app/src/main/java/com/thoraplayer/OemSetupModule.kt`
- Detail:
  - Events/snapshots/idle sessions are serialized into `StringSet` values (`toSet()`), which are deduplicated and unordered by design.
  - This can drop duplicate-but-valid entries and compromise chronological reliability evidence.
- Risk:
  - Audit/report evidence may be incomplete or reordered under repeated events.
  - Weakens trust in hardening and release-gate artifacts.
- Recommendation:
  - Replace `StringSet` persistence with ordered storage (JSON array string or SQLite table).
  - Preserve insertion order and allow duplicate events.

### F-002 (High) — Silent catch blocks mask root causes across major user flows
- Severity: High
- Area: Error observability and debuggability
- Evidence:
  - `app/src/features/reliability/useDeviceSetupGuidance.ts`
  - `app/src/features/playlists/useUserPlaylists.ts`
  - `app/src/features/library/useIndexedLibrary.ts`
  - `app/src/features/playlists/usePlaylistImport.ts`
  - `app/src/features/storage/useFolderGrants.ts`
- Detail:
  - Many `catch { ... }` paths set generic status text and drop the original exception.
- Risk:
  - Hard to diagnose production failures and intermittent issues.
  - Recovery guidance cannot be tailored to error class.
- Recommendation:
  - Capture and classify error details (code/message/source op).
  - Emit structured diagnostic events while keeping UX-friendly messaging.

### F-003 (High) — Playback UI state model diverges from actual service/player state
- Severity: High
- Area: Playback consistency
- Evidence:
  - `app/src/features/playback/useNowPlayingState.ts`
  - `app/android/app/src/main/java/com/thoraplayer/PlaybackService.kt`
- Detail:
  - JS now-playing progress is synthetic timer-driven and not sourced from native playback state.
  - Service `NEXT/PREVIOUS` handlers only refresh state and do not advance a native queue.
- Risk:
  - User-visible drift between UI and actual playback behavior.
  - Incorrect edge-case handling after interruptions/background transitions.
- Recommendation:
  - Introduce a single source of truth from native playback state events.
  - Wire explicit queue index/track transitions for next/previous in service/module contract.

### F-004 (High) — Weak TS boundary validation on native payloads
- Severity: High
- Area: JS/native type safety
- Evidence: `app/src/features/library/useIndexedLibrary.ts`, `app/src/native/modules.ts`
- Detail:
  - Uses unchecked cast (`as SyncStatus`) on `getLatestSyncStatus()` union return.
- Risk:
  - Runtime undefined fields and false status rendering if native payload shape changes.
- Recommendation:
  - Add runtime guards/type predicates before consuming bridge payloads.
  - Normalize bridge responses to stable discriminated shapes.

### F-005 (High) — Playlist grant handling can report granted=true even when grant persistence fails
- Severity: High
- Area: Storage access correctness
- Evidence: `app/android/app/src/main/java/com/thoraplayer/StorageAccessModule.kt`
- Detail:
  - `pickPlaylistFile` wraps `takePersistableUriPermission` in `runCatching` and ignores failure but still returns `granted=true`.
- Risk:
  - False-positive UX, later file access failures, poor recovery path.
- Recommendation:
  - Return real grant status and distinguish transient URI vs persisted grant.
  - Surface actionable recovery message when persistence fails.

### F-006 (High) — Relative playlist resolution uses playlist filename as base path
- Severity: High
- Area: Playlist parser accuracy
- Evidence: `app/android/app/src/main/java/com/thoraplayer/PlaylistImporter.kt`
- Detail:
  - `resolveRelativeToPlaylistDocument` uses `lastPathSegment` (filename) as base and concatenates entry path.
- Risk:
  - Incorrect relative resolution for common playlist layouts.
  - Inflates unresolved diagnostics and false negatives.
- Recommendation:
  - Resolve against parent document/folder context from SAF metadata or persisted source directory abstraction.

### F-007 (Medium) — Re-entrant async actions lack in-flight guards
- Severity: Medium
- Area: Race conditions / unexpected user behavior
- Evidence:
  - `app/src/features/playlists/useUserPlaylists.ts`
  - `app/src/features/playlists/usePlaylistImport.ts`
  - `app/src/features/library/useIndexedLibrary.ts`
- Detail:
  - Multiple button taps can trigger overlapping async operations with stale state updates.
- Risk:
  - Interleaved statuses, stale list rendering, duplicate operations.
- Recommendation:
  - Add per-operation in-flight flags and disable conflicting actions until completion.

### F-008 (Medium) — Search/playlist input validation is minimal for pathological values
- Severity: Medium
- Area: Input hardening
- Evidence: `app/src/features/playlists/useUserPlaylists.ts`, `app/src/features/library/useSearchBrowse.ts`
- Detail:
  - No max-length normalization or stronger sanitization before bridge calls.
- Risk:
  - Excessive query payloads, avoidable memory/work spikes.
- Recommendation:
  - Add bounded input lengths and normalize invalid characters where applicable.

### F-009 (Medium) — Automation scripts contain machine-specific absolute paths
- Severity: Medium
- Area: Tooling portability/reliability
- Evidence: `scripts/run-device-uiautomator-smoke.sh`
- Detail:
  - Embedded `ROOT = '/home/jono/workspace/github/thora-player'` in Python block.
- Risk:
  - Non-portable runs on other machines/CI agents.
- Recommendation:
  - Pass root via environment variable from shell wrapper and remove hard-coded paths.

### F-010 (Medium) — Stage 4.1 OEM mapping claims checks not explicitly asserted in script
- Severity: Medium
- Area: Evidence integrity
- Evidence: `scripts/run-stage41-oem-hardening.sh`
- Detail:
  - `qa-mapping.json` includes guidance-path visibility evidence while script currently relies on control interactions and report assertions.
- Risk:
  - Evidence overstatement versus explicit test assertions.
- Recommendation:
  - Add explicit checks for each claimed evidence line or narrow mapping claims.

### F-011 (Medium) — Metro readiness in instrumentation lane is sleep-based
- Severity: Medium
- Area: Test flakiness
- Evidence: `scripts/run-device-ui-tests.sh`
- Detail:
  - Uses fixed `sleep 4` before instrumentation without readiness probe.
- Risk:
  - Intermittent failures on slower machines.
- Recommendation:
  - Replace fixed sleep with bounded readiness loop on Metro port/log health.

### F-012 (Low) — Status text is overloaded as both UX and error channel
- Severity: Low
- Area: UX/telemetry separation
- Evidence: multiple hooks in `app/src/features/**`
- Detail:
  - Single status string is repeatedly overwritten by unrelated operations.
- Risk:
  - User confusion and lost operation context during concurrent activity.
- Recommendation:
  - Separate transient UX status from operation-specific diagnostics.

### F-013 (Low) — Validation/report generation lacks explicit “stale data” marking
- Severity: Low
- Area: Audit clarity
- Evidence: `app/src/features/reliability/useDeviceSetupGuidance.ts`
- Detail:
  - Reports are generated from current in-memory refresh patterns without explicit data-age marker in UI workflow.
- Risk:
  - Operator may assume recency that is not guaranteed.
- Recommendation:
  - Display last-refresh timestamps per reliability dataset before report/share.

---

## Remediation Status Addendum (2026-02-22)

This section records current implementation status for Pass 1 findings. The original finding counts in the Summary section are kept as historical audit baseline values.

- **F-001:** Resolved
  - Ordered durability model replaced set-based reliability persistence with committed writes and legacy migration.
- **F-002:** Mostly resolved
  - Silent catches were replaced in core reliability/library/playlist/storage hooks with explicit error-message capture and surfaced diagnostics.
  - Residual: broader structured error taxonomy/telemetry standardization can still be expanded.
- **F-003:** Mostly resolved
  - Native playback runtime state bridge now includes playback + queue + progress metadata; next/previous queue index and playback progress are synchronized and reconciled in JS.
  - Residual: playback remains runtime-simulated (no media-engine event stream), so full native player-state eventing is still a future enhancement path.
- **F-004:** Resolved
  - Runtime payload guards were added before consuming sync-status bridge responses.
- **F-005:** Resolved
  - Playlist file grant flow now returns truthful persisted-grant status.
- **F-006:** Resolved
  - Playlist relative path resolution now uses parent-context candidates and canonicalized path segments.
- **F-007:** Resolved
  - In-flight and sequencing guards now gate overlapping async operations in targeted playlist/library hooks.
- **F-008:** Resolved
  - Query/name normalization and bounded input limits are enforced at JS and native boundaries.
- **F-009:** Resolved
  - Machine-specific absolute root paths were removed from smoke harness execution.
- **F-010:** Mostly resolved
  - QA evidence mapping claims were narrowed to explicitly asserted checks in the automated smoke lane.
  - Residual: if strict Stage 4.1 script parity is required, equivalent explicit-assertion alignment should be mirrored in `run-stage41-oem-hardening.sh`.
- **F-011:** Resolved
  - Instrumentation startup now uses bounded Metro readiness probing instead of fixed sleep.
- **F-012:** Resolved
  - Reliability workflow now separates user-facing status from detailed diagnostics.
- **F-013:** Resolved
  - Reliability UI now shows explicit per-dataset freshness/age markers before report/share actions.

---

## Prioritized Remediation Queue (Recommended)

1. F-001: Replace `StringSet` reliability persistence with ordered durable model.
2. F-002 + F-004: Add structured error capture + runtime bridge payload guards.
3. F-003: Unify playback state source of truth and next/previous semantics.
4. F-005 + F-006: Fix grant truthfulness and playlist relative-resolution logic.
5. F-009 + F-011: Hardening for automation portability and stability.

## Suggested Pass 2 Focus

- Deep native DB/transactional audit (`LibraryIndexStore`, `UserPlaylistStore`) for corruption/recovery guarantees.
- Stress-pass for concurrent UI actions (rapid tap/race simulation).
- Failure-injection pass for bridge/module unavailability and permission revocation mid-flow.
