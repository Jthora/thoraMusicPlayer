# Direct Cutover and Migration Plan

## Approach
Implement the refactor in focused PR slices and cut over each surface directly once it passes acceptance checks.

## Cutover Sequence
1. Land navigation shell and new page scaffolds.
2. Replace Home behavior.
3. Replace Your Library behavior.
4. Replace Search behavior.
5. Replace playback mode logic.
6. Replace Create and Settings theme behavior.

## Validation Rules Per Slice
- Run focused smoke checks on the changed surface.
- Run startup and playback continuity checks.
- Confirm no dead-end paths or broken core actions.

## Data Migration Rules
- New analytics tables may start empty; UI must show useful empty states.
- Do not block startup on migration work.
- Backfill behavior should run in background where possible.

## Legacy Removal Criteria
Remove legacy paths after:
- Acceptance checks pass for the replacement surface.
- Regression checks show no break in playback and playlist management.
- New path has stable behavior across first-open and reopen flows.
