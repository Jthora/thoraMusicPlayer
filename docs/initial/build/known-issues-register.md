# Known Issues Register

This register tracks non-P0 gaps, known limitations, and mitigations for the initial build release-readiness pass.

## Current Summary

- Open P0 blockers: **0**
- Current blocker-prioritization status: `CLEAR`
- Source artifact: `app/android/app/build/reports/p0-prioritization/p0-blocker-prioritization.txt`

## Active Issues

| Issue ID | Area | Priority | Status | Mitigation | Owner | Evidence |
|---|---|---|---|---|---|---|
| KI-001 | Audio focus interruption validation depth (QA-008) | P1 | Open | Keep automated interruption/recovery evidence in CI/device loop; schedule targeted device scenario with real competing audio app before RC tag. | playback/android-runtime | `app/android/app/build/reports/device-ui-smoke/qa-mapping.json` |
| KI-002 | Noisy-audio physical unplug validation depth (QA-009) | P1 | Open | Keep automated noisy-audio evidence trigger path; execute physical headset unplug run in final pre-release checklist and capture notes. | playback/android-runtime | `app/android/app/build/reports/device-ui-smoke/qa-mapping.json` |

Additional mitigation evidence:

- Consolidated device regression bundle now runs smoke + OEM hardening + permission-revocation injection in one command: `npm run test:device:robustness`.
- Current passing artifact: `app/android/app/build/reports/device-robustness/device-robustness-bundle.json`.

## Closed Issues

| Issue ID | Area | Priority | Resolution | Owner | Evidence |
|---|---|---|---|---|---|
| KI-C001 | P0 debug/release blocker triage | P0 | No blockers detected after debug+release reruns and prioritization pass. | qa-automation | `app/android/app/build/reports/p0-prioritization/p0-blocker-prioritization.txt` |
| KI-C002 | Xiaomi setup guidance validation (QA-012) | P1 | Closed via Stage 4.1 OEM hardening run with clean-install and controlled idle/doze evidence. | reliability/oem-hardening | `app/android/app/build/reports/stage4-1-oem-hardening/summary.txt` |

## Update Rules

- Add a new row for each newly observed non-P0 gap or limitation.
- Any open P0 blocker must be moved to Active Issues and escalated immediately.
- Update `Status`, `Mitigation`, and `Evidence` after each validation rerun.
