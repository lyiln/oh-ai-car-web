# Web Control v1 Change Report

## Source Plan

Implemented from the project's Spec Kit documents under
`specs/001-web-control-gateway/`, pinned to source reference
commit `6a9a7cb8839a6c16777eabf1f74e65d8c5867c1f`.

## Delivered

- Independent npm workspace with React/Vite frontend, Node TCP/WebSocket
  gateway, and shared TypeScript protocol encoder.
- Localhost-only `ws://127.0.0.1:8787/control` API with high-level command
  validation and fake TCP integration coverage.
- Operator controls for connection settings, buttons, safety stop, rocker,
  direct video, media, tracking, and four wheel speeds.
- Reference snapshot and real-car validation checklist; no OpenHarmony files
  were copied as executable source or changed.

## Validation

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed: 12 tests across shared protocol, gateway, and frontend.
- `curl -L -I http://127.0.0.1:8787`: returned HTTP 200 after local start.

## Residual Risks

- No real vehicle was connected. TCP write success does not prove vehicle
  execution, acknowledgement, or safe command rate.
- Browser iframe loading of the car video endpoint remains dependent on the
  device's HTTP and embedding headers.
- `docs/decisions/protocol-length-discrepancy.md` records a contract example
  that conflicts with the source encoder and original protocol document.
