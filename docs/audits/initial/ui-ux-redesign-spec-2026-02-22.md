# UI/UX Redesign Specification (Mainstream Alignment)

Date: 2026-02-22  
Status: Proposed (implementation-ready)

## 1) Purpose

Define the target UX for the Tho'ra Player so daily listening flows match mainstream music app expectations while preserving advanced reliability/diagnostic capabilities behind progressive disclosure.

This spec converts prior audits and backlog notes into concrete product decisions and implementation constraints.

## 2) Product UX North Star

The app should feel like a listening product first, and an operations tool second.

Success behavior:
- Users can open app and resume/trigger playback with minimal thought and taps.
- Library/search/playlist actions are mostly direct-manipulation and contextual, not command-panel driven.
- Advanced reliability and maintenance remain available but are never the default visual focus.

## 3) Scope and Constraints

In scope:
- Information architecture and navigation behavior
- Per-tab content hierarchy and interaction model
- Tap-budget targets for critical journeys
- Keep/Move/Remove decisions for existing controls
- Rollout and acceptance criteria

Out of scope:
- New feature families unrelated to listening/discovery/organization reliability
- Non-Android platform-specific UX adaptations

Hard constraints:
- Keep existing design token primitives (`theme.ts`, `AppButton`, `SectionCard`, `StatusChip`) unless explicitly revised.
- Preserve automation-critical labels and `testID`s for reliability pathways.
- Maintain passing p0 gates per rollout slice.

## 4) Current-State Diagnosis (Condensed)

What now resembles mainstream apps:
- Tab-based top-level architecture
- Persistent mini-player pattern
- Improved shell consistency and visual theming baseline

What still diverges from mainstream expectations:
- Command-heavy, button-dense pages
- Overexposed maintenance/reliability operations in normal flows
- High explicit-tap burden for routine updates that should be passive/automatic
- Operational text density competing with listening tasks

## 5) IA Target Architecture

## 5.1 Top-Level Tabs (fixed)
- Library
- Search
- Playlists
- Now Playing
- Settings

No additional top-level tabs are introduced.

## 5.2 Navigation Rules
- Mini-player tap always routes to Now Playing.
- Context actions from Search/Library rows route to Playlists picker or Queue context without leaving current tab unless user explicitly navigates.
- Settings is bifurcated into:
  - Basic settings (default visible)
  - Advanced reliability/maintenance (collapsed by default)

## 5.3 Progressive Disclosure
Default surfaces show only high-frequency listening actions.  
Low-frequency diagnostics and maintenance remain accessible behind one deliberate expansion action.

## 6) Tap-Budget Specification

## 6.1 First Playback (warm-start, local media available)
Target: <= 4 user actions.

Expected path:
1. Open app
2. Allow permission (if needed)
3. Start playback from quick row/recent item
4. Optional navigate to full player

## 6.2 Returning User Resume
Target: <= 1 action to audible playback when paused queue exists.

## 6.3 Add Track to Playlist from Search
Target: <= 2 actions.

## 6.4 Reorder Queue Item
Target: <= 2 actions for common reorder path (long press + drop).

## 7) Per-Tab UX Specification

## 7.1 Library (Play-First)
Primary purpose: immediate listening entry.

Required top-to-bottom structure:
1. Quick listening section
   - Recently played / recently indexed rows
   - Clear primary CTA: Play/Resume
2. Library health summary
   - Passive freshness chip and concise status only
3. Optional utility actions (secondary)
   - Scan/refresh only when state indicates staleness or setup incompleteness

Keep:
- Quick start / play-first controls
- Passive freshness and status chips

Move:
- Index diagnostics and raw maintenance controls to Settings > Library Maintenance

Reduce/Hide:
- Redundant command rows that duplicate background automation

Interaction requirements:
- Row-level long press opens contextual action sheet
- No large maintenance control wall in default library view

## 7.2 Search (Result-First)
Primary purpose: find and play quickly.

Required structure:
1. Search input + one primary action
2. Mode selector (segmented control)
3. Results list with inline/context actions

Keep:
- Segmented browse modes
- Existing action sheet integration

Refactor:
- Reduce visible multi-button rows per result
- Promote inline row actions (Play/Add) and contextual long press

Expected behavior:
- Search state and first results visible without additional control scrolling

## 7.3 Playlists (Collection-First)
Primary purpose: manage user-curated sets with low friction.

Required structure:
1. Playlist switcher and create flow
2. Selected playlist tracks with reorder/removal interactions
3. Import tools as secondary section

Keep:
- User playlist CRUD
- Import capability

Refactor:
- Prioritize existing playlists over import diagnostics
- Keep drag-like reorder as default path (up/down as fallback only)

## 7.4 Now Playing (Media-First)
Primary purpose: focused playback control.

Required structure:
1. Track identity and playback state
2. Progress/scrubber
3. Transport controls
4. Secondary queue/track actions

Keep:
- Mini-player integration
- Tap-to-seek progress

Refactor:
- Reduce textual utility clutter around controls
- Ensure control affordances are visually dominant

## 7.5 Settings (Split Basic vs Advanced)
Primary purpose: accountless app configuration and optional advanced diagnostics.

Required structure:
1. Basic settings card(s)
2. Advanced Tools toggle
3. Advanced sections:
   - Reliability workflow
   - Library maintenance

Keep:
- Advanced reliability capability
- Existing automation-compatible labels for test-critical controls

Refactor:
- Reliability panel to step-driven sequence, not flat command board
- Collapse logs/diagnostics by default

## 8) Keep / Move / Redesign Matrix

Keep as-is (or minor polish):
- Top-level tab model
- Mini-player concept
- Tokenized visual theme baseline

Move to advanced areas:
- Raw sync/index diagnostics
- Grant cleanup/manual maintenance controls
- Detailed event/snapshot streams

Redesign for mainstream alignment:
- Button-dense operational rows in primary tabs
- Control-first list UIs lacking contextual row actions
- Reliability default view (convert to guided stepper with progressive disclosure)

## 9) Interaction Model Requirements

## 9.1 Gesture and Contextual Actions
Must provide contextual interactions for high-frequency list operations:
- Long press action sheet in Search/Playlist/Queue rows
- Drag/drop (or drag-like) reorder in queue
- Inline trailing actions where discoverability is improved

## 9.2 Background Automation Defaults
Must run without explicit user action when safe:
- Grant refresh on app resume
- Opportunistic incremental sync when prerequisites are met
- Debounced maintenance cleanup tasks

UI must surface outcomes passively (chips/toasts), not force immediate command interaction.

## 10) Content and Copy Guidelines

Voice target:
- Consumer-facing first, technical second
- Short action labels
- Avoid overexposed operational jargon on default surfaces

Guidelines:
- Keep status lines concise and scannable
- Move long diagnostics into expandable sections
- Preserve explicit technical wording only in advanced panels

## 11) Accessibility and Readability Requirements

- Minimum practical body text scale should avoid dense 11px-equivalent defaults on primary surfaces.
- Ensure color contrast remains compliant across dark surfaces and secondary text.
- Maintain touch target consistency for primary controls.
- Do not rely on color-only state communication; pair with label or icon state.

## 12) Automation Compatibility Requirements

This redesign must preserve test-critical selectors and labels for existing automation lanes where explicitly required.

Required preservation set includes:
- SETTINGS
- SHOW ADVANCED TOOLS
- CAPTURE BASELINE
- CAPTURE POST-SETUP
- EVALUATE SETUP DELTA
- GENERATE REPORT
- LOG INTERRUPTION
- LOG RECOVERY
- START IDLE TEST
- MARK PASS
- MARK FAIL

If visual layout changes, selector strategy should prefer stable labels/testIDs over coordinate assumptions.

## 13) Rollout Plan (Implementation Slices)

Slice 1: IA cleanup and content hierarchy
- Enforce per-tab section ordering from this spec
- Move maintenance-heavy controls out of default Library surfaces

Slice 2: Interaction reduction
- Replace button walls with contextual row actions and reduced command rows

Slice 3: Reliability UX simplification
- Introduce stepper-style advanced reliability workflow
- Collapse deep diagnostics by default

Slice 4: Final polish and consistency
- Align icon semantics and accent usage
- Final tap-budget validation and readability pass

Each slice requires:
- `npm run test:p0:debug`
- `npm run test:p0:prioritize`
- Regression note update in roadmap/backlog docs

## 14) Acceptance Criteria (Spec Exit)

Architecture and navigation:
- All primary listening flows are discoverable without entering advanced sections.
- No non-essential maintenance control wall appears in default Library view.

Tap burden:
- First playback path <= 4 actions on warm start.
- Resume path <= 1 action when paused queue exists.

Interaction model:
- At least 3 high-frequency operations available via contextual interactions, not only page-level buttons.

Readability:
- Primary surfaces avoid dense diagnostic text blocks by default.

Reliability compatibility:
- Existing automation-critical controls remain reachable and testable.
- p0 gates remain passing after each rollout slice.

## 15) Decision Log

2026-02-22:
- Confirmed top-level tab architecture remains fixed.
- Confirmed advanced reliability remains in product, but with progressive disclosure and step-oriented UX.
- Confirmed redesign objective is interaction reduction and listening-first hierarchy, not feature removal.

Implementation sequencing and deeper sub-page/navigation planning are tracked in:

- `docs/audits/initial/ui-ux-redesign-implementation-tracker-2026-02-22.md`
