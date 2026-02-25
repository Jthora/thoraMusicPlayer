# Initial Build Documentation

This folder defines the initial engineering specification for building an Android-first React Native music player for a large offline archive, validated primarily on a connected Xiaomi Android 15 production device.

## Scope of This Documentation Set

These docs intentionally go beyond brainstorming and define:

- Technical constraints and compatibility assumptions
- Detailed feature and non-feature requirements
- Architecture boundaries and module responsibilities
- File access and permission behavior under modern Android
- Playlist parsing and path-resolution policy
- Scanner/indexing and playback service behavior
- Test matrix and acceptance criteria for initial release phases

## Product Objective

Deliver a reliable local music app with two explicit and separate paradigms:

1. **Folders (Primary)**: folder selections generate dynamic playback queues
2. **Playlists (Secondary)**: imported playlist files and user-authored playlists managed from a dedicated playlist surface

## Design Principles

- **Offline-first:** no dependency on network for core playback
- **Archive-tolerant:** support inconsistent tags and mixed file naming
- **Path-aware:** preserve folder semantics and relative path behavior
- **Predictable playback:** queue behavior is deterministic and recoverable
- **Device-realistic:** prioritize reliability on the actual production phone

## Full Document Index

### Foundation

1. [Device Compatibility Profile](./device-compatibility.md)
2. [Android Tooling and Deployment Setup](./android-tooling-and-deploy.md)
3. [App Baseline Architecture and MVP Scope](./app-baseline-architecture.md)
4. [Development Validation Checklist](./development-validation-checklist.md)

### Detailed Specifications

5. [Requirements Specification](./requirements-spec.md)
6. [Android Permissions and Storage Spec](./permissions-and-storage-spec.md)
7. [Playlist Parsing and Resolution Spec](./playlist-parsing-spec.md)
8. [Scanner and Indexing Spec](./scanner-and-indexing-spec.md)
9. [Playback Service Spec](./playback-service-spec.md)
10. [QA Test Matrix](./qa-test-matrix.md)
11. [Progress Tracker](./progress-tracker.md)
12. [Known Issues Register](./known-issues-register.md)
13. [Release Readiness Summary](./release-readiness-summary.md)

### Audit and Remediation

14. [First Pass Robustness Audit](../../audits/initial/first-pass-robustness-audit.md)
15. [Second Pass Robustness Audit](../../audits/initial/second-pass-robustness-audit.md)
16. [Robustness Remediation Plan](../../audits/initial/robustness-remediation-plan.md)

## Definition of Done (Initial Build Phase)

Initial build phase is complete when:

- All **Must** requirements in `requirements-spec.md` pass
- Device compatibility gates in `device-compatibility.md` are satisfied
- Test cases marked **P0** in `qa-test-matrix.md` pass on the connected device
- No critical crash occurs during a 30+ minute local playback endurance run
- Known limitations are documented with mitigation/workaround notes

## Change Control for Specs

- Any requirement changes must update `requirements-spec.md` first
- Behavior changes touching storage, playlists, scanner, or playback must update the corresponding spec doc before implementation
- New blockers discovered on-device must be added to `device-compatibility.md` and the relevant test case rows in `qa-test-matrix.md`

## Suggested Implementation Order

1. Finalize Android toolchain and successful deploy loop on the test device
2. Implement playback service and media session pipeline
3. Implement scanner/index and folder dynamic queue generation
4. Implement playlist-file parsing and user playlist CRUD
5. Implement search and metadata browsing
6. Run the QA matrix and close all P0/P1 gaps
