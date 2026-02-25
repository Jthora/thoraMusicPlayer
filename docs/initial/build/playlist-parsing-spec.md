# Playlist Parsing and Resolution Spec

This document defines playlist import behavior, parser boundaries, and path-resolution policy.

## Supported Formats

### Initial Build (Must)

- `.m3u`
- `.m3u8`

### Planned Next (Should)

- `.pls`
- `.xspf`

## Parser Responsibilities

- Parse playlist text into ordered raw entries
- Handle comments/directives safely
- Emit structured diagnostics for malformed lines
- Never crash app on malformed input

## Entry Normalization Rules

- Trim whitespace and ignore empty lines
- Preserve original line text for debugging
- Normalize separators (`\\` and `/`) for resolver processing
- Treat URI-like entries separately from file-like entries

## Path Resolution Strategy

Resolution attempt order:

1. Exact canonical path match in indexed tracks
2. Relative-to-playlist-file directory resolution
3. Filename + size/duration heuristic match (optional fallback)
4. URI/document reference match when available

## Result Status Model

Each playlist entry receives one status:

- `resolved`
- `unresolved`
- `duplicate`
- `unsupported`

Importer must support partial success and present summary stats.

## Error/Diagnostic Contract

For each failed or ambiguous entry capture:

- Playlist file identifier
- Entry line number
- Original entry text
- Failure reason code (e.g., `NO_MATCH`, `MULTIPLE_MATCHES`, `UNSUPPORTED_URI`)

## UX Requirements

- Imported playlists appear on dedicated Playlists page
- User sees count of resolved/unresolved entries
- User can remove unresolved entries or attempt re-resolve after rescan

## Acceptance Criteria

- Malformed playlists never crash import
- Relative and absolute path examples resolve where possible
- Unresolved entries are visible and actionable
- Import summary is persisted for audit/troubleshooting
