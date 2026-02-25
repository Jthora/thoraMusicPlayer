# UI/UX MVP Tab Audit (V3 Focused Pass)

Date: 2026-02-22  
Scope: Immediate pages reachable from top tabs in production shell (`Library`, `Search`, `Playlists`, `Now Playing`, `Settings`).

## 1) MVP Intent (Reconfirmed)

Users should be able to:
1. Add/select music sources
2. Find songs quickly
3. Play from folders or playlists with minimal friction

Everything not directly serving that path should be secondary via:
- progressive disclosure,
- in-tab sub-pages,
- compact/micro actions,
- or Settings advanced sections.

## 2) Current Fit Snapshot

- **Library:** Good direction, still one step too shell-like for first-use confidence.
- **Search:** Functional, but still command-leaning in `albums/artists/songs` modes.
- **Playlists:** Powerful, but dense in a single surface; import/search/manage blend too much.
- **Now Playing:** Improved and readable; queue and folder-generation controls remain overexposed on same tab.
- **Settings:** Correctly holds advanced tooling; still carries some maintenance controls that can become deeper sub-pages.

## 3) Per-Tab Findings and Actions

## 3.1 Library

What works:
- Clear primary CTA (`PLAY FROM LIBRARY`).
- Quick setup redirection exists.
- Recently-added list is immediately visible.

MVP friction:
- `PLAY FROM LIBRARY`/`BROWSE ALL` behavior can feel ambiguous when empty.
- Setup path still asks user to infer steps in Settings.

Immediate actions:
- Keep one primary button label and make state explicit:
  - Empty state: `SET UP LIBRARY`
  - Ready state: `PLAY FROM LIBRARY`
- Convert secondary `OPEN PLAYLISTS` to compact action chip/micro button under primary area.
- Add one-line helper under primary CTA: “Uses your selected folders and latest index.”

## 3.2 Search

What works:
- Segmented mode structure is clear.
- Inline `PLAY`/`ADD` actions now exist on rows.

MVP friction:
- `albums`, `artists`, `songs` modes are still “load then inspect” instead of direct play intent.
- `PLAY` action on each row currently maps to broad browse playback, not clearly row-specific behavior.

Immediate actions:
- Keep `search` mode as default MVP path and demote other modes behind a secondary “Browse” sub-page.
- In default search mode:
  - keep `RUN SEARCH` as primary,
  - collapse `PLAY RESULTS` into row context/long-press actions.
- Replace per-row dual full-width actions with one compact trailing action + long-press sheet.

## 3.3 Playlists

What works:
- User playlist management is front-loaded.
- Reorder/remove controls are accessible.

MVP friction:
- Create + refresh + search + results + entry management all compete in one vertical surface.
- Import panel is secondary but still heavy once opened.

Immediate actions:
- Split into in-tab sub-pages:
  - `Playlists Home` (list + create + open playlist)
  - `Playlist Detail` (entries + reorder/remove)
  - `Add Tracks` (search and add)
  - `Import` (advanced/secondary)
- Reduce default action rows in `Playlist Detail`:
  - keep long-press sheet as canonical,
  - expose compact micro-buttons only for `REMOVE` and `MOVE` start.

## 3.4 Now Playing

What works:
- Stronger single-purpose playback panel.
- Progress/timing and transport are clear.

MVP friction:
- Tab currently mixes three large surfaces: `NowPlayingPanel`, `FolderQueuePanel`, `QueueEditorPanel`.
- This makes playback feel less direct and more operational.

Immediate actions:
- Keep `Now Playing` tab focused on transport + current track only.
- Move queue-generation and queue-editing into sub-pages:
  - `Queue` sub-page from a single `OPEN QUEUE` action
  - `Folder Queue` sub-page from a single secondary entry point
- Default Now Playing should not show folder path/sort/diagnostics controls.

## 3.5 Settings

What works:
- Correctly contains advanced reliability.
- Progressive disclosure toggles already implemented.

MVP friction:
- Library maintenance still expands into a long mixed diagnostics stack.

Immediate actions:
- Split Settings into explicit sub-pages:
  - `Settings Home`
  - `Library Setup`
  - `Library Maintenance` (advanced)
  - `Reliability Tools` (advanced)
- Keep `Settings Home` to 2–3 high-value cards max.

## 4) High-Impact “Move/Shrink” Inventory

Move out of default primary tab views:
- `FolderQueuePanel` full surface from default `Now Playing`.
- `QueueEditorPanel` full surface from default `Now Playing`.
- Playlist import diagnostics list from default playlist management flow.

Shrink to micro-actions:
- Secondary cross-navigation buttons (`OPEN PLAYLISTS`, `PLAY RESULTS`) where primary action already exists.
- Repeated per-row dual buttons (`PLAY` + `ADD`) in dense lists.

Keep visible by default:
- One primary action per tab.
- One short status summary per tab.
- One direct path to playback from each content tab.

## 5) Recommended Next Slice (MVP-First)

### Slice A (fast, low-risk)
1. Keep `Now Playing` tab playback-only by default.
2. Gate `Folder Queue` and `Queue Editor` behind one `OPEN QUEUE TOOLS` action or sub-page.
3. In Search default mode, de-emphasize `PLAY RESULTS` button and favor row-context actions.

Status:
- 🟨 Partially implemented:
  - ✅ `Now Playing` now defaults to playback-first surface.
  - ✅ `Folder Queue` and `Queue Editor` are gated behind `OPEN QUEUE TOOLS` disclosure.
  - ⏳ Search `PLAY RESULTS` de-emphasis still pending in this slice.

### Slice B (medium-risk)
1. Introduce lightweight in-tab sub-pages for Playlists (`Detail`, `Add Tracks`, `Import`).
2. Keep `Import` as explicitly secondary.

### Slice C (medium-risk)
1. Settings decomposition into concise home + advanced sub-pages.
2. Move long maintenance stacks out of first settings screen.

## 6) MVP Acceptance Checks for This Pass

- From launch, user can identify where to play in <1 second on each primary tab.
- No primary tab displays maintenance/diagnostic stacks by default.
- Folder and playlist playback paths are both obvious and no more than 2 actions from their tab landing views.
- Extra tooling remains reachable but does not dominate vertical space.

## 7) Automation Compatibility Note

Do not alter or hide required reliability control labels/testIDs from advanced flows:
- `SHOW ADVANCED TOOLS`
- `CAPTURE BASELINE`
- `CAPTURE POST-SETUP`
- `EVALUATE SETUP DELTA`
- `GENERATE REPORT`
- `START IDLE TEST`
- `MARK PASS`
- `MARK FAIL`
