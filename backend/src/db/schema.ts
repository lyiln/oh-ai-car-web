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
ALTER TABLE patrol_routes ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE;
ALTER TABLE patrol_routes ADD COLUMN IF NOT EXISTS map_version text;
ALTER TABLE patrol_routes ADD COLUMN IF NOT EXISTS source_yaml text;
ALTER TABLE patrol_routes ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id);
UPDATE patrol_routes
SET
  vehicle_id = COALESCE(vehicle_id, (SELECT id FROM vehicles ORDER BY created_at LIMIT 1)),
  map_version = COALESCE(map_version, 'legacy'),
  source_yaml = COALESCE(source_yaml, ''),
  created_by_user_id = COALESCE(created_by_user_id, (SELECT id FROM users ORDER BY created_at LIMIT 1))
WHERE vehicle_id IS NULL
   OR map_version IS NULL
   OR source_yaml IS NULL
   OR created_by_user_id IS NULL;
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
  name text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
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

export const migration004 = `
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
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bridge_url text NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_patrol_at timestamptz;
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS plate text;
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS waypoint text;
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS confidence double precision;
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS evidence_url text;
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();
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

export const migration005 = `
ALTER TABLE whitelist_imports ADD COLUMN IF NOT EXISTS is_snapshot boolean NOT NULL DEFAULT false;
ALTER TABLE patrol_events DROP CONSTRAINT IF EXISTS patrol_events_event_type_check;
ALTER TABLE patrol_events ADD CONSTRAINT patrol_events_event_type_check
  CHECK (event_type IN ('status', 'waypoint', 'observation'));
`;

export const migration006 = `
WITH ranked_live_whitelists AS (
  SELECT id, row_number() OVER (PARTITION BY vehicle_id ORDER BY created_at DESC, id DESC) AS rank
  FROM whitelist_imports
  WHERE is_snapshot=false
)
UPDATE whitelist_imports
SET is_snapshot=true
WHERE id IN (SELECT id FROM ranked_live_whitelists WHERE rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS whitelist_imports_one_live_per_vehicle_idx
  ON whitelist_imports(vehicle_id)
  WHERE is_snapshot=false;
`;

export const migration007 = `
CREATE TABLE IF NOT EXISTS resident_destinations (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  building text NOT NULL,
  resident_key text NOT NULL DEFAULT '',
  display_name text NOT NULL,
  map_version text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  yaw double precision NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, building, resident_key, map_version)
);
CREATE INDEX IF NOT EXISTS resident_destinations_vehicle_active_idx
  ON resident_destinations(vehicle_id, active, building);

ALTER TABLE whitelist_entries ADD COLUMN IF NOT EXISTS destination_id uuid REFERENCES resident_destinations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS response_tasks (
  id uuid PRIMARY KEY,
  observation_id uuid NOT NULL UNIQUE REFERENCES plate_observations(id) ON DELETE CASCADE,
  violation_id uuid REFERENCES violations(id) ON DELETE SET NULL,
  source_patrol_task_id uuid NOT NULL REFERENCES patrol_tasks(id) ON DELETE CASCADE,
  source_vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  assigned_vehicle_id uuid REFERENCES vehicles(id),
  destination_id uuid NOT NULL REFERENCES resident_destinations(id),
  plate text NOT NULL,
  owner_name text NOT NULL DEFAULT '',
  building text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_review','confirmed','assigned','navigating','arrived','completed','cancelled','failed')),
  eligibility_reason text NOT NULL DEFAULT '',
  ai_suggestion text NOT NULL DEFAULT '',
  notification_text text NOT NULL DEFAULT '',
  confirmed_by_user_id uuid REFERENCES users(id),
  confirmed_at timestamptz,
  assigned_at timestamptz,
  navigation_started_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  arrival_evidence_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS response_tasks_status_created_idx ON response_tasks(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS response_tasks_vehicle_active_idx
  ON response_tasks(assigned_vehicle_id)
  WHERE status IN ('assigned','navigating','arrived');

CREATE TABLE IF NOT EXISTS response_task_events (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES response_tasks(id) ON DELETE CASCADE,
  device_event_id text,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, device_event_id)
);
CREATE INDEX IF NOT EXISTS response_task_events_task_created_idx ON response_task_events(task_id, created_at);
`;

export const migration008 = `
ALTER TABLE response_tasks DROP CONSTRAINT IF EXISTS response_tasks_status_check;
ALTER TABLE response_tasks ADD CONSTRAINT response_tasks_status_check CHECK (
  status IN ('pending_review','confirmed','assigned','navigating','arrived','cancellation_requested','completed','cancelled','failed')
);
ALTER TABLE response_tasks ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
ALTER TABLE response_tasks ADD COLUMN IF NOT EXISTS stop_confirmed_at timestamptz;
DROP INDEX IF EXISTS response_tasks_vehicle_active_idx;
CREATE UNIQUE INDEX response_tasks_vehicle_active_idx
  ON response_tasks(assigned_vehicle_id)
  WHERE status IN ('assigned','navigating','arrived','cancellation_requested');
`;

export const migration009 = `
-- Repair legacy flat whitelist_entries (plate/owner/slot/...) into import/entries model if needed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='whitelist_entries' AND column_name='owner'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='whitelist_entries' AND column_name='whitelist_id'
  ) THEN
    ALTER TABLE whitelist_entries RENAME TO whitelist_entries_legacy_009;
    CREATE TABLE whitelist_entries (
      id uuid PRIMARY KEY,
      whitelist_id uuid NOT NULL REFERENCES whitelist_imports(id) ON DELETE CASCADE,
      plate text NOT NULL,
      owner_name text NOT NULL DEFAULT '',
      building text NOT NULL DEFAULT '',
      category text NOT NULL DEFAULT 'private' CHECK (category IN ('private', 'visitor')),
      destination_id uuid REFERENCES resident_destinations(id) ON DELETE SET NULL,
      UNIQUE (whitelist_id, plate)
    );
    -- One live import per legacy vehicle that still has vehicle-scoped imports; attach no legacy flat rows yet.
    -- Legacy flat rows are attached to a temporary global import below.
  END IF;
END $$;

ALTER TABLE whitelist_imports ALTER COLUMN vehicle_id DROP NOT NULL;

-- Ensure destination_id exists on modern table.
ALTER TABLE whitelist_entries ADD COLUMN IF NOT EXISTS destination_id uuid REFERENCES resident_destinations(id) ON DELETE SET NULL;

-- Ensure patrol_tasks.whitelist_id exists for snapshot linkage.
ALTER TABLE patrol_tasks ADD COLUMN IF NOT EXISTS whitelist_id uuid REFERENCES whitelist_imports(id);
ALTER TABLE patrol_tasks ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id);
ALTER TABLE patrol_tasks ADD COLUMN IF NOT EXISTS finished_at timestamptz;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='patrol_tasks' AND column_name='created_by'
  ) THEN
    UPDATE patrol_tasks SET created_by_user_id = COALESCE(created_by_user_id, created_by) WHERE created_by_user_id IS NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='patrol_tasks' AND column_name='ended_at'
  ) THEN
    UPDATE patrol_tasks SET finished_at = COALESCE(finished_at, ended_at) WHERE finished_at IS NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS whitelist_imports_one_live_per_vehicle_idx;

-- Merge historical per-vehicle live entries / legacy flat rows into one global live whitelist.
DO $$
DECLARE
  global_id uuid;
  admin_id uuid;
BEGIN
  SELECT id INTO admin_id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN
    SELECT id INTO admin_id FROM users ORDER BY created_at LIMIT 1;
  END IF;

  SELECT id INTO global_id FROM whitelist_imports WHERE vehicle_id IS NULL AND is_snapshot=false LIMIT 1;
  IF global_id IS NULL AND admin_id IS NOT NULL THEN
    global_id := gen_random_uuid();
    INSERT INTO whitelist_imports (id, vehicle_id, name, created_by_user_id, is_snapshot)
    VALUES (global_id, NULL, '小区全局白名单', admin_id, false);
  END IF;

  IF global_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='whitelist_entries' AND column_name='whitelist_id'
    ) THEN
      INSERT INTO whitelist_entries (id, whitelist_id, plate, owner_name, building, category, destination_id)
      SELECT gen_random_uuid(), global_id, plate, owner_name, building, category, destination_id
      FROM (
        SELECT DISTINCT ON (e.plate)
          e.plate, e.owner_name, e.building, e.category, e.destination_id
        FROM whitelist_entries e
        JOIN whitelist_imports i ON i.id = e.whitelist_id
        WHERE i.is_snapshot=false AND i.vehicle_id IS NOT NULL
        ORDER BY e.plate, i.created_at DESC, e.id DESC
      ) AS merged
      ON CONFLICT (whitelist_id, plate) DO UPDATE SET
        owner_name=EXCLUDED.owner_name,
        building=EXCLUDED.building,
        category=EXCLUDED.category,
        destination_id=COALESCE(EXCLUDED.destination_id, whitelist_entries.destination_id);
    END IF;

    IF to_regclass('public.whitelist_entries_legacy_009') IS NOT NULL THEN
      INSERT INTO whitelist_entries (id, whitelist_id, plate, owner_name, building, category, destination_id)
      SELECT gen_random_uuid(), global_id, plate,
             COALESCE(owner, ''),
             COALESCE(building, ''),
             CASE WHEN vehicle_type='visitor' THEN 'visitor' ELSE 'private' END,
             destination_id
      FROM (
        SELECT DISTINCT ON (plate) plate, owner, building, vehicle_type, destination_id
        FROM whitelist_entries_legacy_009
        ORDER BY plate, created_at DESC, id DESC
      ) AS legacy
      ON CONFLICT (whitelist_id, plate) DO UPDATE SET
        owner_name=EXCLUDED.owner_name,
        building=EXCLUDED.building,
        category=EXCLUDED.category,
        destination_id=COALESCE(EXCLUDED.destination_id, whitelist_entries.destination_id);
      DROP TABLE whitelist_entries_legacy_009;
    END IF;

    UPDATE whitelist_imports
    SET is_snapshot=true
    WHERE is_snapshot=false AND vehicle_id IS NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS whitelist_imports_one_live_global_idx
  ON whitelist_imports ((true))
  WHERE is_snapshot=false AND vehicle_id IS NULL;
`;

export const migration010 = `
ALTER TABLE whitelist_entries ADD COLUMN IF NOT EXISTS parking_spot text NOT NULL DEFAULT '';
ALTER TABLE whitelist_entries ADD COLUMN IF NOT EXISTS valid_until timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='whitelist_entries' AND column_name='slot'
  ) THEN
    EXECUTE 'UPDATE whitelist_entries SET parking_spot = COALESCE(NULLIF(parking_spot, ''''), slot) WHERE parking_spot = ''''';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='whitelist_entries' AND column_name='expires_at'
  ) THEN
    EXECUTE 'UPDATE whitelist_entries SET valid_until = COALESCE(valid_until, expires_at) WHERE valid_until IS NULL';
  END IF;
END $$;
`;

export const migration011 = `
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE patrol_events ADD COLUMN IF NOT EXISTS waypoint_id uuid REFERENCES patrol_waypoints(id);
ALTER TABLE patrol_routes ADD COLUMN IF NOT EXISTS code text;
UPDATE patrol_routes SET code = 'route-' || substr(id::text, 1, 8) WHERE code IS NULL;
`;
