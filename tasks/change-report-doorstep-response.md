# Doorstep Response Change Report

## Source Plan

Implemented from the user-approved “乱停车识别—上门处置” upgrade plan on 2026-07-12.

Implementation commit: `7ebcabc` (`feat: add safe doorstep response workflow`).

## Delivered

- Added migration 007 for resident Nav2 destinations, whitelist destination links, response tasks and idempotent device events.
- Eligible evidence-backed no-parking observations for registered private vehicles now create an operator-review response candidate.
- Added operator confirmation, privacy-limited AI advice with deterministic fallback, safe deterministic multi-vehicle assignment and audit events.
- Added device claim and lifecycle APIs with transition validation, zero-velocity gates and arrival-evidence requirement.
- Added destination management, a realtime response-task board and removed patrol route demo-data fallback.
- Added the teacher-feedback response document under `docs/course/`.
- Added migration 008 for recoverable assignment, `cancellation_requested`,
  device-confirmed safe cancellation, terminal-state protection and active
  response/control-lease interlocks.

## External Boundary

The ROS response scheduler, Nav2 patrol pause/resume behavior, camera producer and physical arrival evidence remain external integrations. This change provides their Web/API contract and does not claim simulation or real-car validation.

## Post-implementation review and safety follow-up

The initial review found event-isolation, terminal-state and assignment-recovery
blockers. Stage 0 repaired them and added migration 008, retry assignment,
device-confirmed cancellation and regression tests. The follow-up verdict is
**Approved with Notes for stage 1 discovery**; physical movement is still not
approved. See `tasks/code-review-doorstep-response.md`.

## Validation

- `npm run typecheck`: passed.
- `VITE_PLATFORM_ENABLED=false npm run build`: passed.
- Workspace unit tests passed: shared 5, gateway 12, frontend 13, backend 8. Gateway tests required local loopback permission because they bind temporary ports.
- `npm run test:integration --workspace=@oh-ai-car-web/backend`: passed, 10 PostGIS scenarios including the new confirm/assign/claim/arrive/evidence/complete/idempotency flow.
- Integration-test stability: telemetry uses a current timestamp within the track query window, and each scenario restores the administrator credential; the doorstep-response scenario now passes both independently and in the complete suite.
