# Playback Modes Specification

## Required Controls
- End mode selector:
  - Stop at End
  - Repeat
  - Repeat-1
- Random toggle

## State Model
- `endMode: 'stop' | 'repeat_all' | 'repeat_one'`
- `randomEnabled: boolean`

Persist both values and restore at app start.

## Queue Advancement Rules
On track end:
- `stop`: stop playback at final track.
- `repeat_all`: advance to next track, wrap at end.
- `repeat_one`: replay current track.

If `randomEnabled = true`:
- Select next track pseudo-randomly from queue.
- Avoid immediate same-track repeat unless queue length = 1.
- Preserve deterministic fallback if random candidate fails.

## Manual Controls Interaction
- `next` and `previous` remain available in all modes.
- Manual `next` in repeat-one should still move forward (mode affects auto-advance, not manual navigation).

## Telemetry Hooks
Record mode state in playback diagnostics snapshots.

## Test Cases
- End-of-queue behavior for each mode.
- Random behavior with queue sizes 1, 2, many.
- Mode persistence across app restart.
- No regression in existing play/pause/seek/skip behavior.
