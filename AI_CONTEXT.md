# AI Context

## Project State

- `oh-ai-car-web` is an independent npm workspace for browser-based smart-car
  control. The original OpenHarmony project is not required to clone, build,
  test, or run this repository.
- v1 local control is implemented and has automated protocol, gateway, and
  frontend tests. Controlled real-car validation is still pending.
- The vehicle-management platform MVP adds a Fastify/PostgreSQL backend,
  browser login and saved-vehicle UI, renewable control leases, ROS2 GPS
  telemetry ingestion, trajectory display, and Docker Compose deployment
  assets. Code validation is complete; deployment, a real AMap key, ROS2 GPS,
  and vehicle validation remain pending.
- The primary open risk is the unresolved button packet conflict documented in
  `PROTOCOL_STATUS.md`. Treat this as an operational safety constraint.
- `课程状态.md` tracks the course-level evidence needed for the basic
  score. This repository currently covers only the Web/APP control module.

## Runtime Architecture

```text
Browser UI -> ws://127.0.0.1:8787/control -> local Node gateway -> car TCP :6000
Browser UI -> direct car video HTTP :6500/index2

Platform browser -> Nginx -> Fastify API -> PostgreSQL/PostGIS
ROS2 /gps/fix -> Python edge agent -> HTTPS device telemetry API
Platform browser -> lease -> local gateway -> car TCP :6000
```

- `frontend/`: React/Vite operator interface.
- `gateway/`: localhost WebSocket server and raw TCP client.
- `shared/`: WebSocket types and car packet encoder.
- `backend/`: Fastify API, SQL schema/migration, sessions, leases, telemetry,
  audit, and retention cleanup.
- `edge-agent/`: ROS2 `NavSatFix` to HTTPS telemetry bridge with SQLite outbox.
- Network defaults: `192.168.1.11`, TCP `6000`, video `6500`.
- The gateway accepts only the documented localhost production/Vite Origins and
  permits one controlling browser session at a time.

## Source of Truth

1. `PROTOCOL_STATUS.md` governs protocol safety while evidence conflicts.
2. `specs/001-web-control-gateway/` defines the Web feature contract and v1
   scope.
3. `.specify/memory/constitution.md` defines repository-wide engineering
   principles.
4. `docs/reference/` preserves source context and protocol evidence from the
   external source snapshot; it is not a dependency.

The original contract contains `$011503011A#`; source-derived evidence and the
current encoder use `$011504011B#`. Neither is real-car confirmed. Do not
resolve this discrepancy without a recorded controlled test.

Gateway disconnect, reconnect, controller close, and process shutdown attempt
Stop before closing TCP. A successful iframe page load still does not confirm
video-stream health.

## Required Documentation

- `AGENTS.md`: mandatory operating rules for agents.
- `课程状态.md`: course requirement status and evidence gate.
- `docs/course/课程文档索引.md`: index for the group delivery, taskbook mapping, and
  evidence documents.
- `PROTOCOL_STATUS.md`: conflict status and resolution gate.
- `docs/flows/web-control-real-car-validation.md`: required record for any
  hardware test.
- `docs/decisions/protocol-length-discrepancy.md`: detailed conflict evidence.
- `tasks/change-report-*.md`: verified implementation and repository changes.
- `docs/architecture/vehicle-platform-overview.md`: onboarding guide for the
  platform, backend data flow, security boundaries, and local startup order.
- `docs/deployment/vehicle-platform.md`: Docker and ROS2 edge-agent setup.

## Commands

```sh
npm install
npm run typecheck
npm test
npm run build
specify check
```

Use `npm run dev:gateway` and `npm run dev:frontend` for local development.
The gateway must not connect to a real car until an operator explicitly enters
the target and starts a connection from the UI.
