# Data + Native Contracts

## Current Gap
Existing bridge lacks first-class play-history/popularity/query scope support required by new UX.

## Required Data Entities

### Track Play Stats
- `uri: string` (PK)
- `playCount: number`
- `lastPlayedAtSec: number`
- `lastCompletedAtSec: number`
- `skipCount: number`

### Optional Aggregates
- Album-level and playlist-level play stats (materialized or query-time derived).

## Required Native Methods (Add)
- `recordPlaybackEvent(uri, eventType, positionMs, durationMs)`
- `getRecentlyPlayedTracks(limit)`
- `getPopularTracks(limit, windowDays?)`
- `getRecentlyPlayedAlbums(limit)`
- `getRecentlyPlayedPlaylists(limit)`
- `searchUnified(query, scope, limit)` where scope in:
  - `all`
  - `song_names`
  - `song_albums`
  - `song_artists`
  - `playlist_titles`

## Required TypeScript Types (Add)
- `TrackPlayStats`
- `RecentlyPlayedAlbum`
- `RecentlyPlayedPlaylist`
- `UnifiedSearchScope`
- `UnifiedSearchResult`

## Event Semantics
- `PLAY_STARTED`
- `PLAY_COMPLETED`
- `PLAY_SKIPPED`
- `PLAY_PAUSED`

Minimum requirement for popularity:
- Increment `playCount` on completion threshold (e.g., played >= 70% OR >= 30s).

## Performance Constraints
- Home data endpoints return within budget for first render.
- Search endpoint supports bounded result limits and safe normalization.

## Compatibility
- New methods must coexist with existing browse/search methods until migration completion.
