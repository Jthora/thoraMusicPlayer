# UI Performance + Responsiveness Audit

Date: 2026-02-24
Scope: Runtime UI responsiveness in production shell and high-frequency shared components

## 1) Audit Method

- Static hotspot scan across app shell, list surfaces, and shared controls.
- Focus areas:
  - list rendering strategy,
  - render churn sources (inline closures / broad state ownership),
  - component memoization boundaries,
  - expensive derived computations.
- Validation baseline: TypeScript diagnostics + targeted file diagnostics after each phase.

## 2) Findings

### F-001: Single heavy shell controls multiple tabs
- `ProductionAppShell` owns many independent state slices and renders all tab branches conditionally.
- Any state update in shell can trigger expensive reconciliation for active tab subtree.
- Impact: medium-high (especially on lower-end Android devices).

### F-002: Parent scroll container + nested complex sections
- Shell uses top-level `ScrollView` with dense tab content.
- Several sections still rely on non-virtualized row rendering patterns.
- Impact: high during rapid navigation and large-library cases.

### F-003: Callback churn into row components
- Multiple inline handlers are created in render loops (`onPress`, `onPlay`, route transitions).
- This weakens memoization benefits in row-level components.
- Impact: medium.

### F-004: Remaining high-volume lists outside optimized path
- Your Library major lists are virtualized already, but Home feed and Create search result rows remained map-rendered in shell context.
- Impact: medium-high as library size grows.

### F-005: Shared controls not explicitly memoized
- `AppButton`, `MiniNowPlayingDock`, and `IconTabBar` are frequently mounted/updated and participate in many shell renders.
- Theme updates should still re-render, but unrelated shell state should not force avoidable work.
- Impact: medium.

## 3) Optimization Plan (Holistic)

### Phase 1 (immediate)
1. Stabilize high-churn callbacks in shell with `useCallback`.
2. Virtualize Home feed rows and Create results.
3. Reduce inline list-source branching by memoizing active feed datasets.

### Phase 2 (short follow-up)
1. Add/strengthen memoization on shared controls where safe.
2. Move tab-section render logic into focused memoized subcomponents to reduce shell reconciliation cost.

### Phase 3 (verification + hardening)
1. Validate diagnostics and runtime behavior.
2. Run focused on-device smoke (tab switches, long lists, play controls).
3. Capture before/after responsiveness notes and finalize residual backlog.

## 4) Success Criteria

- No regressions in tab behavior, playback controls, or create flow.
- Reduced visible stutter during list scroll and tab switches on target device.
- Existing diagnostics baseline does not worsen in touched files.

## 5) Execution Decision

Proceed with Phase 1 immediately in this pass. Phase 2/3 remains queued for next incremental slice if needed.
