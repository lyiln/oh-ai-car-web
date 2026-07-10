# Implementation Plan: Web Control Gateway

**Branch**: `001-web-control-gateway` | **Date**: 2026-07-09 | **Spec**: `specs/001-web-control-gateway/spec.md`

**Input**: Feature specification from `specs/001-web-control-gateway/spec.md`

**Implementation Status**: Delivered in this repository. See
`tasks/change-report-web-control-v1.md`; manual real-car validation remains
open.

## Summary

Build a first Web control surface for the existing smart car without changing the OpenHarmony/ArkTS app or adding services/content to the car. The Web UI runs in the operator's browser and connects to a localhost-only gateway over WebSocket. The gateway encodes high-level commands into the existing TCP protocol and writes them to the configured car target at TCP port `6000`. Video is loaded directly from the existing car endpoint `http://<ip>:<videoPort>/index2`; failures are surfaced as UI errors and documented for follow-up.

## Technical Context

**Language/Version**: TypeScript for the Web frontend, shared protocol module, and gateway.

**Primary Dependencies**: React + Vite for frontend; Node.js `net.Socket` for TCP gateway; WebSocket library for browser/gateway channel.

**Storage**: Browser local storage for network settings; no database.

**Testing**: Protocol unit tests, gateway integration tests with a fake TCP server, frontend interaction tests, and manual same-LAN real-car validation.

**Target Platform**: Operator machine running a browser and localhost gateway; smart car remains reachable over LAN.

**Project Type**: Web application plus local gateway in this repository root.

**Performance Goals**: Rocker movement commands capped at `10 Hz`; immediate stop commands on release/cancel/blur are not delayed by throttling.

**Constraints**: Gateway binds to localhost only; no browser raw TCP; no raw encoded command passthrough; no dependency on car-side ACK/telemetry; no car-side code/content changes for v1.

**Scale/Scope**: Single operator controlling one car in same-LAN development use.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| Evidence-Backed Changes | PASS | Protocol decisions cite retained local source evidence under `docs/reference/` and `PROTOCOL_STATUS.md`. |
| Existing App Preservation | PASS | The independent repository contains only `frontend/`, `gateway/`, `shared/`, and Web documentation; the original app remains untouched. |
| Protocol Compatibility | PASS | Command mapping preserves `10/15/21/60/61/62/63/64` and existing encoding rules. |
| Browser-to-TCP Boundary | PASS | Browser talks to localhost gateway via WebSocket; gateway owns raw TCP. |
| Operator Safety | PASS | Movement controls disabled until connected; release/cancel/blur/disconnect stop behavior required. |
| Testable Specifications | PASS | Protocol, gateway, UI, and manual real-car validations are defined. |

No constitution violations are required.

## Project Structure

### Documentation (this feature)

```text
specs/001-web-control-gateway/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── websocket-control-api.md
└── tasks.md
```

### Source Code (implemented)

```text
frontend/
├── src/
│   ├── app/
│   ├── components/
│   ├── controls/
│   ├── services/
│   └── styles/
└── tests/
gateway/
├── src/
│   ├── tcp/
│   └── websocket/
└── tests/
shared/
├── src/
└── tests/
```

**Structure Decision**: The project is its own top-level npm workspace. It has
no runtime, build, or source dependency on the OpenHarmony repository.

## Phase 0 Research Summary

See `specs/001-web-control-gateway/research.md`.

Key decisions:
- Use localhost-only gateway binding for v1.
- Treat TCP write success as command success.
- Cap continuous rocker sending at `10 Hz`.
- Direct-load existing video endpoint; no v1 video proxy or car-side content.
- Expose only high-level commands; no raw encoded command input.

## Phase 1 Design Summary

See:
- `specs/001-web-control-gateway/data-model.md`
- `specs/001-web-control-gateway/contracts/websocket-control-api.md`
- `specs/001-web-control-gateway/quickstart.md`

## Post-Design Constitution Check

| Principle | Status | Evidence |
|---|---|---|
| Evidence-Backed Changes | PASS | Research records decisions and alternatives; contracts cite existing protocol mapping. |
| Existing App Preservation | PASS | All implementation resides in this repository; no existing app files are part of the implementation surface. |
| Protocol Compatibility | PASS | Contracts define high-level messages mapped to existing command codes. |
| Browser-to-TCP Boundary | PASS | WebSocket contract is browser/gateway only; raw TCP is gateway/car only. |
| Operator Safety | PASS | Data model and contract include stop, connected state, and rejected disconnected commands. |
| Testable Specifications | PASS | Quickstart defines protocol, fake TCP, UI, and real-car validation scenarios. |

## Complexity Tracking

No constitution violations or complexity exceptions.
