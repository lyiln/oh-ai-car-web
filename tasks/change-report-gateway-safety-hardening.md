# Gateway Safety Hardening Change Report

## Source Plan

Implemented from the approved Web control safety repair plan following the
source and documentation review.

## Delivered

- Restricted WebSocket upgrades to documented localhost production and Vite
  Origins, and rejected untrusted browser origins.
- Added one-controller ownership so a second browser cannot retarget or command
  an active car connection.
- Centralized best-effort Stop before explicit disconnect, reconnect,
  controlling-browser close, and gateway shutdown. `STOP_FAILED` closes TCP
  even when the Stop write cannot be confirmed.
- Updated media and tracking UI state only after a successful gateway result;
  rejected commands no longer leave optimistic UI state behind.
- Documented that direct iframe page loading cannot prove video-stream health.

## Validation

- `npm run typecheck`: passed.
- `npm test`: passed: 19 tests across shared protocol, gateway, and frontend.
- `npm run build`: passed.

## Remaining Risk

- The Stop packet and every other car command remain source-compatible and
  simulator-tested only. No physical-car packet, stop, or video behavior is
  confirmed until the manual validation record is completed.
