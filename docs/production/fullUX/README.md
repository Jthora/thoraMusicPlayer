# Full UX Refactor Documentation

This folder is the authoritative implementation guide for the major Spotify-style retrofit.

## Purpose
- Define exact UX and engineering contracts before coding.
- Anchor development decisions so implementation remains consistent.
- Provide clear phase gates and acceptance checks.

## How Copilot Should Use This
1. Read `01-product-charter.md` before changing UX behavior.
2. Validate page behavior against `02-information-architecture.md` + `03-navigation-contract.md`.
3. For native/JS bridge work, follow `04-data-native-contracts.md`.
4. For feature logic, use these specs:
   - Search: `05-search-spec.md`
   - Playback modes: `06-playback-modes-spec.md`
   - Theme runtime: `07-theme-system-spec.md`
5. Execute changes in the order defined by `08-implementation-plan-pr-slices.md`.
6. Follow direct-cutover sequencing in `09-direct-cutover-migration.md`.
7. Validate against `10-qa-acceptance-matrix.md`.
8. Record implementation decisions in `12-decision-log-template.md`.

## Priority Rule
If implementation conflicts with this folder, update documentation first (or in the same PR) before changing behavior.

## Scope of This Phase
- Bottom nav retrofit: Home, Search, Your Library, Create, Settings
- Home redesign
- Your Library V2
- Unified Search with scoped filtering
- Playback mode controls
- Settings navigation with runtime theming controls
