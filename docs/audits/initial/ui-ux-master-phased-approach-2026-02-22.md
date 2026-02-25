# UI/UX Master Phased Approach (End-to-End)

Date: 2026-02-22  
Objective: Execute all remaining UX work in a controlled sequence, with every tab and adjacent sub-page covered, while keeping MVP intent primary (play music from folders/playlists quickly).

## 1) Program Principles

- MVP-first: playback from folders/playlists is always prioritized over diagnostics/maintenance surfaces.
- One visible primary action per tab landing view.
- Everything non-core is moved, collapsed, or compacted.
- No phase closes without gate evidence (`test:p0:debug`, `test:p0:prioritize`).
- Automation-critical reliability labels/testIDs remain unchanged.

## 2) Coverage Map (Nothing Left Out)

In scope:
- Library tab
- Search tab
- Playlists tab
- Now Playing tab
- Settings tab
- Immediate in-tab sub-pages required to reduce command density
- Cross-cutting copy/readability/action hierarchy consistency
- Validation + rollout documentation

Out of scope:
- New unrelated feature families
- Platform expansion beyond current Android product focus

## 3) Phase Plan

## Phase 0 — Baseline Lock + Measurement

Goal:
- Freeze baseline and define measurable success before structural changes.

Actions:
- Capture current tap paths for:
  - first play from library
  - add from search to playlist
  - play from playlist detail
  - resume from now playing
- Record baseline screenshots for each tab landing state.

Exit criteria:
- Baseline metrics and screenshots attached to PR notes template.
- No code behavior changes in this phase.

---

## Phase 1 — Now Playing Scope Slimming (MVP Fast Win)

Goal:
- Make Now Playing tab playback-first and remove operational overload.

Actions:
- Keep `NowPlayingPanel` on tab landing.
- Move `FolderQueuePanel` and `QueueEditorPanel` behind secondary entry (`OPEN QUEUE TOOLS`) or sub-page route.
- Preserve direct access path to queue tools from Now Playing.

Primary file anchors:
- app/src/app/ProductionAppShell.tsx
- app/src/features/playback/NowPlayingPanel.tsx
- app/src/features/queue/FolderQueuePanel.tsx
- app/src/features/queue/QueueEditorPanel.tsx

Exit criteria:
- Now Playing landing no longer shows folder/sort/queue editor stacks by default.
- Playback controls remain one-step visible.

Status:
- ✅ Implemented in shell: `NowPlayingPanel` is default landing content, while `FolderQueuePanel` and `QueueEditorPanel` are moved behind a secondary `OPEN QUEUE TOOLS` disclosure on the Now Playing tab.

---

## Phase 2 — Search Directness + Command Reduction

Goal:
- Make Search default path direct-to-play and direct-to-add.

Actions:
- Keep `search` mode as default landing behavior.
- Demote heavy browse modes (`albums`, `artists`, `songs`) into secondary browse flow/sub-page if needed.
- Reduce row action footprint:
  - retain one inline compact action,
  - keep long-press action sheet for full options.
- De-emphasize or relocate `PLAY RESULTS` as a non-primary action.

Primary file anchors:
- app/src/features/library/SearchBrowsePanel.tsx
- app/src/ui/components/TrackActionSheet.tsx

Exit criteria:
- Search landing has one clear primary action.
- Per-result action density reduced while keeping add/play discoverable.

Status:
- ✅ Implemented in `SearchBrowsePanel`: top-level bulk `PLAY RESULTS` was removed from Search landing, and per-track rows were reduced to one inline primary action (`ADD` when quick-add target is available, otherwise `PLAY`) while preserving long-press advanced actions.

---

## Phase 3 — Playlists Decomposition (Home/Detail/Add/Import)

Goal:
- Remove single-screen density from playlist management.

Actions:
- Introduce in-tab sub-pages:
  - Playlists Home
  - Playlist Detail
  - Add Tracks
  - Import (secondary)
- Keep import diagnostics collapsed by default.
- Ensure playlist detail emphasizes playback and simple list operations.

Primary file anchors:
- app/src/app/ProductionAppShell.tsx
- app/src/features/playlists/UserPlaylistsPanel.tsx
- app/src/features/playlists/PlaylistImportPanel.tsx

Exit criteria:
- Playlist landing is collection-first.
- Import and diagnostics are reachable but not dominant.

Status:
- ✅ Implemented with in-tab Playlists sub-pages (`home`, `detail`, `add`, `import`) in shell routing. Landing now emphasizes collection-first actions, while import tools are moved to a secondary import sub-page.

---

## Phase 4 — Library First-Use Clarity

Goal:
- Eliminate ambiguity in empty vs ready states.

Actions:
- Dynamic primary CTA label by state:
  - setup state: `SET UP LIBRARY`
  - ready state: `PLAY FROM LIBRARY`
- Demote secondary cross-navigation (`OPEN PLAYLISTS`) to compact action.
- Add one-line helper text clarifying playback source.

Primary file anchors:
- app/src/app/ProductionAppShell.tsx

Exit criteria:
- User can identify exact next action from Library in under 1 second.
- Empty-state confusion is removed.

Status:
- ✅ Implemented in Library shell card: primary CTA now dynamically uses `SET UP LIBRARY` (setup state) and `PLAY FROM LIBRARY` (ready state), helper copy clarifies playback source, and `OPEN PLAYLISTS` is de-emphasized as a compact secondary action.

---

## Phase 5 — Settings Sub-Page Decomposition

Goal:
- Keep Settings Home concise while preserving advanced depth.

Actions:
- Split Settings into:
  - Settings Home
  - Library Setup
  - Library Maintenance (advanced)
  - Reliability Tools (advanced)
- Keep Home to 2–3 cards max.
- Keep maintenance/reliability surfaces outside home landing.

Primary file anchors:
- app/src/app/ProductionAppShell.tsx
- app/src/features/reliability/DeviceSetupPanel.tsx
- app/src/features/storage/FolderGrantsPanel.tsx

Exit criteria:
- Settings landing is concise and non-operational.
- Advanced stacks are one deliberate navigation deeper.

Status:
- ✅ Implemented in shell with Settings sub-pages: `home`, `librarySetup`, `libraryMaintenance`, and `reliabilityTools`. Home now stays concise (navigation + playback controls), while maintenance and reliability tooling are moved one step deeper.

---

## Phase 6 — Micro-Actions + Visual Density Cleanup

Goal:
- Replace remaining large secondary buttons with compact actions where suitable.

Actions:
- Convert repeated secondary actions into chips/micro-buttons/context actions.
- Standardize status line placement and action priority hierarchy.
- Remove duplicate intents on same screen region.

Primary file anchors:
- app/src/ui/components/AppButton.tsx
- app/src/ui/components/StatusChip.tsx
- tab panel files touched in earlier phases

Exit criteria:
- Each landing tab has one dominant primary action.
- Secondary controls do not visually compete.

Status:
- ✅ Implemented across shell and tab panels: secondary full-width controls were converted to compact actions in Playlists Home, Settings Home, Search songs mode, Playlist row controls, and Now Playing seek-step controls. Primary actions remain dominant per landing view.

---

## Phase 7 — Cross-Flow Tap Budget Verification

Goal:
- Confirm UX outcomes against MVP expectations.

Actions:
- Re-run tap walkthroughs for key flows.
- Verify action counts and identify any regressions.
- Ensure copy/readability remains consistent after structural changes.

Exit criteria:
- First-play and resume targets met.
- Add-to-playlist and playlist-play paths are direct and stable.

Status:
- ✅ Verification complete via `ui-ux-phase-7-tap-budget-verification-2026-02-22.md`: first-play, resume, add-to-playlist, and playlist-detail playback paths all meet targets.

---

## Phase 8 — Stabilization + Release Readiness Update

Goal:
- Close execution with documented evidence and handoff-ready status.

Actions:
- Run required gates per final integrated state.
- Update roadmap/backlog/tracker statuses.
- Record residual non-MVP items in backlog (not primary views).

Exit criteria:
- `P0_DEBUG_BUNDLE=PASS`
- `P0_BLOCKER_SUMMARY=CLEAR`
- Planning docs reflect actual shipped UX structure.

Status:
- ✅ Complete: residual playlist-detail playback path was implemented and validated; required gates are passing and planning docs are synchronized to shipped UX.

## 4) Validation Cadence (Every Phase)

Required after each phase:
- npm run test:p0:prioritize
- npm run test:p0:debug

Optional targeted validation:
- Opt-in UI automation lane when phase materially changes selector-relevant surfaces.

## 5) Execution Rhythm

Per phase cycle:
1. Implement narrow scope branch
2. Run required gates
3. Capture before/after screenshots + tap counts
4. Update docs/status in same PR
5. Start next phase only after evidence is attached

## 6) Risk Controls

- Avoid multi-phase mixing in one PR.
- Keep reliability automation-critical controls unchanged.
- Use feature toggles/state guards where sub-page migration risks temporary regressions.

## 7) Definition of Complete Program

Program is complete when:
- All five tabs present obvious direct-to-play intent on landing.
- Non-core operational tooling is secondary via sub-pages/disclosure.
- Folder and playlist playback are both straightforward and low-friction.
- Required gates and documentation are clean and current.
