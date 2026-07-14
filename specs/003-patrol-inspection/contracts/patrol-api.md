# Patrol API Contract

- `POST /api/vehicles/:id/patrol-routes`: admin creates a route from
  `{name,mapVersion,yaml}`.
- `GET /api/vehicles/:id/patrol-routes`: authorised user lists routes.
- `POST /api/vehicles/:id/whitelists`: admin imports `{name,csv}`.
- `POST /api/vehicles/:id/patrol-tasks`: authorised user creates a task with
  `{routeId,whitelistId,shift}`; `POST .../:taskId/start|stop` changes it.
- `GET /api/vehicles/:id/patrol-tasks/active` returns the current queued,
  running, or cancellation-requested task for the selected vehicle.
- `GET /api/vehicles/:id/patrol-tasks` and `GET .../:taskId/report` return
  operator-facing task and report data.
- `GET /device/v1/patrol/tasks/next`: authenticated scheduler claims one
  queued task for its vehicle.
- `GET /device/v1/patrol/tasks/:taskId`: authenticated scheduler reads the
  task `status` for its own vehicle (used to detect `cancellation_requested`
  while navigating).
- `POST /device/v1/patrol/tasks/:taskId/events`: authenticated scheduler posts
  `status`, `waypoint`, `observation`, or `stop_confirmed` events. A
  `stop_confirmed` event requires `{ "zeroVelocity": true }`.

## Safety stop protocol

`POST .../stop` sets `cancellation_requested` and keeps the vehicle locked for
patrol. The scheduler must cancel Nav2, verify zero velocity, then post
`stop_confirmed`. Only that confirmation creates the terminal `stopped` state.
Waypoint and observation events are rejected during cancellation and after a
terminal state. The platform lease verifier rejects manual gateway connection
while a task is queued, running, or awaiting this confirmation.

This is an interface-level safety control. It is not evidence that a physical
vehicle has stopped; real-car Nav2 cancellation and zero-velocity validation
remain required.
