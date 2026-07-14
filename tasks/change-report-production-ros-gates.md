# Production and ROS Gate Change Report

## Source plan

Implemented from the approved “生产与 ROS 接入门禁修复方案” on 2026-07-12.

## Delivered

- Nginx now upgrades and proxies `/patrol/live`; an isolated Compose smoke test
  logs in, subscribes an authorised vehicle and rejects an unauthenticated client.
- Production config rejects insecure sessions, cookies and missing public origin.
- Both WebSocket routes reject untrusted or missing Origins with close code 1008.
- Response assignment enforces compatible map, recent online state and actual
  battery of at least 20% for source and backup vehicles alike.
- Migrations are serialized by a PostgreSQL advisory lock and record each
  migration atomically.

## Validation

- `npm run typecheck`: passed.
- `npm test`: passed (49 tests).
- `npm run build`: passed.
- `npm run test:integration --workspace=@oh-ai-car-web/backend`: passed (10 PostGIS scenarios, including concurrent migration and vehicle-health gates).
- `npm run test:deploy-live`: passed (isolated Compose/Nginx authenticated WebSocket verification and cleanup).

## Remaining boundary

The Compose smoke stack runs in development mode for local HTTP testing. A real
production deployment still needs HTTPS plus the production environment gates.
ROS scheduler, Nav2 pause/resume, zero-velocity evidence, edge outbox and all
physical-car validation remain unimplemented or unverified.
