# Robustness Remediation Plan (Post Audit Passes)

Date: 2026-02-21  
Inputs:
- `docs/audits/initial/first-pass-robustness-audit.md`
- `docs/audits/initial/second-pass-robustness-audit.md`

## Planning Principles

- Fix data-loss and corruption vectors before UX polish.
- Ship in small, verifiable waves with explicit rollback criteria.
- Require physical-device evidence for each completed wave.

## Prioritized Delivery Waves

### Wave 0 — Safety Guardrails (Immediate, block all other feature work)

**Priority:** P0  
**Target:** 1–2 days  
**Goal:** Eliminate index data-loss paths introduced by partial scans and mixed SAF roots.

**Audit findings covered:** P2-001, P2-002, P2-009

**Implementation scope:**
1. Add explicit sync coverage mode (`FULL`/`PARTIAL`) to snapshot persistence.
2. Prevent delete/prune operations unless coverage is `FULL` for the exact source/root being processed.
3. Split SAF incremental sync into root-scoped transactions (no shared synthetic `TREE` delete scope).
4. Persist root identity per track for SAF records and use it for delete boundaries.

**Exit criteria:**
- Partial MediaStore and partial SAF runs produce `removed=0` unless full coverage is confirmed.
- Revoked or inaccessible SAF root cannot delete tracks from other healthy SAF roots.
- Snapshot diagnostics include machine-readable coverage metadata.

**Validation evidence:**
- Add targeted script scenario: partial scan limit + full scan comparison.
- Re-run `npm run test:p0:debug` and confirm no new blockers.

---

### Wave 1 — Playlist Transaction Integrity (High urgency)

**Priority:** P1  
**Target:** 1–2 days after Wave 0  
**Goal:** Remove lost-update races and referential integrity gaps in playlist storage.

**Audit findings covered:** P2-003, P2-004, P2-005, F-007

**Implementation scope:**
1. Enable SQLite foreign keys in playlist/index DB helpers (`onConfigure`).
2. Add explicit playlist existence validation for create/add/remove/move operations.
3. Refactor `moveTrack` to run read+rewrite under one transaction (or equivalent atomic SQL strategy).
4. Add mutation sequencing guard in JS playlist hook (reject/ignore stale async completions).

**Exit criteria:**
- Concurrent add/remove/move actions do not lose updates or create unreachable rows.
- Invalid playlist IDs return deterministic module errors.
- DB constraints prevent orphaned entry rows.

**Validation evidence:**
- Add stress script for rapid playlist operations (reorder/add/remove burst).
- Re-run `npm run test:p0:debug` and `npm run test:p0:prioritize`.

---

### Wave 2 — Persistence Durability and Truthful Grants

**Priority:** P1  
**Target:** 2–3 days  
**Goal:** Ensure reliability logs/import history/grant status are durable and truthful.

**Audit findings covered:** F-001, F-005, P2-006, P2-007

**Implementation scope:**
1. Replace `StringSet` reliability logs/snapshots/idle sessions with ordered durable persistence (SQLite preferred).
2. Update playlist file grant flow to return actual persisted-grant result (never hardcoded granted=true).
3. Use transaction-safe writes for latest playlist import summary.
4. Add migration/read-compat path from existing prefs data.

**Exit criteria:**
- Event/snapshot ordering is stable and duplicates are preserved where valid.
- Playlist picker accurately reports persist failure conditions.
- Latest import summary survives process-kill scenarios.

**Validation evidence:**
- Process kill/restart verification after writes.
- Re-run `npm run test:stage4.1:oem` and verify report generation still passes.

---

### Wave 3 — Playback State and Bridge Hardening

**Priority:** P2  
**Target:** 2–3 days  
**Goal:** Align UI state with native playback truth and harden bridge payload handling.

**Audit findings covered:** F-002, F-003, F-004, F-012, F-013, P2-008

**Implementation scope:**
1. Introduce runtime guards/type predicates for module payloads (especially sync status responses).
2. Replace synthetic-only now-playing assumptions with native-driven state events.
3. Add structured error classification across hook catch-paths.
4. Separate user status text from diagnostic telemetry fields.

**Exit criteria:**
- UI no longer drifts from service state on pause/resume/skip.
- Bridge shape regressions fail safely with clear diagnostics.
- Overlapping async hook operations cannot overwrite newer state.

**Validation evidence:**
- Physical-device interactive playback flow + interruption checks.
- Re-run `npm run test:p0:debug` plus targeted manual state-coherence checks.

---

## Sequencing and Release Gates

- Do not begin Wave 1 until Wave 0 exit criteria are met.
- Do not start release candidate hardening until Waves 0–2 are complete.
- Wave 3 can overlap late Wave 2 only after core data-integrity risks are closed.

## Ownership Proposal

- Native persistence/integrity (Waves 0–2): Android/Kotlin owner.
- JS race and state coherence (Waves 1, 3): React Native owner.
- Verification scripts and matrix evidence: QA automation owner.

## Tracking Updates Required per Wave

For each wave completion:
1. Append evidence paths and command outputs to `docs/initial/build/qa-test-matrix.md`.
2. Update `docs/initial/build/known-issues-register.md` status/mitigations.
3. Add changelog entry in `docs/initial/build/progress-tracker.md`.
4. Recompute blocker view via `npm run test:p0:prioritize`.
