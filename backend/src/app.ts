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
interface SessionPayload extends SignedPayload { sub: string; role: Role; }
interface LeasePayload extends SignedPayload { sub: string; role: Role; leaseId: string; vehicleId: string; }
const SESSION_COOKIE = 'oh_ai_session';
const LEASE_MS = 60_000;

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function number(value: unknown, field: string, min: number, max: number): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} is invalid`); return value; }

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
  function vehicleDto(row: VehicleRow) { return { id: row.id, code: row.code, name: row.name, description: row.description, host: row.tcp_host, tcpPort: row.tcp_port, videoPort: row.video_port, archived: row.archived }; }
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
  app.post('/internal/control-lease/verify', async (request) => { const body = object(request.body); const token = string(body?.token, 'token'); const claim = verify<LeasePayload>(token, config.sessionSecret); if (!claim?.leaseId || !claim.vehicleId) return { valid: false }; const result = await db.query<VehicleRow>('SELECT v.* FROM control_leases l JOIN vehicles v ON v.id=l.vehicle_id JOIN users u ON u.id=l.user_id WHERE l.id=$1 AND l.vehicle_id=$2 AND l.user_id=$3 AND l.released_at IS NULL AND l.expires_at>now() AND u.active=true', [claim.leaseId, claim.vehicleId, claim.sub]); return result.rows[0] ? { valid: true, vehicle: vehicleDto(result.rows[0]), expiresAt: new Date(claim.exp).toISOString() } : { valid: false };
  });

  app.post('/device/v1/telemetry', async (request, reply) => {
    const authorization = request.headers.authorization; const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''; const [credentialId, secret] = token.split('.'); if (!credentialId || !secret) return reply.status(401).send({ error: 'Invalid device credential' });
    const credential = await db.query<{ vehicle_id: string; secret_hash: string }>('SELECT vehicle_id,secret_hash FROM device_credentials WHERE id=$1 AND active=true', [credentialId]); if (!credential.rows[0] || credential.rows[0].secret_hash !== hashSecret(secret)) return reply.status(401).send({ error: 'Invalid device credential' });
    const body = object(request.body); if (!Array.isArray(body?.points) || !body.points.length) throw new Error('points must be a non-empty array'); const vehicleId = credential.rows[0].vehicle_id; let accepted = 0;
    for (const raw of body.points) { const point = object(raw); const occurredAt = string(point?.occurredAt, 'occurredAt'); const longitude = number(point?.longitude, 'longitude', -180, 180); const latitude = number(point?.latitude, 'latitude', -90, 90); const optional = (key: string, min = -Infinity, max = Infinity) => point?.[key] === undefined || point?.[key] === null ? null : number(point?.[key], key, min, max); const row = await db.query('INSERT INTO telemetry_points (id,vehicle_id,occurred_at,longitude,latitude,altitude_m,accuracy_m,speed_kph,heading_deg,battery_pct,mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (vehicle_id,occurred_at) DO NOTHING RETURNING id', [randomUUID(), vehicleId, occurredAt, longitude, latitude, optional('altitudeM'), optional('accuracyM', 0), optional('speedKph', 0), optional('headingDeg', 0, 360), optional('batteryPct', 0, 100), typeof point?.mode === 'string' ? point.mode : null]); if (row.rowCount) { accepted++; hub.publish(vehicleId, { occurredAt, longitude, latitude, altitudeM: optional('altitudeM'), accuracyM: optional('accuracyM', 0), speedKph: optional('speedKph', 0), headingDeg: optional('headingDeg', 0, 360), batteryPct: optional('batteryPct', 0, 100), mode: typeof point?.mode === 'string' ? point.mode : null }); } }
    return { accepted };
  });
  app.get('/api/vehicles/:id/track', async (request) => { const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const query = request.query as { from?: string; to?: string }; const result = await db.query('SELECT occurred_at AS "occurredAt",longitude,latitude,altitude_m AS "altitudeM",accuracy_m AS "accuracyM",speed_kph AS "speedKph",heading_deg AS "headingDeg",battery_pct AS "batteryPct",mode FROM telemetry_points WHERE vehicle_id=$1 AND occurred_at >= COALESCE($2::timestamptz,now()-interval \'24 hours\') AND occurred_at <= COALESCE($3::timestamptz,now()) ORDER BY occurred_at', [vehicleId, query.from ?? null, query.to ?? null]); return { points: result.rows }; });
  app.get('/api/audit-logs', async (request) => { await requireAdmin(request); const result = await db.query('SELECT id,actor_user_id AS "actorUserId",vehicle_id AS "vehicleId",action,outcome,metadata,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 200'); return { logs: result.rows }; });

  app.get('/ws', { websocket: true }, async (socket, request) => { const user = await currentUser(request); if (!user) return socket.close(1008, 'Authentication required'); let unsubscribe: (() => void) | undefined; socket.on('message', async (raw: Buffer) => { try { const message = JSON.parse(raw.toString()) as { type?: string; vehicleId?: string }; if (message.type !== 'subscribe' || !message.vehicleId || !await canAccessVehicle(user, message.vehicleId)) return socket.send(JSON.stringify({ type: 'error', message: 'Vehicle access denied' })); unsubscribe?.(); unsubscribe = hub.subscribe(message.vehicleId, socket); socket.send(JSON.stringify({ type: 'subscribed', vehicleId: message.vehicleId })); } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); } }); socket.on('close', () => unsubscribe?.()); });

  app.addHook('onClose', async () => { if (!services.db) await db.close(); });
  return app;
}
