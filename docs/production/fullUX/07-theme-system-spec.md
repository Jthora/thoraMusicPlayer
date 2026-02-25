# Theme Runtime System Specification

## Objective
Move from static theme constants to runtime-configurable theme with presets and custom values.

## Required Features
- Theme control at top of Settings.
- Preset list including current default palette.
- Custom color editing.
- Persisted selection and live apply.

## Architecture
- Introduce `ThemeContext` + `useTheme()`.
- Theme object should include existing semantic tokens:
  - backgroundBase, backgroundElevated, backgroundCard
  - borderSubtle, borderStrong
  - textPrimary, textSecondary, textMuted
  - accentPrimary, accentSuccess, accentWarning, accentDanger

## Migration Strategy
- Phase 1: keep `ui/theme.ts` as default preset source.
- Phase 2: add provider and compatibility exports.
- Phase 3: migrate components incrementally to runtime `useTheme()`.

## Validation Rules
- Contrast and readability checks for custom values.
- Prevent invalid color formats.
- Fail-safe fallback to default preset.

## Persistence
- Store selected preset/custom theme in local persistent storage.
- Apply before first meaningful paint when possible.
