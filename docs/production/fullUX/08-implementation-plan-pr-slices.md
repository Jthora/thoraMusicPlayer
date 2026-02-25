# Implementation Plan: PR Slices and Dependencies

## Sequencing Principle
Small, mergeable PRs with one primary risk area each.

## PR-1 Navigation Skeleton
Scope:
- New tab keys + labels + shell page scaffolds.
- Compatibility shims for existing panels.

Do not include:
- Data model changes
- Playback logic changes

Gate:
- Existing flows still reachable.

## PR-2 Home Refactor
Scope:
- Rename/rebuild legacy Library surface into Home.
- Remove dead CTA.
- Add Last Played and Popular sections with placeholder/fallback data.

Gate:
- Home has 3 required sections.

## PR-3 Your Library V2
Scope:
- Recently played albums/playlists header area.
- Pills: Playlists, Albums, Artists, All Songs.
- Default to All Songs on entry.
- Sort UI with all required options.

Gate:
- Entry defaults and sort controls verified.

## PR-4 Unified Search UI + Contracts
Scope:
- Search scope dropdown.
- Unified result renderer.
- Temporary adapter if native unified endpoint not ready.

Gate:
- Scope changes affect result set correctly.

## PR-5 Native Analytics + Unified Search Backend
Scope:
- Playback stats persistence.
- Recently played/popular queries.
- Unified search endpoint with playlist-title coverage.

Gate:
- Home + Library populate with real play-history data.

## PR-6 Playback Modes
Scope:
- End mode + random controls and queue engine integration.

Gate:
- End-of-queue behavior passes matrix.

## PR-7 Create + Settings + Theme Runtime
Scope:
- Dedicated Create flow.
- Settings nav refinement.
- Theme controls + persistence + runtime application.

Gate:
- Theme change applies globally and persists.
