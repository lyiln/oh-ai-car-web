# Feature Specification: Vehicle Fleet Platform MVP

## Scope

This feature adds a central management platform while retaining the existing
localhost-only Web-to-TCP gateway. It introduces administrator-created users,
vehicle records and grants, exclusive renewable control leases, device-authenticated
GPS telemetry, live/historical tracks, audit logs, and a Docker Compose
deployment.

## Public contracts

- Cookie-authenticated browser endpoints live under `/api` for sessions, users,
  vehicles, memberships, device-credential rotation, control leases, tracks,
  and audits.
- `POST /device/v1/telemetry` accepts a bearer device credential and an ordered
  `points` array containing `occurredAt`, WGS-84 `longitude`, WGS-84
  `latitude`, and optional state fields.
- `POST /internal/control-lease/verify` validates an unexpired control-lease token for
  the localhost gateway. A missing, expired, released, or mismatched lease must prevent TCP control.
- Live `/ws` subscribers may receive only the `vehicle.position` events for
  vehicles they are authorised to view.

## Safety requirements

- The local gateway stays bound to loopback, validates local UI origins, and
  accepts only high-level commands.
- The backend accepts credentialed browser requests only from explicit trusted
  origins. Cookie-authenticated state changes reject missing or untrusted
  Origins; device and gateway internal endpoints use their own credentials.
- Control leases last 20 minutes and the browser renews them every five minutes. A
  renewal failure or lease expiry causes the gateway to attempt Stop before closing TCP.
- Browser closure, explicit disconnect, or gateway shutdown also follows the Stop-and-close
  path and makes a best-effort lease release. No gateway heartbeat is required.
- The platform does not alter the unverified car TCP encoder or represent
  automated tests as real-car validation.
