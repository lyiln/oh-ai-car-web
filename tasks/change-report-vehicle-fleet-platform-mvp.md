# Vehicle Fleet Platform MVP Change Report

## Source Plan

Implemented from `tasks/vehicle-fleet-platform-mvp-plan.md` after explicit
approval on 2026-07-11.

## Delivered

- Added a Fastify/PostgreSQL/PostGIS backend with migrations, administrator
  bootstrap, Argon2 session authentication, vehicle access grants, device
  credentials, telemetry ingestion, control leases, audit logs, WebSocket
  position events, and retention cleanup.
- Added platform-aware gateway lease verification. With `PLATFORM_API_URL`
  configured, connections and refreshes require a live lease; expiry or failed
  refresh safely disconnects through the existing Stop path. Without that
  setting, the original local-control v1 behavior remains unchanged.
- Added the platform UI behind the explicit `VITE_PLATFORM_ENABLED=true` build
  flag: login, dashboard, saved vehicles, lease-backed local connection,
  selected safety controls, live trajectory updates, map rendering, replay,
  users, and audit views.
- Added the ROS2 `/gps/fix` edge agent with durable SQLite outbox, Compose,
  Nginx AMap security proxy, environment template, deployment documentation,
  and the `002-vehicle-fleet-platform` specification/data model.
- Review follow-up: AMap overlays are explicitly added to the map, browser
  Origins are allow-listed and checked for Cookie-authenticated writes, and
  PostGIS integration-test scaffolding is isolated from the regular suite.

## Validation

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed: 34 tests across shared, gateway, frontend, and backend.
- `npm run typecheck:integration --workspace=@oh-ai-car-web/backend`: passed.
- `docker compose config` with placeholder secrets: passed.
- `npm audit`: passed with zero production or development dependency findings.

## Remaining Risks

- Docker Compose was configured but not started or deployed; production must
  supply strong secrets, HTTPS, backups, and `COOKIE_SECURE=true`.
- The PostGIS integration test suite is implemented but was not run because
  the local Docker daemon is unavailable. No AMap key, ROS2 GPS source, or
  physical vehicle was available in this workspace.
- Existing TCP protocol uncertainty remains unchanged. Automated gateway tests
  do not establish real-car packet compatibility or safe operational command
  rates.
