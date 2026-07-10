# Control Ownership And Course Readiness Change Report

## Source Plan

Implemented from the approved “Web 修复与课程基础分保障计划”.

## Delivered

- State events now distinguish TCP connection, browser control ownership, and
  whether the receiving browser can claim control.
- Observer pages cannot connect, disconnect, or issue car commands while a
  controller session is active.
- Unexpected gateway closure publishes a safe disconnected state and clears
  pending browser media and tracking state.
- Gateway startup rejects bind failures; the production gateway has a fixed
  `127.0.0.1:8787` endpoint matching the browser and Origin contract.
- The WebSocket contract now documents HTTP `403` for rejected upgrade Origins
  rather than advertising a JSON error that cannot be delivered.
- Added `COURSE_STATUS.md` and course evidence, submission, and defense
  checklists. They preserve the boundary between tested Web behavior and
  unverified real-car behavior.

## Validation

- `npm run typecheck`: passed.
- `npm test`: passed, with 27 tests across shared protocol, gateway, and frontend.
- `npm run build`: passed.
- `specify check`: passed using the locally installed Spec Kit CLI.

## Remaining Risk

- Real-car protocol, Stop behavior, video behavior, and media/tracking effects
  remain unverified until the manual record is completed.
- The other four course basic requirements are external team deliverables and
  remain “开发中” until their evidence matrix entries are completed.
