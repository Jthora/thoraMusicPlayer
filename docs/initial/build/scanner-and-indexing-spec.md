# Scanner and Indexing Spec

This document defines library scan behavior, indexing, and update policy.

## Scanner Objectives

- Build a reliable local catalog from mixed archive sources
- Support incremental updates without full rebuild by default
- Keep UI responsive while scans run

## Scan Sources

1. MediaStore audio query
2. SAF-selected folder roots

## Scan Modes

- **Initial full scan**: baseline catalog creation
- **Incremental scan**: detect adds/changes/removals using `path/uri + size + mtime`
- **Manual targeted rescan**: user-triggered for selected root(s)

## Index Pipeline

1. Collect source records
2. Normalize metadata and canonical identifiers
3. Deduplicate candidates
4. Upsert tracks/artists/albums/folders in DB
5. Materialize search tokens
6. Write `ScanSnapshot` metrics

## Deduplication Policy

Prefer deterministic dedup keys:

1. Canonical path/URI
2. Fallback: title + duration + artist (when metadata quality allows)

Potential duplicates should be tagged, not silently dropped, if confidence is low.

## Data Quality Handling

- Missing tags: fallback to filename and folder-derived labels
- Corrupt metadata: store minimal safe record and continue
- Unsupported MIME: skip with diagnostic count

## Concurrency and State

- One active scan job at a time
- New scan requests while active become queued/cancel-restart per policy
- Scan progress state exposed to UI (`idle/running/completed/failed`)

## Performance Targets (Initial)

- Incremental scan should complete quickly for small deltas
- UI should remain interactive during scan operations
- Scan cancellation should leave DB in a consistent state

## Acceptance Criteria

- Initial scan produces stable browsable library
- Incremental scan reflects file additions/changes/removals
- Scan failures are isolated and reported without catastrophic reset
- Search index updates reflect latest successful scan snapshot
