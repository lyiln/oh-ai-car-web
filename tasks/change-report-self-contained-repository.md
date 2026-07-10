# Self-Contained Repository Change Report

## Goal

Make `oh-ai-car-web` independently cloneable for GitHub development while
retaining source-derived protocol evidence without copying ArkTS business code.

## Changes

- Initialized the repository-local Spec Kit Codex integration under `.specify/`
  and `.agents/skills/`.
- Added retained source context and protocol documents under `docs/reference/`.
- Replaced the former unchecked task snapshot with an actual delivery status;
  preserved the original planning list under `docs/reference/planning/`.
- Added `PROTOCOL_STATUS.md` and linked it from the README, specification, and
  WebSocket contract. The conflicting button packets remain explicitly
  unconfirmed pending controlled real-car validation.

## Validation

- `specify check`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed: 12 tests.
- The source repository was inspected and not modified.

## Remaining Risk

The real car has not confirmed either conflicting button packet. Do not resolve
the conflict or claim physical-car compatibility without recording the manual
validation result.
