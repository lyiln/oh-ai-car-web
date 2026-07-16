import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { Database } from '../db/index.js';
import { saveEvidenceJpeg } from '../evidence-storage.js';
import { parseRing, pointInPolygon } from '../geometry/point-in-polygon.js';
import { matchWhitelistPlate, normalisePlate, plateMatchDto, type PlateMatchResult } from '../plate-match.js';
import { createResponseCandidate } from './response-platform.js';

type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'operator';
  active: boolean;
  password_hash?: string;
  email?: string | null;
};

type DeviceRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  tcp_host: string;
  tcp_port: number;
  video_port: number;
  bridge_url: string | null;
  last_seen_at: Date | null;
  last_patrol_at: Date | null;
  archived: boolean;
};

type PatrolTaskRow = {
  id: string;
  vehicle_id: string;
  route_id: string;
  whitelist_id: string;
  shift: string;
  status: string;
  progress_done: number;
  progress_total: number;
  started_at: Date | null;
  ended_at: Date | null;
  created_by: string;
  created_at: Date;
  device_name?: string;
  route_name?: string;
  event_count?: number;
  review_confidence_threshold?: number;
  dedupe_window_sec?: number;
};

type RouteUser = {
  id: string;
  role: 'admin' | 'operator';
  username?: string;
  display_name?: string;
  active?: boolean;
};

export type PatrolRouteDeps = {
  db: Database;
  requireUser: (req: FastifyRequest) => Promise<RouteUser & AuthUser>;
  requireAdmin: (req: FastifyRequest) => Promise<RouteUser & AuthUser>;
  canAccessVehicle: (user: RouteUser, vehicleId: string) => Promise<boolean>;
  vehicleDto: (row: DeviceRow) => Record<string, unknown>;
  acquireLease: (client: PoolClient, user: RouteUser, vehicleId: string) => Promise<{ id: string; expiresAt: Date }>;
  leaseToken: (leaseId: string, vehicleId: string, user: RouteUser, expiresAt: Date) => string;
  audit: (action: string, outcome: string, actorUserId?: string, vehicleId?: string, metadata?: Record<string, unknown>) => Promise<void>;
  isTrustedOrigin: (origin: string | undefined) => boolean;
  hub: {
    publish: (vehicleId: string, payload: unknown) => void;
    publishPatrol?: (msg: { vehicleId: string; [key: string]: unknown }) => void;
    subscribePatrol?: (socket: { send: (value: string) => void }, vehicleId: string) => () => void;
  };
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return value.trim();
}

function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw Object.assign(new Error(`${field} is invalid`), { statusCode: 400 });
  }
  return value;
}

function optionalString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function deviceDto(row: DeviceRow, status?: 'online' | 'offline' | 'patrolling') {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    host: row.tcp_host,
    tcpPort: row.tcp_port,
    videoPort: row.video_port,
    bridgeUrl: row.bridge_url ?? '',
    lastSeenAt: iso(row.last_seen_at),
    lastPatrolAt: iso(row.last_patrol_at),
    archived: row.archived,
    status: status ?? (row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 2 * 60_000 ? 'online' : 'offline'),
  };
}

function taskDto(row: PatrolTaskRow) {
  return {
    id: row.id,
    deviceId: row.vehicle_id,
    deviceName: row.device_name,
    routeId: row.route_id ?? '',
    routeName: row.route_name,
    shift: row.shift,
    status: row.status,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    waypointDone: row.progress_done,
    waypointTotal: row.progress_total,
    eventCount: row.event_count ?? undefined,
  };
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function optionalValidUntil(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw httpError('validUntil is invalid', 400);
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw httpError('validUntil is invalid', 400);
  return date.toISOString();
}

const DEFAULT_PATROL_RULES = { reviewConfidenceThreshold: 0.75, dedupeWindowSec: 1800 } as const;
function patrolRules(rows: Array<{ key: string; value: unknown }>) {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const threshold = values.get('reviewConfidenceThreshold');
  const window = values.get('dedupeWindowSec');
  return {
    reviewConfidenceThreshold: typeof threshold === 'number' && threshold >= 0 && threshold <= 1
      ? threshold : DEFAULT_PATROL_RULES.reviewConfidenceThreshold,
    dedupeWindowSec: typeof window === 'number' && Number.isInteger(window) && window >= 60 && window <= 86_400
      ? window : DEFAULT_PATROL_RULES.dedupeWindowSec,
  };
}

function optionalWxUid(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string') throw httpError('wxUid is invalid', 400);
  const wxUid = value.trim();
  if (!wxUid) return '';
  if (wxUid.length > 128) throw httpError('wxUid is too long', 400);
  return wxUid;
}

type WhitelistEntryRow = {
  id: string;
  plate: string;
  owner: string | null;
  building: string | null;
  parkingSpot?: string | null;
  wxUid?: string | null;
  vehicleType: string | null;
  validUntil?: Date | string | null;
};

function whitelistEntryDto(row: WhitelistEntryRow) {
  return {
    id: row.id,
    plate: row.plate,
    owner: row.owner ?? '',
    building: row.building ?? '',
    parkingSpot: row.parkingSpot ?? '',
    wxUid: row.wxUid ?? '',
    vehicleType: row.vehicleType,
    validUntil: iso(row.validUntil ?? null),
  };
}

const WHITELIST_ENTRY_SELECT = `
  SELECT e.id, e.plate, e.owner_name AS owner, e.building,
         e.parking_spot AS "parkingSpot", e.wx_uid AS "wxUid", e.category AS "vehicleType",
         e.valid_until AS "validUntil"
  FROM whitelist_entries e
  JOIN whitelist_imports i ON i.id=e.whitelist_id
`;

const WHITELIST_LIVE_CLAUSE = `i.vehicle_id IS NULL AND i.is_snapshot=false`;


function normalizeRing(coordinates: unknown): number[][] {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw httpError('coordinates must be an array of at least 3 [lng,lat] pairs', 400);
  }
  const ring: number[][] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) throw httpError('each coordinate must be [lng,lat]', 400);
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw httpError('coordinates contain invalid numbers', 400);
    ring.push([lng, lat]);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

async function ensureDefaultRoute(db: Database, vehicleId: string, userId: string): Promise<string> {
  const existing = await db.query<{ id: string }>('SELECT id FROM patrol_routes WHERE vehicle_id=$1 ORDER BY created_at LIMIT 1', [vehicleId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const routeId = randomUUID();
  const routeCode = `route-${routeId.slice(0, 8)}`;
  try {
    await db.query(
      `INSERT INTO patrol_routes (id, vehicle_id, name, code, map_version, source_yaml, created_by_user_id)
       VALUES ($1,$2,'默认巡检路线',$4,'platform-default','generated for the selected device',$3)`,
      [routeId, vehicleId, userId, routeCode],
    );
  } catch {
    await db.query(
      `INSERT INTO patrol_routes (id, vehicle_id, name, map_version, source_yaml, created_by_user_id)
       VALUES ($1,$2,'默认巡检路线','platform-default','generated for the selected device',$3)`,
      [routeId, vehicleId, userId],
    );
  }
  const wp1 = randomUUID();
  const wp2 = randomUUID();
  const wp3 = randomUUID();
  await db.query(
    `INSERT INTO patrol_waypoints (id, route_id, ordinal, name, x, y, yaw, dwell_seconds, no_parking_roi) VALUES
      ($1,$4,0,'起点',0,0,0,8,$5::jsonb),
      ($2,$4,1,'巡检点',1,1,0,8,NULL),
      ($3,$4,2,'终点',2,2,0,8,NULL)`,
    [wp1, wp2, wp3, routeId, JSON.stringify([0.1, 0.1, 0.5, 0.5])],
  );
  return routeId;
}

async function ensureMapMetadata(db: Database): Promise<{ name: string; basemap_url: string }> {
  const existing = await db.query<{ name: string; basemap_url: string }>('SELECT name, basemap_url FROM map_metadata WHERE vehicle_id IS NULL ORDER BY created_at LIMIT 1');
  if (existing.rows[0]) return existing.rows[0];
  await db.query('INSERT INTO map_metadata (id, name, basemap_url) VALUES ($1, $2, $3)', [randomUUID(), 'default', '']);
  return { name: 'default', basemap_url: '' };
}

type MapMetaRow = {
  id: string;
  name: string;
  basemap_url: string;
  map_version: string;
  resolution: number;
  origin_x: number;
  origin_y: number;
  origin_yaw: number;
  image_width: number;
  image_height: number;
};

function mapMetaDto(row: MapMetaRow | undefined) {
  if (!row) return null;
  return {
    name: row.name,
    mapVersion: row.map_version,
    resolution: Number(row.resolution),
    originX: Number(row.origin_x),
    originY: Number(row.origin_y),
    originYaw: Number(row.origin_yaw),
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageUrl: row.basemap_url || null,
  };
}

const MAP_META_SELECT = 'id, name, basemap_url, map_version, resolution, origin_x, origin_y, origin_yaw, image_width, image_height';

// 优先返回该车辆专属地图；没有则回退到全局默认地图（vehicle_id 为空）。
async function loadFloorMap(db: Database, vehicleId: string | null): Promise<MapMetaRow | undefined> {
  if (vehicleId) {
    const perVehicle = await db.query<MapMetaRow>(`SELECT ${MAP_META_SELECT} FROM map_metadata WHERE vehicle_id=$1 LIMIT 1`, [vehicleId]);
    if (perVehicle.rows[0]) return perVehicle.rows[0];
  }
  const global = await db.query<MapMetaRow>(`SELECT ${MAP_META_SELECT} FROM map_metadata WHERE vehicle_id IS NULL AND image_width>0 ORDER BY updated_at DESC LIMIT 1`);
  return global.rows[0];
}

async function ensureGlobalWhitelist(client: PoolClient, user: RouteUser): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('oh-ai-car-web:global-whitelist'))");
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM whitelist_imports WHERE vehicle_id IS NULL AND is_snapshot=false ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE',
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await client.query(
    'INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id,is_snapshot) VALUES ($1,NULL,$2,$3,false)',
    [id, '小区全局白名单', user.id],
  );
  return id;
}

const TASK_SELECT = `
  SELECT t.*, t.finished_at AS ended_at, t.created_by_user_id AS created_by,
    0::int AS progress_done, (SELECT count(*)::int FROM patrol_waypoints w WHERE w.route_id=t.route_id) AS progress_total,
    v.name AS device_name, r.name AS route_name,
    (SELECT count(*)::int FROM patrol_events e WHERE e.task_id = t.id) AS event_count
  FROM patrol_tasks t
  JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN patrol_routes r ON r.id = t.route_id
`;

export function registerPatrolPlatformRoutes(app: FastifyInstance, deps: PatrolRouteDeps): void {
  const { db, requireUser, requireAdmin, canAccessVehicle, acquireLease, leaseToken, audit, hub, isTrustedOrigin } = deps;

  // --- Devices (vehicle aliases) ---
  app.get('/api/devices', async (request) => {
    const user = await requireUser(request);
    const q = typeof (request.query as { q?: unknown }).q === 'string'
      ? (request.query as { q: string }).q.trim()
      : '';
    const pattern = q ? `%${q}%` : null;
    const result = user.role === 'admin'
      ? await db.query<DeviceRow>(
        `SELECT * FROM vehicles
         WHERE archived=false
           AND ($1::text IS NULL OR name ILIKE $1 OR code ILIKE $1 OR tcp_host ILIKE $1 OR description ILIKE $1)
         ORDER BY name`,
        [pattern],
      )
      : await db.query<DeviceRow>(
        `SELECT v.* FROM vehicles v
         JOIN vehicle_members m ON m.vehicle_id=v.id
         WHERE m.user_id=$1 AND v.archived=false
           AND ($2::text IS NULL OR v.name ILIKE $2 OR v.code ILIKE $2 OR v.tcp_host ILIKE $2 OR v.description ILIKE $2)
         ORDER BY v.name`,
        [user.id, pattern],
      );
    const active = await db.query<{ vehicle_id: string }>(
      "SELECT vehicle_id FROM patrol_tasks WHERE status IN ('queued','running','cancellation_requested')",
    );
    const activeIds = new Set(active.rows.map((row) => row.vehicle_id));
    return { devices: result.rows.map((row) => deviceDto(row, activeIds.has(row.id) ? 'patrolling' : undefined)) };
  });

  app.post('/api/devices', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    const id = randomUUID();
    const code = string(body?.code, 'code');
    const name = string(body?.name, 'name');
    const host = string(body?.host, 'host');
    const tcpPort = number(body?.tcpPort ?? 6000, 'tcpPort', 1, 65535);
    const videoPort = number(body?.videoPort ?? 6500, 'videoPort', 1, 65535);
    const bridgeUrl = optionalString(body?.bridgeUrl);
    const description = optionalString(body?.description);
    await db.query(
      'INSERT INTO vehicles (id,code,name,description,tcp_host,tcp_port,video_port,bridge_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, code, name, description, host, tcpPort, videoPort, bridgeUrl],
    );
    await audit('device.create', 'success', admin.id, id);
    const row = (await db.query<DeviceRow>('SELECT * FROM vehicles WHERE id=$1', [id])).rows[0];
    return { device: deviceDto(row) };
  });

  app.put('/api/devices/:id', async (request) => {
    const admin = await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const body = object(request.body);
    const result = await db.query<DeviceRow>(
      `UPDATE vehicles SET
        name=COALESCE($1,name),
        description=COALESCE($2,description),
        tcp_host=COALESCE($3,tcp_host),
        tcp_port=COALESCE($4,tcp_port),
        video_port=COALESCE($5,video_port),
        bridge_url=COALESCE($6,bridge_url),
        updated_at=now()
      WHERE id=$7 AND archived=false
      RETURNING *`,
      [
        typeof body?.name === 'string' ? body.name.trim() : null,
        typeof body?.description === 'string' ? body.description : null,
        typeof body?.host === 'string' ? body.host.trim() : null,
        typeof body?.tcpPort === 'number' ? number(body.tcpPort, 'tcpPort', 1, 65535) : null,
        typeof body?.videoPort === 'number' ? number(body.videoPort, 'videoPort', 1, 65535) : null,
        typeof body?.bridgeUrl === 'string' ? body.bridgeUrl.trim() : null,
        id,
      ],
    );
    if (!result.rows[0]) throw httpError('Device not found', 404);
    await audit('device.update', 'success', admin.id, id);
    return { device: deviceDto(result.rows[0]) };
  });

  app.delete('/api/devices/:id', async (request) => {
    const admin = await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const result = await db.query('UPDATE vehicles SET archived=true, updated_at=now() WHERE id=$1 AND archived=false RETURNING id', [id]);
    if (!result.rows[0]) throw httpError('Device not found', 404);
    await audit('device.archive', 'success', admin.id, id);
    return { ok: true as const };
  });

  app.post('/api/devices/:id/connect', async (request) => {
    const user = await requireUser(request);
    const vehicleId = (request.params as { id: string }).id;
    if (!await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);
    const vehicle = await db.query<DeviceRow>('SELECT * FROM vehicles WHERE id=$1 AND archived=false', [vehicleId]);
    if (!vehicle.rows[0]) throw httpError('Device not found', 404);
    const lease = await db.transaction((client) => acquireLease(client, user, vehicleId));
    await audit('device.connect', 'success', user.id, vehicleId);
    const row = vehicle.rows[0];
    return {
      host: row.tcp_host,
      tcpPort: row.tcp_port,
      videoPort: row.video_port,
      bridgeUrl: row.bridge_url ?? '',
      leaseId: lease.id,
      expiresAt: lease.expiresAt.toISOString(),
      gatewayToken: leaseToken(lease.id, vehicleId, user, lease.expiresAt),
    };
  });

  app.get('/api/devices/:id/status', async (request) => {
    const user = await requireUser(request);
    const vehicleId = (request.params as { id: string }).id;
    if (!await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);
    const vehicle = await db.query<DeviceRow>('SELECT * FROM vehicles WHERE id=$1', [vehicleId]);
    if (!vehicle.rows[0]) throw httpError('Device not found', 404);
    const telem = await db.query<{ occurred_at: Date; battery_pct: number | null; mode: string | null }>(
      `SELECT occurred_at, battery_pct, mode FROM telemetry_points
       WHERE vehicle_id=$1 AND occurred_at > now() - interval '2 minutes'
       ORDER BY occurred_at DESC LIMIT 1`,
      [vehicleId],
    );
    const lastSeen = vehicle.rows[0].last_seen_at;
    const seenRecently = lastSeen ? Date.now() - new Date(lastSeen).getTime() < 2 * 60_000 : false;
    const online = Boolean(telem.rows[0]) || seenRecently;
    const lease = await db.query<{ id: string; user_id: string; expires_at: Date }>(
      'SELECT id, user_id, expires_at FROM control_leases WHERE vehicle_id=$1 AND released_at IS NULL AND expires_at>now() LIMIT 1',
      [vehicleId],
    );
    return {
      online,
      batteryPct: telem.rows[0]?.battery_pct ?? null,
      mode: telem.rows[0]?.mode ?? null,
      message: online ? 'online' : 'offline',
      lease: lease.rows[0]
        ? { leaseId: lease.rows[0].id, userId: lease.rows[0].user_id, expiresAt: iso(lease.rows[0].expires_at) }
        : null,
    };
  });

  app.get('/api/devices/:id/pose', async (request) => {
    const user = await requireUser(request);
    const vehicleId = (request.params as { id: string }).id;
    if (!await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);
    const result = await db.query<{ longitude: number; latitude: number; heading_deg: number | null; occurred_at: Date }>(
      `SELECT longitude, latitude, heading_deg, occurred_at FROM telemetry_points
       WHERE vehicle_id=$1 ORDER BY occurred_at DESC LIMIT 1`,
      [vehicleId],
    );
    const point = result.rows[0];
    if (!point) return { longitude: 0, latitude: 0, headingDeg: null, occurredAt: null };
    return {
      longitude: point.longitude,
      latitude: point.latitude,
      headingDeg: point.heading_deg,
      occurredAt: iso(point.occurred_at),
    };
  });

  // --- Dashboard ---
  app.get('/api/dashboard/summary', async (request) => {
    const user = await requireUser(request);
    const memberId = user.role === 'admin' ? null : user.id;
    const onlineDevices = await db.query<{ c: number }>(`
      SELECT count(*)::int AS c FROM vehicles v
      WHERE v.archived=false AND (
        v.last_seen_at > now() - interval '2 minutes'
        OR EXISTS (
          SELECT 1 FROM telemetry_points t
          WHERE t.vehicle_id=v.id AND t.occurred_at > now() - interval '2 minutes'
        )
      ) AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.id AND vm.user_id=$1))`, [memberId]);
    const todayPatrols = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM patrol_tasks t WHERE started_at >= date_trunc('day', now())
       AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$1))`, [memberId],
    );
    const pendingReviews = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM reviews r JOIN patrol_events e ON e.id=r.event_id JOIN patrol_tasks t ON t.id=e.task_id
       WHERE r.status='pending' AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$1))`, [memberId],
    );
    const violations = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM violations v WHERE disposition='pending'
       AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.vehicle_id AND vm.user_id=$1))`, [memberId],
    );
    const recentTasks = await db.query<PatrolTaskRow>(`${TASK_SELECT}
      WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$1))
      ORDER BY t.created_at DESC LIMIT 5`, [memberId]);
    const todayAlerts = await db.query<{ id: string; plate: string | null; priority: string; occurred_at: Date; violation_type: string }>(
      `SELECT id, plate, priority, occurred_at, violation_type FROM violations v
       WHERE occurred_at >= date_trunc('day', now())
         AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.vehicle_id AND vm.user_id=$1))
       ORDER BY occurred_at DESC LIMIT 10`, [memberId],
    );
    return {
      onlineDevices: onlineDevices.rows[0]?.c ?? 0,
      todayPatrols: todayPatrols.rows[0]?.c ?? 0,
      pendingReviews: pendingReviews.rows[0]?.c ?? 0,
      violations: violations.rows[0]?.c ?? 0,
      recentTasks: recentTasks.rows.map(taskDto),
      alerts: todayAlerts.rows.map((row) => ({
        id: row.id,
        message: `${row.plate ?? '未知车牌'} · ${row.violation_type}`,
        priority: row.priority,
        occurredAt: iso(row.occurred_at),
      })),
    };
  });

  // --- Patrol ---
  // Whitelist starts empty by design; POST /api/patrol/start returns 409 until entries exist.
  app.post('/api/patrol/start', async (request) => {
    const user = await requireUser(request);
    const body = object(request.body);
    const deviceId = string(body?.deviceId, 'deviceId');
    if (!await canAccessVehicle(user, deviceId)) throw httpError('Vehicle access denied', 403);

    let routeId = typeof body?.routeId === 'string' && body.routeId.trim() ? body.routeId.trim() : null;
    if (!routeId) {
      routeId = await ensureDefaultRoute(db, deviceId, user.id);
    } else {
      const route = await db.query('SELECT id FROM patrol_routes WHERE id=$1 AND vehicle_id=$2', [routeId, deviceId]);
      if (!route.rows[0]) throw httpError('Route not found', 404);
      routeId = (route.rows[0] as { id: string }).id;
    }

    const shiftRaw = typeof body?.shift === 'string' ? body.shift.trim() : 'morning';
    const shift = shiftRaw === 'afternoon' || shiftRaw === 'evening' || shiftRaw === 'morning'
      ? shiftRaw
      : shiftRaw === 'noon' ? 'afternoon' : (() => { throw httpError('shift is invalid', 400); })();

    const id = randomUUID();
    await db.transaction(async (client) => {
      const vehicle = await client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [deviceId]);
      if (!vehicle.rowCount) throw httpError('Device not found', 404);
      await client.query("UPDATE control_leases SET released_at=now(),release_reason='expired' WHERE vehicle_id=$1 AND released_at IS NULL AND expires_at<=now()", [deviceId]);
      const manualControl = await client.query('SELECT 1 FROM control_leases WHERE vehicle_id=$1 AND released_at IS NULL AND expires_at>now() LIMIT 1', [deviceId]);
      if (manualControl.rowCount) throw httpError('Safely disconnect the local gateway and release the active control lease before starting patrol', 409);
      const active = await client.query("SELECT 1 FROM patrol_tasks WHERE vehicle_id=$1 AND status IN ('queued','running','cancellation_requested')", [deviceId]);
      if (active.rowCount) throw httpError('Device already has an active patrol task', 409);
      const activeResponse = await client.query("SELECT 1 FROM response_tasks WHERE assigned_vehicle_id=$1 AND status IN ('assigned','navigating','arrived','cancellation_requested')", [deviceId]);
      if (activeResponse.rowCount) throw httpError('Device already has an active doorstep response task', 409);
      const whitelist = await client.query<{ id: string }>(
        'SELECT id FROM whitelist_imports WHERE vehicle_id IS NULL AND is_snapshot=false ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE',
      );
      if (!whitelist.rows[0]) throw httpError('Whitelist is empty; add at least one entry before starting patrol', 409);
      const whitelistHasEntries = await client.query('SELECT 1 FROM whitelist_entries WHERE whitelist_id=$1 LIMIT 1', [whitelist.rows[0].id]);
      if (!whitelistHasEntries.rowCount) throw httpError('Whitelist is empty; add at least one entry before starting patrol', 409);
      // Create immutable whitelist snapshot for this task (FR-002)
      const snapshotId = randomUUID();
      const snapshot = await client.query(
        `INSERT INTO whitelist_imports (id, vehicle_id, name, created_by_user_id, is_snapshot)
         SELECT $1, $2, name || ' [快照]', $3, true
         FROM whitelist_imports WHERE id=$4`,
        [snapshotId, deviceId, user.id, whitelist.rows[0].id],
      );
      if (!snapshot.rowCount) throw httpError('Whitelist changed while starting patrol; retry the request', 409);
      await client.query(
        `INSERT INTO whitelist_entries (id, whitelist_id, plate, owner_name, building, category, parking_spot, valid_until, wx_uid)
         SELECT gen_random_uuid(), $1, plate, owner_name, building, category, parking_spot, valid_until, wx_uid
         FROM whitelist_entries WHERE whitelist_id=$2`,
        [snapshotId, whitelist.rows[0].id],
      );
      const ruleRows = await client.query<{ key: string; value: unknown }>(
        "SELECT key,value FROM platform_settings WHERE key IN ('reviewConfidenceThreshold','dedupeWindowSec')",
      );
      const rules = patrolRules(ruleRows.rows);
      await client.query(
        `INSERT INTO patrol_tasks (id, vehicle_id, route_id, whitelist_id, shift, status, created_by_user_id, review_confidence_threshold, dedupe_window_sec)
         VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8)`,
        [id, deviceId, routeId, snapshotId, shift, user.id, rules.reviewConfidenceThreshold, rules.dedupeWindowSec],
      );
      await client.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), id, JSON.stringify({ status: 'queued' })]);
    });
    await db.query('UPDATE vehicles SET last_patrol_at=now(), updated_at=now() WHERE id=$1', [deviceId]);
    await audit('patrol.start', 'success', user.id, deviceId, { taskId: id, routeId, shift });
    hub.publishPatrol?.({ type: 'patrol_status', taskId: id, vehicleId: deviceId, deviceId, status: 'queued' });
    const task = await db.query<PatrolTaskRow>(`${TASK_SELECT} WHERE t.id=$1`, [id]);
    return { task: taskDto(task.rows[0]) };
  });

  app.post('/api/patrol/stop', async (request) => {
    const user = await requireUser(request);
    const body = object(request.body);
    const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : null;
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : null;
    const force = body?.force === true;
    if (!taskId && !deviceId) throw httpError('deviceId or taskId is required', 400);

    let task: PatrolTaskRow | undefined;
    if (taskId) {
      const result = await db.query<PatrolTaskRow>(`${TASK_SELECT} WHERE t.id=$1`, [taskId]);
      task = result.rows[0];
    } else if (deviceId) {
      const result = await db.query<PatrolTaskRow>(
        `${TASK_SELECT} WHERE t.vehicle_id=$1 AND t.status IN ('queued','running','cancellation_requested') ORDER BY t.created_at DESC LIMIT 1`,
        [deviceId],
      );
      task = result.rows[0];
    }
    if (!task) throw httpError('Active patrol task not found', 404);
    if (!await canAccessVehicle(user, task.vehicle_id)) throw httpError('Vehicle access denied', 403);

    // 无调度器确认零速时，cancellation_requested 会一直卡住并挡住前往/控制台；允许强制结束。
    if (task.status === 'cancellation_requested' || force) {
      await db.query(
        `UPDATE patrol_tasks
         SET status='stopped', finished_at=COALESCE(finished_at, now()),
             stop_confirmed_at=COALESCE(stop_confirmed_at, now()),
             zero_velocity_confirmed_at=COALESCE(zero_velocity_confirmed_at, now()),
             failure_reason=COALESCE(failure_reason, 'operator force stop')
         WHERE id=$1 AND status IN ('queued','running','cancellation_requested')`,
        [task.id],
      );
      await db.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), task.id, JSON.stringify({ status: 'stopped', source: 'operator_force' })]);
      await audit('patrol.force-stop', 'success', user.id, task.vehicle_id, { taskId: task.id });
      hub.publishPatrol?.({ type: 'patrol_status', taskId: task.id, vehicleId: task.vehicle_id, deviceId: task.vehicle_id, status: 'stopped' });
      return { ok: true as const, forced: true };
    }

    const stopped = await db.query<{ id: string; status: string }>(
      `UPDATE patrol_tasks
         SET status = CASE WHEN status='queued' THEN 'stopped' ELSE 'cancellation_requested' END,
             stop_requested_at = now(),
             stop_confirmed_at = CASE WHEN status='queued' THEN now() ELSE stop_confirmed_at END,
             zero_velocity_confirmed_at = CASE WHEN status='queued' THEN now() ELSE zero_velocity_confirmed_at END,
             finished_at = CASE WHEN status='queued' THEN now() ELSE finished_at END
       WHERE id=$1 AND status IN ('queued','running')
       RETURNING id, status`,
      [task.id],
    );
    if (!stopped.rowCount) throw httpError('Task cannot be stopped', 409);
    const nextStatus = stopped.rows[0].status;
    await db.query(
      "INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)",
      [
        randomUUID(),
        task.id,
        JSON.stringify({ status: nextStatus, source: 'operator', zeroVelocity: nextStatus === 'stopped' }),
      ],
    );
    await audit('patrol.stop', 'success', user.id, task.vehicle_id, { taskId: task.id });
    hub.publishPatrol?.({ type: 'patrol_status', taskId: task.id, vehicleId: task.vehicle_id, deviceId: task.vehicle_id, status: nextStatus });
    return { ok: true as const, status: nextStatus };
  });

  app.get('/api/patrol/status', async (request) => {
    const user = await requireUser(request);
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    if (deviceId) {
      if (!await canAccessVehicle(user, deviceId)) throw httpError('Vehicle access denied', 403);
      const result = await db.query<PatrolTaskRow>(
        `${TASK_SELECT} WHERE t.vehicle_id=$1 AND t.status IN ('queued','running','cancellation_requested') ORDER BY t.created_at DESC LIMIT 1`,
        [deviceId],
      );
      return { status: result.rows[0] ? taskDto(result.rows[0]) : null };
    }
    const result = await db.query<PatrolTaskRow>(
      `${TASK_SELECT} WHERE t.status IN ('queued','running','cancellation_requested') ORDER BY t.created_at DESC LIMIT 1`,
    );
    const row = result.rows[0];
    if (row && !await canAccessVehicle(user, row.vehicle_id)) return { status: null };
    return { status: row ? taskDto(row) : null };
  });

  app.get('/api/patrol/tasks', async (request) => {
    const user = await requireUser(request);
    const result = user.role === 'admin'
      ? await db.query<PatrolTaskRow>(`${TASK_SELECT} ORDER BY t.created_at DESC LIMIT 100`)
      : await db.query<PatrolTaskRow>(
        `${TASK_SELECT}
         JOIN vehicle_members m ON m.vehicle_id=t.vehicle_id
         WHERE m.user_id=$1
         ORDER BY t.created_at DESC LIMIT 100`,
        [user.id],
      );
    return { tasks: result.rows.map(taskDto) };
  });

  app.get('/api/patrol/tasks/:id', async (request) => {
    const user = await requireUser(request);
    const id = (request.params as { id: string }).id;
    const result = await db.query<PatrolTaskRow>(`${TASK_SELECT} WHERE t.id=$1`, [id]);
    const row = result.rows[0];
    if (!row) throw httpError('Task not found', 404);
    if (!await canAccessVehicle(user, row.vehicle_id)) throw httpError('Vehicle access denied', 403);
    return { task: taskDto(row) };
  });

  app.get('/api/patrol/tasks/:id/events', async (request) => {
    const user = await requireUser(request);
    const id = (request.params as { id: string }).id;
    const task = await db.query<{ vehicle_id: string }>('SELECT vehicle_id FROM patrol_tasks WHERE id=$1', [id]);
    if (!task.rows[0]) throw httpError('Task not found', 404);
    if (!await canAccessVehicle(user, task.rows[0].vehicle_id)) throw httpError('Vehicle access denied', 403);
    const events = await db.query(
      `SELECT id, task_id AS "taskId", plate, event_type AS "eventType", waypoint,
              confidence, evidence_url AS "evidenceUrl", review_status AS "reviewStatus",
              occurred_at AS "occurredAt",
              details->'plateMatch' AS "plateMatch"
       FROM patrol_events WHERE task_id=$1 ORDER BY occurred_at DESC`,
      [id],
    );
    const observations = await db.query(
      `SELECT id, waypoint_id AS "waypointId", occurred_at AS "occurredAt", plate, confidence,
              classification, no_parking AS "noParking", evidence_image_url AS "evidenceImageUrl",
              annotated_image_url AS "annotatedImageUrl", longitude, latitude,
              observation_count AS "observationCount", last_seen_at AS "lastSeenAt"
       FROM plate_observations WHERE task_id=$1 ORDER BY occurred_at DESC`,
      [id],
    );
    return {
      events: events.rows.map((row) => ({
        ...row,
        thumbnailUrl: (row as { evidenceUrl?: string }).evidenceUrl ?? null,
        verdict: (row as { reviewStatus?: string }).reviewStatus,
      })),
      observations: observations.rows,
    };
  });

  app.get('/api/patrol/tasks/:id/report', async (request) => {
    const user = await requireUser(request);
    const id = (request.params as { id: string }).id;
    const task = await db.query<PatrolTaskRow>(`${TASK_SELECT} WHERE t.id=$1`, [id]);
    if (!task.rows[0]) throw httpError('Task not found', 404);
    if (!await canAccessVehicle(user, task.rows[0].vehicle_id)) throw httpError('Vehicle access denied', 403);
    if (!['completed', 'failed', 'stopped'].includes(task.rows[0].status)) {
      throw httpError('Report is available after the patrol has finished', 409);
    }

    let report = await db.query<{
      id: string; task_id: string; html_content: string; csv_content: string; stats: Record<string, unknown>; created_at: Date;
    }>('SELECT * FROM patrol_reports WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [id]);

    if (!report.rows[0]) {
      const taskRow = task.rows[0];
      const observationStats = await db.query<{ classification: string; count: number; raw_count: number; no_parking: number }>(
        `SELECT classification, count(*)::int AS count, coalesce(sum(observation_count), 0)::int AS raw_count,
                count(*) FILTER (WHERE no_parking)::int AS no_parking
         FROM plate_observations WHERE task_id=$1 GROUP BY classification`,
        [id],
      );
      const counts = new Map(observationStats.rows.map((row) => [row.classification, row]));
      const observationCount = observationStats.rows.reduce((sum, row) => sum + row.count, 0);
      const rawObservationCount = observationStats.rows.reduce((sum, row) => sum + row.raw_count, 0);
      const noParkingCount = observationStats.rows.reduce((sum, row) => sum + row.no_parking, 0);
      const eventCount = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM patrol_events WHERE task_id=$1', [id]);
      const violationCount = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM violations WHERE task_id=$1', [id]);
      const responseStats = await db.query<{ total: number; completed: number; ai_used: number; average_seconds: number | null }>(
        `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status='completed')::int AS completed,
          count(*) FILTER (WHERE ai_suggestion<>'')::int AS ai_used,
          avg(extract(epoch FROM (completed_at-created_at))) FILTER (WHERE completed_at IS NOT NULL)::float8 AS average_seconds
         FROM response_tasks WHERE source_patrol_task_id=$1 AND notification_only=true`, [id],
      );
      const stats = {
        eventCount: eventCount.rows[0]?.c ?? 0,
        violationCount: violationCount.rows[0]?.c ?? 0,
        observationCount,
        rawObservationCount,
        registeredPrivate: counts.get('registered_private')?.count ?? 0,
        visitorCount: counts.get('visitor')?.count ?? 0,
        suspectedExternal: counts.get('suspected_external')?.count ?? 0,
        pendingReview: counts.get('pending_review')?.count ?? 0,
        noParkingCount,
        responseCount: responseStats.rows[0]?.total ?? 0,
        responseCompleted: responseStats.rows[0]?.completed ?? 0,
        responseAiAdviceCount: responseStats.rows[0]?.ai_used ?? 0,
        responseAverageSeconds: responseStats.rows[0]?.average_seconds ?? null,
        reviewConfidenceThreshold: taskRow.review_confidence_threshold ?? DEFAULT_PATROL_RULES.reviewConfidenceThreshold,
        dedupeWindowSec: taskRow.dedupe_window_sec ?? DEFAULT_PATROL_RULES.dedupeWindowSec,
        status: taskRow.status,
      };

      // FR-007: query evidence with waypoint names
      const evidenceRows = await db.query<{
        plate: string | null; classification: string; confidence: number; waypoint_name: string;
        no_parking: boolean; observation_count: number; occurred_at: Date;
        evidence_image_url: string | null; annotated_image_url: string | null;
      }>(
        `SELECT po.plate, po.classification, po.confidence, w.name AS waypoint_name,
                po.no_parking, po.observation_count, po.occurred_at,
                po.evidence_image_url, po.annotated_image_url
         FROM plate_observations po
         JOIN patrol_waypoints w ON w.id = po.waypoint_id
         WHERE po.task_id = $1
         ORDER BY po.occurred_at DESC`,
        [id],
      );
      const followupRows = evidenceRows.rows.filter((r) => r.classification === 'suspected_external' || r.no_parking);

      const esc = (s: string | null | undefined) =>
        String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const classLabel: Record<string, string> = {
        registered_private: '已登记私家车', visitor: '访客',
        suspected_external: '疑似外来', pending_review: '待审核',
      };
      const shiftLabel: Record<string, string> = { morning: '早班', afternoon: '午班', evening: '晚班' };
      const isoStr = (d: Date | null | undefined) =>
        d ? (d instanceof Date ? d.toISOString() : String(d)) : '—';

      const evidenceTableRows = evidenceRows.rows.map((r) =>
        `<tr><td>${esc(r.plate)}</td><td>${esc(classLabel[r.classification] ?? r.classification)}</td>` +
        `<td>${(r.confidence * 100).toFixed(0)}%</td><td>${esc(r.waypoint_name)}</td>` +
        `<td>${r.no_parking ? '是' : '否'}</td><td>${r.observation_count}</td>` +
        `<td>${esc(isoStr(r.occurred_at))}</td>` +
        `<td>${r.evidence_image_url ? `<a href="${esc(r.evidence_image_url)}">图片</a>` : '—'}` +
        `${r.annotated_image_url ? ` / <a href="${esc(r.annotated_image_url)}">标注</a>` : ''}</td></tr>`,
      ).join('');

      const followupTableRows = followupRows.map((r) =>
        `<tr><td>${esc(r.plate)}</td>` +
        `<td>${r.no_parking && r.classification === 'suspected_external' ? '违停+外来' : r.no_parking ? '违规停车' : '疑似外来'}</td>` +
        `<td>${esc(r.waypoint_name)}</td><td>${esc(isoStr(r.occurred_at))}</td>` +
        `<td>${r.evidence_image_url ? `<a href="${esc(r.evidence_image_url)}">图片</a>` : '—'}</td></tr>`,
      ).join('');

      const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>巡检报告</title>
<style>body{font-family:sans-serif;margin:2rem;color:#333}table{border-collapse:collapse;width:100%;margin-bottom:1.5rem}th,td{border:1px solid #ccc;padding:.4rem .8rem;text-align:left}th{background:#f5f5f5}h1{color:#1a1a1a}h2{color:#444;border-bottom:1px solid #ddd;padding-bottom:.3rem}</style>
</head><body>
<h1>巡牌通 · 巡检报告</h1>
<h2>任务元数据</h2>
<table>
<tr><th>任务 ID</th><td>${esc(taskRow.id)}</td></tr>
<tr><th>设备名称</th><td>${esc(taskRow.device_name)}</td></tr>
<tr><th>巡检路线</th><td>${esc(taskRow.route_name)}</td></tr>
<tr><th>班次</th><td>${esc(shiftLabel[taskRow.shift] ?? taskRow.shift)}</td></tr>
<tr><th>完成状态</th><td>${esc(taskRow.status)}</td></tr>
<tr><th>开始时间</th><td>${esc(isoStr(taskRow.started_at))}</td></tr>
<tr><th>结束时间</th><td>${esc(isoStr(taskRow.ended_at))}</td></tr>
</table>
<h2>统计摘要</h2>
<table>
<tr><th>分类</th><th>数量</th></tr>
<tr><td>已登记私家车</td><td>${stats.registeredPrivate}</td></tr>
<tr><td>访客车辆</td><td>${stats.visitorCount}</td></tr>
<tr><td>疑似外来车辆</td><td>${stats.suspectedExternal}</td></tr>
<tr><td>微信通知任务</td><td>${stats.responseCount}</td></tr>
<tr><td>已完成微信通知</td><td>${stats.responseCompleted}</td></tr>
<tr><td>已生成通知建议</td><td>${stats.responseAiAdviceCount}</td></tr>
<tr><td>平均通知耗时（秒）</td><td>${stats.responseAverageSeconds === null ? '—' : Math.round(stats.responseAverageSeconds as number)}</td></tr>
<tr><td>待人工审核</td><td>${stats.pendingReview}</td></tr>
<tr><td>违规停车</td><td>${stats.noParkingCount}</td></tr>
<tr><td>违规记录</td><td>${stats.violationCount}</td></tr>
<tr><td>去重后观测总数</td><td>${stats.observationCount}</td></tr>
<tr><td>原始帧数</td><td>${stats.rawObservationCount}</td></tr>
</table>
<h2>观测证据 (${evidenceRows.rows.length} 条)</h2>
<table>
<tr><th>车牌</th><th>分类</th><th>置信度</th><th>巡检点</th><th>违规停车</th><th>观测次数</th><th>发现时间</th><th>证据链接</th></tr>
${evidenceTableRows || '<tr><td colspan="8">无观测记录</td></tr>'}
</table>
<h2>物业跟进清单 (${followupRows.length} 项)</h2>
<table>
<tr><th>车牌</th><th>类型</th><th>巡检点</th><th>时间</th><th>证据链接</th></tr>
${followupTableRows || '<tr><td colspan="5">无需跟进项目</td></tr>'}
</table>
</body></html>`;

      const csvObsRows = evidenceRows.rows.map((r) =>
        `${r.plate ?? ''},${classLabel[r.classification] ?? r.classification},${(r.confidence * 100).toFixed(0)}%,${r.waypoint_name},${r.no_parking ? '是' : '否'},${r.observation_count},${isoStr(r.occurred_at)},${r.evidence_image_url ?? ''}`,
      ).join('\n');
      const csv = `任务元数据\n任务ID,${taskRow.id}\n设备名称,${taskRow.device_name ?? ''}\n路线,${taskRow.route_name ?? ''}\n班次,${shiftLabel[taskRow.shift] ?? taskRow.shift}\n状态,${taskRow.status}\n开始时间,${isoStr(taskRow.started_at)}\n结束时间,${isoStr(taskRow.ended_at)}\n\n统计摘要\n分类,数量\n已登记私家车,${stats.registeredPrivate}\n访客车辆,${stats.visitorCount}\n疑似外来车辆,${stats.suspectedExternal}\n待人工审核,${stats.pendingReview}\n违规停车,${stats.noParkingCount}\n违规记录,${stats.violationCount}\n去重后观测总数,${stats.observationCount}\n原始帧数,${stats.rawObservationCount}\n\n观测记录\n车牌,分类,置信度,巡检点,违规停车,观测次数,发现时间,证据图片\n${csvObsRows}\n`;

      const reportId = randomUUID();
      await db.query(
        'INSERT INTO patrol_reports (id, task_id, html_content, csv_content, stats) VALUES ($1,$2,$3,$4,$5)',
        [reportId, id, html, csv, JSON.stringify(stats)],
      );
      report = await db.query('SELECT * FROM patrol_reports WHERE id=$1', [reportId]);
    }

    const row = report.rows[0];
    return {
      report: {
        id: row.id,
        taskId: row.task_id,
        deviceName: task.rows[0].device_name,
        date: iso(row.created_at),
        violationCount: Number((row.stats as { violationCount?: number })?.violationCount ?? 0),
        htmlContent: row.html_content,
        csvContent: row.csv_content,
        stats: row.stats,
        summary: `Events: ${(row.stats as { eventCount?: number })?.eventCount ?? 0}`,
      },
    };
  });

  app.get('/api/patrol/routes', async (request) => {
    const user = await requireUser(request);
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    if (deviceId) {
      if (!await canAccessVehicle(user, deviceId)) throw httpError('Vehicle access denied', 403);
      await ensureDefaultRoute(db, deviceId, user.id);
    }
    const result = deviceId
      ? await db.query<{ id: string; name: string; c: number }>(
        `SELECT r.id, r.name, count(w.id)::int AS c
         FROM patrol_routes r LEFT JOIN patrol_waypoints w ON w.route_id=r.id
         WHERE r.vehicle_id=$1 GROUP BY r.id ORDER BY r.created_at`,
        [deviceId],
      )
      : user.role === 'admin'
      ? await db.query<{ id: string; name: string; c: number }>(
        `SELECT r.id, r.name, count(w.id)::int AS c
       FROM patrol_routes r
       LEFT JOIN patrol_waypoints w ON w.route_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at`,
      )
      : await db.query<{ id: string; name: string; c: number }>(
        `SELECT r.id, r.name, count(w.id)::int AS c
         FROM patrol_routes r
         JOIN vehicle_members m ON m.vehicle_id=r.vehicle_id AND m.user_id=$1
         LEFT JOIN patrol_waypoints w ON w.route_id=r.id
         GROUP BY r.id
         ORDER BY r.created_at`,
        [user.id],
      );
    return {
      routes: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        waypointCount: row.c,
      })),
    };
  });

  // --- Map ---
  app.get('/api/map', async (request) => {
    await requireUser(request);
    const meta = await ensureMapMetadata(db);
    return { name: meta.name, basemapUrl: meta.basemap_url };
  });

  // 楼道 SLAM 底图元数据（分辨率/原点/尺寸/图片）。图片以 data URL 存储于 basemap_url。
  app.get('/api/map/basemap', async (request) => {
    const user = await requireUser(request);
    const vehicleId = optionalString((request.query as { vehicleId?: string }).vehicleId) || null;
    if (vehicleId && !await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);
    const row = await loadFloorMap(db, vehicleId);
    return { basemap: mapMetaDto(row) };
  });

  app.post('/api/map/basemap', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    const vehicleId = optionalString(body?.vehicleId) || null;
    if (vehicleId) {
      const vehicle = await db.query('SELECT id FROM vehicles WHERE id=$1', [vehicleId]);
      if (!vehicle.rows[0]) throw httpError('Vehicle not found', 404);
    }
    const mapVersion = string(body?.mapVersion, 'mapVersion');
    const resolution = number(body?.resolution, 'resolution', 1e-6, 100);
    const originX = number(body?.originX, 'originX', -1e6, 1e6);
    const originY = number(body?.originY, 'originY', -1e6, 1e6);
    const originYaw = body?.originYaw === undefined ? 0 : number(body?.originYaw, 'originYaw', -Math.PI * 2, Math.PI * 2);
    const imageWidth = number(body?.imageWidth, 'imageWidth', 1, 100000);
    const imageHeight = number(body?.imageHeight, 'imageHeight', 1, 100000);
    const imageUrl = string(body?.imageDataUrl ?? body?.imageUrl, 'imageDataUrl');
    if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight)) throw httpError('imageWidth/imageHeight must be integers', 400);

    const name = optionalString(body?.name, '楼道地图');
    const rowId = randomUUID();
    // 每车最多一张底图（map_metadata_vehicle_idx）；全局图 vehicle_id 为空可多条，上传时先清再插。
    await db.transaction(async (client) => {
      if (vehicleId) {
        await client.query(
          `INSERT INTO map_metadata (id, vehicle_id, name, basemap_url, map_version, resolution, origin_x, origin_y, origin_yaw, image_width, image_height, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
           ON CONFLICT (vehicle_id) WHERE vehicle_id IS NOT NULL DO UPDATE SET
             name = EXCLUDED.name,
             basemap_url = EXCLUDED.basemap_url,
             map_version = EXCLUDED.map_version,
             resolution = EXCLUDED.resolution,
             origin_x = EXCLUDED.origin_x,
             origin_y = EXCLUDED.origin_y,
             origin_yaw = EXCLUDED.origin_yaw,
             image_width = EXCLUDED.image_width,
             image_height = EXCLUDED.image_height,
             updated_at = now()`,
          [rowId, vehicleId, name, imageUrl, mapVersion, resolution, originX, originY, originYaw, imageWidth, imageHeight],
        );
      } else {
        await client.query('DELETE FROM map_metadata WHERE vehicle_id IS NULL');
        await client.query(
          `INSERT INTO map_metadata (id, vehicle_id, name, basemap_url, map_version, resolution, origin_x, origin_y, origin_yaw, image_width, image_height, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
          [rowId, null, name, imageUrl, mapVersion, resolution, originX, originY, originYaw, imageWidth, imageHeight],
        );
      }
    });
    await audit('map.basemap.upload', 'success', admin.id, vehicleId ?? undefined, { mapVersion, imageWidth, imageHeight, resolution });
    const row = await loadFloorMap(db, vehicleId);
    return { basemap: mapMetaDto(row) };
  });

  app.get('/api/map/waypoints', async (request) => {
    const user = await requireUser(request);
    const query = request.query as { routeId?: string; vehicleId?: string };
    const routeId = query.routeId;
    const vehicleId = typeof query.vehicleId === 'string' ? query.vehicleId.trim() : '';
    if (routeId) {
      const route = await db.query<{ vehicle_id: string }>('SELECT vehicle_id FROM patrol_routes WHERE id=$1', [routeId]);
      if (!route.rows[0]) throw httpError('Route not found', 404);
      if (!await canAccessVehicle(user, route.rows[0].vehicle_id)) throw httpError('Vehicle access denied', 403);
    } else if (vehicleId) {
      if (!await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);
    }
    const result = routeId
      ? await db.query(
        `SELECT id, name, x AS longitude, y AS latitude, ordinal AS "order", route_id AS "routeId"
         FROM patrol_waypoints WHERE route_id=$1 ORDER BY ordinal`,
        [routeId],
      )
      : vehicleId
      ? await db.query(
        `SELECT w.id, w.name, w.x AS longitude, w.y AS latitude, w.ordinal AS "order", w.route_id AS "routeId"
         FROM patrol_waypoints w
         JOIN patrol_routes r ON r.id = w.route_id
         WHERE r.vehicle_id=$1
         ORDER BY r.created_at, w.ordinal`,
        [vehicleId],
      )
      : user.role === 'admin'
        ? await db.query(
          `SELECT id, name, x AS longitude, y AS latitude, ordinal AS "order", route_id AS "routeId"
           FROM patrol_waypoints ORDER BY route_id, ordinal`,
        )
        : await db.query(
          `SELECT w.id, w.name, w.x AS longitude, w.y AS latitude, w.ordinal AS "order", w.route_id AS "routeId"
           FROM patrol_waypoints w
           JOIN patrol_routes r ON r.id=w.route_id
           JOIN vehicle_members vm ON vm.vehicle_id=r.vehicle_id AND vm.user_id=$1
           ORDER BY w.route_id, w.ordinal`,
          [user.id],
        );
    return { waypoints: result.rows };
  });

  app.get('/api/map/zones', async (request) => {
    await requireUser(request);
    const result = await db.query<{ id: string; name: string; active: boolean; geojson: { type: string; coordinates: number[][][] } }>(
      `SELECT id, name, active, ST_AsGeoJSON(geom)::json AS geojson FROM map_zones ORDER BY created_at`,
    );
    return {
      zones: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
        coordinates: row.geojson?.coordinates?.[0] ?? [],
      })),
    };
  });

  app.post('/api/map/zones', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    const name = string(body?.name, 'name');
    const ring = normalizeRing(body?.coordinates);
    const id = randomUUID();
    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [ring] });
    await db.query(
      `INSERT INTO map_zones (id, name, geom) VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))`,
      [id, name, geojson],
    );
    await audit('map.zone.create', 'success', admin.id, undefined, { zoneId: id });
    return { zone: { id, name, active: true, coordinates: ring } };
  });

  app.put('/api/map/zones/:id', async (request) => {
    const admin = await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const body = object(request.body);
    const existing = await db.query('SELECT id FROM map_zones WHERE id=$1', [id]);
    if (!existing.rows[0]) throw httpError('Zone not found', 404);

    const name = typeof body?.name === 'string' ? body.name.trim() : null;
    const active = typeof body?.active === 'boolean' ? body.active : null;
    const ring = body?.coordinates !== undefined ? normalizeRing(body.coordinates) : null;
    const geojson = ring ? JSON.stringify({ type: 'Polygon', coordinates: [ring] }) : null;

    const result = await db.query<{ id: string; name: string; active: boolean; geojson: { coordinates: number[][][] } }>(
      `UPDATE map_zones SET
        name=COALESCE($1, name),
        active=COALESCE($2, active),
        geom=CASE WHEN $3::text IS NULL THEN geom ELSE ST_SetSRID(ST_GeomFromGeoJSON($3), 4326) END,
        updated_at=now()
       WHERE id=$4
       RETURNING id, name, active, ST_AsGeoJSON(geom)::json AS geojson`,
      [name, active, geojson, id],
    );
    await audit('map.zone.update', 'success', admin.id, undefined, { zoneId: id });
    const row = result.rows[0];
    return { zone: { id: row.id, name: row.name, active: row.active, coordinates: row.geojson?.coordinates?.[0] ?? [] } };
  });

  app.delete('/api/map/zones/:id', async (request) => {
    const admin = await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const result = await db.query('DELETE FROM map_zones WHERE id=$1 RETURNING id', [id]);
    if (!result.rows[0]) throw httpError('Zone not found', 404);
    await audit('map.zone.delete', 'success', admin.id, undefined, { zoneId: id });
    return { ok: true as const };
  });

  // --- Floor map no-parking zones (map-frame meters; not AMap map_zones) ---
  type FloorZoneRow = {
    id: string;
    vehicle_id: string;
    map_version: string;
    name: string;
    active: boolean;
    ring: unknown;
  };

  const floorZoneDto = (row: FloorZoneRow) => ({
    id: row.id,
    vehicleId: row.vehicle_id,
    mapVersion: row.map_version,
    name: row.name,
    active: row.active,
    ring: Array.isArray(row.ring) ? row.ring : [],
  });

  app.get('/api/vehicles/:id/floor-zones', async (request) => {
    const user = await requireUser(request);
    const vehicleId = (request.params as { id: string }).id;
    if (!await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);
    const mapVersion = typeof (request.query as { mapVersion?: string }).mapVersion === 'string'
      ? (request.query as { mapVersion?: string }).mapVersion!.trim()
      : '';
    const result = mapVersion
      ? await db.query<FloorZoneRow>(
        `SELECT id, vehicle_id, map_version, name, active, ring
         FROM floor_map_zones WHERE vehicle_id=$1 AND map_version=$2 ORDER BY created_at`,
        [vehicleId, mapVersion],
      )
      : await db.query<FloorZoneRow>(
        `SELECT id, vehicle_id, map_version, name, active, ring
         FROM floor_map_zones WHERE vehicle_id=$1 ORDER BY created_at`,
        [vehicleId],
      );
    return { zones: result.rows.map(floorZoneDto) };
  });

  app.get('/api/vehicles/:id/floor-zones/check', async (request) => {
    const user = await requireUser(request);
    const vehicleId = (request.params as { id: string }).id;
    if (!await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);
    const query = request.query as { mapVersion?: string; maxAgeSec?: string };
    const mapVersion = typeof query.mapVersion === 'string' && query.mapVersion.trim()
      ? query.mapVersion.trim()
      : null;
    const maxAgeSec = Math.min(Math.max(Number(query.maxAgeSec) || 10, 1), 120);
    const pose = await db.query<{ x: number; y: number; map_version: string | null; occurred_at: Date }>(
      `SELECT x, y, map_version, occurred_at FROM pose_points
       WHERE vehicle_id=$1 AND occurred_at >= now() - ($2::text || ' seconds')::interval
       ORDER BY occurred_at DESC LIMIT 1`,
      [vehicleId, String(maxAgeSec)],
    );
    if (!pose.rows[0]) {
      return { inNoParking: false, reason: 'no_recent_pose', pose: null, zone: null };
    }
    const version = mapVersion || pose.rows[0].map_version || 'floor-map-v1';
    const zones = await db.query<{ id: string; name: string; ring: unknown }>(
      `SELECT id, name, ring FROM floor_map_zones
       WHERE vehicle_id=$1 AND active=true AND map_version=$2`,
      [vehicleId, version],
    );
    const point = { x: Number(pose.rows[0].x), y: Number(pose.rows[0].y) };
    for (const zone of zones.rows) {
      const ring = parseRing(zone.ring);
      if (ring && pointInPolygon(point, ring)) {
        return {
          inNoParking: true,
          reason: 'inside_zone',
          pose: { x: point.x, y: point.y, mapVersion: version, occurredAt: pose.rows[0].occurred_at.toISOString() },
          zone: { id: zone.id, name: zone.name },
        };
      }
    }
    return {
      inNoParking: false,
      reason: 'outside_zones',
      pose: { x: point.x, y: point.y, mapVersion: version, occurredAt: pose.rows[0].occurred_at.toISOString() },
      zone: null,
    };
  });

  app.post('/api/vehicles/:id/floor-zones', async (request) => {
    const admin = await requireAdmin(request);
    const vehicleId = (request.params as { id: string }).id;
    const body = object(request.body) ?? {};
    const name = string(body.name, 'name').slice(0, 120);
    const mapVersion = (typeof body.mapVersion === 'string' && body.mapVersion.trim())
      ? body.mapVersion.trim().slice(0, 120)
      : 'floor-map-v1';
    const ring = parseRing(body.ring);
    if (!ring) throw httpError('ring must be an array of at least 3 [x,y] points', 400);
    const id = randomUUID();
    await db.query(
      `INSERT INTO floor_map_zones (id, vehicle_id, map_version, name, active, ring)
       VALUES ($1,$2,$3,$4,true,$5::jsonb)`,
      [id, vehicleId, mapVersion, name, JSON.stringify(ring.map((p) => [p.x, p.y]))],
    );
    await audit('floor_zone.create', 'success', admin.id, vehicleId, { zoneId: id, name, mapVersion });
    const row = await db.query<FloorZoneRow>(
      'SELECT id, vehicle_id, map_version, name, active, ring FROM floor_map_zones WHERE id=$1',
      [id],
    );
    return { zone: floorZoneDto(row.rows[0]) };
  });

  app.put('/api/vehicles/:id/floor-zones/:zoneId', async (request) => {
    const admin = await requireAdmin(request);
    const { id: vehicleId, zoneId } = request.params as { id: string; zoneId: string };
    const body = object(request.body) ?? {};
    const existing = await db.query('SELECT id FROM floor_map_zones WHERE id=$1 AND vehicle_id=$2', [zoneId, vehicleId]);
    if (!existing.rows[0]) throw httpError('Zone not found', 404);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : null;
    const active = typeof body.active === 'boolean' ? body.active : null;
    const ring = body.ring === undefined ? null : parseRing(body.ring);
    if (body.ring !== undefined && !ring) throw httpError('ring must be an array of at least 3 [x,y] points', 400);
    await db.query(
      `UPDATE floor_map_zones SET
         name=COALESCE($1,name),
         active=COALESCE($2,active),
         ring=COALESCE($3::jsonb,ring),
         updated_at=now()
       WHERE id=$4`,
      [name, active, ring ? JSON.stringify(ring.map((p) => [p.x, p.y])) : null, zoneId],
    );
    await audit('floor_zone.update', 'success', admin.id, vehicleId, { zoneId });
    const row = await db.query<FloorZoneRow>(
      'SELECT id, vehicle_id, map_version, name, active, ring FROM floor_map_zones WHERE id=$1',
      [zoneId],
    );
    return { zone: floorZoneDto(row.rows[0]) };
  });

  app.delete('/api/vehicles/:id/floor-zones/:zoneId', async (request) => {
    const admin = await requireAdmin(request);
    const { id: vehicleId, zoneId } = request.params as { id: string; zoneId: string };
    const result = await db.query(
      'DELETE FROM floor_map_zones WHERE id=$1 AND vehicle_id=$2 RETURNING id',
      [zoneId, vehicleId],
    );
    if (!result.rows[0]) throw httpError('Zone not found', 404);
    await audit('floor_zone.delete', 'success', admin.id, vehicleId, { zoneId });
    return { ok: true as const };
  });

  // --- Violations ---
  // Console plate-scan workbench: reject whitelist matches; otherwise create violation + review queue item.
  app.post('/api/violations/from-console-scan', { bodyLimit: 6 * 1024 * 1024 }, async (request) => {
    const user = await requireUser(request);
    const body = (request.body && typeof request.body === 'object' && !Array.isArray(request.body))
      ? request.body as Record<string, unknown>
      : {};
    const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId.trim() : '';
    if (!vehicleId) throw httpError('vehicleId is required', 400);
    if (!await canAccessVehicle(user, vehicleId)) throw httpError('Vehicle access denied', 403);

    let plate: string;
    try {
      plate = normalisePlate(body.plate);
    } catch {
      throw httpError('plate is invalid', 400);
    }

    const liveWhitelist = await db.query<{ id: string }>(
      `SELECT id FROM whitelist_imports
       WHERE vehicle_id IS NULL AND is_snapshot=false
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    let whitelistMatch: PlateMatchResult | null = null;
    if (liveWhitelist.rows[0]) {
      const entries = await db.query<{ plate: string; category: 'private' | 'visitor' }>(
        'SELECT plate, category FROM whitelist_entries WHERE whitelist_id=$1',
        [liveWhitelist.rows[0].id],
      );
      whitelistMatch = matchWhitelistPlate(plate, entries.rows);
    }

    const jpegRaw = typeof body.jpegBase64 === 'string' ? body.jpegBase64.trim() : '';
    if (!jpegRaw) throw httpError('jpegBase64 is required', 400);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(jpegRaw.replace(/^data:image\/jpeg;base64,/i, ''), 'base64');
    } catch {
      throw httpError('jpegBase64 is invalid', 400);
    }

    const confidence = typeof body.confidence === 'number' && Number.isFinite(body.confidence)
      ? Math.min(1, Math.max(0, body.confidence))
      : 0.5;
    const waypoint = typeof body.waypoint === 'string' && body.waypoint.trim()
      ? body.waypoint.trim().slice(0, 120)
      : '控制台自动识别';

    const mapVersionHint = typeof body.mapVersion === 'string' && body.mapVersion.trim()
      ? body.mapVersion.trim().slice(0, 120)
      : null;
    const pose = await db.query<{ x: number; y: number; map_version: string | null; occurred_at: Date }>(
      `SELECT x, y, map_version, occurred_at FROM pose_points
       WHERE vehicle_id=$1 AND occurred_at >= now() - interval '10 seconds'
       ORDER BY occurred_at DESC LIMIT 1`,
      [vehicleId],
    );
    let floorZoneId: string | null = null;
    let floorZoneName: string | null = null;
    let poseSnapshot: { x: number; y: number; mapVersion: string; occurredAt: string } | null = null;
    if (pose.rows[0]) {
      const version = mapVersionHint || pose.rows[0].map_version || 'floor-map-v1';
      poseSnapshot = {
        x: Number(pose.rows[0].x),
        y: Number(pose.rows[0].y),
        mapVersion: version,
        occurredAt: pose.rows[0].occurred_at.toISOString(),
      };
      const zones = await db.query<{ id: string; name: string; ring: unknown }>(
        `SELECT id, name, ring FROM floor_map_zones
         WHERE vehicle_id=$1 AND active=true AND map_version=$2`,
        [vehicleId, version],
      );
      for (const zone of zones.rows) {
        const ring = parseRing(zone.ring);
        if (ring && pointInPolygon({ x: poseSnapshot.x, y: poseSnapshot.y }, ring)) {
          floorZoneId = zone.id;
          floorZoneName = zone.name;
          break;
        }
      }
    }
    const inNoParking = Boolean(floorZoneId);
    const violationType = inNoParking ? 'no_parking' : 'suspected_external';
    if (whitelistMatch && !inNoParking) {
      return {
        recorded: false,
        deduplicated: false,
        reason: 'whitelist_normal',
        plateMatch: plateMatchDto(whitelistMatch),
        message: `白名单车辆 ${whitelistMatch.matchedPlate} 未处于禁停区，无需记录违规`,
      };
    }

    const route = await db.query<{ id: string; waypoint_id: string; waypoint_name: string }>(
      `SELECT r.id,w.id AS waypoint_id,w.name AS waypoint_name FROM patrol_routes r
       JOIN LATERAL (SELECT id,name FROM patrol_waypoints WHERE route_id=r.id ORDER BY ordinal LIMIT 1) w ON true
       WHERE r.vehicle_id=$1 ORDER BY r.created_at DESC LIMIT 1`,
      [vehicleId],
    );
    if (!route.rows[0]) {
      throw httpError('请先为该设备创建巡逻路线，识别审核需要挂接到任务事件', 409);
    }
    if (!liveWhitelist.rows[0]) {
      throw httpError('全局白名单为空；请先维护白名单后再测试', 409);
    }

    const saved = saveEvidenceJpeg(bytes, 'console-scan');
    const created = await db.transaction(async (client) => {
      const matchedPlate = whitelistMatch?.matchedPlate ?? plate;
      const bucket = new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000);
      const dedupeKey = `${matchedPlate}:${inNoParking ? floorZoneId : 'outside'}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${vehicleId}:${dedupeKey}:${bucket.toISOString()}`]);
      const duplicate = await client.query<{ id: string; event_id: string | null; observation_id: string | null }>(
        'SELECT id,event_id,observation_id FROM violations WHERE vehicle_id=$1 AND dedupe_key=$2 AND dedupe_bucket=$3 LIMIT 1',
        [vehicleId, dedupeKey, bucket],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].observation_id) {
          await client.query(
            `UPDATE plate_observations SET
               observation_count=observation_count+1,
               last_seen_at=now(),
               evidence_image_url=CASE WHEN $2>=confidence THEN $3 ELSE evidence_image_url END,
               confidence=GREATEST(confidence,$2)
             WHERE id=$1`,
            [duplicate.rows[0].observation_id, confidence, saved.publicPath],
          );
          await client.query(
            `UPDATE violations v SET evidence_url=o.evidence_image_url
             FROM plate_observations o WHERE v.id=$1 AND o.id=$2`,
            [duplicate.rows[0].id, duplicate.rows[0].observation_id],
          );
        }
        return {
          taskId: null,
          violationId: duplicate.rows[0].id,
          eventId: duplicate.rows[0].event_id,
          reviewId: null,
          observationId: duplicate.rows[0].observation_id,
          deduplicated: true,
        };
      }
      const taskId = randomUUID();
      const eventId = randomUUID();
      const reviewId = randomUUID();
      const violationId = randomUUID();
      const observationId = randomUUID();

      await client.query(
        `INSERT INTO patrol_tasks
           (id, vehicle_id, route_id, whitelist_id, shift, status, created_by_user_id, started_at, finished_at)
         VALUES ($1, $2, $3, $4, 'morning', 'completed', $5, now(), now())`,
        [taskId, vehicleId, route.rows[0].id, liveWhitelist.rows[0].id, user.id],
      );
      await client.query(
        `INSERT INTO patrol_events
           (id, task_id, event_type, waypoint, plate, confidence, evidence_url, review_status, occurred_at, details)
         VALUES ($1, $2, 'observation', $3, $4, $5, $6, 'pending', now(), $7)`,
        [
          eventId,
          taskId,
          waypoint,
          plate,
          confidence,
          saved.publicPath,
          JSON.stringify({
            source: 'console_scan',
            vehicleId,
            plateMatch: plateMatchDto(whitelistMatch),
            inNoParking,
            floorZoneId,
            floorZoneName,
            pose: poseSnapshot,
          }),
        ],
      );
      await client.query(
        `INSERT INTO reviews (id, event_id, reason, status)
         VALUES ($1, $2, 'console_scan', 'pending')`,
        [reviewId, eventId],
      );
      await client.query(
        `INSERT INTO plate_observations
           (id,task_id,waypoint_id,occurred_at,dedupe_bucket,dedupe_key,plate,confidence,classification,no_parking,evidence_image_url,last_seen_at)
         VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,now())`,
        [observationId, taskId, route.rows[0].waypoint_id, bucket, dedupeKey, plate, confidence,
          confidence < 0.75 ? 'pending_review' : whitelistMatch?.category === 'private' ? 'registered_private' : whitelistMatch?.category === 'visitor' ? 'visitor' : 'suspected_external',
          inNoParking, saved.publicPath],
      );
      if (confidence >= 0.75) await client.query(
        `INSERT INTO violations
           (id,event_id,observation_id,plate,violation_type,task_id,vehicle_id,waypoint,priority,disposition,evidence_url,occurred_at,floor_zone_id,source,dedupe_key,dedupe_bucket)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,now(),$11,'console_scan',$12,$13)`,
        [
          violationId,
          eventId,
          observationId,
          matchedPlate,
          violationType,
          taskId,
          vehicleId,
          waypoint,
          inNoParking ? 'high' : 'normal',
          saved.publicPath,
          floorZoneId,
          dedupeKey,
          bucket,
        ],
      );
      return { taskId, eventId, reviewId, violationId: confidence >= 0.75 ? violationId : null, observationId, deduplicated: false };
    });

    if (!created.deduplicated && created.violationId && created.observationId && whitelistMatch?.category === 'private' && inNoParking) {
      await createResponseCandidate(db, { publishPatrol: (message) => hub.publishPatrol?.(message) }, {
        observationId: created.observationId,
        taskId: created.taskId as string,
        vehicleId,
        plate,
        matchedPlate: whitelistMatch.matchedPlate,
        plateMatch: whitelistMatch,
        confidence,
        noParking: true,
        evidenceUrl: saved.publicPath,
        violationId: created.violationId,
      });
    }

    if (created.violationId && !created.deduplicated) hub.publishPatrol?.({
      type: 'violation_alert',
      violationId: created.violationId,
      vehicleId,
      plate,
      evidenceUrl: saved.publicPath,
      source: 'console_scan',
      confidence,
      eventId: created.eventId,
      inNoParking,
      floorZoneId,
    });
    await audit('violation.console_scan', created.deduplicated ? 'deduplicated' : 'success', user.id, vehicleId, {
      violationId: created.violationId,
      eventId: created.eventId,
      reviewId: created.reviewId,
      plate,
      evidenceUrl: saved.publicPath,
      confidence,
      inNoParking,
      floorZoneId,
    });
    return {
      recorded: Boolean(created.violationId),
      deduplicated: created.deduplicated,
      reason: created.violationId ? 'violation_recorded' : 'pending_review',
      plateMatch: plateMatchDto(whitelistMatch),
      violation: {
        id: created.violationId,
        plate,
        evidenceUrl: saved.publicPath,
        deviceId: vehicleId,
        waypoint,
        status: 'pending',
        type: violationType,
        zoneName: floorZoneName,
      },
      review: {
        id: created.reviewId,
        eventId: created.eventId,
      },
      noParking: {
        inNoParking,
        pose: poseSnapshot,
        zone: floorZoneId ? { id: floorZoneId, name: floorZoneName } : null,
        reason: inNoParking ? 'inside_zone' : (poseSnapshot ? 'outside_zones' : 'no_recent_pose'),
      },
    };
  });

  // Observation coords preferred; else nearest telemetry within ±60s of violation time.
  const VIOLATION_FROM = `
       FROM violations v
       LEFT JOIN map_zones z ON z.id = v.zone_id
       LEFT JOIN response_tasks rt ON rt.violation_id = v.id
       LEFT JOIN plate_observations po ON po.id = COALESCE(rt.observation_id, (
         SELECT po2.id FROM plate_observations po2
         WHERE po2.task_id = v.task_id AND (v.plate IS NULL OR po2.plate = v.plate)
         ORDER BY po2.occurred_at DESC LIMIT 1
       ))
       LEFT JOIN patrol_tasks pt ON pt.id = v.task_id
       LEFT JOIN whitelist_entries we ON we.whitelist_id = pt.whitelist_id
         AND v.plate IS NOT NULL AND we.plate = v.plate
       LEFT JOIN LATERAL (
         SELECT t.longitude, t.latitude
         FROM telemetry_points t
         WHERE t.vehicle_id = v.vehicle_id
           AND t.occurred_at BETWEEN v.occurred_at - interval '60 seconds'
                                AND v.occurred_at + interval '60 seconds'
         ORDER BY ABS(EXTRACT(EPOCH FROM (t.occurred_at - v.occurred_at)))
         LIMIT 1
       ) tp ON true`;
  const VIOLATION_SELECT = `
       SELECT v.id, v.plate, v.violation_type AS type, v.waypoint, v.priority, v.disposition AS status,
              v.evidence_url AS "evidenceUrl", v.occurred_at AS "occurredAt",
              v.task_id AS "taskId", v.vehicle_id AS "deviceId", z.name AS "zoneName",
              COALESCE(po.longitude, tp.longitude) AS longitude,
              COALESCE(po.latitude, tp.latitude) AS latitude,
              CASE
                WHEN po.longitude IS NOT NULL AND po.latitude IS NOT NULL THEN 'observation'
                WHEN tp.longitude IS NOT NULL AND tp.latitude IS NOT NULL THEN 'telemetry'
                ELSE 'none'
              END AS "coordinateSource",
              we.owner_name AS "ownerName", we.building, we.parking_spot AS "parkingSpot",
              po.confidence`;

  app.get('/api/violations', async (request) => {
    const user = await requireUser(request);
    const query = request.query as {
      disposition?: string;
      priority?: string;
      plate?: string;
      taskId?: string;
      vehicleId?: string;
    };
    const clauses: string[] = [];
    const values: unknown[] = [];
    const push = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replace('?', `$${values.length}`));
    };
    if (query.disposition) push('v.disposition=?', query.disposition);
    if (query.priority) push('v.priority=?', query.priority);
    if (query.plate) push('v.plate ILIKE ?', `%${query.plate}%`);
    if (query.taskId) push('v.task_id=?', query.taskId);
    if (query.vehicleId) {
      if (!await canAccessVehicle(user, query.vehicleId)) throw httpError('Vehicle access denied', 403);
      push('v.vehicle_id=?', query.vehicleId);
    }
    if (user.role !== 'admin') push('EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.vehicle_id AND vm.user_id=?)', user.id);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
      `${VIOLATION_SELECT}
       ${VIOLATION_FROM}
       ${where}
       ORDER BY v.occurred_at DESC
       LIMIT 200`,
      values,
    );
    return { violations: result.rows };
  });

  app.get('/api/violations/:event_id', async (request) => {
    const user = await requireUser(request);
    const eventId = (request.params as { event_id: string }).event_id;
    const result = await db.query(
      `${VIOLATION_SELECT},
              v.event_id AS "eventId"
       ${VIOLATION_FROM}
       WHERE (v.id=$1 OR v.event_id=$1)
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.vehicle_id AND vm.user_id=$2))
       LIMIT 1`,
      [eventId, user.role === 'admin' ? null : user.id],
    );
    if (!result.rows[0]) throw httpError('Violation not found', 404);
    return { violation: result.rows[0] };
  });

  // --- Reviews ---
  app.get('/api/reviews/pending', async (request) => {
    const user = await requireUser(request);
    const result = await db.query(
      `SELECT r.id, r.event_id AS "eventId", r.reason, r.created_at AS "occurredAt",
              e.plate, e.waypoint, e.evidence_url AS "evidenceUrl", e.confidence,
              e.details->'plateMatch' AS "plateMatch",
              v.name AS "deviceName"
       FROM reviews r
       JOIN patrol_events e ON e.id = r.event_id
       JOIN patrol_tasks t ON t.id = e.task_id
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE r.status='pending'
         AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$1))
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [user.role === 'admin' ? null : user.id],
    );
    return { reviews: result.rows };
  });

  app.post('/api/reviews/:event_id/resolve', async (request) => {
    const user = await requireUser(request);
    const eventId = (request.params as { event_id: string }).event_id;
    const body = object(request.body);
    const resolutionInput = typeof body?.resolution === 'string' ? body.resolution : body?.action;
    const resolution = string(resolutionInput, 'resolution');
    const plate = typeof body?.plate === 'string' ? body.plate.trim() : null;
    if (resolution === 'whitelist' && user.role !== 'admin') throw httpError('Administrator role required to update whitelist', 403);

    const reviewStatus =
      resolution === 'confirmed' || resolution === 'confirm' || resolution === 'false_positive' || resolution === 'whitelist' || resolution === 'external' || resolution === 'visitor'
        ? resolution === 'confirm' ? 'confirmed' : resolution === 'visitor' ? 'external' : resolution
        : 'confirmed';

    const event = await db.query<{ vehicle_id: string }>('SELECT t.vehicle_id FROM patrol_events e JOIN patrol_tasks t ON t.id=e.task_id WHERE e.id=$1', [eventId]);
    if (!event.rows[0]) throw httpError('Event not found', 404);
    if (!await canAccessVehicle(user, event.rows[0].vehicle_id)) throw httpError('Vehicle access denied', 403);

    const violationDisposition =
      reviewStatus === 'confirmed' ? 'confirmed'
        : reviewStatus === 'false_positive' ? 'false_positive'
          : reviewStatus === 'whitelist' || reviewStatus === 'external' ? 'resolved'
            : 'confirmed';

    await db.transaction(async (client) => {
      await client.query(
        `UPDATE reviews SET status='resolved', resolver_id=$1, resolution=$2, resolved_at=now()
         WHERE event_id=$3 AND status='pending'`,
        [user.id, resolution, eventId],
      );
      await client.query(
        `UPDATE patrol_events SET review_status=$1, plate=COALESCE($2, plate) WHERE id=$3`,
        [reviewStatus, plate, eventId],
      );
      // Keep violations list in sync with review outcomes (confirm / false_positive / whitelist / visitor).
      await client.query(
        `UPDATE violations SET disposition=$1 WHERE event_id=$2`,
        [violationDisposition, eventId],
      );
      if (resolution === 'whitelist' && plate) {
        const whitelistId = await ensureGlobalWhitelist(client, user);
        await client.query(
          `INSERT INTO whitelist_entries (id, whitelist_id, plate, owner_name, building, category)
           VALUES ($1,$2,$3,$4,$5,'private')
           ON CONFLICT (whitelist_id, plate) DO NOTHING`,
          [randomUUID(), whitelistId, plate.toUpperCase(), '', ''],
        );
      }
    });
    await audit('review.resolve', 'success', user.id, event.rows[0].vehicle_id, { eventId, resolution, plate, violationDisposition });
    return { ok: true as const };
  });

  // --- Whitelist ---
  app.get('/api/whitelist', async (request) => {
    await requireAdmin(request);
    const q = typeof (request.query as { q?: string }).q === 'string'
      ? (request.query as { q: string }).q.trim()
      : '';
    const values: unknown[] = [];
    let where = `WHERE ${WHITELIST_LIVE_CLAUSE}`;
    if (q) {
      values.push(`%${q}%`);
      where += ` AND (
        e.plate ILIKE $1 OR e.owner_name ILIKE $1 OR e.building ILIKE $1 OR e.parking_spot ILIKE $1
        OR e.wx_uid ILIKE $1
      )`;
    }
    const result = await db.query<WhitelistEntryRow>(
      `${WHITELIST_ENTRY_SELECT} ${where} ORDER BY e.plate`,
      values,
    );
    return { entries: result.rows.map(whitelistEntryDto) };
  });

  app.get('/api/whitelist/:id', async (request) => {
    await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const result = await db.query<WhitelistEntryRow>(
      `${WHITELIST_ENTRY_SELECT} WHERE ${WHITELIST_LIVE_CLAUSE} AND e.id=$1 LIMIT 1`,
      [id],
    );
    if (!result.rows[0]) throw httpError('Whitelist entry not found', 404);
    return { entry: whitelistEntryDto(result.rows[0]) };
  });

  app.post('/api/whitelist', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    const plate = string(body?.plate, 'plate').toUpperCase();
    const owner = optionalString(body?.owner);
    const building = optionalString(body?.building);
    const parkingSpot = optionalString(body?.parkingSpot ?? body?.slot);
    const wxUid = optionalWxUid(body?.wxUid ?? body?.wx_uid);
    const vehicleTypeRaw = optionalString(body?.vehicleType, 'private');
    if (vehicleTypeRaw !== 'private' && vehicleTypeRaw !== 'visitor') throw httpError('vehicleType is invalid', 400);
    const vehicleType = vehicleTypeRaw;
    const validUntil = optionalValidUntil(body?.validUntil ?? body?.expiresAt);
    const entry = await db.transaction(async (client) => {
      const whitelistId = await ensureGlobalWhitelist(client, admin);
      const result = await client.query<WhitelistEntryRow>(
        `INSERT INTO whitelist_entries (id, whitelist_id, plate, owner_name, building, category, parking_spot, valid_until, wx_uid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (whitelist_id, plate) DO UPDATE SET
           owner_name=EXCLUDED.owner_name, building=EXCLUDED.building, category=EXCLUDED.category,
           parking_spot=EXCLUDED.parking_spot, valid_until=EXCLUDED.valid_until, wx_uid=EXCLUDED.wx_uid
         RETURNING id, plate, owner_name AS owner, building, parking_spot AS "parkingSpot",
                   wx_uid AS "wxUid", category AS "vehicleType", valid_until AS "validUntil"`,
        [randomUUID(), whitelistId, plate, owner, building, vehicleType, parkingSpot, validUntil, wxUid],
      );
      return result.rows[0];
    });
    await audit('whitelist.create', 'success', admin.id, undefined, { plate });
    return {
      entry: whitelistEntryDto(entry),
    };
  });

  app.put('/api/whitelist/:id', async (request) => {
    const admin = await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const body = object(request.body);
    const existing = await db.query<{ id: string; whitelist_id: string }>(
      `SELECT e.id, e.whitelist_id
       FROM whitelist_entries e JOIN whitelist_imports i ON i.id=e.whitelist_id
       WHERE e.id=$1 AND ${WHITELIST_LIVE_CLAUSE} LIMIT 1`,
      [id],
    );
    if (!existing.rows[0]) throw httpError('Whitelist entry not found', 404);

    const plate = body?.plate !== undefined ? string(body.plate, 'plate').toUpperCase() : null;
    const owner = body?.owner !== undefined ? optionalString(body.owner) : null;
    const building = body?.building !== undefined ? optionalString(body.building) : null;
    const parkingSpot = body?.parkingSpot !== undefined || body?.slot !== undefined
      ? optionalString(body?.parkingSpot ?? body?.slot)
      : null;
    const wxUid = body?.wxUid !== undefined || body?.wx_uid !== undefined
      ? optionalWxUid(body?.wxUid ?? body?.wx_uid)
      : null;
    const vehicleTypeRaw = body?.vehicleType !== undefined ? optionalString(body.vehicleType, 'private') : null;
    if (vehicleTypeRaw !== null && vehicleTypeRaw !== 'private' && vehicleTypeRaw !== 'visitor') {
      throw httpError('vehicleType is invalid', 400);
    }
    const validUntil = body?.validUntil !== undefined || body?.expiresAt !== undefined
      ? optionalValidUntil(body?.validUntil ?? body?.expiresAt)
      : undefined;

    try {
      const result = await db.query<WhitelistEntryRow>(
        `UPDATE whitelist_entries SET
           plate=COALESCE($1, plate),
           owner_name=COALESCE($2, owner_name),
           building=COALESCE($3, building),
           category=COALESCE($4, category),
           parking_spot=COALESCE($5, parking_spot),
           valid_until=CASE WHEN $6::boolean THEN $7::timestamptz ELSE valid_until END,
           wx_uid=COALESCE($8, wx_uid)
         WHERE id=$9
         RETURNING id, plate, owner_name AS owner, building, parking_spot AS "parkingSpot",
                   wx_uid AS "wxUid", category AS "vehicleType", valid_until AS "validUntil"`,
        [
          plate,
          owner,
          building,
          vehicleTypeRaw,
          parkingSpot,
          validUntil !== undefined,
          validUntil ?? null,
          wxUid,
          id,
        ],
      );
      await audit('whitelist.update', 'success', admin.id, undefined, { entryId: id, plate: result.rows[0].plate });
      return { entry: whitelistEntryDto(result.rows[0]) };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw httpError('Plate already exists in whitelist', 409);
      throw error;
    }
  });

  app.delete('/api/whitelist/:id', async (request) => {
    const admin = await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const result = await db.query(
      `DELETE FROM whitelist_entries e
       USING whitelist_imports i
       WHERE e.whitelist_id=i.id AND e.id=$1 AND ${WHITELIST_LIVE_CLAUSE}
       RETURNING e.id, e.plate`,
      [id],
    );
    if (!result.rows[0]) throw httpError('Whitelist entry not found', 404);
    await audit('whitelist.delete', 'success', admin.id, undefined, { entryId: id, plate: result.rows[0].plate });
    return { ok: true as const };
  });

  app.post('/api/whitelist/import', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    type RowIn = {
      plate?: string; owner?: string; building?: string; slot?: string; parkingSpot?: string;
      wxUid?: string; wx_uid?: string; vehicleType?: string; expiresAt?: string; validUntil?: string;
    };
    let rows: RowIn[] = [];

    if (Array.isArray(body?.rows)) {
      rows = body.rows as RowIn[];
    } else if (typeof body?.csv === 'string') {
      const lines = body.csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const header = lines[0]?.toLowerCase() ?? '';
      const hasHeader = header.includes('plate');
      const headers = hasHeader ? header.split(/[,;\t]/).map((c) => c.trim()) : [];
      const start = hasHeader ? 1 : 0;
      for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(/[,;\t]/).map((c) => c.trim());
        if (hasHeader) {
          const idx = (name: string) => headers.indexOf(name);
          rows.push({
            plate: cols[idx('plate')],
            owner: cols[idx('owner')] ?? '',
            building: cols[idx('building')] ?? '',
            parkingSpot: cols[idx('parkingspot')] ?? cols[idx('slot')] ?? '',
            wxUid: cols[idx('wxuid')] ?? '',
            vehicleType: cols[idx('vehicletype')] ?? 'private',
            expiresAt: cols[idx('validuntil')] || cols[idx('expiresat')] || undefined,
          });
        } else {
          // plate,owner,building,parkingSpot,wxUid,vehicleType,validUntil
          rows.push({
            plate: cols[0],
            owner: cols[1] ?? '',
            building: cols[2] ?? '',
            parkingSpot: cols[3] ?? '',
            wxUid: cols[4] ?? '',
            vehicleType: cols[5] ?? 'private',
            expiresAt: cols[6] || undefined,
          });
        }
      }
    } else {
      throw httpError('rows or csv is required', 400);
    }

    let success = 0;
    let failed = 0;
    const errors: Array<{ index: number; plate?: string; error: string }> = [];
    const validRows: Array<{
      plate: string; owner: string; building: string; parkingSpot: string;
      wxUid: string; vehicleType: 'private' | 'visitor'; validUntil: string | null;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const plate = string(row.plate, 'plate').toUpperCase();
        const owner = optionalString(row.owner);
        const building = optionalString(row.building);
        const parkingSpot = optionalString(row.parkingSpot ?? row.slot);
        const wxUid = optionalWxUid(row.wxUid ?? row.wx_uid);
        const vehicleTypeRaw = optionalString(row.vehicleType, 'private');
        if (vehicleTypeRaw !== 'private' && vehicleTypeRaw !== 'visitor') throw httpError('vehicleType is invalid', 400);
        const validUntil = optionalValidUntil(row.validUntil ?? row.expiresAt);
        validRows.push({ plate, owner, building, parkingSpot, wxUid, vehicleType: vehicleTypeRaw, validUntil });
        success++;
      } catch (error) {
        failed++;
        errors.push({ index: i, plate: row.plate, error: error instanceof Error ? error.message : 'import failed' });
      }
    }

    await db.transaction(async (client) => {
      const whitelistId = await ensureGlobalWhitelist(client, admin);
      for (const row of validRows) {
        await client.query(
          `INSERT INTO whitelist_entries (id, whitelist_id, plate, owner_name, building, category, parking_spot, valid_until, wx_uid)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (whitelist_id, plate) DO UPDATE SET
             owner_name=EXCLUDED.owner_name, building=EXCLUDED.building, category=EXCLUDED.category,
             parking_spot=EXCLUDED.parking_spot, valid_until=EXCLUDED.valid_until, wx_uid=EXCLUDED.wx_uid`,
          [randomUUID(), whitelistId, row.plate, row.owner, row.building, row.vehicleType, row.parkingSpot, row.validUntil, row.wxUid],
        );
      }
    });

    await audit('whitelist.import', 'success', admin.id, undefined, { success, failed });
    return { imported: success, failed, errors };
  });

  // --- Reports ---
  app.get('/api/reports', async (request) => {
    const user = await requireUser(request);
    const result = await db.query(
      `SELECT pr.id, pr.task_id AS "taskId", pr.stats, pr.created_at AS "createdAt",
              v.name AS "deviceName", t.started_at AS "startedAt"
       FROM patrol_reports pr
       JOIN patrol_tasks t ON t.id = pr.task_id
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$1))
       ORDER BY pr.created_at DESC
       LIMIT 100`,
      [user.role === 'admin' ? null : user.id],
    );
    return {
      reports: result.rows.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        deviceName: row.deviceName,
        date: iso(row.createdAt as Date),
        violationCount: Number((row.stats as { violationCount?: number })?.violationCount ?? 0),
        visitorCount: Number((row.stats as { visitorCount?: number })?.visitorCount ?? 0),
        stats: row.stats,
      })),
    };
  });

  app.get('/api/reports/:id', async (request) => {
    const user = await requireUser(request);
    const id = (request.params as { id: string }).id;
    const result = await db.query(
      `SELECT pr.id, pr.task_id AS "taskId", pr.html_content AS "htmlContent", pr.csv_content AS "csvContent",
              pr.stats, pr.created_at AS "createdAt", v.name AS "deviceName"
       FROM patrol_reports pr
       JOIN patrol_tasks t ON t.id = pr.task_id
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE pr.id=$1
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$2))`,
      [id, user.role === 'admin' ? null : user.id],
    );
    if (!result.rows[0]) throw httpError('Report not found', 404);
    const row = result.rows[0];
    return {
      report: {
        id: row.id,
        taskId: row.taskId,
        deviceName: row.deviceName,
        date: iso(row.createdAt as Date),
        htmlContent: row.htmlContent,
        csvContent: row.csvContent,
        stats: row.stats,
        violationCount: Number((row.stats as { violationCount?: number })?.violationCount ?? 0),
      },
    };
  });

  // --- Settings ---
  app.get('/api/settings', async (request) => {
    await requireUser(request);
    const result = await db.query<{ key: string; value: unknown; updated_at: Date }>(
      'SELECT key, value, updated_at FROM platform_settings ORDER BY key',
    );
    const settings = patrolRules(result.rows);
    return { settings, entries: result.rows.map((row) => ({ key: row.key, value: row.value, updatedAt: iso(row.updated_at) })) };
  });

  app.put('/api/settings', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    if (!body) throw httpError('body is required', 400);
    const settings = object(body.settings) ?? body;
    const allowed = new Set(['reviewConfidenceThreshold', 'dedupeWindowSec']);
    if (!Object.keys(settings).length || Object.keys(settings).some((key) => !allowed.has(key))) {
      throw httpError('Only reviewConfidenceThreshold and dedupeWindowSec can be updated', 400);
    }
    const upserts: Array<{ key: string; value: unknown }> = [];
    if (settings.reviewConfidenceThreshold !== undefined) {
      upserts.push({ key: 'reviewConfidenceThreshold', value: number(settings.reviewConfidenceThreshold, 'reviewConfidenceThreshold', 0, 1) });
    }
    if (settings.dedupeWindowSec !== undefined) {
      upserts.push({ key: 'dedupeWindowSec', value: number(settings.dedupeWindowSec, 'dedupeWindowSec', 60, 86_400) });
    }

    for (const entry of upserts) {
      await db.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [entry.key, JSON.stringify(entry.value ?? {})],
      );
    }
    await audit('settings.update', 'success', admin.id, undefined, { keys: upserts.map((e) => e.key) });
    return { ok: true as const };
  });

  // --- WebSocket /patrol/live ---
  app.get('/patrol/live', { websocket: true }, async (socket, request) => {
    if (!isTrustedOrigin(request.headers.origin)) {
      socket.close(1008, 'Untrusted WebSocket origin');
      return;
    }
    let user: RouteUser & AuthUser;
    try {
      user = await requireUser(request);
    } catch {
      socket.close(1008, 'Authentication required');
      return;
    }

    let unsubscribe: (() => void) | undefined;
    socket.on('message', async (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; vehicleId?: string };
        if (message.type !== 'subscribe' || !message.vehicleId) {
          socket.send(JSON.stringify({ type: 'error', message: 'Expected { type:"subscribe", vehicleId }' }));
          return;
        }
        if (!await canAccessVehicle(user, message.vehicleId)) {
          socket.send(JSON.stringify({ type: 'error', message: 'Vehicle access denied' }));
          return;
        }
        unsubscribe?.();
        if (hub.subscribePatrol) {
          unsubscribe = hub.subscribePatrol(socket, message.vehicleId);
        } else {
          // Fallback: mirror pose via hub.publish channel by wrapping subscribe if only publish exists
          const vehicleId = message.vehicleId;
          const handler = { send: (value: string) => {
            try {
              const parsed = JSON.parse(value) as { type?: string; vehicleId?: string; payload?: Record<string, unknown> };
              if (parsed.type === 'vehicle.position' && parsed.vehicleId === vehicleId) {
                socket.send(JSON.stringify({ type: 'pose_update', vehicleId, ...(parsed.payload ?? {}) }));
              }
            } catch {
              socket.send(value);
            }
          } };
          // No vehicle-scoped subscribe without hub extension; acknowledge only.
          void handler;
          unsubscribe = () => undefined;
        }
        socket.send(JSON.stringify({ type: 'subscribed', vehicleId: message.vehicleId }));

        const pose = await db.query<{ longitude: number; latitude: number; heading_deg: number | null; occurred_at: Date }>(
          `SELECT longitude, latitude, heading_deg, occurred_at FROM telemetry_points
           WHERE vehicle_id=$1 ORDER BY occurred_at DESC LIMIT 1`,
          [message.vehicleId],
        );
        if (pose.rows[0]) {
          socket.send(JSON.stringify({
            type: 'pose_update',
            vehicleId: message.vehicleId,
            longitude: pose.rows[0].longitude,
            latitude: pose.rows[0].latitude,
            headingDeg: pose.rows[0].heading_deg,
            occurredAt: iso(pose.rows[0].occurred_at),
          }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
      }
    });
    socket.on('close', () => unsubscribe?.());
  });
}
