# UI/UX Audit — Fresh Eyes Pass (V2)

Date: 2026-02-22  
Scope: Current production shell and all active feature panels after overhaul pass.

## Executive Read

The app has improved significantly in structure and visual consistency, but still behaves like a power-tool dashboard in several places where mainstream music apps feel effortless.

- Current UX maturity: **7.2 / 10**
- With targeted auto/background + interaction upgrades: **8.8 / 10**

Main issue now is not architecture; it is **interaction burden**. Too many tasks still require explicit button presses that users expect to happen automatically.

---

## What Improved Since Last Audit

- Stronger tabbed IA and shell consistency.
- Gunmetal + accent token system is now coherent.
- Better hierarchy in Library, Search, Playlists, Now Playing, Settings.
- Readability improved in reliability and queue flows.
- Basic motion introduced (tab fade), and regression gates remain stable.

---

## Fresh-Eyes Critical Findings

### 1) Still too button-centric for mainstream feel
Even after improvements, many screens rely on action rows and command-style operations. Mainstream music apps use direct manipulation and background state sync first, buttons second.

### 2) Discovery and indexing still feel manual
User still has to explicitly run many sync/scan actions that can be opportunistic in background when app is foregrounded and permissions/folders are valid.

### 3) Lists are data-rich but interaction-light
Track rows in Library/Search/Queue lack gestures and inline affordances (swipe, long-press menus, contextual controls).

### 4) Visual style is good but not yet premium
Palette is solid, but accent behavior is still broad and static. A premium look needs semantic glow usage, stronger depth hierarchy, and icon consistency.

### 5) Reliability tools are improved but still heavy
Advanced reliability is correctly gated, but once open, the panel is still dense and command-heavy.

---

## What Should Become Automatic / Background

These are high-value reductions in user effort:

1. **Auto refresh grants on app focus**
   - Trigger folder grant refresh automatically when app resumes.
   - Only show user intervention if grant health changed.

2. **Smart incremental sync on idle foreground**
   - If permission granted and at least one folder root exists, run lightweight incremental sync silently after app opens.
   - Present a passive status chip: “Library updated 30s ago”.

3. **Auto-scan suggestion engine**
   - Detect stale library age and suggest one-tap scan only when needed, instead of always showing scan controls as equal priority.

4. **Playlist import post-action automation**
   - After import, auto-run a resolve retry once if unresolved entries are path-normalizable.
   - Show summary toast/chip instead of requiring immediate manual refresh/retry cycle.

5. **Now Playing continuation heuristics**
   - Auto restore last queue + position if app restarts and track source remains valid.

6. **Background housekeeping**
   - Debounced cleanup of revoked grants and stale diagnostics can run on schedule without explicit button taps.

---

## Non-Button UI Improvements (High Impact)

### Track/List interactions
- Swipe right on track row: quick add to queue.
- Swipe left: remove/dismiss (playlist/queue contexts).
- Long-press row: bottom-sheet actions (Play next, Add to playlist, Go to album/artist).

### Queue interactions
- Drag-and-drop reorder in Queue Editor instead of Up/Down buttons.
- Tap row to set active track with subtle active-row highlight and pulse.

### Search/Discover
- Inline segmented control already present; add horizontal filter chips for Artist/Album/Song count thresholds.
- Result rows: one trailing icon action instead of separate add/play rows.

### Reliability panel
- Convert repeated action groups into stepper timeline cards:
  - Baseline → Post-setup → Delta → Report
- Use progress indicator + completion checks, reducing visual command density.

### Settings
- Use switch/toggle controls where stateful actions exist (e.g., advanced tools visibility), instead of binary action buttons.

---

## Style & Theme V2 Recommendations

### Gunmetal refinement
- Keep current base palette; reduce accent usage to emphasis moments.
- Add one additional surface depth level for cards that should float (e.g., Now Playing card, active queue item).

### Accent semantics
- `accentPrimary` only for primary CTA and active progress.
- `accentSuccess` only for healthy/ready states.
- `accentWarning` only for stale/running transitions.
- `accentDanger` only for failures/critical actions.

### Typography polish
- Raise small utility text floors to 13 where practical.
- Keep long diagnostics compact but increase line-height slightly for scanability.

---

## Icon System Critique + Upgrade

Current icon usage is better but inconsistent:
- Tabs use symbolic glyphs; many action areas still text-heavy.

Next step:
- Adopt a single icon vocabulary for all major actions:
  - Play/Pause/Next/Prev, Scan, Sync, Folder, Import, Share, Report, Settings, Warning, Success.
- Use icon-leading buttons in high-frequency controls.
- Use icon-only only in universally recognized transport controls.

---

## Animation Critique + Upgrade

Current motion is intentionally minimal (good for reliability workflows).

Recommended incremental additions:
1. Subtle list-item insertion/removal transitions for queue/playlist edits.
2. Active-track micro-animation in Now Playing/Queue (short pulse/glow).
3. Section expand/collapse animation for advanced cards.

Constraints:
- Keep transitions <= 180ms.
- Avoid animations that obscure status/diagnostics readability.

---

## Screen-by-Screen Priority Upgrades

### Library (priority high)
- Auto refresh + incremental sync in background.
- Convert scan/index controls into progressive disclosure.
- Add recently-added / recently-played quick rows.

### Search (priority high)
- Inline actions per row and long-press contextual menu.
- Remove dependency on separate action button rows where possible.

### Playlists (priority high)
- Replace Up/Down with drag reorder.
- Add swipe-to-remove and quick-add chips.

### Now Playing (priority medium)
- Add scrubber thumb interaction and subtle active glow.
- Keep current transport layout; refine icon consistency.

### Settings / Reliability (priority medium)
- Add timeline/stepper structure for reliability tasks.
- Collapse low-priority diagnostics by default.

---

## Suggested Implementation Sequence (V2)

1. Introduce passive background sync/grant-refresh orchestration.
2. Implement gesture interactions in queue/playlist/search result rows.
3. Replace queue up/down with drag reorder UX.
4. Add reliability stepper flow and collapse dense sections.
5. Unify icon vocabulary and semantic accent rules across all panels.
6. Add micro-motion where it reinforces status changes.

---

## Acceptance Criteria for Next Iteration

- User can reach playback from a valid library with fewer explicit setup taps than current flow.
- At least 3 major repetitive actions become automatic/background.
- At least 2 high-frequency list actions become gesture/context-menu based.
- Button count per major panel decreases without reducing capability.
- p0 debug + prioritization gates remain clean after each phase.
