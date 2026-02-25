# UI/UX V3 Implementation Backlog

Date: 2026-02-22  
Objective: Replace remaining clunky interactions with mainstream music-app patterns while preserving existing reliability and automation gates.

## Product Goals

1. Reduce explicit user actions for routine operations (scan/sync/grant refresh).
2. Shift high-frequency flows from button-centric to gesture/contextual interactions.
3. Increase premium feel via stronger icon consistency, semantic accents, and subtle motion.
4. Preserve operational confidence: keep `test:p0:debug` and `test:p0:prioritize` green at each phase.

## Success Metrics

- First usable playback path: <= 4 user actions on warm start.
- Repetitive manual actions reduced by >= 40% in Library/Search/Queue flows.
- At least 3 high-frequency actions available by gesture/context menu (not only buttons).
- Zero blocker regressions in p0 prioritization after each rollout slice.

---

## Epic A — Background Automation Engine

### A1. App-resume auto health refresh
- Trigger folder grant refresh when app foregrounds.
- Trigger lightweight playback service health refresh.
- Show passive status chips only on state change.

Acceptance criteria:
- User does not need to manually press Refresh for normal health state updates.
- No aggressive polling; bounded and debounced refresh cadence.

### A2. Opportunistic incremental library sync
- Auto-run incremental sync if:
  - permission granted,
  - at least one valid folder grant,
  - app not actively scanning.
- Add freshness indicator (`Updated Xs ago`) in Library card.

Acceptance criteria:
- No blocking modal/loading during auto sync.
- Sync cancellation/resume safe when app background changes.

### A3. Auto-cleanup and retry heuristics
- Debounced revoked-grant cleanup in background.
- Playlist import: auto retry one resolve pass when safe to normalize paths.

Acceptance criteria:
- User sees concise outcome summary (status chip/toast), not forced action chain.

---

## Epic B — Non-Button Interaction Upgrade

### B1. Track row gestures (Search/Playlist/Queue)
- Swipe right: `Play Next` / `Add to Queue`.
- Swipe left: `Remove` / `Hide` (context-sensitive).
- Long press: bottom sheet with `Play now`, `Play next`, `Add to playlist`, `View album/artist`.

Acceptance criteria:
- Existing button fallback remains for accessibility and compatibility.
- Gesture affordances discoverable via first-use hints.

### B2. Drag-and-drop Queue reorder
- Replace Up/Down button workflow with drag handles.
- Preserve active-track marker and stable reorder behavior.

Acceptance criteria:
- Queue reorder operations remain deterministic and persisted.
- No regressions in playback index reconciliation.

### B3. Inline row action affordances
- Add trailing icon actions on list rows for common commands.
- Keep full-screen action rows only for low-frequency/advanced operations.

Acceptance criteria:
- Overall visible button count per panel reduced.

---

## Epic C — Mainstream Playback UX

### C1. Mini player dock
- Add persistent mini player above tab bar:
  - title + artist,
  - play/pause,
  - progress hint,
  - tap to open full Now Playing.

Acceptance criteria:
- Mini player visible while queue has active or paused item.
- Does not obscure tab interactions.

### C2. Full player refinements
- Replace remaining textual utility indicators with visual controls where safe.
- Add scrubber thumb interaction and active-track micro glow.

Acceptance criteria:
- Scrubbing remains precise and reversible.
- Motion under 180ms and non-distracting.

---

## Epic D — Theme, Icons, and Motion Consistency

### D1. Icon system unification
- Standardize icon family and action mapping across shell + feature panels.
- Keep active/inactive icon state variants.

Acceptance criteria:
- No mixed icon metaphors for same action class.

### D2. Semantic accent enforcement
- `accentPrimary`: primary CTA + progress only.
- `accentSuccess`: healthy/ready.
- `accentWarning`: stale/running.
- `accentDanger`: destructive/failure.

Acceptance criteria:
- Accent use is consistent and predictable across tabs.

### D3. Motion guidelines implementation
- Keep existing tab fade.
- Add list insertion/reorder micro transitions.
- Add optional expandable section animation for advanced cards.

Acceptance criteria:
- Motion only reinforces state change; no decorative-only animation.

---

## Epic E — Reliability UX Simplification (Advanced)

### E1. Reliability stepper workflow
- Reframe advanced reliability actions into sequential steps:
  1. Baseline
  2. Post-setup
  3. Delta
  4. Report
- Show completion checkmarks and current step emphasis.

Acceptance criteria:
- User can execute a full validation run with less cognitive overhead.
- Existing test IDs and automation labels preserved.

### E2. Progressive diagnostics disclosure
- Show summary by default.
- Expand event/snapshot logs on demand.

Acceptance criteria:
- Dense diagnostics no longer dominate first view.

---

## Component Backlog (Concrete)

1. `BackgroundSyncOrchestrator` (hook/service)
2. `AutoRefreshBanner` / `FreshnessPill`
3. `SwipeTrackRow` component
4. `TrackActionSheet` component
5. `DraggableQueueList` component
6. `MiniNowPlayingDock` component
7. `ReliabilityStepperCard` component
8. `IconRegistry` mapping utility
9. `MotionPrimitives` (`fadeInShort`, `listReorderTransition`)

---

## Rollout Plan (Safe Sequencing)

### Slice 1 (low-risk): Automation + Freshness
- A1, A2 partial, A3 partial.
- Validate p0 gates.

Status: ✅ Implemented
- Added foreground/background automation orchestrator for startup/resume grant refresh and opportunistic incremental sync.
- Added passive Library status chips for auto-sync state + last auto-sync time.
- Validation: `test:p0:debug` PASS, `test:p0:prioritize` CLEAR.

### Slice 2 (medium-risk): Gesture Rows + Action Sheet
- B1 + B3 in Search and Playlist rows.
- Validate p0 gates and interaction fallback paths.

Status: ✅ Implemented
- Added reusable long-press contextual action sheet component.
- Integrated long-press actions into:
  - Discover search-result rows (play/add-to-selected-playlist)
  - Discover songs rows (play/add-to-selected-playlist)
  - Queue Editor rows (play/move/remove)
  - Playlist search-result rows (add to playlist)
  - Playlist entry rows (move/remove)
- Reduced Search landing command density for MVP directness:
  - Removed top-level bulk `PLAY RESULTS` from Search landing.
  - Simplified Search/Songs rows to one inline primary action (`ADD` when quick-add target exists, otherwise `PLAY`).
- Retained long-press advanced actions and button fallback behavior for accessibility/compatibility.
- Added explicit playlist-detail playback path:
  - Row-level `PLAY` action in Playlist Detail.
  - Long-press `PLAY FROM HERE` action for playlist entries.
  - Queue-backed playback start from selected playlist position.
- Validation: `test:p0:debug` PASS, `test:p0:prioritize` CLEAR.

### Slice 3 (medium/high-risk): Queue Drag Reorder
- B2 with playback index safety checks.
- Validate p0 gates + queue behavior tests.

Status: 🟨 Groundwork Implemented
- Added drag-like move mode in Queue Editor:
  - Long-press to pick up track.
  - Tap destination row to drop/reorder.
  - Visual source/target highlighting and cancel affordance.
- Retained fallback controls and contextual action sheet options.
- Validation: `test:p0:debug` PASS, `test:p0:prioritize` CLEAR.

### Slice 4 (medium-risk): Mini Player + Full Player refinements
- C1 + C2.
- Validate p0 gates + visual smoke checks.

Status: ✅ Implemented
- Added persistent mini-player dock above tab bar:
  - Track title/artist
  - Play/Pause quick control
  - Progress indicator
  - Tap-to-open full Now Playing tab
- Enhanced full Now Playing interactions:
  - Tap-to-seek scrub behavior on progress track
  - Subtle active-state micro-motion on artwork while playing
  - Final copy/readability polish applied to Now Playing controls and timing presentation
- Validation: `test:p0:debug` PASS, `test:p0:prioritize` CLEAR.

### Slice 5 (medium-risk): Reliability Stepper
- E1 + E2 with strict automation label/testID compatibility.
- Validate full p0 and supplemental robustness lane.

Status: ✅ Implemented
- Reframed advanced reliability flow into explicit 4-step sequence:
  - Step 1: Baseline
  - Step 2: Post-setup
  - Step 3: Delta
  - Step 4: Report
- Preserved automation-critical labels/testIDs (`CAPTURE BASELINE`, `CAPTURE POST-SETUP`, `EVALUATE SETUP DELTA`, `GENERATE REPORT`, `START IDLE TEST`, `MARK PASS`, `MARK FAIL`).
- Collapsed verbose diagnostics by default (event log, snapshots, idle history, checklist, report preview now expand on demand).
- Validation: `test:p0:debug` PASS, `test:p0:prioritize` CLEAR.

---

## Regression Gate Policy (Per Slice)

Must run after each slice:
- `npm run test:p0:debug`
- `npm run test:p0:prioritize`

Required state:
- `P0_DEBUG_BUNDLE=PASS`
- `P0_BLOCKER_SUMMARY=CLEAR`

If non-blocking supplemental fails repeatedly:
- classify lane-specific flake vs true regression,
- patch immediately only when tied to changed UX path,
- avoid unrelated scope expansion.

---

## Final Program Status

- UX execution program completed (Phases 1-8).
- Tap-budget verification passed on 4/4 target flows.
- Release handoff: `docs/audits/initial/ui-ux-release-handoff-2026-02-22.md`

---

## Execution Tracker Reference

PR-sized implementation sequencing and file-level touchpoints for this backlog are defined in:

- `docs/audits/initial/ui-ux-redesign-implementation-tracker-2026-02-22.md`
- `docs/audits/initial/ui-ux-mvp-tab-audit-2026-02-22-v3.md`
- `docs/audits/initial/ui-ux-master-phased-approach-2026-02-22.md`
