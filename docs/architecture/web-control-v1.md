# Web Control v1 Architecture

## Boundary

This repository is independently buildable and deployable on an operator
machine. It does not import, build, or require a sibling OpenHarmony project.
The retained source analysis under `docs/reference/architecture/` is evidence
for the car TCP protocol only.

## Runtime

```text
Browser UI
  -> ws://127.0.0.1:8787/control
  -> local Node gateway
  -> TCP <car-ip>:6000

Browser UI
  -> http://<car-ip>:<video-port>/index2
```

`frontend/` provides the React control console, `gateway/` owns the local TCP
socket and WebSocket validation, and `shared/` owns the command types and
packet encoder. The gateway accepts only documented high-level commands and
binds to localhost.

## Validation State

The shared encoder, fake TCP gateway behavior, and frontend interaction tests
are automated. Real-car validation is manual and tracked in
`docs/flows/web-control-real-car-validation.md`.
