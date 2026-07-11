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
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS auth_otps (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_otps_email_created_idx ON auth_otps(email, created_at DESC);
`;

export const migration003 = `
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bridge_url text NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_patrol_at timestamptz;
`;

export const migration004 = `
CREATE TABLE IF NOT EXISTS patrol_routes (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS waypoints (
  id uuid PRIMARY KEY,
  route_id uuid NOT NULL REFERENCES patrol_routes(id) ON DELETE CASCADE,
  name text NOT NULL,
  seq integer NOT NULL,
  longitude double precision NOT NULL,
  latitude double precision NOT NULL,
  UNIQUE (route_id, seq)
);
CREATE TABLE IF NOT EXISTS patrol_tasks (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  route_id uuid REFERENCES patrol_routes(id) ON DELETE SET NULL,
  shift text NOT NULL DEFAULT 'morning' CHECK (shift IN ('morning','afternoon','evening')),
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','navigating','scanning','completed','failed','stopped')),
  progress_done integer NOT NULL DEFAULT 0,
  progress_total integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patrol_tasks_vehicle_active_idx ON patrol_tasks(vehicle_id) WHERE status IN ('navigating','scanning');
CREATE TABLE IF NOT EXISTS patrol_events (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES patrol_tasks(id) ON DELETE CASCADE,
  plate text,
  event_type text NOT NULL DEFAULT 'recognition',
  waypoint text,
  confidence double precision,
  evidence_url text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','confirmed','false_positive','whitelist','external')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patrol_events_task_idx ON patrol_events(task_id, occurred_at DESC);
`;

export const migration005 = `
CREATE TABLE IF NOT EXISTS map_metadata (
  id uuid PRIMARY KEY,
  name text NOT NULL DEFAULT 'default',
  basemap_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS map_zones (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  geom geometry(Polygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_zones_geom_idx ON map_zones USING GIST (geom);
`;

export const migration006 = `
CREATE TABLE IF NOT EXISTS violations (
  id uuid PRIMARY KEY,
  event_id uuid REFERENCES patrol_events(id) ON DELETE SET NULL,
  plate text,
  violation_type text NOT NULL DEFAULT 'no_parking' CHECK (violation_type IN ('no_parking','suspected_external')),
  zone_id uuid REFERENCES map_zones(id) ON DELETE SET NULL,
  task_id uuid REFERENCES patrol_tasks(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  waypoint text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal','low')),
  disposition text NOT NULL DEFAULT 'pending' CHECK (disposition IN ('pending','processed','dismissed')),
  evidence_url text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS violations_occurred_idx ON violations(occurred_at DESC);
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES patrol_events(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'low_confidence',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolver_id uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_pending_idx ON reviews(created_at DESC) WHERE status='pending';
`;

export const migration007 = `
CREATE TABLE IF NOT EXISTS whitelist_entries (
  id uuid PRIMARY KEY,
  plate text NOT NULL UNIQUE,
  owner text NOT NULL DEFAULT '',
  building text NOT NULL DEFAULT '',
  slot text NOT NULL DEFAULT '',
  vehicle_type text NOT NULL DEFAULT 'private' CHECK (vehicle_type IN ('private','visitor','commercial')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS patrol_reports (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES patrol_tasks(id) ON DELETE CASCADE,
  html_content text NOT NULL DEFAULT '',
  csv_content text NOT NULL DEFAULT '',
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
