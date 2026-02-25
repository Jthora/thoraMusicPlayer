# Playback Service Spec

This document defines playback service requirements for reliable background audio on Android.

## Objectives

- Stable local playback in foreground/background states
- Correct media control integration
- Recoverable queue/session state

## Service Model

- Playback runs in a foreground service when active
- Media session is initialized and bound to transport controls
- Service lifecycle aligns with active playback/queue state

## Transport Controls

Required actions:

- Play
- Pause
- Seek
- Next
- Previous
- Stop

Controls must work from:

- In-app player UI
- Notification actions
- Lockscreen controls
- Headset/Bluetooth media buttons

## Audio Focus and Interruptions

Must handle:

- Transient focus loss
- Permanent focus loss
- Ducking scenarios (if implemented)
- Noisy-audio events (e.g., unplug headset)

## Queue Behavior

- Queue operations are atomic and state-consistent
- Current index remains valid after reorder/remove operations
- End-of-queue behavior follows configured repeat/shuffle policy

## Session Persistence

Persist enough state to resume after process/app restart:

- Last queue items
- Current index
- Position in track
- Repeat/shuffle mode (if enabled)

## OEM Reliability Considerations

For Xiaomi/HyperOS behavior:

- Provide guidance for battery optimization exemption/autostart
- Detect and surface likely restriction-caused playback interruptions

## Failure Handling

- Failed track decode: skip or stop according to policy with user feedback
- Missing file at play time: report and advance safely
- Service startup failure: provide explicit retry path and diagnostics

## Acceptance Criteria

- Playback continues with screen off under normal conditions
- Notification and lockscreen controls remain responsive
- Queue state remains coherent through user actions and app lifecycle events
- No critical crash in 30+ minute playback endurance run
