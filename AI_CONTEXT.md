# AI Context

## Project State

- **Active handoff:** before further doorstep-response or real-car work, read
  `NEXT_SESSION.md`, `tasks/code-review-doorstep-response.md`, and
  `tasks/real-car-doorstep-integration-plan.md`. Stage 0 and the repository
  deployment/security gate fixes are implemented; the next allowed step is
  read-only stage 1 hardware/ROS discovery. Physical autonomous motion is not
  approved yet.

- `oh-ai-car-web` is an independent npm workspace for browser-based smart-car
  control. The original OpenHarmony project is not required to clone, build,
  test, or run this repository.
- v1 local control is implemented and has automated protocol, gateway, and
  frontend tests. Controlled real-car validation is still pending.
- The **巡牌通 · PatrolPlate** management platform extends the fleet MVP with a
  dark AppShell, React Router pages (dashboard, fleet, console, patrol,
  map, violations, reviews, whitelist, reports, settings), password login and
  administrator-only email OTP. OTP is generated and hashed in the backend and
  delivered only through configured SMTP; it is unavailable rather than exposed
  when SMTP is not configured. The platform also has devices API aliases,
  patrol/map/ops domain tables (migrations 003–010), and `/patrol/live`
  WebSocket. See `docs/architecture/patrol-platform-api.md`.
- The primary open risk is the unresolved button packet conflict documented in
  `PROTOCOL_STATUS.md`. Treat this as an operational safety constraint.
- The doorstep-response implementation is present in migrations 007–008 and
  `backend/src/routes/response-platform.ts` at commit `7ebcabc`, but its
  ROS/Nav2 scheduler and physical-car behavior remain external and unverified.
- `课程状态.md` tracks the course-level evidence needed for the basic
  score. This repository currently covers only the Web/APP control module.

## Runtime Architecture

```text
Browser UI -> ws://127.0.0.1:8787/control -> local Node gateway -> car TCP :6000
Browser UI -> direct car video HTTP :6500/index2

Platform browser -> Vite/Nginx -> Fastify API -> PostgreSQL/PostGIS
ROS2 /gps/fix -> Python edge agent -> HTTPS device telemetry API
Platform browser -> lease -> local gateway -> car TCP :6000
Platform browser -> /patrol/live WS -> pose_update / patrol_* events
Device response scheduler -> /device/v1/response/* -> Nav2 pause/goal/resume
```

- `frontend/`: React/Vite operator interface (AppShell + classic `/connect`).
- `gateway/`: localhost WebSocket server and raw TCP client.
- `shared/`: WebSocket types and car packet encoder.
- `backend/`: Fastify API, SQL migrations, sessions, leases, telemetry,
  patrol/map/ops routes, audit, and retention cleanup.
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
- `tasks/real-car-doorstep-integration-plan.md`: decision-complete staged handoff
  for repairing blockers, building the ROS adapter, and validating a real car.

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
