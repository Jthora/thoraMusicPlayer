# UI/UX Audit (Production Shell)

Date: 2026-02-22  
Scope: Current production shell and core panels in `app/src/app/ProductionAppShell.tsx` and `app/src/features/**`.

## Executive Summary

The app made a strong structural move from a single-page debug layout to a tabbed production shell. That is a major UX improvement. The next quality step is visual hierarchy and interaction clarity: the UI is still dominated by default React Native controls, text-heavy diagnostics, and repeated action rows that feel like internal tooling instead of a polished music-player experience.

Overall rating (current): **6.0 / 10**  
Potential after targeted refinements: **8.2 / 10**

---

## What’s Working Well

- **Clear navigation baseline:** Top-level tasks are separated into tabs (`Library`, `Search`, `Playlists`, `Now Playing`, `Settings`).
- **Quick-start intent exists:** First-run card helps users get to “play music now” faster.
- **Diagnostics isolation improved:** Reliability tooling is hidden behind `Show Advanced Tools`, reducing first-time overwhelm.
- **Operational depth is strong:** App has mature capability for scanning, indexing, queueing, playlists, and reliability evidence.

---

## Key UX Gaps (Current State)

### 1) Visual hierarchy is weak
- Most screens look equally important because they use the same control style (`Button`, plain `Text`, simple borders).
- Primary actions (play, scan, import) are not visually distinguished from secondary/diagnostic actions.
- Dense rows of equal buttons create “control wall” fatigue.

### 2) Music-first experience is diluted by tooling density
- `Library` tab still contains many technical and maintenance actions above/alongside core user tasks.
- New users should primarily see: **source → scan → results → play**, not index/sync internals early.

### 3) Iconography is missing in navigation and controls
- Bottom tabs are text-only and visually heavy.
- Common actions (play, pause, next, search, add playlist, settings) rely on word recognition instead of quick icon scanning.

### 4) Theming is inconsistent/implicit
- No clear visual identity yet (no coherent dark palette, accent system, or semantic color roles).
- Controls depend on platform defaults, producing uneven Android presentation.

### 5) Information architecture inside tabs is still debug-oriented
- `Settings` includes both user settings and reliability lab controls (gated, but still long/dense when opened).
- `Search & Browse` mode switching uses button rows that feel utilitarian rather than navigational.

### 6) Interaction/accessibility friction
- Small text sizes (`11-12`) are used widely in high-density panels.
- Long FlatLists with capped heights (`maxHeight`) can compress discoverability and force awkward nested scroll behavior.

---

## Theme Direction: “Gunmetal + Glow Accents”

This direction fits your preference and the app’s technical personality.

### Recommended token set

- **Background / Surface**
  - `bg.base`: `#0F1318` (gunmetal deep)
  - `bg.elevated`: `#161C24`
  - `bg.card`: `#1B2330`
- **Borders / dividers**
  - `border.subtle`: `#2B3544`
  - `border.strong`: `#3A475B`
- **Text**
  - `text.primary`: `#E7EDF7`
  - `text.secondary`: `#A8B3C7`
  - `text.muted`: `#7A879B`
- **Glow accents (semantic use)**
  - `accent.primary`: `#5BD1FF` (cyan glow; primary actions)
  - `accent.success`: `#5CFFB2` (pass/healthy)
  - `accent.warning`: `#FFC857` (attention)
  - `accent.danger`: `#FF6B8A` (critical/stop/fail)

### Usage rules
- Use **one dominant accent** per screen (usually `accent.primary`), not all accents at once.
- Reserve glow/shadow for active/focused/playing states; avoid permanent neon everywhere.
- Keep cards/surfaces matte gunmetal, then let active controls and progress elements glow.

---

## Icon Audit and Replacement Plan

### Bottom tabs (highest impact)
- `Library` → library/music-note-stack icon
- `Search` → magnifying-glass icon
- `Playlists` → list-plus icon
- `Now Playing` → waveform / play-circle icon
- `Settings` → gear icon

### Primary action icons
- Request Permission → shield-check / key icon
- Pick Folder → folder-open icon
- Scan MediaStore → radar/refresh-search icon
- Play/Pause/Next/Prev → media transport icons
- Generate Report → document-chart icon
- Share Report/Bundle → share/export icon

### Guidance for labels
- Keep icon + short label together for clarity.
- Use icon-only only when action is universally obvious (e.g., Play, Pause, Next, Back).

---

## Per-Tab UX Audit

### Library
Current: functional but overloaded.  
Improve:
- Keep Quick Start pinned at top until first successful play.
- Move technical controls (index sync, diagnostics snippets) into collapsible “Advanced Library Tools”.
- Surface immediate feedback: “Tracks found”, “Last scan”, “Ready to play”.

### Search
Current: mode switch is button-heavy and mechanical.  
Improve:
- Replace mode buttons with segmented control + icons.
- Promote one clear primary CTA (`Search` or `Play Results`) depending on state.
- Improve empty states (“No results yet — try artist, album, folder”).

### Playlists
Current: powerful but operations appear admin-like.  
Improve:
- Emphasize user playlist list first, import tools second.
- Add clear add/edit/remove affordances with icons.

### Now Playing
Current: strongest conceptual panel but still utilitarian.  
Improve:
- Replace ASCII progress (`█░`) with actual progress bar.
- Enlarge primary transport cluster; icon-first controls.
- Increase visual focus on track title/art and playback state.

### Settings
Current: mixed user settings and advanced diagnostics.  
Improve:
- Keep basic settings top-level.
- Place diagnostics inside a separate “Advanced Reliability” section card with warning/support context.

---

## Prioritized Recommendations

### P0 (Do next)
1. Introduce theme tokens and apply app-level dark gunmetal palette.
2. Add icon-enabled bottom tab buttons.
3. Convert Now Playing controls to icon-first and proper progress bar.
4. Rebalance Library tab to make “play quickly” flow dominant.

### P1
1. Convert heavy button grids into grouped action cards with primary/secondary hierarchy.
2. Add semantic status chips (Ready, Scanning, Error, Idle) with accent color coding.
3. Improve empty/loading/success states across all tabs.

### P2
1. Add adaptive typography/spacing scale for small devices.
2. Add subtle motion for transitions (tab changes, play-state changes).
3. Add optional compact mode for advanced diagnostics views.

---

## UX Acceptance Criteria (Practical)

- First launch to first playback requires **≤ 5 taps** (assuming local music exists and permission granted on first prompt).
- User can identify current tab and primary action in **< 1 second** visually.
- Primary controls are always visually distinct from diagnostics/maintenance actions.
- `Now Playing` conveys track + state + progress without reading dense text.
- Advanced reliability tooling is discoverable but never intrusive for normal listening workflow.

---

## Suggested Implementation Order

1. Create `theme` tokens (`colors`, `spacing`, `radii`, `typography`).
2. Build reusable `IconTabButton`, `PrimaryButton`, `SecondaryButton`, `StatusChip` primitives.
3. Refactor `ProductionAppShell` tab bar and Quick Start card to new primitives.
4. Refactor `NowPlayingPanel` to icon transport + progress bar.
5. Refactor `Library` and `Search` action hierarchy.
6. Keep `LegacyDebugShell` unchanged for debug-only workflows.
