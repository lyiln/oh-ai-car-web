# Research: Web Control Gateway

## Decision: Use a localhost-only gateway in v1

**Rationale**: The feature is same-operator, same-machine control. Binding the gateway to localhost reduces accidental LAN exposure and avoids authentication work that is explicitly out of scope for v1.

**Alternatives considered**:
- LAN-accessible gateway: rejected because it expands security and authorization scope.
- Configurable localhost/LAN mode: deferred until there is a real multi-device use case.

## Decision: Treat TCP write success as command success

**Rationale**: The inspected ArkTS receive path does not implement meaningful acknowledgement handling. Requiring car-side ACK would block v1 on unconfirmed hardware behavior.

**Alternatives considered**:
- Require ACK before success: rejected because no ACK protocol is confirmed.
- Parse telemetry in v1: rejected because telemetry format is not confirmed.
- Log inbound data only: acceptable as an implementation detail, but UI behavior must not depend on it.

## Decision: Cap rocker commands at 10 Hz

**Rationale**: `10 Hz` is responsive enough for first-pass joystick control and avoids unnecessary WebSocket/TCP flooding. Stop commands on release/cancel/blur must bypass normal throttling.

**Alternatives considered**:
- `5 Hz`: safer but likely less responsive.
- `20 Hz`: more responsive but depends on unverified car-side tolerance.
- Change-threshold only: useful optimization, but insufficient as the sole rate guard.

## Decision: Load the existing video endpoint directly

**Rationale**: The existing app loads `http://<ip>:<videoPort>/index2`. The project goal is to avoid adding content or services to the car in v1.

**Alternatives considered**:
- Gateway video proxy: rejected for v1 because it increases gateway scope and may mask car-side behavior.
- Car-side page/service changes: rejected because v1 must not add car-side content.
- Configurable direct/proxy mode: deferred until browser testing proves direct loading fails.

## Decision: Do not expose raw encoded command sending

**Rationale**: Raw command passthrough increases operator-safety risk and bypasses validation. The gateway contract should expose high-level commands only.

**Alternatives considered**:
- Hidden debug panel: rejected for v1 because it still exposes arbitrary car commands.
- Development-only raw command path: deferred until protocol debugging requires it and safety controls are defined.

## Decision: Use TypeScript across frontend, gateway, and shared protocol

**Rationale**: TypeScript allows the frontend, gateway, and shared command schemas to use one type system. This reduces drift between UI commands, WebSocket messages, and gateway protocol encoding.

**Alternatives considered**:
- Plain JavaScript: rejected because command schemas and safety constraints benefit from type checking.
- Python gateway: viable for TCP, but adds a second language if the frontend is TypeScript.
- Go gateway: viable for a standalone binary, but higher setup cost for the current Web-first workflow.
