# Unified Search Specification

## Search Scope Options
- All
- Song Names
- Song Albums
- Song Artists
- Playlist Titles

## UI Contract
- One query input.
- One scope dropdown.
- Results grouped by entity type with clear labels.

## Behavior Rules
- Default scope = All.
- Empty query does not execute search.
- Query should be normalized and length-limited.
- Scope change should re-run current query automatically.

## Ranking Rules (Initial)
When scope = All:
1. Exact title/name matches
2. Prefix matches
3. Substring matches
4. Secondary field matches

Within each group, sort by:
- Relevance score desc
- Then alphabetic fallback

## Result Entity Model
Each result row includes:
- `type` (`song` | `album` | `artist` | `playlist`)
- `primaryText`
- `secondaryText`
- `uriOrId`
- Optional play/add action metadata

## Error/Empty States
- No results: explicit empty message with query echo.
- Native/module unavailable: actionable error text.
- Long-running query: non-blocking inline loading status.

## Validation
- Add deterministic fixture tests for scope filtering.
- Extend relevance validator to include playlist-title scenario coverage.
