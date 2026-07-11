export const migration001 = `
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'operator')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  tcp_host text NOT NULL,
  tcp_port integer NOT NULL CHECK (tcp_port BETWEEN 1 AND 65535),
  video_port integer NOT NULL CHECK (video_port BETWEEN 1 AND 65535),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vehicle_members (
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (vehicle_id, user_id)
);
CREATE TABLE IF NOT EXISTS device_credentials (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  secret_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_credentials_vehicle_active_idx ON device_credentials(vehicle_id) WHERE active;
CREATE TABLE IF NOT EXISTS telemetry_points (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  altitude_m double precision,
  accuracy_m double precision,
  speed_kph double precision,
  heading_deg double precision,
  battery_pct double precision CHECK (battery_pct BETWEEN 0 AND 100),
  mode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, occurred_at)
);
CREATE INDEX IF NOT EXISTS telemetry_points_vehicle_time_idx ON telemetry_points(vehicle_id, occurred_at DESC);
CREATE TABLE IF NOT EXISTS control_leases (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text
);
CREATE INDEX IF NOT EXISTS control_leases_vehicle_active_idx ON control_leases(vehicle_id, expires_at) WHERE released_at IS NULL;
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
`;

export const migration002 = `
CREATE TABLE IF NOT EXISTS patrol_routes (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name text NOT NULL,
  map_version text NOT NULL,
  source_yaml text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patrol_routes_vehicle_created_idx ON patrol_routes(vehicle_id, created_at DESC);
CREATE TABLE IF NOT EXISTS patrol_waypoints (
  id uuid PRIMARY KEY,
  route_id uuid NOT NULL REFERENCES patrol_routes(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  name text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  yaw double precision NOT NULL,
  dwell_seconds integer NOT NULL CHECK (dwell_seconds BETWEEN 8 AND 10),
  no_parking_roi jsonb,
  UNIQUE (route_id, ordinal)
);
CREATE TABLE IF NOT EXISTS whitelist_imports (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whitelist_entries (
  id uuid PRIMARY KEY,
  whitelist_id uuid NOT NULL REFERENCES whitelist_imports(id) ON DELETE CASCADE,
  plate text NOT NULL,
  owner_name text NOT NULL,
  building text NOT NULL,
  category text NOT NULL CHECK (category IN ('private', 'visitor')),
  UNIQUE (whitelist_id, plate)
);
CREATE TABLE IF NOT EXISTS patrol_tasks (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES patrol_routes(id),
  whitelist_id uuid NOT NULL REFERENCES whitelist_imports(id),
  shift text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'queued', 'running', 'stopped', 'completed', 'failed')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  started_at timestamptz,
  finished_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS patrol_tasks_vehicle_active_idx ON patrol_tasks(vehicle_id) WHERE status IN ('queued', 'running');
CREATE TABLE IF NOT EXISTS patrol_events (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES patrol_tasks(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('status', 'waypoint')),
  waypoint_id uuid REFERENCES patrol_waypoints(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plate_observations (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES patrol_tasks(id) ON DELETE CASCADE,
  waypoint_id uuid NOT NULL REFERENCES patrol_waypoints(id),
  occurred_at timestamptz NOT NULL,
  dedupe_bucket timestamptz NOT NULL,
  dedupe_key text NOT NULL,
  plate text,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  classification text NOT NULL CHECK (classification IN ('pending_review', 'registered_private', 'visitor', 'suspected_external')),
  no_parking boolean NOT NULL DEFAULT false,
  evidence_image_url text,
  annotated_image_url text,
  longitude double precision,
  latitude double precision,
  observation_count integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL,
  UNIQUE (task_id, waypoint_id, dedupe_key, dedupe_bucket)
);
CREATE INDEX IF NOT EXISTS plate_observations_task_time_idx ON plate_observations(task_id, occurred_at DESC);
`;

export const migration003 = `
ALTER TABLE patrol_tasks DROP CONSTRAINT IF EXISTS patrol_tasks_status_check;
ALTER TABLE patrol_tasks ADD CONSTRAINT patrol_tasks_status_check CHECK (status IN ('draft', 'queued', 'running', 'cancellation_requested', 'stopped', 'completed', 'failed'));
ALTER TABLE patrol_tasks ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz;
ALTER TABLE patrol_tasks ADD COLUMN IF NOT EXISTS stop_confirmed_at timestamptz;
ALTER TABLE patrol_tasks ADD COLUMN IF NOT EXISTS zero_velocity_confirmed_at timestamptz;
DROP INDEX IF EXISTS patrol_tasks_vehicle_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS patrol_tasks_vehicle_active_idx ON patrol_tasks(vehicle_id) WHERE status IN ('queued', 'running', 'cancellation_requested');
`;
