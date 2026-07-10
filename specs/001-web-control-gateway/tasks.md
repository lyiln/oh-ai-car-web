# Tasks: Web Control Gateway

**Status**: v1 implementation delivered; controlled real-car validation is
still pending.

The original detailed planning list is preserved at
`docs/reference/planning/001-web-control-gateway-original-tasks.md`. It uses
the former `web/...` path proposal and is not the execution status for this
standalone repository.

## Delivered

- [x] Independent npm workspace: `frontend/`, `gateway/`, and `shared/`.
- [x] Shared command types and encoder for commands `10`, `15`, `21`, and
  `60` through `64`.
- [x] Localhost-only WebSocket gateway, TCP client, high-level command
  validation, local-Origin validation, personalized single-controller
  ownership state, and fake TCP integration coverage.
- [x] Connection setup, button/rocker safety behavior, video panel, media,
  tracking, and wheel-speed controls with gateway-result confirmation for
  media and tracking state.
- [x] Stop-before-close behavior for explicit disconnect, reconnect,
  controller closure, and gateway shutdown.
- [x] Protocol, gateway, and frontend automated tests; see
  `tasks/change-report-web-control-v1.md`.

## Outstanding

- [ ] Carry out the controlled procedure in
  `docs/flows/web-control-real-car-validation.md`.
- [ ] Resolve or retain the packet conflict based on recorded hardware evidence
  as required by `PROTOCOL_STATUS.md`.
