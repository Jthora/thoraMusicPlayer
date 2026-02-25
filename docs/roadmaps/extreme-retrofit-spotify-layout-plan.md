# Extreme Retrofit Plan: Spotify-Style Information Architecture

Date: 2026-02-23

## 1) Target Product Shape

### Primary bottom navigation
- Home
- Search
- Your Library
- Create
- Settings

### Home
- Rename current Library tab content to Home.
- Keep Recently Added.
- Add Last Played.
- Add Popular Songs.
- Remove the current "Play from Library" CTA.

### Search
- Global search across:
  - Song names
  - Song albums
  - Song artists
  - Playlist titles
- Add filter dropdown:
  - All (default)
  - Song Names
  - Song Albums
  - Song Artists
  - Playlist Titles

### Your Library
- Default sub-page on open: All Songs.
- Top pill filters:
  - Playlists
  - Albums
  - Artists
  - All Songs
- Above filters, show recently played albums and playlists.

### All Songs behavior
- Sort options:
  - Name
  - Album
  - Artist
  - Last Played
  - Most Played
  - Length

### Playback modes
- End behavior modes:
  - Stop at End
  - Repeat All
  - Repeat One
- Random mode toggle (shuffle).

### Create
- Dedicated page for creating playlists from songs.

### Settings
- Keep existing settings/tools, but group under a clearer settings navigation view.
- Add Theme Color Control at top:
  - Default preset = current theme
  - Additional presets
  - Custom color editing

---

## 2) Current-State Gap Analysis (Codebase)

### Already available
- Existing bottom tabs in `ProductionAppShell`.
- Indexed song/album/artist browse and search APIs.
- User playlists (create/list/add/remove/move tracks).
- Queue and now-playing controls.

### Missing for requested UX
- No play-history model (`lastPlayed`, `playCount`) in JS/native types.
- No unified search including playlist titles + scoped search filters.
- No dedicated Your Library page architecture with default All Songs + sorts.
- No playback mode state machine for stop/repeat/repeat-1/shuffle.
- Theme is static constants, not user-configurable.

---

## 3) Proposed Architecture Changes

### A. Navigation + page model
- Replace current tab schema with:
  - `home`, `search`, `yourLibrary`, `create`, `settings`
- Move current Library card/stats content into Home cards only.
- Move current playlist-heavy flow to:
  - `yourLibrary` (consumption)
  - `create` (authoring)

### B. Listening analytics data layer
Add persistent stats model (SQLite/native store):
- `track_play_stats`
  - `uri` (PK)
  - `playCount`
  - `lastPlayedAtSec`
  - `lastCompletedAtSec`
  - `skipCount`
- `album_play_stats` (derived/denormalized or query-time aggregate)
- `playlist_play_stats` (by playlist id)

Update native bridge with endpoints:
- `recordPlaybackEvent(uri, eventType, positionMs, durationMs)`
- `getRecentlyPlayedTracks(limit)`
- `getPopularTracks(limit, windowDays?)`
- `getRecentlyPlayedAlbums(limit)`
- `getRecentlyPlayedPlaylists(limit)`

### C. Library domain hooks
Introduce focused hooks:
- `useHomeFeed()`
  - recently added, last played, popular songs
- `useLibraryView()`
  - selected pill, all songs list, sorting mode, grouped datasets
- `useUnifiedSearch()`
  - query + filter scope + merged ranked results

### D. Playback mode state
Add playback settings state:
- `endMode: 'stop' | 'repeat_all' | 'repeat_one'`
- `randomEnabled: boolean`

Integrate with queue advance logic in now-playing state:
- On track end:
  - stop / repeat queue / repeat track
- Random:
  - randomized next-track selection with history-safe behavior

### E. Theme system
Replace static color singleton usage with theme provider:
- `ThemeContext` with runtime theme object.
- Presets + custom palette editor.
- Persist selected theme in storage.
- Incrementally migrate components from static imports to `useTheme()`.

---

## 4) Execution Plan (Phased)

### Phase 0: Foundation + safety rails (1-2 days)
- Freeze current UX with baseline screenshots and smoke scripts.
- Add lightweight feature flags:
  - `enableSpotifyIa`
  - `enableThemeControl`
  - `enablePlaybackModes`
- Add migration notes and rollback strategy.

### Phase 1: Navigation retrofit (2-3 days)
- Refactor tab keys/order and labels/icons.
- Stand up pages:
  - Home
  - Search
  - Your Library
  - Create
  - Settings
- Keep old components behind compatibility wrappers where useful.

### Phase 2: Home redesign (2 days)
- Remove dead Library CTA/stat-first behavior.
- Implement sections:
  - Recently Added
  - Last Played (placeholder data fallback until Phase 4)
  - Popular Songs (placeholder fallback)

### Phase 3: Your Library IA (3-4 days)
- Build top pills + default `All Songs` selected.
- Add list sections for recently played albums/playlists.
- Implement All Songs sort controls (initially for available fields).

### Phase 4: Playback analytics persistence (3-5 days)
- Native + JS bridge for play events and retrieval queries.
- Record events from now-playing transitions.
- Backfill Home + Your Library with true last-played/popular signals.

### Phase 5: Unified Search overhaul (2-3 days)
- Native search endpoint supporting scoped targets.
- Search UI filter dropdown.
- Unified result list with section headers and ranking strategy.

### Phase 6: Playback mode controls (2-3 days)
- Add UI controls in now-playing.
- Implement stop/repeat/repeat-1/shuffle logic.
- Persist playback mode preferences.

### Phase 7: Create page (1-2 days)
- Extract playlist creation flow from current mixed playlists surface.
- Song picker + search + add to selected/new playlist flow.

### Phase 8: Settings navigation + Theme Color Control (3-5 days)
- Introduce settings nav controller layout.
- Add preset themes and custom editor.
- Migrate core components to theme context.

### Phase 9: QA hardening and polish (2-4 days)
- Regression for playback/queue/search/playlists.
- Device matrix checks.
- Performance pass on list rendering and search latency.

---

## 5) Acceptance Criteria by Feature

### Home
- No “Play from Library” CTA.
- Shows Recently Added, Last Played, Popular Songs sections.

### Your Library
- Opens with All Songs selected every time.
- Pills visible: Playlists, Albums, Artists, All Songs.
- All Songs supports all six sort options.

### Search
- One query can search songs/albums/artists/playlists.
- Filter dropdown correctly scopes results.

### Playback
- End mode buttons visibly selectable.
- Shuffle toggle affects next-track behavior.

### Create
- User can create playlist and add tracks without entering Your Library flow.

### Settings/Theme
- Theme control appears at top.
- Preset switch and custom color edits apply live and persist.

---

## 6) Risks and Mitigations

- Risk: Broad refactor destabilizes playback state.
  - Mitigation: Phase flags + preserve current queue engine until Phase 6.

- Risk: No existing play-history data.
  - Mitigation: Placeholder sections first, then analytics-backed data in Phase 4.

- Risk: Theme migration touches many files.
  - Mitigation: Introduce compatibility layer (`getThemeColors`) and migrate incrementally.

- Risk: Search relevance regresses with multi-entity indexing.
  - Mitigation: keep current relevance validator; extend tests for scoped search.

---

## 7) Recommended Build Order for First PR Wave

PR-1: Navigation skeleton + page shells + tab rename/order.
PR-2: Home redesign (remove dead CTA, add sections with temporary data).
PR-3: Your Library page with pills and All Songs sorts (without play-history sorts fully wired).
PR-4: Unified search UI with filter dropdown + temporary JS-level filtering fallback.
PR-5: Native play-history + playlist-title search APIs and full wiring.
PR-6: Playback mode controls.
PR-7: Theme color system and settings navigation refactor.

---

## 8) Immediate Next Step

Start PR-1 with routing and page extraction only, no data-model changes. This unlocks parallel work across Home, Search, Library, Create, and Settings without merge conflicts.
