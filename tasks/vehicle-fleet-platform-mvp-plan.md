# Vehicle Management and Trajectory Platform MVP Plan

## Status

**Code implementation complete; deployment and real-hardware validation
pending.** Database, authentication, control leases, and deployment are
high-risk changes. Implementation was explicitly approved on 2026-07-11. See
`tasks/change-report-vehicle-fleet-platform-mvp.md` for the delivered code and
validation record.

## Summary

Evolve the current single-car local control console into a multi-user
management platform. A central backend stores vehicles, users, grants,
trajectories, and audit records. Operators select an authorised, previously
saved vehicle and connect it through the existing localhost gateway on their
own machine. A ROS2 edge agent reports GPS position data so that the Web UI
can show live and historical tracks on AMap.

The MVP uses TypeScript/React, a Fastify API, PostgreSQL with PostGIS, and
Docker Compose with Nginx. A Python ROS2 edge agent subscribes to `/gps/fix`.

## Architecture and Behaviour

### Accounts, vehicles, and audit

- Administrators create, disable, and assign user accounts; public
  registration is not provided. `admin` manages users, vehicles, and audit
  data; `operator` may view and operate only assigned vehicles.
- Passwords use Argon2 hashes and browser sessions use HttpOnly cookies.
- Vehicle records hold name, identifier, description, TCP host/port, video
  port, status, and authorised members. The operator vehicle list is the
  saved-vehicle entry point for one-click reconnection.
- Audit records cover sign-in, vehicle and membership changes, control-lease
  lifecycle, connection outcomes, and device-credential rotation.

### Safe control lease and the existing local gateway

- An operator acquires a 60-second renewable control lease before initiating a
  TCP connection. Only one active lease per vehicle is allowed; other users
  have read-only access. The UI renews every 20 seconds and releases the lease
  when disconnecting or closing.
- Preserve the gateway's localhost-only binding, Origin validation,
  high-level-command boundary, and single-browser controller rule.
- Extend the gateway contract so that `connect` carries a vehicle ID and a
  short-lived backend lease token. The gateway validates the token and safely
  sends Stop before disconnecting if it expires, refresh fails, or the backend
  rejects the lease.
- The platform records lease and gateway connection events for audit. The car
  TCP service and the local gateway are never exposed to the public network.

### GPS ingestion and trajectory storage

- Add a Python `rclpy` edge agent for the vehicle or its companion computer.
  It subscribes to `sensor_msgs/NavSatFix` on `/gps/fix` and uploads batches
  to the central HTTPS device API.
- Each vehicle receives a separately rotatable device credential, shown only
  at issuance and stored as a hash by the backend. The edge agent uses a local
  SQLite outbox to retain samples while disconnected and uploads them in time
  order after recovery.
- Persist vehicle ID, timestamp, original WGS-84 longitude/latitude, altitude,
  accuracy, speed, heading, and optional battery percentage and operating
  mode. Missing optional values remain explicitly unavailable rather than
  being fabricated.
- Track data is retained for 90 days and audit data for one year, with a
  scheduled cleanup job. Duplicate device uploads are idempotent by vehicle
  and sample time.

### Web experience and AMap

- Add authenticated dashboard, vehicle list/detail and control pages, live map
  and trajectory replay, user management, and audit-log pages.
- The dashboard shows vehicle freshness/online state, the latest telemetry,
  and current control-lease state. Vehicle details provide the one-click local
  gateway connection action.
- The map shows the latest marker, track polyline, time-range filter, point
  details, and playback controls. Replay summaries show start/end time, point
  count, distance, maximum/average speed, and unavailable optional fields.
- Store GPS coordinates in their original WGS-84 system and convert them with
  `AMap.convertFrom` before rendering on AMap's GCJ-02 base map. Do not display
  unconverted points as accurately aligned map positions.
- Use AMap JS API 2.0. The Web key is a domain-restricted frontend setting;
  `securityJsCode` remains an Nginx environment secret and is injected through
  the `/_AMapService` reverse proxy rather than being bundled into frontend
  code.

## Interfaces and Data Model

- Browser API: sessions, user administration, vehicle and member management,
  control lease acquire/renew/release, trajectory queries, and audit queries.
- Device API: `POST /device/v1/telemetry` accepts only a vehicle device
  credential and batch position payloads, never a browser session.
- Live events: authorised browser sessions receive `vehicle.position` events;
  unauthorised users cannot subscribe to a vehicle.
- Gateway contract: `connect` gains vehicle ID and lease token inputs plus a
  lease-token refresh flow; expiry always triggers Stop and TCP disconnect.
- Core entities: `users`, `vehicles`, `vehicle_members`,
  `device_credentials`, `telemetry_points`, `control_leases`, and
  `audit_logs`.

## Deployment and Documentation

- Docker Compose runs frontend, API, PostgreSQL/PostGIS, and Nginx with health
  checks and persistent volumes. Provide an environment template, migrations,
  and first-administrator bootstrap instructions.
- Add a new feature specification, API and gateway contracts, data model,
  deployment guide, and ROS2 real-hardware validation record when implementation
  is approved. Keep `specs/001-web-control-gateway/` unchanged because it
  remains the delivered local-control v1 specification.
- Do not update course status or course evidence solely from this plan. The
  platform is not an implementation or a completed course deliverable.

## Validation Plan

- Unit tests: authorisation, passwords/sessions, device credentials, telemetry
  validation, retention cleanup, and control-lease competition/renewal.
- API/database integration tests: access rejection, single-vehicle lease
  exclusion, credential rotation, idempotent GPS batches, live updates, and
  retention periods.
- Gateway/frontend tests: expired or invalid lease causes Stop and disconnect;
  saved vehicle reconnection, permission-sensitive controls, AMap coordinate
  conversion, live updates, replay, and missing telemetry presentation.
- Edge-agent tests: `NavSatFix` parsing, offline SQLite queue, retry, ordered
  recovery, and duplicate upload handling.
- Manual validation: real GPS alignment with AMap, safe Stop handling, lease
  exclusion between operators, and real-car control/video validation. Fake TCP
  tests are not evidence of physical-car protocol compatibility.

## Assumptions and Scope Boundaries

- A vehicle or companion computer can provide ROS2 `/gps/fix`. The current Web
  repository and TCP protocol have no reusable position or telemetry channel.
- The operator machine can reach the centrally deployed platform during
  control; inability to renew a lease defaults to stopping rather than offline
  continued driving.
- The first release excludes public TCP forwarding, geofencing and alerting,
  low-battery notifications, and SLAM-local-coordinate calibration to global
  coordinates.
- This plan does not alter the current unverified car TCP encoding. Existing
  protocol safety rules and real-car validation requirements remain in force.
