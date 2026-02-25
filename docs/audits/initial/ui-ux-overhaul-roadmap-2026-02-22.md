# UI/UX Overhaul Roadmap (Prioritized)

Date: 2026-02-22

## Priority Order

### Phase 1 — Foundations (now)
1. Establish visual language and success metrics.
2. Implement theme tokens (gunmetal + glow accent system).
3. Implement reusable primitives (button, tab bar, status/section shells).
4. Apply to app shell first to unlock fast consistency wins.

### Phase 2 — Core Listening Journey (next)
1. Rebuild first-run quickstart for <=5 taps to first playback.
2. Redesign `Now Playing` as the primary listening surface.
3. Make Library tab play-first; move maintenance actions behind advanced affordances.

### Phase 3 — Discovery and Organization
1. Redesign Search/Browse controls with clearer mode hierarchy.
2. Redesign Playlists workflows (import/manage/create) around user intent.
3. Standardize list item hierarchy and empty/loading states.

### Phase 4 — Settings, Diagnostics, and Hardening
1. Keep normal settings lightweight and clear.
2. Keep reliability tools discoverable but isolated in advanced section.
3. Verify accessibility/readability across all tabs.
4. Update automation selectors for UI changes and keep p0 gates green.

### Phase 5 — Finalization
1. Full UX acceptance pass against KPI checklist.
2. Regression (smoke/instrumentation/robustness/prioritization).
3. Design-system documentation and maintenance guidance.

## KPI Targets

- First-launch to first playback: <= 5 taps.
- Primary action recognition: < 1 second per tab.
- No high-priority action hidden behind dense text walls.
- p0 debug bundle remains PASS after each phase.

## Current Execution Status

- Completed in this pass:
  - Phase 1 complete: Now Playing landing is playback-first with queue tools behind secondary disclosure.
  - Phase 2 complete: Search landing removed bulk `PLAY RESULTS`; result rows now use one inline primary action with long-press advanced actions retained.
  - Phase 3 complete: Playlists split into in-tab Home/Detail/Add/Import flows so landing stays collection-first and import remains secondary.
  - Phase 4 complete: Library first-use clarity updates with explicit state-based primary CTA and compact secondary playlists action.
  - Phase 5 complete: Settings decomposed into Home, Library Setup, Library Maintenance, and Reliability Tools sub-pages.
  - Phase 6 complete: Secondary controls converted to compact actions across Search, Playlists, Now Playing, and Settings Home to reduce visual competition.
  - Phase 7 verification complete: tap-budget walkthrough validated first-play/resume/add-to-playlist/playlist-detail-play targets.
  - Phase 8 complete: residual playlist-detail playback path implemented and stabilized with fresh gate evidence.
  - Theme token system created.
  - Reusable primitives created (`AppButton`, `IconTabBar`, `SectionCard`, `StatusChip`).
  - Production shell styled with gunmetal palette and icon tabs.
  - Quickstart flow moved into a dedicated play-first card.
  - Library tab reorganized into mainstream grouped sections.
  - Search tab refactored to segmented mode controls and clearer CTA hierarchy.
  - Playlists tab refactored for import/manage flow clarity.
  - Settings tab split into basic controls and advanced reliability section.
  - Queue and reliability panels upgraded for readability and themed controls.
  - Design-system handoff doc added with token/component/automation rules.
  - Now Playing upgraded with progress bar and icon-first controls.
  - Reliability advanced panel refactored into a 4-step workflow (Baseline, Post-setup, Delta, Report) with progressive disclosure for heavy diagnostics.
  - Final polish applied for copy/readability and control emphasis across shell/tab/now-playing/status surfaces.
  - Validation gates remain green (`test:p0:debug`, `test:p0:prioritize`).
- In progress:
  - None.

## Post-Release Follow-up (Optional)

1. Run opt-in UI automation lane for expanded confidence (`RUN_UI_AUTOMATION=1`).
2. Capture final device screenshots for release note archive.
3. Track non-MVP enhancements as separate backlog items (no primary-tab scope expansion).

## V3 Execution Path

Next-phase implementation now follows:

- `docs/audits/initial/ui-ux-v3-implementation-backlog-2026-02-22.md`
- `docs/audits/initial/ui-ux-redesign-spec-2026-02-22.md`
- `docs/audits/initial/ui-ux-redesign-implementation-tracker-2026-02-22.md`
- `docs/audits/initial/ui-ux-mvp-tab-audit-2026-02-22-v3.md`
- `docs/audits/initial/ui-ux-master-phased-approach-2026-02-22.md`

This backlog defines automation-first UX reduction, gesture-first interactions, mini-player progression, reliability stepper simplification, and per-slice regression gate policy.
