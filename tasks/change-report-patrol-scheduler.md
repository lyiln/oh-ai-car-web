# Change report: patrol scheduler (Stage C/D code)

Date: 2026-07-13

## Summary

Added a vehicle-side patrol scheduler and a ROS-free Stage C simulation loop so
the platform can claim queued patrol tasks, advance through waypoints, complete
or safely stop with `stop_confirmed`. Stage D is documented as on-vehicle
graded validation; physical car motion is not claimed complete.

## Delivered

- `GET /device/v1/patrol/tasks/:id` for cancellation polling during navigation.
- `edge-agent/nav_backend.py`: `sim` fake travel (+ optional pose upload) and
  `nav2` NavigateToPose client.
- `edge-agent/patrol_scheduler.py`: claim → navigate → dwell → waypoint events →
  completed / failed / stop_confirmed.
- `scripts/sim-patrol-loop.mjs` and `npm run sim:patrol` for Windows-friendly
  Stage C without Python ROS.
- Runbooks: `docs/flows/patrol-stage-c-sim.md`, `docs/flows/patrol-stage-d-real-car.md`.

## Explicitly not claimed

- Gazebo simulation on a ROS workstation.
- Jetson ROS/Nav2 runtime recovery.
- Real-car wheel-on-ground autonomous acceptance.

## Validation

- Workspace `npm run typecheck`, `npm test`, `npm run build` (see session log).
- Stage C manual path: follow `docs/flows/patrol-stage-c-sim.md`.
