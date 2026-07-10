# Vehicle Fleet Platform Data Model

| Entity | Responsibility |
| --- | --- |
| `users` | Administrator/operator identity, password hash, role, active state. |
| `vehicles` | Saved TCP/video connection target and vehicle metadata. |
| `vehicle_members` | Operator-to-vehicle access grants. |
| `device_credentials` | Rotatable hashed credentials used only by edge telemetry agents. |
| `telemetry_points` | Idempotent WGS-84 GPS samples and optional vehicle state. |
| `control_leases` | Time-limited exclusive control ownership with release reason. |
| `audit_logs` | Security-relevant account, vehicle, device, lease, and connection events. |

Tracks are retained for 90 days; audit logs are retained for one year. The
scheduled cleanup job is an operational follow-up before production rollout.
