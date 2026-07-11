import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { Database } from '../db/index.js';

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
  route_id: string | null;
  shift: string;
  status: string;
  progress_done: number;
  progress_total: number;
  started_at: Date | null;
  ended_at: Date | null;
  created_by: string | null;
  created_at: Date;
  device_name?: string;
  route_name?: string;
  event_count?: number;
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
  hub: {
    publish: (vehicleId: string, payload: unknown) => void;
    publishPatrol?: (msg: unknown) => void;
    subscribePatrol?: (socket: { send: (value: string) => void }, vehicleId?: string) => () => void;
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

function deviceDto(row: DeviceRow) {
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

async function ensureDefaultRoute(db: Database): Promise<void> {
  const count = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM patrol_routes');
  if ((count.rows[0]?.c ?? 0) > 0) return;
  const routeId = randomUUID();
  await db.query(
    `INSERT INTO patrol_routes (id, code, name, description) VALUES ($1, 'route_morning_a', '早班路线 A', 'Default demo route')`,
    [routeId],
  );
  await db.query(
    `INSERT INTO waypoints (id, route_id, name, seq, longitude, latitude) VALUES
      ($1, $3, 'WP1', 1, 116.397428, 39.90923),
      ($2, $3, 'WP2', 2, 116.3985, 39.9101)`,
    [randomUUID(), randomUUID(), routeId],
  );
}

async function ensureMapMetadata(db: Database): Promise<{ name: string; basemap_url: string }> {
  const existing = await db.query<{ name: string; basemap_url: string }>('SELECT name, basemap_url FROM map_metadata ORDER BY created_at LIMIT 1');
  if (existing.rows[0]) return existing.rows[0];
  await db.query('INSERT INTO map_metadata (id, name, basemap_url) VALUES ($1, $2, $3)', [randomUUID(), 'default', '']);
  return { name: 'default', basemap_url: '' };
}

const TASK_SELECT = `
  SELECT t.*, v.name AS device_name, r.name AS route_name,
    (SELECT count(*)::int FROM patrol_events e WHERE e.task_id = t.id) AS event_count
  FROM patrol_tasks t
  JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN patrol_routes r ON r.id = t.route_id
`;

export function registerPatrolPlatformRoutes(app: FastifyInstance, deps: PatrolRouteDeps): void {
  const { db, requireUser, requireAdmin, canAccessVehicle, acquireLease, leaseToken, audit, hub } = deps;

  // --- Devices (vehicle aliases) ---
  app.get('/api/devices', async (request) => {
    const user = await requireUser(request);
    const result = user.role === 'admin'
      ? await db.query<DeviceRow>('SELECT * FROM vehicles WHERE archived=false ORDER BY name')
      : await db.query<DeviceRow>(
        'SELECT v.* FROM vehicles v JOIN vehicle_members m ON m.vehicle_id=v.id WHERE m.user_id=$1 AND v.archived=false ORDER BY v.name',
        [user.id],
      );
    return { devices: result.rows.map(deviceDto) };
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
    await requireUser(request);
    const onlineDevices = await db.query<{ c: number }>(`
      SELECT count(*)::int AS c FROM vehicles v
      WHERE v.archived=false AND (
        v.last_seen_at > now() - interval '2 minutes'
        OR EXISTS (
          SELECT 1 FROM telemetry_points t
          WHERE t.vehicle_id=v.id AND t.occurred_at > now() - interval '2 minutes'
        )
      )`);
    const todayPatrols = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM patrol_tasks WHERE started_at >= date_trunc('day', now())`,
    );
    const pendingReviews = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM reviews WHERE status='pending'`,
    );
    const violations = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM violations WHERE disposition='pending'`,
    );
    const recentTasks = await db.query<PatrolTaskRow>(`${TASK_SELECT} ORDER BY t.created_at DESC LIMIT 5`);
    const todayAlerts = await db.query<{ id: string; plate: string | null; priority: string; occurred_at: Date; violation_type: string }>(
      `SELECT id, plate, priority, occurred_at, violation_type FROM violations
       WHERE occurred_at >= date_trunc('day', now()) ORDER BY occurred_at DESC LIMIT 10`,
    );
    return {
      onlineDevices: onlineDevices.rows[0]?.c ?? 0,
      todayPatrols: todayPatrols.rows[0]?.c ?? 0,
      pendingReviews: pendingReviews.rows[0]?.c ?? 0,
      violations: violations.rows[0]?.c ?? 0,
      recentTasks: recentTasks.rows.map(taskDto),
      todayAlerts: todayAlerts.rows.map((row) => ({
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

    const whitelistCount = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM whitelist_entries');
    if ((whitelistCount.rows[0]?.c ?? 0) === 0) {
      throw httpError('Whitelist is empty; add at least one entry before starting patrol', 409);
    }

    const active = await db.query(
      `SELECT id FROM patrol_tasks WHERE vehicle_id=$1 AND status IN ('navigating','scanning') LIMIT 1`,
      [deviceId],
    );
    if (active.rows[0]) throw httpError('Device already has an active patrol task', 409);

    await ensureDefaultRoute(db);
    let routeId = typeof body?.routeId === 'string' && body.routeId.trim() ? body.routeId.trim() : null;
    if (!routeId) {
      const fallback = await db.query<{ id: string }>('SELECT id FROM patrol_routes ORDER BY created_at LIMIT 1');
      routeId = fallback.rows[0]?.id ?? null;
    } else {
      const route = await db.query('SELECT id FROM patrol_routes WHERE id=$1 OR code=$1', [routeId]);
      if (!route.rows[0]) throw httpError('Route not found', 404);
      routeId = (route.rows[0] as { id: string }).id;
    }

    const shiftRaw = typeof body?.shift === 'string' ? body.shift.trim() : 'morning';
    const shift = shiftRaw === 'afternoon' || shiftRaw === 'evening' || shiftRaw === 'morning'
      ? shiftRaw
      : shiftRaw === 'noon' ? 'afternoon' : (() => { throw httpError('shift is invalid', 400); })();

    const wpCount = routeId
      ? (await db.query<{ c: number }>('SELECT count(*)::int AS c FROM waypoints WHERE route_id=$1', [routeId])).rows[0]?.c ?? 0
      : 0;

    const id = randomUUID();
    await db.query(
      `INSERT INTO patrol_tasks (id, vehicle_id, route_id, shift, status, progress_done, progress_total, started_at, created_by)
       VALUES ($1,$2,$3,$4,'navigating',0,$5,now(),$6)`,
      [id, deviceId, routeId, shift, wpCount, user.id],
    );
    await db.query('UPDATE vehicles SET last_patrol_at=now(), updated_at=now() WHERE id=$1', [deviceId]);
    await audit('patrol.start', 'success', user.id, deviceId, { taskId: id, routeId, shift });
    hub.publishPatrol?.({ type: 'patrol_status', taskId: id, deviceId, status: 'navigating' });
    const task = await db.query<PatrolTaskRow>(`${TASK_SELECT} WHERE t.id=$1`, [id]);
    return { task: taskDto(task.rows[0]) };
  });

  app.post('/api/patrol/stop', async (request) => {
    const user = await requireUser(request);
    const body = object(request.body);
    const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : null;
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : null;
    if (!taskId && !deviceId) throw httpError('deviceId or taskId is required', 400);

    let task: PatrolTaskRow | undefined;
    if (taskId) {
      const result = await db.query<PatrolTaskRow>(`${TASK_SELECT} WHERE t.id=$1`, [taskId]);
      task = result.rows[0];
    } else if (deviceId) {
      const result = await db.query<PatrolTaskRow>(
        `${TASK_SELECT} WHERE t.vehicle_id=$1 AND t.status IN ('navigating','scanning') ORDER BY t.started_at DESC LIMIT 1`,
        [deviceId],
      );
      task = result.rows[0];
    }
    if (!task) throw httpError('Active patrol task not found', 404);
    if (!await canAccessVehicle(user, task.vehicle_id)) throw httpError('Vehicle access denied', 403);

    await db.query(
      `UPDATE patrol_tasks SET status='stopped', ended_at=now() WHERE id=$1 AND status IN ('navigating','scanning')`,
      [task.id],
    );
    await audit('patrol.stop', 'success', user.id, task.vehicle_id, { taskId: task.id });
    hub.publishPatrol?.({ type: 'patrol_status', taskId: task.id, deviceId: task.vehicle_id, status: 'stopped' });
    return { ok: true as const };
  });

  app.get('/api/patrol/status', async (request) => {
    const user = await requireUser(request);
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    if (deviceId) {
      if (!await canAccessVehicle(user, deviceId)) throw httpError('Vehicle access denied', 403);
      const result = await db.query<PatrolTaskRow>(
        `${TASK_SELECT} WHERE t.vehicle_id=$1 AND t.status IN ('navigating','scanning') ORDER BY t.started_at DESC LIMIT 1`,
        [deviceId],
      );
      return { status: result.rows[0] ? taskDto(result.rows[0]) : null };
    }
    const result = await db.query<PatrolTaskRow>(
      `${TASK_SELECT} WHERE t.status IN ('navigating','scanning') ORDER BY t.started_at DESC LIMIT 1`,
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
              occurred_at AS "occurredAt"
       FROM patrol_events WHERE task_id=$1 ORDER BY occurred_at DESC`,
      [id],
    );
    return {
      events: events.rows.map((row) => ({
        ...row,
        thumbnailUrl: (row as { evidenceUrl?: string }).evidenceUrl ?? null,
        verdict: (row as { reviewStatus?: string }).reviewStatus,
      })),
    };
  });

  app.get('/api/patrol/tasks/:id/report', async (request) => {
    const user = await requireUser(request);
    const id = (request.params as { id: string }).id;
    const task = await db.query<PatrolTaskRow>(`${TASK_SELECT} WHERE t.id=$1`, [id]);
    if (!task.rows[0]) throw httpError('Task not found', 404);
    if (!await canAccessVehicle(user, task.rows[0].vehicle_id)) throw httpError('Vehicle access denied', 403);

    let report = await db.query<{
      id: string; task_id: string; html_content: string; csv_content: string; stats: Record<string, unknown>; created_at: Date;
    }>('SELECT * FROM patrol_reports WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [id]);

    if (!report.rows[0]) {
      const eventCount = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM patrol_events WHERE task_id=$1', [id]);
      const violationCount = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM violations WHERE task_id=$1', [id]);
      const stats = {
        eventCount: eventCount.rows[0]?.c ?? 0,
        violationCount: violationCount.rows[0]?.c ?? 0,
        status: task.rows[0].status,
      };
      const html = `<html><body><h1>Patrol Report</h1><p>Task ${id}</p><pre>${JSON.stringify(stats, null, 2)}</pre></body></html>`;
      const csv = `metric,value\neventCount,${stats.eventCount}\nviolationCount,${stats.violationCount}\n`;
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
    await requireUser(request);
    await ensureDefaultRoute(db);
    const result = await db.query<{ id: string; code: string; name: string; c: number }>(
      `SELECT r.id, r.code, r.name, count(w.id)::int AS c
       FROM patrol_routes r
       LEFT JOIN waypoints w ON w.route_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at`,
    );
    return {
      routes: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
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

  app.get('/api/map/waypoints', async (request) => {
    await requireUser(request);
    await ensureDefaultRoute(db);
    const routeId = (request.query as { routeId?: string }).routeId;
    const result = routeId
      ? await db.query(
        `SELECT id, name, longitude, latitude, seq AS "order", route_id AS "routeId"
         FROM waypoints WHERE route_id=$1 OR route_id=(SELECT id FROM patrol_routes WHERE code=$1)
         ORDER BY seq`,
        [routeId],
      )
      : await db.query(
        `SELECT id, name, longitude, latitude, seq AS "order", route_id AS "routeId"
         FROM waypoints ORDER BY route_id, seq`,
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

  // --- Violations ---
  app.get('/api/violations', async (request) => {
    await requireUser(request);
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
    if (query.vehicleId) push('v.vehicle_id=?', query.vehicleId);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT v.id, v.plate, v.violation_type AS type, v.waypoint, v.priority, v.disposition AS status,
              v.evidence_url AS "evidenceUrl", v.occurred_at AS "occurredAt",
              v.task_id AS "taskId", v.vehicle_id AS "deviceId", z.name AS "zoneName"
       FROM violations v
       LEFT JOIN map_zones z ON z.id = v.zone_id
       ${where}
       ORDER BY v.occurred_at DESC
       LIMIT 200`,
      values,
    );
    return { violations: result.rows };
  });

  app.get('/api/violations/:event_id', async (request) => {
    await requireUser(request);
    const eventId = (request.params as { event_id: string }).event_id;
    const result = await db.query(
      `SELECT v.id, v.plate, v.violation_type AS type, v.waypoint, v.priority, v.disposition AS status,
              v.evidence_url AS "evidenceUrl", v.occurred_at AS "occurredAt",
              v.task_id AS "taskId", v.vehicle_id AS "deviceId", v.event_id AS "eventId",
              z.name AS "zoneName"
       FROM violations v
       LEFT JOIN map_zones z ON z.id = v.zone_id
       WHERE v.id=$1 OR v.event_id=$1
       LIMIT 1`,
      [eventId],
    );
    if (!result.rows[0]) throw httpError('Violation not found', 404);
    return { violation: result.rows[0] };
  });

  // --- Reviews ---
  app.get('/api/reviews/pending', async (request) => {
    await requireUser(request);
    const result = await db.query(
      `SELECT r.id, r.event_id AS "eventId", r.reason, r.created_at AS "occurredAt",
              e.plate, e.waypoint, e.evidence_url AS "evidenceUrl",
              v.name AS "deviceName"
       FROM reviews r
       JOIN patrol_events e ON e.id = r.event_id
       JOIN patrol_tasks t ON t.id = e.task_id
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE r.status='pending'
       ORDER BY r.created_at DESC
       LIMIT 100`,
    );
    return { reviews: result.rows };
  });

  app.post('/api/reviews/:event_id/resolve', async (request) => {
    const user = await requireUser(request);
    const eventId = (request.params as { event_id: string }).event_id;
    const body = object(request.body);
    const resolution = string(body?.resolution, 'resolution');
    const plate = typeof body?.plate === 'string' ? body.plate.trim() : null;

    const reviewStatus =
      resolution === 'confirmed' || resolution === 'false_positive' || resolution === 'whitelist' || resolution === 'external'
        ? resolution
        : 'confirmed';

    const event = await db.query('SELECT id FROM patrol_events WHERE id=$1', [eventId]);
    if (!event.rows[0]) throw httpError('Event not found', 404);

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
    });
    await audit('review.resolve', 'success', user.id, undefined, { eventId, resolution, plate });
    return { ok: true as const };
  });

  // --- Whitelist ---
  app.get('/api/whitelist', async (request) => {
    await requireUser(request);
    const result = await db.query(
      `SELECT id, plate, owner, building, slot AS "parkingSpot", vehicle_type AS "vehicleType",
              expires_at AS "validUntil", created_at AS "createdAt"
       FROM whitelist_entries ORDER BY plate`,
    );
    return { entries: result.rows };
  });

  app.post('/api/whitelist', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    const plate = string(body?.plate, 'plate').toUpperCase();
    const owner = optionalString(body?.owner);
    const building = optionalString(body?.building);
    const slot = optionalString(body?.slot ?? body?.parkingSpot);
    const vehicleTypeRaw = optionalString(body?.vehicleType, 'private');
    const vehicleType = vehicleTypeRaw === 'visitor' || vehicleTypeRaw === 'commercial' ? vehicleTypeRaw : 'private';
    const expiresAt = typeof body?.expiresAt === 'string' && body.expiresAt.trim()
      ? body.expiresAt.trim()
      : typeof body?.validUntil === 'string' && body.validUntil.trim()
        ? body.validUntil.trim()
        : null;
    const id = randomUUID();
    await db.query(
      `INSERT INTO whitelist_entries (id, plate, owner, building, slot, vehicle_type, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, plate, owner, building, slot, vehicleType, expiresAt],
    );
    await audit('whitelist.create', 'success', admin.id, undefined, { plate });
    return {
      entry: {
        id, plate, owner, building, parkingSpot: slot, vehicleType, validUntil: expiresAt,
      },
    };
  });

  app.post('/api/whitelist/import', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    type RowIn = { plate?: string; owner?: string; building?: string; slot?: string; parkingSpot?: string; vehicleType?: string; expiresAt?: string; validUntil?: string };
    let rows: RowIn[] = [];

    if (Array.isArray(body?.rows)) {
      rows = body.rows as RowIn[];
    } else if (typeof body?.csv === 'string') {
      const lines = body.csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const start = lines[0]?.toLowerCase().includes('plate') ? 1 : 0;
      for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(/[,;\t]/).map((c) => c.trim());
        rows.push({
          plate: cols[0],
          owner: cols[1] ?? '',
          building: cols[2] ?? '',
          slot: cols[3] ?? '',
          vehicleType: cols[4] ?? 'private',
          expiresAt: cols[5] || undefined,
        });
      }
    } else {
      throw httpError('rows or csv is required', 400);
    }

    let success = 0;
    let failed = 0;
    const errors: Array<{ index: number; plate?: string; error: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const plate = string(row.plate, 'plate').toUpperCase();
        const owner = optionalString(row.owner);
        const building = optionalString(row.building);
        const slot = optionalString(row.slot ?? row.parkingSpot);
        const vehicleTypeRaw = optionalString(row.vehicleType, 'private');
        const vehicleType = vehicleTypeRaw === 'visitor' || vehicleTypeRaw === 'commercial' ? vehicleTypeRaw : 'private';
        const expiresAt = row.expiresAt || row.validUntil || null;
        await db.query(
          `INSERT INTO whitelist_entries (id, plate, owner, building, slot, vehicle_type, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (plate) DO UPDATE SET
             owner=EXCLUDED.owner, building=EXCLUDED.building, slot=EXCLUDED.slot,
             vehicle_type=EXCLUDED.vehicle_type, expires_at=EXCLUDED.expires_at`,
          [randomUUID(), plate, owner, building, slot, vehicleType, expiresAt],
        );
        success++;
      } catch (error) {
        failed++;
        errors.push({ index: i, plate: row.plate, error: error instanceof Error ? error.message : 'import failed' });
      }
    }

    await audit('whitelist.import', 'success', admin.id, undefined, { success, failed });
    return { success, failed, errors };
  });

  // --- Reports ---
  app.get('/api/reports', async (request) => {
    await requireUser(request);
    const result = await db.query(
      `SELECT pr.id, pr.task_id AS "taskId", pr.stats, pr.created_at AS "createdAt",
              v.name AS "deviceName", t.started_at AS "startedAt"
       FROM patrol_reports pr
       JOIN patrol_tasks t ON t.id = pr.task_id
       JOIN vehicles v ON v.id = t.vehicle_id
       ORDER BY pr.created_at DESC
       LIMIT 100`,
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
    await requireUser(request);
    const id = (request.params as { id: string }).id;
    const result = await db.query(
      `SELECT pr.id, pr.task_id AS "taskId", pr.html_content AS "htmlContent", pr.csv_content AS "csvContent",
              pr.stats, pr.created_at AS "createdAt", v.name AS "deviceName"
       FROM patrol_reports pr
       JOIN patrol_tasks t ON t.id = pr.task_id
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE pr.id=$1`,
      [id],
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
    const settings: Record<string, unknown> = {};
    for (const row of result.rows) settings[row.key] = row.value;
    return { settings, entries: result.rows.map((row) => ({ key: row.key, value: row.value, updatedAt: iso(row.updated_at) })) };
  });

  app.put('/api/settings', async (request) => {
    const admin = await requireAdmin(request);
    const body = object(request.body);
    if (!body) throw httpError('body is required', 400);

    const upserts: Array<{ key: string; value: unknown }> = [];
    if (typeof body.key === 'string' && body.key.trim()) {
      upserts.push({ key: body.key.trim(), value: body.value ?? {} });
    } else if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
      for (const [key, value] of Object.entries(body.settings as Record<string, unknown>)) {
        upserts.push({ key, value });
      }
    } else {
      throw httpError('Provide { key, value } or { settings: { ... } }', 400);
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
