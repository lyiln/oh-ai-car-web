import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { loadConfig, type Config } from './config.js';
import { Database } from './db/index.js';
import { hashSecret, randomSecret, sign, verify, type SignedPayload } from './security.js';

type Role = 'admin' | 'operator';
interface UserRow { id: string; username: string; display_name: string; password_hash: string; role: Role; active: boolean; }
interface VehicleRow { id: string; code: string; name: string; description: string; tcp_host: string; tcp_port: number; video_port: number; archived: boolean; }
interface DeviceCredentialRow { vehicle_id: string; secret_hash: string; }
interface RouteRow { id: string; name: string; map_version: string; source_yaml: string; created_at: string; }
interface WaypointRow { id: string; ordinal: number; name: string; x: number; y: number; yaw: number; dwell_seconds: number; no_parking_roi: unknown; }
interface TaskRow { id: string; vehicle_id: string; route_id: string; whitelist_id: string; shift: string; status: string; started_at: string | null; stop_requested_at: string | null; stop_confirmed_at: string | null; zero_velocity_confirmed_at: string | null; finished_at: string | null; failure_reason: string | null; created_at: string; route_name?: string; }
interface SessionPayload extends SignedPayload { sub: string; role: Role; }
interface LeasePayload extends SignedPayload { sub: string; role: Role; leaseId: string; vehicleId: string; }
const SESSION_COOKIE = 'oh_ai_session';
const LEASE_MS = 60_000;

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function number(value: unknown, field: string, min: number, max: number): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} is invalid`); return value; }
function normalisePlate(value: unknown): string { const plate = string(value, 'plate').replace(/[\s-]/g, '').toUpperCase(); if (!/^[A-Z0-9]{5,10}$/.test(plate)) throw new Error('plate is invalid'); return plate; }
function html(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }

interface ParsedWaypoint { name: string; x: number; y: number; yaw: number; dwellSeconds: number; noParkingRoi: number[] | null; }
function parseRouteYaml(yaml: string): ParsedWaypoint[] {
  const waypoints: Array<Record<string, string>> = []; let current: Record<string, string> | undefined;
  for (const raw of yaml.split(/\r?\n/)) {
    const item = raw.match(/^\s*-\s*(.*)$/); const field = (item ? item[1] : raw).match(/^\s*([A-Za-z_]+)\s*:\s*(.*?)\s*$/);
    if (item) { current = {}; waypoints.push(current); }
    if (field && current) current[field[1]] = field[2].replace(/^['"]|['"]$/g, '');
  }
  if (waypoints.length < 3 || waypoints.length > 8) throw new Error('route must contain 3 to 8 waypoints');
  return waypoints.map((point, index) => {
    const value = (key: string) => Number(point[key]); const dwellSeconds = value('dwellSeconds') || value('dwell_seconds');
    if (!point.name || !Number.isFinite(value('x')) || !Number.isFinite(value('y')) || !Number.isFinite(value('yaw')) || !Number.isInteger(dwellSeconds) || dwellSeconds < 8 || dwellSeconds > 10) throw new Error(`waypoint ${index + 1} is invalid`);
    let noParkingRoi: number[] | null = null;
    if (point.roi || point.noParkingRoi || point.no_parking_roi) {
      try { noParkingRoi = JSON.parse(point.roi ?? point.noParkingRoi ?? point.no_parking_roi) as number[]; } catch { throw new Error(`waypoint ${index + 1} ROI is invalid`); }
      if (!Array.isArray(noParkingRoi) || noParkingRoi.length !== 4 || !noParkingRoi.every((entry) => typeof entry === 'number' && entry >= 0 && entry <= 1) || noParkingRoi[2] <= 0 || noParkingRoi[3] <= 0 || noParkingRoi[0] + noParkingRoi[2] > 1 || noParkingRoi[1] + noParkingRoi[3] > 1) throw new Error(`waypoint ${index + 1} ROI is invalid`);
    }
    return { name: point.name, x: value('x'), y: value('y'), yaw: value('yaw'), dwellSeconds, noParkingRoi };
  });
}
function parseWhitelistCsv(csv: string): Array<{ plate: string; ownerName: string; building: string; category: 'private' | 'visitor' }> {
  const rows = csv.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((value) => value.trim()));
  const headers = rows.shift()?.map((header) => header.toLowerCase()); if (!headers) throw new Error('CSV is empty');
  const index = (name: string) => { const value = headers.indexOf(name); if (value < 0) throw new Error(`CSV must include ${name}`); return value; };
  const plate = index('plate'); const ownerName = index('ownername'); const building = index('building'); const category = index('category'); const seen = new Set<string>();
  return rows.map((row, line) => { const value = normalisePlate(row[plate]); if (seen.has(value)) throw new Error(`duplicate plate on CSV line ${line + 2}`); seen.add(value); const kind = row[category] === 'visitor' ? 'visitor' : row[category] === 'private' ? 'private' : (() => { throw new Error(`category on CSV line ${line + 2} must be private or visitor`); })(); return { plate: value, ownerName: string(row[ownerName], 'ownerName'), building: string(row[building], 'building'), category: kind }; });
}
function bboxIntersectsRoi(box: unknown, roi: unknown): boolean {
  if (!Array.isArray(box) || !Array.isArray(roi) || box.length !== 4 || roi.length !== 4 || !box.every((value) => typeof value === 'number' && value >= 0 && value <= 1)) return false;
  const [x, y, width, height] = box as number[]; const [roiX, roiY, roiWidth, roiHeight] = roi as number[];
  return x < roiX + roiWidth && x + width > roiX && y < roiY + roiHeight && y + height > roiY;
}

export class RealtimeHub {
  private readonly subscribers = new Map<string, Set<{ send: (value: string) => void }>>();
  subscribe(vehicleId: string, socket: { send: (value: string) => void }) { const set = this.subscribers.get(vehicleId) ?? new Set(); set.add(socket); this.subscribers.set(vehicleId, set); return () => { set.delete(socket); if (!set.size) this.subscribers.delete(vehicleId); }; }
  publish(vehicleId: string, payload: unknown) { for (const socket of this.subscribers.get(vehicleId) ?? []) socket.send(JSON.stringify({ type: 'vehicle.position', vehicleId, payload })); }
}

export interface AppServices { db?: Database; config?: Partial<Config>; }
export async function createApp(services: AppServices = {}) {
  const config = loadConfig(services.config);
  const db = services.db ?? new Database(config.databaseUrl);
  const hub = new RealtimeHub();
  const app = Fastify({ logger: true });
  await app.register(cookie);
  const trustedOrigins = new Set(config.allowedOrigins);
  await app.register(cors, { origin: (origin, callback) => callback(null, Boolean(origin && trustedOrigins.has(origin))), credentials: true });
  await app.register(websocket);
  app.addHook('onRequest', async (request, reply) => {
    const mutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    const exempt = request.url.startsWith('/device/') || request.url.startsWith('/internal/');
    if (mutating && !exempt && !trustedOrigins.has(request.headers.origin ?? '')) return reply.code(403).send({ error: 'Untrusted request origin' });
  });

  async function audit(action: string, outcome: string, actorUserId?: string, vehicleId?: string, metadata: Record<string, unknown> = {}) {
    await db.query('INSERT INTO audit_logs (id, actor_user_id, vehicle_id, action, outcome, metadata) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), actorUserId ?? null, vehicleId ?? null, action, outcome, JSON.stringify(metadata)]);
  }
  function session(request: FastifyRequest): SessionPayload | null { const value = request.cookies[SESSION_COOKIE]; return value ? verify<SessionPayload>(value, config.sessionSecret) : null; }
  async function currentUser(request: FastifyRequest): Promise<UserRow | null> {
    const claim = session(request); if (!claim) return null;
    const result = await db.query<UserRow>('SELECT id, username, display_name, password_hash, role, active FROM users WHERE id=$1', [claim.sub]);
    return result.rows[0]?.active ? result.rows[0] : null;
  }
  async function requireUser(request: FastifyRequest): Promise<UserRow> { const user = await currentUser(request); if (!user) throw Object.assign(new Error('Authentication required'), { statusCode: 401 }); return user; }
  async function requireAdmin(request: FastifyRequest): Promise<UserRow> { const user = await requireUser(request); if (user.role !== 'admin') throw Object.assign(new Error('Administrator role required'), { statusCode: 403 }); return user; }
  async function canAccessVehicle(user: UserRow, vehicleId: string): Promise<boolean> {
    if (user.role === 'admin') return true;
    const result = await db.query('SELECT 1 FROM vehicle_members WHERE vehicle_id=$1 AND user_id=$2', [vehicleId, user.id]);
    return result.rowCount === 1;
  }
  async function deviceVehicle(request: FastifyRequest): Promise<string> {
    const authorization = request.headers.authorization; const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''; const [credentialId, secret] = token.split('.');
    if (!credentialId || !secret) throw Object.assign(new Error('Invalid device credential'), { statusCode: 401 });
    const credential = await db.query<DeviceCredentialRow>('SELECT vehicle_id,secret_hash FROM device_credentials WHERE id=$1 AND active=true', [credentialId]);
    if (!credential.rows[0] || credential.rows[0].secret_hash !== hashSecret(secret)) throw Object.assign(new Error('Invalid device credential'), { statusCode: 401 });
    return credential.rows[0].vehicle_id;
  }
  function vehicleDto(row: VehicleRow) { return { id: row.id, code: row.code, name: row.name, description: row.description, host: row.tcp_host, tcpPort: row.tcp_port, videoPort: row.video_port, archived: row.archived }; }
  function waypointDto(row: WaypointRow) { return { id: row.id, ordinal: row.ordinal, name: row.name, x: row.x, y: row.y, yaw: row.yaw, dwellSeconds: row.dwell_seconds, noParkingRoi: row.no_parking_roi }; }
  function taskDto(row: TaskRow) { return { id: row.id, vehicleId: row.vehicle_id, routeId: row.route_id, whitelistId: row.whitelist_id, routeName: row.route_name, shift: row.shift, status: row.status, startedAt: row.started_at, stopRequestedAt: row.stop_requested_at, stopConfirmedAt: row.stop_confirmed_at, zeroVelocityConfirmedAt: row.zero_velocity_confirmed_at, finishedAt: row.finished_at, failureReason: row.failure_reason, createdAt: row.created_at }; }
  function leaseToken(leaseId: string, vehicleId: string, user: UserRow, expiresAt: Date) { return sign({ sub: user.id, role: user.role, leaseId, vehicleId, exp: expiresAt.getTime() }, config.sessionSecret); }

  app.setErrorHandler((error, _request, reply) => reply.status((error as { statusCode?: number }).statusCode ?? 400).send({ error: error instanceof Error ? error.message : 'Request failed' }));
  app.get('/health', async () => ({ ok: true }));

  app.post('/api/auth/login', async (request, reply) => {
    const body = object(request.body); const username = string(body?.username, 'username'); const password = string(body?.password, 'password');
    const result = await db.query<UserRow>('SELECT id, username, display_name, password_hash, role, active FROM users WHERE username=$1', [username]);
    const user = result.rows[0];
    if (!user || !user.active || !await argon2.verify(user.password_hash, password)) { await audit('auth.login', 'rejected', undefined, undefined, { username }); return reply.status(401).send({ error: 'Invalid username or password' }); }
    const token = sign({ sub: user.id, role: user.role, exp: Date.now() + 8 * 60 * 60_000 }, config.sessionSecret);
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 8 * 60 * 60 });
    await audit('auth.login', 'success', user.id); return { user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } };
  });
  app.post('/api/auth/logout', async (request, reply) => { const user = await currentUser(request); reply.clearCookie(SESSION_COOKIE, { path: '/' }); if (user) await audit('auth.logout', 'success', user.id); return { ok: true }; });
  app.get('/api/auth/me', async (request) => { const user = await requireUser(request); return { user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } }; });

  app.get('/api/users', async (request) => { await requireAdmin(request); const result = await db.query<UserRow>('SELECT id, username, display_name, password_hash, role, active FROM users ORDER BY username'); return { users: result.rows.map(({ password_hash: _hash, display_name, ...user }) => ({ ...user, displayName: display_name })) }; });
  app.post('/api/users', async (request) => {
    const admin = await requireAdmin(request); const body = object(request.body); const username = string(body?.username, 'username'); const displayName = string(body?.displayName, 'displayName'); const password = string(body?.password, 'password'); const role = body?.role === 'admin' ? 'admin' : body?.role === 'operator' ? 'operator' : (() => { throw new Error('role is invalid'); })();
    const id = randomUUID(); await db.query('INSERT INTO users (id,username,display_name,password_hash,role) VALUES ($1,$2,$3,$4,$5)', [id, username, displayName, await argon2.hash(password), role]); await audit('user.create', 'success', admin.id, undefined, { createdUserId: id }); return { user: { id, username, displayName, role, active: true } };
  });
  app.patch('/api/users/:id', async (request) => { const admin = await requireAdmin(request); const body = object(request.body); const active = body?.active; if (typeof active !== 'boolean') throw new Error('active is required'); await db.query('UPDATE users SET active=$1,updated_at=now() WHERE id=$2', [active, (request.params as { id: string }).id]); await audit('user.update', 'success', admin.id, undefined, { targetUserId: (request.params as { id: string }).id, active }); return { ok: true }; });

  app.get('/api/vehicles', async (request) => {
    const user = await requireUser(request); const result = user.role === 'admin' ? await db.query<VehicleRow>('SELECT * FROM vehicles WHERE archived=false ORDER BY name') : await db.query<VehicleRow>('SELECT v.* FROM vehicles v JOIN vehicle_members m ON m.vehicle_id=v.id WHERE m.user_id=$1 AND v.archived=false ORDER BY v.name', [user.id]);
    return { vehicles: result.rows.map(vehicleDto) };
  });
  app.post('/api/vehicles', async (request) => {
    const admin = await requireAdmin(request); const body = object(request.body); const id = randomUUID(); const code = string(body?.code, 'code'); const name = string(body?.name, 'name'); const host = string(body?.host, 'host'); const tcpPort = number(body?.tcpPort, 'tcpPort', 1, 65535); const videoPort = number(body?.videoPort, 'videoPort', 1, 65535); const description = typeof body?.description === 'string' ? body.description : '';
    await db.query('INSERT INTO vehicles (id,code,name,description,tcp_host,tcp_port,video_port) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, code, name, description, host, tcpPort, videoPort]); await audit('vehicle.create', 'success', admin.id, id); return { vehicle: { id, code, name, description, host, tcpPort, videoPort, archived: false } };
  });
  app.get('/api/vehicles/:id', async (request) => { const user = await requireUser(request); const id = (request.params as { id: string }).id; if (!await canAccessVehicle(user, id)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const result = await db.query<VehicleRow>('SELECT * FROM vehicles WHERE id=$1', [id]); if (!result.rows[0]) throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 }); return { vehicle: vehicleDto(result.rows[0]) }; });
  app.patch('/api/vehicles/:id', async (request) => { const admin = await requireAdmin(request); const id = (request.params as { id: string }).id; const body = object(request.body); const description = typeof body?.description === 'string' ? body.description : ''; await db.query('UPDATE vehicles SET name=COALESCE($1,name),description=$2,updated_at=now() WHERE id=$3', [typeof body?.name === 'string' ? body.name.trim() : null, description, id]); await audit('vehicle.update', 'success', admin.id, id); return { ok: true }; });
  app.put('/api/vehicles/:id/members', async (request) => { const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const body = object(request.body); if (!Array.isArray(body?.userIds) || !body.userIds.every((id) => typeof id === 'string')) throw new Error('userIds must be strings'); await db.transaction(async (client) => { await client.query('DELETE FROM vehicle_members WHERE vehicle_id=$1', [vehicleId]); for (const userId of body.userIds as string[]) await client.query('INSERT INTO vehicle_members (vehicle_id,user_id) VALUES ($1,$2)', [vehicleId, userId]); }); await audit('vehicle.members.update', 'success', admin.id, vehicleId); return { ok: true }; });
  app.post('/api/vehicles/:id/device-credentials', async (request) => { const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const id = randomUUID(); const secret = randomSecret(); await db.transaction(async (client) => { await client.query('UPDATE device_credentials SET active=false,revoked_at=now() WHERE vehicle_id=$1 AND active=true', [vehicleId]); await client.query('INSERT INTO device_credentials (id,vehicle_id,secret_hash) VALUES ($1,$2,$3)', [id, vehicleId, hashSecret(secret)]); }); await audit('device-credential.rotate', 'success', admin.id, vehicleId); return { credential: { id, token: `${id}.${secret}` } }; });

  app.get('/api/vehicles/:id/patrol-routes', async (request) => {
    const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    const routes = await db.query<RouteRow>('SELECT id,name,map_version,source_yaml,created_at FROM patrol_routes WHERE vehicle_id=$1 ORDER BY created_at DESC', [vehicleId]);
    return { routes: await Promise.all(routes.rows.map(async (route) => ({ id: route.id, name: route.name, mapVersion: route.map_version, sourceYaml: route.source_yaml, createdAt: route.created_at, waypoints: (await db.query<WaypointRow>('SELECT id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi FROM patrol_waypoints WHERE route_id=$1 ORDER BY ordinal', [route.id])).rows.map(waypointDto) }))) };
  });
  app.post('/api/vehicles/:id/patrol-routes', async (request) => {
    const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const body = object(request.body); const name = string(body?.name, 'name'); const mapVersion = string(body?.mapVersion, 'mapVersion'); const yaml = string(body?.yaml, 'yaml'); const waypoints = parseRouteYaml(yaml); const routeId = randomUUID();
    await db.transaction(async (client) => { await client.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, name, mapVersion, yaml, admin.id]); for (const [ordinal, waypoint] of waypoints.entries()) await client.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), routeId, ordinal, waypoint.name, waypoint.x, waypoint.y, waypoint.yaw, waypoint.dwellSeconds, waypoint.noParkingRoi ? JSON.stringify(waypoint.noParkingRoi) : null]); });
    await audit('patrol-route.create', 'success', admin.id, vehicleId, { routeId }); return { routeId };
  });
  app.get('/api/vehicles/:id/whitelists', async (request) => {
    const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    const result = await db.query<{ id: string; name: string; created_at: string; entry_count: string }>('SELECT w.id,w.name,w.created_at,COUNT(e.id) AS entry_count FROM whitelist_imports w LEFT JOIN whitelist_entries e ON e.whitelist_id=w.id WHERE w.vehicle_id=$1 GROUP BY w.id ORDER BY w.created_at DESC', [vehicleId]); return { whitelists: result.rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, entryCount: Number(row.entry_count) })) };
  });
  app.post('/api/vehicles/:id/whitelists', async (request) => {
    const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const body = object(request.body); const name = string(body?.name, 'name'); const entries = parseWhitelistCsv(string(body?.csv, 'csv')); if (!entries.length) throw new Error('CSV has no entries'); const whitelistId = randomUUID();
    await db.transaction(async (client) => { await client.query('INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id) VALUES ($1,$2,$3,$4)', [whitelistId, vehicleId, name, admin.id]); for (const entry of entries) await client.query('INSERT INTO whitelist_entries (id,whitelist_id,plate,owner_name,building,category) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), whitelistId, entry.plate, entry.ownerName, entry.building, entry.category]); });
    await audit('patrol-whitelist.create', 'success', admin.id, vehicleId, { whitelistId, entries: entries.length }); return { whitelistId, entries: entries.length };
  });
  app.get('/api/vehicles/:id/patrol-tasks', async (request) => {
    const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    const result = await db.query<TaskRow>('SELECT t.*,r.name AS route_name FROM patrol_tasks t JOIN patrol_routes r ON r.id=t.route_id WHERE t.vehicle_id=$1 ORDER BY t.created_at DESC', [vehicleId]); return { tasks: result.rows.map(taskDto) };
  });
  app.get('/api/vehicles/:id/patrol-tasks/active', async (request) => {
    const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    const result = await db.query<TaskRow>("SELECT t.*,r.name AS route_name FROM patrol_tasks t JOIN patrol_routes r ON r.id=t.route_id WHERE t.vehicle_id=$1 AND t.status IN ('queued','running','cancellation_requested') ORDER BY t.created_at DESC LIMIT 1", [vehicleId]); return { task: result.rows[0] ? taskDto(result.rows[0]) : null };
  });
  app.post('/api/vehicles/:id/patrol-tasks', async (request) => {
    const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const body = object(request.body); const routeId = string(body?.routeId, 'routeId'); const whitelistId = string(body?.whitelistId, 'whitelistId'); const shift = string(body?.shift, 'shift');
    const route = await db.query('SELECT 1 FROM patrol_routes WHERE id=$1 AND vehicle_id=$2', [routeId, vehicleId]); const whitelist = await db.query('SELECT 1 FROM whitelist_imports WHERE id=$1 AND vehicle_id=$2', [whitelistId, vehicleId]); if (!route.rowCount || !whitelist.rowCount) throw new Error('Route or whitelist does not belong to vehicle'); const taskId = randomUUID();
    await db.query("INSERT INTO patrol_tasks (id,vehicle_id,route_id,whitelist_id,shift,status,created_by_user_id) VALUES ($1,$2,$3,$4,$5,'draft',$6)", [taskId, vehicleId, routeId, whitelistId, shift, user.id]); await audit('patrol-task.create', 'success', user.id, vehicleId, { taskId }); return { taskId };
  });
  app.post('/api/vehicles/:id/patrol-tasks/:taskId/start', async (request) => {
    const user = await requireUser(request); const { id: vehicleId, taskId } = request.params as { id: string; taskId: string }; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    await db.transaction(async (client) => {
      const vehicle = await client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [vehicleId]); if (!vehicle.rowCount) throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });
      await client.query("UPDATE control_leases SET released_at=now(),release_reason='expired' WHERE vehicle_id=$1 AND released_at IS NULL AND expires_at<=now()", [vehicleId]);
      const manualControl = await client.query('SELECT 1 FROM control_leases WHERE vehicle_id=$1 AND released_at IS NULL AND expires_at>now() LIMIT 1', [vehicleId]);
      if (manualControl.rowCount) throw Object.assign(new Error('Safely disconnect the local gateway and release the active control lease before starting patrol'), { statusCode: 409 });
      const active = await client.query("SELECT 1 FROM patrol_tasks WHERE vehicle_id=$1 AND status IN ('queued','running','cancellation_requested')", [vehicleId]); if (active.rowCount) throw Object.assign(new Error('Vehicle already has an active patrol'), { statusCode: 409 });
      const result = await client.query("UPDATE patrol_tasks SET status='queued' WHERE id=$1 AND vehicle_id=$2 AND status='draft' RETURNING id", [taskId, vehicleId]); if (!result.rowCount) throw new Error('Task is not ready to start'); await client.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), taskId, JSON.stringify({ status: 'queued' })]);
    });
    await audit('patrol-task.start', 'success', user.id, vehicleId, { taskId }); return { ok: true };
  });
  app.post('/api/vehicles/:id/patrol-tasks/:taskId/stop', async (request) => {
    const user = await requireUser(request); const { id: vehicleId, taskId } = request.params as { id: string; taskId: string }; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const result = await db.query("UPDATE patrol_tasks SET status='cancellation_requested',stop_requested_at=now() WHERE id=$1 AND vehicle_id=$2 AND status IN ('queued','running') RETURNING stop_requested_at", [taskId, vehicleId]); if (!result.rowCount) throw new Error('Task cannot be stopped'); await db.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), taskId, JSON.stringify({ status: 'cancellation_requested', source: 'operator' })]); await audit('patrol-task.stop.request', 'success', user.id, vehicleId, { taskId }); return { stopRequestedAt: result.rows[0].stop_requested_at };
  });
  app.get('/api/vehicles/:id/patrol-tasks/:taskId', async (request) => {
    const user = await requireUser(request); const { id: vehicleId, taskId } = request.params as { id: string; taskId: string }; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const task = await db.query<TaskRow>('SELECT t.*,r.name AS route_name FROM patrol_tasks t JOIN patrol_routes r ON r.id=t.route_id WHERE t.id=$1 AND t.vehicle_id=$2', [taskId, vehicleId]); if (!task.rows[0]) throw Object.assign(new Error('Patrol task not found'), { statusCode: 404 }); const events = await db.query('SELECT id,event_type AS "eventType",waypoint_id AS "waypointId",details,created_at AS "createdAt" FROM patrol_events WHERE task_id=$1 ORDER BY created_at DESC', [taskId]); const observations = await db.query('SELECT id,waypoint_id AS "waypointId",occurred_at AS "occurredAt",plate,confidence,classification,no_parking AS "noParking",evidence_image_url AS "evidenceImageUrl",annotated_image_url AS "annotatedImageUrl",longitude,latitude,observation_count AS "observationCount",last_seen_at AS "lastSeenAt" FROM plate_observations WHERE task_id=$1 ORDER BY occurred_at DESC', [taskId]); return { task: taskDto(task.rows[0]), events: events.rows, observations: observations.rows };
  });
  app.get('/api/vehicles/:id/patrol-tasks/:taskId/report', async (request) => {
    const user = await requireUser(request); const { id: vehicleId, taskId } = request.params as { id: string; taskId: string }; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const detail = await app.inject({ method: 'GET', url: `/api/vehicles/${vehicleId}/patrol-tasks/${taskId}`, headers: { cookie: request.headers.cookie ?? '' } }); if (detail.statusCode !== 200) throw new Error('Patrol task not found'); const value = detail.json<{ task: ReturnType<typeof taskDto>; observations: Array<{ classification: string; noParking: boolean; plate: string | null; confidence: number; evidenceImageUrl: string | null }> }>(); const summary = { registeredPrivate: value.observations.filter((entry) => entry.classification === 'registered_private').length, visitor: value.observations.filter((entry) => entry.classification === 'visitor').length, suspectedExternal: value.observations.filter((entry) => entry.classification === 'suspected_external').length, pendingReview: value.observations.filter((entry) => entry.classification === 'pending_review').length, noParking: value.observations.filter((entry) => entry.noParking).length }; const rows = value.observations.map((entry) => `<tr><td>${html(entry.plate ?? '待复核')}</td><td>${html(entry.classification)}</td><td>${entry.confidence.toFixed(2)}</td><td>${entry.noParking ? '是' : '否'}</td><td>${entry.evidenceImageUrl ? `<a href="${html(entry.evidenceImageUrl)}">证据</a>` : '-'}</td></tr>`).join(''); return { ...value, summary, html: `<!doctype html><meta charset="utf-8"><title>巡检报告</title><h1>巡检报告：${html(value.task.routeName)}</h1><p>班次：${html(value.task.shift)}；状态：${html(value.task.status)}</p><p>登记私家车 ${summary.registeredPrivate}，访客 ${summary.visitor}，疑似外来 ${summary.suspectedExternal}，待复核 ${summary.pendingReview}，违规停放 ${summary.noParking}</p><table border="1"><tr><th>车牌</th><th>分类</th><th>置信度</th><th>违规停放</th><th>证据</th></tr>${rows}</table>` };
  });

  async function acquireLease(client: PoolClient, user: UserRow, vehicleId: string) {
    await client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [vehicleId]);
    await client.query("UPDATE control_leases SET released_at=now(),release_reason='expired' WHERE vehicle_id=$1 AND released_at IS NULL AND expires_at<=now()", [vehicleId]);
    const existing = await client.query<{ user_id: string }>('SELECT user_id FROM control_leases WHERE vehicle_id=$1 AND released_at IS NULL AND expires_at>now() LIMIT 1', [vehicleId]);
    if (existing.rows[0] && existing.rows[0].user_id !== user.id) throw Object.assign(new Error('Vehicle is controlled by another operator'), { statusCode: 409 });
    const expiresAt = new Date(Date.now() + LEASE_MS); const id = existing.rows[0] ? (await client.query<{ id: string }>('UPDATE control_leases SET expires_at=$1 WHERE vehicle_id=$2 AND user_id=$3 AND released_at IS NULL RETURNING id', [expiresAt, vehicleId, user.id])).rows[0].id : randomUUID();
    if (!existing.rows[0]) await client.query('INSERT INTO control_leases (id,vehicle_id,user_id,expires_at) VALUES ($1,$2,$3,$4)', [id, vehicleId, user.id, expiresAt]);
    return { id, expiresAt };
  }
  app.post('/api/vehicles/:id/control-lease', async (request) => { const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const lease = await db.transaction((client) => acquireLease(client, user, vehicleId)); await audit('control-lease.acquire', 'success', user.id, vehicleId); return { leaseId: lease.id, expiresAt: lease.expiresAt.toISOString(), gatewayToken: leaseToken(lease.id, vehicleId, user, lease.expiresAt) }; });
  app.post('/api/control-leases/:id/renew', async (request) => { const user = await requireUser(request); const leaseId = (request.params as { id: string }).id; const expiresAt = new Date(Date.now() + LEASE_MS); const result = await db.query<{ vehicle_id: string }>('UPDATE control_leases SET expires_at=$1 WHERE id=$2 AND user_id=$3 AND released_at IS NULL AND expires_at>now() RETURNING vehicle_id', [expiresAt, leaseId, user.id]); if (!result.rows[0]) throw Object.assign(new Error('Control lease expired'), { statusCode: 409 }); await audit('control-lease.renew', 'success', user.id, result.rows[0].vehicle_id); return { expiresAt: expiresAt.toISOString(), gatewayToken: leaseToken(leaseId, result.rows[0].vehicle_id, user, expiresAt) }; });
  app.delete('/api/control-leases/:id', async (request) => { const user = await requireUser(request); const leaseId = (request.params as { id: string }).id; const result = await db.query<{ vehicle_id: string }>("UPDATE control_leases SET released_at=now(),release_reason='operator' WHERE id=$1 AND user_id=$2 AND released_at IS NULL RETURNING vehicle_id", [leaseId, user.id]); if (result.rows[0]) await audit('control-lease.release', 'success', user.id, result.rows[0].vehicle_id); return { ok: true }; });
  app.post('/internal/control-lease/verify', async (request) => { const body = object(request.body); const token = string(body?.token, 'token'); const claim = verify<LeasePayload>(token, config.sessionSecret); if (!claim?.leaseId || !claim.vehicleId) return { valid: false }; const result = await db.query<VehicleRow>("SELECT v.* FROM control_leases l JOIN vehicles v ON v.id=l.vehicle_id JOIN users u ON u.id=l.user_id WHERE l.id=$1 AND l.vehicle_id=$2 AND l.user_id=$3 AND l.released_at IS NULL AND l.expires_at>now() AND u.active=true AND NOT EXISTS (SELECT 1 FROM patrol_tasks p WHERE p.vehicle_id=v.id AND p.status IN ('queued','running','cancellation_requested'))", [claim.leaseId, claim.vehicleId, claim.sub]); return result.rows[0] ? { valid: true, vehicle: vehicleDto(result.rows[0]), expiresAt: new Date(claim.exp).toISOString() } : { valid: false };
  });

  app.post('/device/v1/telemetry', async (request, reply) => {
    const authorization = request.headers.authorization; const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''; const [credentialId, secret] = token.split('.'); if (!credentialId || !secret) return reply.status(401).send({ error: 'Invalid device credential' });
    const credential = await db.query<{ vehicle_id: string; secret_hash: string }>('SELECT vehicle_id,secret_hash FROM device_credentials WHERE id=$1 AND active=true', [credentialId]); if (!credential.rows[0] || credential.rows[0].secret_hash !== hashSecret(secret)) return reply.status(401).send({ error: 'Invalid device credential' });
    const body = object(request.body); if (!Array.isArray(body?.points) || !body.points.length) throw new Error('points must be a non-empty array'); const vehicleId = credential.rows[0].vehicle_id; let accepted = 0;
    for (const raw of body.points) { const point = object(raw); const occurredAt = string(point?.occurredAt, 'occurredAt'); const longitude = number(point?.longitude, 'longitude', -180, 180); const latitude = number(point?.latitude, 'latitude', -90, 90); const optional = (key: string, min = -Infinity, max = Infinity) => point?.[key] === undefined || point?.[key] === null ? null : number(point?.[key], key, min, max); const row = await db.query('INSERT INTO telemetry_points (id,vehicle_id,occurred_at,longitude,latitude,altitude_m,accuracy_m,speed_kph,heading_deg,battery_pct,mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (vehicle_id,occurred_at) DO NOTHING RETURNING id', [randomUUID(), vehicleId, occurredAt, longitude, latitude, optional('altitudeM'), optional('accuracyM', 0), optional('speedKph', 0), optional('headingDeg', 0, 360), optional('batteryPct', 0, 100), typeof point?.mode === 'string' ? point.mode : null]); if (row.rowCount) { accepted++; hub.publish(vehicleId, { occurredAt, longitude, latitude, altitudeM: optional('altitudeM'), accuracyM: optional('accuracyM', 0), speedKph: optional('speedKph', 0), headingDeg: optional('headingDeg', 0, 360), batteryPct: optional('batteryPct', 0, 100), mode: typeof point?.mode === 'string' ? point.mode : null }); } }
    return { accepted };
  });
  app.get('/device/v1/patrol/tasks/next', async (request) => {
    const vehicleId = await deviceVehicle(request); const task = await db.transaction(async (client) => {
      const next = await client.query<TaskRow>("SELECT * FROM patrol_tasks WHERE vehicle_id=$1 AND status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1", [vehicleId]); if (!next.rows[0]) return null;
      await client.query("UPDATE patrol_tasks SET status='running',started_at=COALESCE(started_at,now()) WHERE id=$1", [next.rows[0].id]); await client.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), next.rows[0].id, JSON.stringify({ status: 'running', source: 'scheduler' })]); return next.rows[0];
    });
    if (!task) return { task: null };
    const waypoints = await db.query<WaypointRow>('SELECT id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi FROM patrol_waypoints WHERE route_id=$1 ORDER BY ordinal', [task.route_id]); return { task: { ...taskDto({ ...task, status: 'running', started_at: task.started_at ?? new Date().toISOString() }), waypoints: waypoints.rows.map(waypointDto) } };
  });
  app.get('/device/v1/patrol/tasks/active', async (request) => {
    const vehicleId = await deviceVehicle(request); const result = await db.query<TaskRow>("SELECT * FROM patrol_tasks WHERE vehicle_id=$1 AND status IN ('queued','running','cancellation_requested') ORDER BY created_at DESC LIMIT 1", [vehicleId]); return { task: result.rows[0] ? taskDto(result.rows[0]) : null };
  });
  app.post('/device/v1/patrol/tasks/:taskId/events', async (request) => {
    const vehicleId = await deviceVehicle(request); const taskId = (request.params as { taskId: string }).taskId; const task = await db.query<TaskRow>('SELECT * FROM patrol_tasks WHERE id=$1 AND vehicle_id=$2', [taskId, vehicleId]); if (!task.rows[0]) throw Object.assign(new Error('Patrol task not found'), { statusCode: 404 }); const body = object(request.body); const type = body?.type;
    if (type === 'stop_confirmed') {
      if (task.rows[0].status !== 'cancellation_requested') throw Object.assign(new Error('Task has no pending cancellation'), { statusCode: 409 }); if (body?.zeroVelocity !== true) throw new Error('zeroVelocity confirmation is required');
      await db.query("UPDATE patrol_tasks SET status='stopped',stop_confirmed_at=now(),zero_velocity_confirmed_at=now(),finished_at=now() WHERE id=$1", [taskId]); await db.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), taskId, JSON.stringify({ status: 'stopped', source: 'scheduler', zeroVelocity: true })]); await audit('patrol-task.stop.confirmed', 'success', undefined, vehicleId, { taskId }); return { ok: true };
    }
    if (type === 'status') {
      const status = body?.status; if (status !== 'running' && status !== 'completed' && status !== 'failed') throw new Error('status is invalid'); const terminal = status === 'completed' || status === 'failed';
      const result = await db.query(terminal ? "UPDATE patrol_tasks SET status=$1,finished_at=now(),failure_reason=CASE WHEN $1='failed' THEN $2 ELSE failure_reason END WHERE id=$3 AND status='running' RETURNING id" : "UPDATE patrol_tasks SET status='running',started_at=COALESCE(started_at,now()) WHERE id=$1 AND status IN ('queued','running') RETURNING id", terminal ? [status, typeof body?.reason === 'string' ? body.reason : null, taskId] : [taskId]);
      if (!result.rowCount) throw Object.assign(new Error(terminal ? 'Task is not running' : 'Task is not ready to run'), { statusCode: 409 });
      await db.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), taskId, JSON.stringify({ status, reason: typeof body?.reason === 'string' ? body.reason : undefined })]); await audit('patrol-task.scheduler-status', 'success', undefined, vehicleId, { taskId, status }); return { ok: true };
    }
    const waypointId = string(body?.waypointId, 'waypointId'); const waypoint = await db.query<WaypointRow>('SELECT w.id,w.ordinal,w.name,w.x,w.y,w.yaw,w.dwell_seconds,w.no_parking_roi FROM patrol_waypoints w JOIN patrol_tasks t ON t.route_id=w.route_id WHERE w.id=$1 AND t.id=$2', [waypointId, taskId]); if (!waypoint.rows[0]) throw new Error('Waypoint does not belong to task');
    if (type === 'waypoint') { if (task.rows[0].status !== 'running') throw new Error('Task is not running'); await db.query("INSERT INTO patrol_events (id,task_id,event_type,waypoint_id,details) VALUES ($1,$2,'waypoint',$3,$4)", [randomUUID(), taskId, waypointId, JSON.stringify({ state: typeof body?.state === 'string' ? body.state : 'arrived' })]); return { ok: true }; }
    if (type !== 'observation') throw new Error('event type is invalid'); if (task.rows[0].status !== 'running') throw new Error('Task is not running'); const confidence = number(body?.confidence, 'confidence', 0, 1); const occurredAt = string(body?.occurredAt, 'occurredAt'); const occurred = new Date(occurredAt); if (Number.isNaN(occurred.getTime())) throw new Error('occurredAt is invalid'); const plate = typeof body?.plate === 'string' && body.plate.trim() ? normalisePlate(body.plate) : null; const bucket = new Date(Math.floor(occurred.getTime() / 1_800_000) * 1_800_000).toISOString(); const classification = confidence < 0.75 || !plate ? 'pending_review' : (await db.query<{ category: 'private' | 'visitor' }>('SELECT category FROM whitelist_entries WHERE whitelist_id=$1 AND plate=$2', [task.rows[0].whitelist_id, plate])).rows[0]?.category === 'private' ? 'registered_private' : (await db.query<{ category: 'private' | 'visitor' }>('SELECT category FROM whitelist_entries WHERE whitelist_id=$1 AND plate=$2', [task.rows[0].whitelist_id, plate])).rows[0]?.category === 'visitor' ? 'visitor' : 'suspected_external'; const noParking = bboxIntersectsRoi(body?.vehicleBox, waypoint.rows[0].no_parking_roi); const longitude = body?.longitude === undefined ? null : number(body?.longitude, 'longitude', -180, 180); const latitude = body?.latitude === undefined ? null : number(body?.latitude, 'latitude', -90, 90); const dedupeKey = plate && confidence >= 0.75 ? plate : randomUUID();
    await db.query("INSERT INTO plate_observations (id,task_id,waypoint_id,occurred_at,dedupe_bucket,dedupe_key,plate,confidence,classification,no_parking,evidence_image_url,annotated_image_url,longitude,latitude,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$4) ON CONFLICT (task_id,waypoint_id,dedupe_key,dedupe_bucket) DO UPDATE SET observation_count=plate_observations.observation_count+1,last_seen_at=EXCLUDED.last_seen_at,confidence=GREATEST(plate_observations.confidence,EXCLUDED.confidence),no_parking=plate_observations.no_parking OR EXCLUDED.no_parking,evidence_image_url=COALESCE(EXCLUDED.evidence_image_url,plate_observations.evidence_image_url),annotated_image_url=COALESCE(EXCLUDED.annotated_image_url,plate_observations.annotated_image_url)", [randomUUID(), taskId, waypointId, occurred.toISOString(), bucket, dedupeKey, plate, confidence, classification, noParking, typeof body?.evidenceImageUrl === 'string' ? body.evidenceImageUrl : null, typeof body?.annotatedImageUrl === 'string' ? body.annotatedImageUrl : null, longitude, latitude]); return { ok: true, classification, noParking };
  });
  app.get('/api/vehicles/:id/track', async (request) => { const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const query = request.query as { from?: string; to?: string }; const result = await db.query('SELECT occurred_at AS "occurredAt",longitude,latitude,altitude_m AS "altitudeM",accuracy_m AS "accuracyM",speed_kph AS "speedKph",heading_deg AS "headingDeg",battery_pct AS "batteryPct",mode FROM telemetry_points WHERE vehicle_id=$1 AND occurred_at >= COALESCE($2::timestamptz,now()-interval \'24 hours\') AND occurred_at <= COALESCE($3::timestamptz,now()) ORDER BY occurred_at', [vehicleId, query.from ?? null, query.to ?? null]); return { points: result.rows }; });
  app.get('/api/audit-logs', async (request) => { await requireAdmin(request); const result = await db.query('SELECT id,actor_user_id AS "actorUserId",vehicle_id AS "vehicleId",action,outcome,metadata,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 200'); return { logs: result.rows }; });

  app.get('/ws', { websocket: true }, async (socket, request) => { const user = await currentUser(request); if (!user) return socket.close(1008, 'Authentication required'); let unsubscribe: (() => void) | undefined; socket.on('message', async (raw: Buffer) => { try { const message = JSON.parse(raw.toString()) as { type?: string; vehicleId?: string }; if (message.type !== 'subscribe' || !message.vehicleId || !await canAccessVehicle(user, message.vehicleId)) return socket.send(JSON.stringify({ type: 'error', message: 'Vehicle access denied' })); unsubscribe?.(); unsubscribe = hub.subscribe(message.vehicleId, socket); socket.send(JSON.stringify({ type: 'subscribed', vehicleId: message.vehicleId })); } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); } }); socket.on('close', () => unsubscribe?.()); });

  app.addHook('onClose', async () => { if (!services.db) await db.close(); });
  return app;
}
