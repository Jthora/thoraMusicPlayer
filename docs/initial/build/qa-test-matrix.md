# QA Test Matrix

This matrix maps key requirements to concrete tests for the initial build.

## Priority Definitions

- **P0**: must pass for release candidate
- **P1**: high priority, mitigation required if failing
- **P2**: quality improvement

## Matrix

| Test ID | Priority | Requirement(s) | Scenario | Expected Result |
|---|---|---|---|---|
| QA-001 | P0 | RQ-001, NFR-003 | Fresh install, grant media access, run initial scan | Track library is populated without crash |
| QA-002 | P0 | RQ-002 | Select folder root and start playback | Queue generated and playback starts deterministically |
| QA-003 | P0 | RQ-005, RQ-006 | Background app with screen off during playback | Playback continues; controls remain available |
| QA-004 | P0 | RQ-003 | Import valid `.m3u` with mixed relative/absolute paths | Import succeeds with resolved and unresolved counts |
| QA-005 | P0 | RQ-004 | Create/edit/reorder user playlist then restart app | Playlist persists with order intact |
| QA-006 | P0 | RQ-007 | Search by title/artist/album/filename/folder | Correct results returned for each query mode |
| QA-007 | P0 | NFR-001 | 30+ minute continuous playback run | No critical crash or unrecoverable stall |
| QA-008 | P1 | RQ-006 | Trigger transient audio focus interruptions | Playback follows focus policy correctly |
| QA-009 | P1 | RQ-006 | Headphone unplug during playback | Noisy-audio policy executes safely |
| QA-010 | P1 | RQ-003 | Import malformed playlist file | Import reports errors without app crash |
| QA-011 | P1 | RQ-001 | Incremental rescan after add/remove files | Catalog updates delta without full reset |
| QA-012 | P1 | RQ-008 | Xiaomi battery optimization enabled vs disabled | Guidance shown; reliability improves after exemption |
| QA-013 | P2 | NFR-002 | Scan and browse large folder tree | UI remains responsive enough for navigation |

## Execution Notes

- Execute all P0 tests on both debug and release builds
- Run P0 + selected P1 tests after any playback/scanner/parser refactor
- Record failures with reproduction steps, build hash, and device firmware info
- Use `npm run test:device-ui` for automated physical-device reliability smoke (`baseline → post-setup → delta → interruption/recovery trigger → idle trigger → report`) and capture artifacts from `app/android/app/build/reports/device-ui-smoke/summary.txt` and `app/android/app/build/reports/device-ui-smoke/qa-mapping.json` (current automated partial mapping: QA-012, QA-003, QA-008, QA-009)
- Use `npm run test:p0:debug` to execute the current automated debug P0 bundle (smoke + instrumentation) and capture consolidated output at `app/android/app/build/reports/p0-debug/p0-debug-bundle.json` plus failure classification output at `app/android/app/build/reports/p0-debug/failure-classification.json`
- `npm run test:p0:debug` now also records a non-blocking supplemental device-robustness lane result (`SUPPLEMENT_device-robustness`) in the same bundle output for broader physical-device evidence coverage.
- Use `npm run test:p0:release` to execute the current automated release P0 bundle (assembleRelease + release smoke) and capture consolidated output at `app/android/app/build/reports/p0-release/p0-release-bundle.json` plus failure classification output at `app/android/app/build/reports/p0-release/failure-classification.json`
- Use `npm run test:p0:prioritize` to consolidate debug/release failure classifications into prioritized blocker outputs at `app/android/app/build/reports/p0-prioritization/p0-blocker-prioritization.json` and `.txt`
- Use `npm run test:stage4.1:oem` for Stage 4.1 clean-install OEM hardening validation (setup guidance + baseline/post-setup/delta + controlled doze transition) with artifacts at `app/android/app/build/reports/stage4-1-oem-hardening/summary.txt` and `qa-mapping.json`
- Use `npm run test:failure:permission-revocation` for a pass-3 failure-injection scenario that revokes `READ_MEDIA_AUDIO` at runtime, verifies post-revoke app liveness/status handling, and confirms re-grant recovery; artifacts are written to `app/android/app/build/reports/permission-revocation-injection/summary.txt` and `result.json`
- Use `npm run test:device:robustness` to execute a consolidated physical-device robustness bundle (smoke + Stage 4.1 OEM + permission-revocation injection) with aggregated output at `app/android/app/build/reports/device-robustness/device-robustness-bundle.{txt,json}`

## Exit Gate

Initial release candidate requires:

- 100% pass on P0 tests
- P1 failures documented with mitigation and owner
- No open critical crash defects
- Current P1 mitigations and owners maintained in `known-issues-register.md`
