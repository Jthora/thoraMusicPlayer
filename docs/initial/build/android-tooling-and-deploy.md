# Android Tooling and Deployment Setup

This document defines baseline setup for Android Studio + SDK tooling and repeatable deployment to the attached test/production device.

## Objectives

- Ensure deterministic Android build/install loops
- Prevent ABI incompatibility regressions
- Standardize first-run device configuration and smoke tests
- Provide reproducible failure-triage flow

## 1. Host Toolchain Baseline

- Android Studio: latest stable (or current project-pinned stable)
- Android SDK Platform: API 35
- Build Tools: latest compatible with AGP in use
- Platform Tools (`adb`): keep current (already available)
- JDK: version required by selected Android Gradle Plugin
- Node.js + package manager (npm/pnpm/yarn) according to React Native version

### Verification commands

- `adb version`
- `java -version`
- `node -v`
- `npm -v` (or `pnpm -v` / `yarn -v`)

### SDK components to ensure installed

- Android SDK Platform 35
- Android SDK Build-Tools (latest stable compatible with AGP)
- Android SDK Platform-Tools
- Android Emulator (optional; physical device is primary)
- NDK only if required by selected native dependencies

## 2. Device Connectivity Baseline

- USB debugging enabled on phone
- Device appears in `adb devices -l` as `device` (not `unauthorized`)
- Use a known-good USB data cable and avoid unstable USB hubs

### Reliability notes

- Keep one primary USB port/cable combination for deployment consistency
- If connection flaps, restart ADB daemon and reseat USB connection
- Confirm `adb shell getprop ro.build.version.sdk` output before release-candidate testing

## 3. React Native Android Build Baseline

Project settings should align to:

- `compileSdkVersion = 35`
- `targetSdkVersion = 35`
- `minSdkVersion` selected by RN/audio dependency compatibility
- NDK/ABI packaging must retain `armeabi-v7a`

### Build variants

- **Debug**: rapid iteration and log-heavy diagnostics
- **Release**: realistic process/memory behavior and performance validation

### ABI packaging policy

- Include `armeabi-v7a` explicitly
- Do not merge dependencies that drop 32-bit support without approval
- Validate resulting artifact contents for ABI coverage before tagging milestones

## 4. Permissions and Manifest Baseline

Expected Android permissions/services at minimum:

- `READ_MEDIA_AUDIO`
- Foreground service permission(s) required by current Android level
- Foreground playback service declaration
- Media button/transport control integration (MediaSession path)

Additional expected declarations/behaviors:

- Runtime permission prompts follow least-surprise flow (defer until needed)
- Playback service notification channel configured and visible
- App handles denied permissions with actionable guidance
- SAF folder-picking flow available from settings/library onboarding

## 5. First Deployment Procedure

1. Build and install debug APK on connected device
2. Confirm app launch and no immediate native-library ABI failures
3. Validate media permission request flow
4. Validate foreground playback service start/stop behavior
5. Validate lock screen and notification playback controls

### First deployment acceptance checks

- No startup crash on cold launch
- No missing native library errors in logcat
- Permission denial path does not crash and shows guidance
- Foreground service starts within acceptable latency

## 6. Known Device-Specific Setup Steps (Xiaomi/HyperOS)

After initial install, configure app manually on device:

- Allow media/file permissions
- Disable battery optimization for app
- Enable autostart (if available in system settings)
- Allow background activity where applicable

Document exact settings path per observed firmware UI when confirmed.

## 7. Repeatable Deployment Commands

Examples:

- `adb devices -l`
- `adb install -r <apk-path>`
- `adb shell am force-stop <package>`
- `adb logcat | grep -Ei "Audio|Media|TrackPlayer|ReactNative|AndroidRuntime"`

Additional useful commands:

- `adb shell dumpsys package <package>`
- `adb shell dumpsys activity services <package>`
- `adb shell dumpsys media_session`
- `adb shell cmd appops query-op --user current READ_MEDIA_AUDIO allow`

## 8. Failure Triage Priorities

1. ABI mismatch / native load errors
2. Foreground service startup/notification issues
3. Permission denial or scoped storage access failure
4. Playlist path resolution failures
5. OEM battery policy process termination

## 9. Escalation Playbook

When a blocker persists after basic triage:

1. Capture timestamped logs and exact reproduction steps
2. Classify blocker into ABI, storage, service, parser, or OEM policy bucket
3. Add blocker to documentation with current mitigation status
4. Gate further feature work if blocker is in a critical path (playback/scan/install)

## 10. Release Readiness (Initial Build)

Before considering initial build stable:

- Debug and release both validated on connected production device
- P0 test matrix pass complete
- Known issues list updated with severity and workaround
- Device setup guide steps verified end-to-end by fresh install flow
