# Android Permissions and Storage Spec

This document defines required storage access behavior for Android 15+ compatibility.

## Goals

- Comply with scoped storage behavior
- Preserve folder-first UX semantics
- Avoid deprecated broad external storage assumptions

## Permission Model

### Required runtime permissions

- `READ_MEDIA_AUDIO`

### Service/notification permissions and declarations

- Foreground service permission(s) required by current Android target
- Foreground playback service declaration
- Notification channel and media-style notification setup

## Storage Access Strategy

Use hybrid access:

1. **MediaStore access** for broad media discovery and metadata indexing
2. **SAF directory grants** for user-selected root folders used by folder-first playback

## SAF Requirements

- Invoke folder picker with `ACTION_OPEN_DOCUMENT_TREE`
- Persist URI grant permissions
- Store granted URIs in app-local settings table
- Validate grant availability on startup and flag revoked grants

## Canonicalization Rules

- Normalize separators and URI forms before resolver matching
- Maintain both display path and canonical path/URI key
- Preserve original source path strings from playlist files for diagnostics

## Failure Handling

### Permission denied

- Do not crash
- Show clear guidance and retry action
- Keep app usable for already-indexed content where possible

### Grant revoked

- Mark affected root as unavailable
- Skip inaccessible content during scan
- Provide a one-tap re-grant flow

### Missing/unreadable file

- Record non-fatal diagnostic
- Continue scan/import operation

## Security and Privacy

- Do not collect unrelated file data outside selected/granted scope
- Keep diagnostics local unless explicit export is requested
- Avoid storing unnecessary personally identifying data

## Acceptance Criteria

- Media permission flow succeeds and is recoverable from denial
- SAF grant persists and remains usable after app restart
- Folder-driven queue works from SAF-selected roots
- Scanner tolerates revoked grants and partial access failures
