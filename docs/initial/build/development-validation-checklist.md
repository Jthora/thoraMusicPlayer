# Development Validation Checklist

Use this checklist throughout early development to avoid regressions on the production test device.

## Severity Legend

- **P0**: release-blocking
- **P1**: high-priority, ship with mitigation only if necessary
- **P2**: quality improvement, not release-blocking for initial build

## A. Environment and Build

- [ ] (P0) Android Studio and SDK API 35 installed/updated
- [ ] (P0) `adb` detects device in `device` state
- [ ] (P0) Debug build installs successfully
- [ ] (P0) Release build installs successfully
- [ ] (P0) No ABI-related native load errors on startup
- [ ] (P1) Build reproducible on clean checkout with documented steps

## B. Permissions and Access

- [ ] (P0) `READ_MEDIA_AUDIO` request succeeds
- [ ] (P0) SAF folder selection works
- [ ] (P0) SAF folder permission persists after restart
- [ ] (P0) App can rescan and detect new files
- [ ] (P1) Permission denial path provides actionable guidance and recovery action

## C. Playback Core

- [ ] (P0) Single track play/pause/seek works
- [ ] (P0) Next/previous track works reliably
- [ ] (P0) Queue survives app backgrounding
- [ ] (P0) Playback continues with screen off
- [ ] (P0) Notification and lockscreen controls function
- [ ] (P1) Audio focus loss events handled correctly (transient/permanent)
- [ ] (P1) Noisy-audio event (headphone unplug) handled safely

## D. Folder-First UX

- [ ] (P0) Folder tree loads from selected roots
- [ ] (P0) Selecting folder creates dynamic queue
- [ ] (P1) Sorting options work (name/date/random if implemented)
- [ ] (P0) Missing files are skipped with non-fatal reporting
- [ ] (P1) Large folder selection does not freeze UI

## E. Playlist UX

- [ ] (P0) `.m3u/.m3u8` import parses without app crash
- [ ] (P0) Relative and absolute paths are resolved where possible
- [ ] (P0) Unresolved entries are surfaced clearly
- [ ] (P0) User can create/edit/reorder/save custom playlists
- [ ] (P1) Playlist import supports UTF-8 and mixed newline styles

## F. Search and Organization

- [ ] (P0) Search finds by filename/title/artist/album/folder
- [ ] (P1) Albums view groups tracks correctly
- [ ] (P1) Artists view groups tracks correctly
- [ ] (P1) Duplicate tracks are handled consistently
- [ ] (P2) Search response remains acceptable on larger library snapshots

## G. Device-Specific Reliability (Xiaomi/HyperOS)

- [ ] (P0) Battery optimization exemption flow documented/tested
- [ ] (P0) Autostart/background settings documented/tested
- [ ] (P0) Playback survives normal idle/doze transitions
- [ ] (P1) Playback remains stable during USB attach/detach in dev sessions
- [ ] (P1) Notification permission/state does not block media controls

Execution notes for G checks:

- Capture a **baseline** setup snapshot before changing Xiaomi/HyperOS settings
- Apply battery/autostart guidance, then capture a **post-setup** snapshot
- Start an **idle/doze test session** before screen-off/background endurance checks
- Complete the idle/doze session with **PASS/FAIL** outcome and concise notes
- Generate a setup validation report after snapshots/events are captured
- Log interruption/recovery events during idle/doze playback tests to preserve evidence
- Attach snapshot/event exports to validation notes before marking G subtasks complete

## H. Data Integrity and Recovery

- [ ] (P0) App restart restores last known queue/session state safely
- [ ] (P1) Incremental rescan updates changed files without full reset
- [ ] (P1) Corrupt playlist file does not corrupt existing library state
- [ ] (P1) Failed track decode does not crash queue playback

## Exit Criteria for Initial Build Phase

- [ ] All P0 checks pass consistently
- [ ] All P1 checks either pass or have documented mitigation/workaround
- [ ] At least one realistic legacy playlist import validated
- [ ] No critical crash in 30+ minute continuous playback session
- [ ] Team documentation updated with any new device-specific caveats

## Execution Cadence

- Run A–C checks on every major playback/scanner merge
- Run D–F checks on feature milestone completion
- Run G–H checks before release candidate tagging
