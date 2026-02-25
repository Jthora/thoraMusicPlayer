# Navigation Contract

## Tab Key Contract
Use stable tab keys:
- `home`
- `search`
- `yourLibrary`
- `create`
- `settings`

Do not reuse old keys (`library`, `playlists`) in new feature code.

## Initial Tab
- Startup tab should be `home` (or `search` only if explicitly toggled during migration).
- Final target for this phase: `home`.

## Page State Contracts
- Entering `yourLibrary` always resets active pill to `allSongs`.
- Entering `search` preserves last query/filter in-session.
- Entering `create` preserves draft playlist name/query in-session.

## Deep-Link Readiness
Internal route IDs (future-proofing):
- `home/recently-added`
- `home/last-played`
- `home/popular`
- `search/results`
- `library/all-songs`
- `library/playlists`
- `library/albums`
- `library/artists`
- `create/playlist`
- `settings/theme`

## Transition Rule
Do not block route transitions on non-critical background data fetches.
- Render shell immediately.
- Load data asynchronously.
- Show inline loading placeholders.
