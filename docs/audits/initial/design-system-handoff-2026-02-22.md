# Design System Handoff

Date: 2026-02-22

## Purpose

Defines the production UI system introduced during the overhaul so future work remains consistent, accessible, and automation-safe.

## Core Tokens

Source: `app/src/ui/theme.ts`

- Colors:
  - `backgroundBase`, `backgroundElevated`, `backgroundCard`
  - `borderSubtle`, `borderStrong`
  - `textPrimary`, `textSecondary`, `textMuted`
  - `accentPrimary`, `accentSuccess`, `accentWarning`, `accentDanger`
- Spacing scale: `xs`, `sm`, `md`, `lg`, `xl`
- Radius scale: `sm`, `md`, `lg`

## Component Primitives

### `AppButton`
File: `app/src/ui/components/AppButton.tsx`
- Variants: `primary`, `secondary`
- Supports `disabled`
- Supports `testID` for instrumentation compatibility
- Usage rules:
  - Use `primary` only for highest-priority action in a section.
  - Use uppercase action labels for consistent visual rhythm.

### `IconTabBar`
File: `app/src/ui/components/IconTabBar.tsx`
- Icon + label tabs with active/inactive state styling
- Keep labels concise and uppercase
- Use stable accessibility labels for automation and accessibility

### `SectionCard`
File: `app/src/ui/components/SectionCard.tsx`
- Group related controls into a single surface
- Include title + optional subtitle
- Prefer multiple focused cards over one oversized control wall

### `StatusChip`
File: `app/src/ui/components/StatusChip.tsx`
- Tones: `neutral`, `success`, `warning`, `danger`
- Use for compact status visibility near top of sections

## Accessibility and Readability Rules

1. Prefer body text size >= 13 for dense operational content.
2. Keep placeholder contrast visible (`textMuted` on elevated fields).
3. Use card boundaries and spacing to reduce cognitive load.
4. Avoid rows with more than 3 peer actions unless essential.
5. Keep primary action visually dominant in each section.

## Automation-Safe Labeling Rules

For device smoke and reliability flows, preserve these exact uppercase button texts:
- `SETTINGS`
- `SHOW ADVANCED TOOLS`
- `CAPTURE BASELINE`
- `CAPTURE POST-SETUP`
- `EVALUATE SETUP DELTA`
- `GENERATE REPORT`
- `LOG INTERRUPTION`
- `LOG RECOVERY`
- `START IDLE TEST`
- `MARK PASS`
- `MARK FAIL`

## Motion/Interaction Guidance

Current state keeps motion minimal by design.
Future additions should be subtle and functional:
- Use short press-state feedback (`opacity`) only.
- Tab content now uses a short fade-in transition on tab switch (160ms ease-out).
- Reserve additional animated transitions for playback-state updates only when they improve clarity.
- Avoid decorative motion in diagnostics-heavy workflows.

## Current Coverage

Overhauled screens/components:
- Production shell tabs and header
- Library quickstart + grouped sections
- Search segmented modes and result hierarchy
- Playlists import/manage flows
- Now Playing transport/progress
- Settings basic/advanced split
- Queue and reliability panel readability pass

## Extension Guidance

When building new screens:
1. Start with `SectionCard` layout.
2. Add top status via `StatusChip`.
3. Choose one `AppButton` primary action.
4. Keep secondary actions in `AppButton` secondary style.
5. Validate with `test:p0:debug` and `test:p0:prioritize` after changes.
