# UI/UX Redesign Implementation Tracker (PR Plan)

Date: 2026-02-22  
Source spec: `docs/audits/initial/ui-ux-redesign-spec-2026-02-22.md`  
Execution mode: Incremental, regression-gated PR slices

## 1) Goal of This Tracker

Convert the redesign spec into shippable implementation slices with:
- explicit code touchpoints
- clear done criteria
- measurable UX outcomes
- required regression gates

Master sequencing reference:
- `docs/audits/initial/ui-ux-master-phased-approach-2026-02-22.md`

## 2) Guardrails (Apply to Every PR)

- Preserve automation-critical labels/testIDs in reliability flows.
- Keep top-level tab architecture unchanged.
- Prefer progressive disclosure over capability removal.
- Keep changes scoped to the target slice; avoid unrelated refactors.

Required gates after each PR:
- `npm run test:p0:debug`
- `npm run test:p0:prioritize`
- Expected state: `P0_DEBUG_BUNDLE=PASS`, `P0_BLOCKER_SUMMARY=CLEAR`

---

## 3) PR Sequence Overview

- PR-1: Library/Search/Playlists IA cleanup and button-wall reduction
- PR-2: Contextual interaction defaults (inline actions + gesture-safe fallbacks)
- PR-3: Reliability stepper and progressive diagnostics disclosure
- PR-4: Final polish (copy/readability/tap-budget verification)

---

## 4) PR-1 — IA Cleanup + Listening-First Hierarchy

## 4.1 Objective
Move default surfaces toward mainstream listening flow and reduce operational noise.

## 4.2 Files to change (primary)
- `app/src/app/ProductionAppShell.tsx`
- `app/src/features/library/SearchBrowsePanel.tsx`
- `app/src/features/playlists/UserPlaylistsPanel.tsx`
- `app/src/features/playlists/PlaylistImportPanel.tsx`
- `app/src/features/reliability/DeviceSetupPanel.tsx` (only section ordering/collapse defaults)

## 4.3 Tasks
1. Enforce tab section order from redesign spec:
   - Library: quick listening → health summary → optional utility
   - Playlists: user collections first, import second
2. Reduce command density:
   - Remove redundant duplicated actions from visible default rows
   - Keep maintenance/reliability controls behind advanced disclosure
3. Keep reliability labels unchanged for automation-critical buttons.

## 4.4 Done criteria
- Default Library surface no longer presents maintenance control wall.
- Playlists shows existing playlists and track actions before import diagnostics.
- No automation selector regression in advanced reliability controls.

## 4.5 UX acceptance checks
- First-playback warm path demonstrably <= 4 actions (documented in PR notes).
- User can identify one clear primary action per main tab at first glance.

---

## 5) PR-2 — Contextual Interaction Defaults

## 5.1 Objective
Make high-frequency actions row-contextual, not panel-command-centric.

## 5.2 Files to change (primary)
- `app/src/ui/components/TrackActionSheet.tsx`
- `app/src/features/library/SearchBrowsePanel.tsx`
- `app/src/features/playlists/UserPlaylistsPanel.tsx`
- `app/src/features/queue/QueueEditorPanel.tsx`
- `app/src/ui/components/AppButton.tsx` (only if needed for compact inline actions)

## 5.3 Tasks
1. Add/standardize inline row actions for top scenarios:
   - Play now
   - Add to selected playlist
   - Remove/reorder queue entries
2. Keep long-press contextual sheet as canonical advanced row action.
3. Retain explicit button fallback for accessibility and automation compatibility.

## 5.4 Done criteria
- At least 3 high-frequency operations available contextually on rows.
- Visible full-width button rows reduced in Search/Playlists/Queue surfaces.
- Queue reorder path remains deterministic (drag-like mode + fallback controls).

## 5.5 UX acceptance checks
- Add-to-playlist-from-search path <= 2 actions.
- Queue reorder common path <= 2 actions.

---

## 6) PR-3 — Reliability Stepper + Progressive Disclosure

## 6.1 Objective
Keep advanced reliability capability while making it cognitively structured and less visually heavy.

## 6.2 Files to change (primary)
- `app/src/features/reliability/DeviceSetupPanel.tsx`
- `app/src/features/reliability/useDeviceSetupGuidance.ts`
- `app/src/features/reliability/readinessStatus.ts`
- `app/src/ui/components/SectionCard.tsx` (if section affordances needed)

## 6.3 Tasks
1. Introduce reliability workflow grouping:
   - Step 1: Baseline
   - Step 2: Post-setup
   - Step 3: Delta
   - Step 4: Report
2. Collapse verbose diagnostics by default; preserve expand-on-demand behavior.
3. Preserve exact automation-critical labels and `testID` semantics.
4. Keep readiness and freshness summaries visible near the top.

## 6.4 Done criteria
- Reliability flow is visually step-driven rather than flat command board.
- Logs/snapshots/events are not dominant in default advanced view.
- Existing smoke/stage4.1 scripts pass without selector rewrites beyond layout resilience.

## 6.5 UX acceptance checks
- Full advanced reliability run can be completed with reduced visual scanning overhead.
- Advanced panel still validates all required test controls.

---

## 7) PR-4 — Final Polish + Tap-Budget Closure

## 7.1 Objective
Finalize readability, copy tone, icon/action consistency, and verify tap-budget targets.

## 7.2 Files to change (primary)
- `app/src/app/ProductionAppShell.tsx`
- `app/src/features/playback/NowPlayingPanel.tsx`
- `app/src/ui/components/IconTabBar.tsx`
- `app/src/ui/components/StatusChip.tsx`
- `app/src/ui/theme.ts` (minor token usage tuning only)
- `docs/audits/initial/ui-ux-overhaul-roadmap-2026-02-22.md`
- `docs/audits/initial/ui-ux-v3-implementation-backlog-2026-02-22.md`

## 7.3 Tasks
1. Normalize copy for consumer-first default surfaces.
2. Ensure primary controls are visually dominant and secondary utilities de-emphasized.
3. Validate per-flow tap budgets and document evidence in PR notes.
4. Update roadmap/backlog status sections to reflect completion.

## 7.4 Done criteria
- Resume path <= 1 action when paused queue exists.
- Primary surfaces avoid dense diagnostics by default.
- Spec acceptance criteria are fully mapped to implementation evidence.

---

## 8) Spec-to-Code Traceability

| Spec Section | Implementation PR | Primary File Anchors |
|---|---|---|
| IA target architecture | PR-1 | `ProductionAppShell.tsx` |
| Tap-budget requirements | PR-1, PR-2, PR-4 | `ProductionAppShell.tsx`, `SearchBrowsePanel.tsx`, `UserPlaylistsPanel.tsx` |
| Per-tab UX requirements | PR-1, PR-2 | `SearchBrowsePanel.tsx`, `UserPlaylistsPanel.tsx`, `QueueEditorPanel.tsx` |
| Reliability progressive disclosure | PR-3 | `DeviceSetupPanel.tsx`, `useDeviceSetupGuidance.ts` |
| Readability/copy consistency | PR-4 | Shell/panel/component files |

---

## 9) QA + Evidence Checklist per PR

For each PR, include in summary:
1. Before/after screen captures for affected tabs
2. Tap-count walkthrough for relevant target flows
3. `test:p0:debug` result artifact path
4. `test:p0:prioritize` result artifact path
5. Any automation selector impact statement (expected: none or clearly scoped)

Latest tap-budget evidence:
- `docs/audits/initial/ui-ux-phase-7-tap-budget-verification-2026-02-22.md`

---

## 10) Suggested Owner Split

- App shell + IA ordering: app-shell owner
- Library/Search/Playlists interactions: feature-ui owner
- Reliability stepper/progressive disclosure: reliability-ui owner
- Automation compatibility and gate validation: qa-automation owner

---

## 11) Implementation Start Order (Immediate)

1. Execute PR-1 in a single focused branch.
2. Land PR-2 only after PR-1 gates pass.
3. Land PR-3 with immediate smoke/stage4.1 confirmation.
4. Finish PR-4 and close spec acceptance checklist.

---

## 12) Mainstream Navigation Architecture (Deeper Planning)

## 12.1 Top-Level Tabs Decision

Keep exactly 5 top-level tabs:
- Library
- Search
- Playlists
- Now Playing
- Settings

Decision rationale:
- This matches mainstream app mental models and avoids over-segmentation.
- Additional top-level tabs would increase wayfinding overhead for core listening tasks.

## 12.2 Sub-Page Model (Within Tabs)

Introduce lightweight in-tab sub-pages (stack-style) instead of adding more top-level tabs.

Proposed sub-pages:
- Library:
   - `LibraryHome`
   - `AlbumDetail`
   - `ArtistDetail`
   - `AllSongs`
- Search:
   - `SearchHome`
   - `SearchResults`
   - `SearchDetail` (optional if needed)
- Playlists:
   - `PlaylistsHome`
   - `PlaylistDetail`
   - `ImportSummary` (advanced/secondary)
- Settings:
   - `SettingsHome`
   - `LibrarySetup`
   - `LibraryMaintenance` (advanced)
   - `ReliabilityTools` (advanced)

Navigation behavior:
- Use back navigation (header back affordance) for sub-pages.
- Do not introduce breadcrumb trails on mobile; breadcrumbs are atypical for mainstream music apps and add visual noise.

## 12.3 Navigation Controls Guidance

- Keep bottom tab bar persistent.
- Use contextual header actions per sub-page when needed.
- Keep mini-player persistent across tab/sub-page navigation.
- Avoid modal-heavy task flows for routine library/search/playlist actions.

---

## 13) Manual Button → Autonomous/Settings Migration Plan

## 13.1 Convert to Autonomous Behavior

Manual controls to convert (or keep hidden as fallback):
- `REFRESH` library sync trigger → auto on app resume/foreground debounce
- `REFRESH` playlist summaries → auto after mutation and on tab focus
- grant health refresh actions → auto on foreground

Autonomous behavior requirements:
- Run opportunistically in background when prerequisites are met.
- Surface passive status (`Updated X ago`, warning chips only on exceptions).
- Keep fallback manual controls inside Settings advanced sections.

## 13.2 Move to Settings (Advanced)

Move these out of default mainstream surfaces:
- raw index diagnostics and sync internals
- manual SAF/MediaStore maintenance operations
- detailed reliability logs/events/snapshots controls
- import diagnostics-heavy controls (keep import entry visible but diagnostics collapsed)

## 13.3 Keep on Primary Tabs

Only keep controls tied to mainstream listening flows:
- Play/Resume
- Browse
- Search
- Add to playlist / reorder queue
- Open now playing

---

## 14) Expanded PR Plan (Beyond PR-4)

## PR-5 — Sub-Page Navigation Foundation

Objective:
- Implement in-tab stack navigation model with clean back behavior.

Primary files:
- `app/src/app/ProductionAppShell.tsx`
- `app/src/features/library/*` (home/detail split)
- `app/src/features/playlists/*` (home/detail split)

Done criteria:
- Library and Playlists can open detail sub-pages without new top-level tabs.
- Back behavior is deterministic and does not break tab state.

## PR-6 — Settings Decomposition

Objective:
- Break Settings into explicit sub-pages (`LibrarySetup`, `LibraryMaintenance`, `ReliabilityTools`).

Primary files:
- `app/src/app/ProductionAppShell.tsx`
- `app/src/features/reliability/DeviceSetupPanel.tsx`
- `app/src/features/storage/*`
- `app/src/features/library/*maintenance components`

Done criteria:
- Settings home is concise and task-oriented.
- Advanced surfaces are reachable but collapsed/off critical path.

## PR-7 — Autonomous Refresh Completion

Objective:
- Complete manual-to-autonomous migration for routine refresh actions.

Primary files:
- `app/src/features/library/useBackgroundSyncOrchestrator.ts`
- `app/src/features/playlists/useUserPlaylists.ts`
- `app/src/app/ProductionAppShell.tsx`

Done criteria:
- Routine refresh buttons removed from primary tabs where automation is safe.
- Passive status replaces explicit maintenance prompts.

---

## 15) UX Validation Checklist (Mainstream Fit)

Use this checklist after PR-4+ slices:

- Library reads as content-first (not maintenance-first).
- Search reads as result-first (not command-first).
- Playlists reads as collection-first (import is secondary).
- Settings owns special tooling; non-settings tabs avoid debug-looking controls.
- No primary tab requires users to understand sync/index internals.
- First-play and resume tap budgets meet targets.

---

## 16) Operational Note on UI Automation

Current execution policy:
- UI automation lanes are intentionally skipped by default in routine p0 debug/release gate runs.
- They can be opt-in enabled for dedicated validation passes.

Rationale:
- Avoid long-running brittle loops blocking UX refactor velocity.
- Preserve optional deep validation path for targeted reliability checks.

---

## 17) Final Closure (Program Complete)

Execution status:
- ✅ Phases 1-8 completed and validated.
- ✅ Tap-budget targets verified across 4/4 core flows.
- ✅ Residual playlist-detail playback gap closed.

Release handoff artifact:
- `docs/audits/initial/ui-ux-release-handoff-2026-02-22.md`

Final verification artifact:
- `docs/audits/initial/ui-ux-phase-7-tap-budget-verification-2026-02-22.md`
