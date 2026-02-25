# Device Compatibility Profile (Current Test/Production Device)

This profile captures observed nuances from the currently connected Android phone and how they impact implementation decisions.

## Observed Device/OS Facts

- Manufacturer: Xiaomi
- Model: 2312CRNCCL (product: `blue_global`)
- Android Version: 15
- SDK: 35
- Build: `V816.0.10.0.VGRMIXM`
- OS Flavor: HyperOS/MIUI line (`V140`)
- Security Patch: 2025-10-01
- ABI support reported: `armeabi-v7a, armeabi` (32-bit only observed)
- Storage visibility: emulated internal volume mounted (`emulated;0`), no external SD currently mounted

## Captured Diagnostic Evidence

The following command categories were used to gather baseline evidence:

- ADB connectivity and daemon health
- Device properties (`getprop`) for model/build/version/ABI
- Storage volume listing (`sm list-volumes all`, `/storage`)
- Feature declarations (`pm list features`)
- Power/idle snapshot (`dumpsys battery`, `dumpsys deviceidle`)

These command classes should be rerun after major OS updates.

## Compatibility Risk Register

| ID | Area | Severity | Symptom | Impact | Mitigation |
|---|---|---|---|---|---|
| DVC-01 | ABI mismatch | Critical | Install/load failures for native modules | App may not start | Validate all native dependencies for `armeabi-v7a` before merge |
| DVC-02 | Scoped storage | Critical | Missing tracks or inaccessible folders | Core library UX breaks | Use MediaStore + SAF hybrid model with persisted grants |
| DVC-03 | HyperOS process management | High | Playback stops in background | Poor user trust/reliability | Foreground playback service + setup guidance for battery/autostart |
| DVC-04 | Legacy playlist paths | High | Playlist imports resolve few tracks | Playlist value diminished | Implement robust path normalization and unresolved diagnostics |
| DVC-05 | Device-only test coverage | Medium | Hidden regressions on other phones | Future portability risk | Keep constraints documented and add secondary test device later |

## Compatibility Nuances

### 1) ABI / Native Library Compatibility

Risk: The device reports 32-bit ABI support only, which can break modern native modules that ship arm64-only binaries.

Requirements:

- Ensure every native dependency used by the app includes `armeabi-v7a` artifacts
- Verify Gradle packaging and transitive native libraries before feature integration
- Treat ABI validation as a gating check before adding new native packages

Engineering checks:

- Validate generated APK/AAB contains expected native `.so` files for `armeabi-v7a`
- Keep a dependency compatibility table in pull requests for new native packages
- Fail fast during CI/device smoke tests when native load errors are detected

### 2) Android 15 Storage Rules

Risk: Direct raw file traversal assumptions can fail under scoped storage behavior.

Requirements:

- Use `READ_MEDIA_AUDIO` for audio media discovery
- Use MediaStore for broad indexing and metadata retrieval
- Use SAF folder grants (`ACTION_OPEN_DOCUMENT_TREE`) for deterministic folder-first playback roots
- Persist URI permissions for selected folder roots

Engineering checks:

- Confirm SAF tree grants survive app restart and device reboot
- Confirm folder playback does not rely on deprecated external storage broad access flags
- Confirm path resolution logic supports both MediaStore IDs and document URIs

### 3) Background Playback on Xiaomi/HyperOS

Risk: Aggressive background management can kill playback services.

Requirements:

- Run playback as a foreground service with media-style notification
- Integrate Android MediaSession and headset/Bluetooth transport controls
- Provide in-app setup guidance for battery optimization exemption and autostart enablement

Engineering checks:

- Validate continuous playback with screen off for 30+ minutes
- Validate notification controls remain responsive after app process moves to background
- Validate playback resumes correctly after temporary audio focus loss

### 4) Playlist Path Resolution

Risk: Legacy playlist files often include absolute/relative paths that do not resolve directly on Android.

Requirements:

- Implement robust path normalization and relative-path resolution
- Detect and report unresolved entries without failing entire playlist import
- Preserve source playlist file metadata for debugging and re-sync

Engineering checks:

- Validate resolver behavior on Unix-style and Windows-style path separators
- Validate handling for UTF-8 encoded playlist content and mixed newline styles
- Validate importer can partially succeed with unresolved line-level diagnostics

## Xiaomi/HyperOS Operational Nuances

Expected user/device setup guidance should include:

- Battery optimization exemption for the app
- Autostart enablement (if setting is present)
- Background activity allowance (OEM-specific wording varies)
- Notification visibility/permission confirmation

The app should expose a lightweight "Device Setup" help section with current status indicators where possible.

## Revalidation Triggers

Re-run this profile validation whenever any of the following occurs:

- Device firmware/HyperOS update
- React Native major upgrade
- Audio engine/native module change
- Permission model/storage logic change

## Immediate Device-Gated Acceptance Criteria

## Immediate Device-Gated Acceptance Criteria

- App installs and launches on this device in debug and release variants
- Background audio continues with screen off and app in background
- Playback survives brief USB disconnect/reconnect during development sessions
- Folder root selection via SAF persists across app restarts
- `.m3u/.m3u8` import resolves a meaningful subset of legacy archive paths

## Deferred Device Unknowns (Track Explicitly)

- Behavior with large removable SD card libraries
- Behavior with Bluetooth earbuds/headset codec transitions
- Behavior under low battery + thermal constraints during long playback sessions
- Behavior with very large (50k+) track libraries and deep nested folders
