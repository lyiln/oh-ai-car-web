# Patrol Inspection Change Report

## Source Plan

Implemented from the user-approved `003-patrol-inspection` plan on 2026-07-11.

## Delivered

- Added the `002-patrol-inspection` database migration for versioned patrol
  routes and waypoints, whitelist imports, single-vehicle patrol tasks,
  scheduler events, plate observations and report evidence.
- Added administrator route-YAML and whitelist-CSV imports; authorised users
  can create, start, stop, inspect and report on vehicle patrol tasks.
- Added device-credential patrol APIs for a ROS `patrol_scheduler` to claim a
  task, obtain Nav2 waypoints, poll the current stop state and post lifecycle,
  waypoint and recognition events.
- Added 0.75 OCR review threshold, private/visitor/external classification,
  waypoint-camera ROI no-parking tagging and 30-minute task/plate/waypoint
  observation deduplication.
- Added the platform "巡检任务" page with route and whitelist import, task
  controls, result review and HTML report download.
- Added migration `003-patrol-stop-confirmation`: an operator stop now enters
  `cancellation_requested`; only a device-authenticated `stop_confirmed` event
  with `zeroVelocity: true` records a confirmed stop. Active patrols also block
  platform gateway lease verification and concurrent task starts.
- Starting a patrol now uses the same vehicle-lock transaction to reject an
  existing valid manual control lease with `409`. The task remains `draft`
  until the operator safely disconnects the local gateway and releases that
  lease, closing the gap before the gateway's next lease verification.
- A task awaiting cancellation confirmation now rejects scheduler `completed`
  and `failed` events; only `stop_confirmed` with `zeroVelocity: true` can
  make it terminal and re-enable manual control. Scheduler status writes use
  an atomic current-state condition, so a concurrent stop request cannot be
  overwritten by a stale terminal event.

## Validation

- `VITE_PLATFORM_ENABLED=false npm test`: passed, 36 tests across shared,
  gateway, frontend and backend workspaces.
- `npm run typecheck`: passed.
- `VITE_PLATFORM_ENABLED=false npm run build`: passed.
- `npm run test:integration --workspace=@oh-ai-car-web/backend` passed, 2
  PostGIS scenarios. The fixture waits for PostgreSQL's second ready log to
  avoid its initialization restart window.

## Remaining Risks

- The ROS `patrol_scheduler`, Nav2 cancellation/zero-velocity confirmation,
  camera/OCR producer and evidence-file storage are external integrations;
  this repository now exposes their API contract but does not contain them.
- The user's uncommitted `frontend/vite.config.ts` loads the workspace `.env`,
  where platform mode is enabled. The legacy frontend tests require
  `VITE_PLATFORM_ENABLED=false`; that user change was preserved.
- No real-car navigation, OCR accuracy, manual safety takeover or TCP packet
  compatibility has been validated by these automated tests.

## Remaining Follow-ups

- Patrol events and records are refreshed on demand; they are not published to
  the browser WebSocket in real time.
- The external ROS `patrol_scheduler` must implement the documented
  `stop_confirmed` contract before any integrated demonstration. The automated
  confirmation test simulates that device event and is not real-car evidence.
