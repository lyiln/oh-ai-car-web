# Patrol Data Model

- `patrol_routes` and `patrol_waypoints`: immutable YAML route version and its
  ordered Nav2 poses, dwell time and optional camera-frame ROI.
- `whitelist_imports` and `whitelist_entries`: CSV import version and its
  normalised plate, owner, building and private/visitor classification.
- `patrol_tasks`: one vehicle run with route/whitelist snapshots and lifecycle
  timestamps.
- `patrol_events`: append-only scheduler status and waypoint audit trail.
- `plate_observations`: recognised plate, confidence, evidence URLs, GPS,
  classification and no-parking tag; `(task, plate, waypoint, 30-minute
  bucket)` is deduplicated by application logic.
