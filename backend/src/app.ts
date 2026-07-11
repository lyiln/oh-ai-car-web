import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { loadConfig, type Config } from './config.js';
import { Database } from './db/index.js';
import { registerPatrolPlatformRoutes } from './routes/patrol-platform.js';
import { hashSecret, randomSecret, sign, verify, type SignedPayload } from './security.js';

type Role = 'admin' | 'operator';
interface UserRow { id: string; username: string; display_name: string; password_hash: string; role: Role; active: boolean; email: string | null; }
interface VehicleRow {
  id: string;
  code: string;
  name: string;
  description: string;
  tcp_host: string;
  tcp_port: number;
  video_port: number;
  archived: boolean;
  bridge_url?: string | null;
  last_seen_at?: Date | null;
  last_patrol_at?: Date | null;
}
interface DeviceCredentialRow { vehicle_id: string; secret_hash: string; }
interface SessionPayload extends SignedPayload { sub: string; role: Role; }
interface LeasePayload extends SignedPayload { sub: string; role: Role; leaseId: string; vehicleId: string; }
type PatrolSocket = { send: (value: string) => void; vehicleId?: string };
const SESSION_COOKIE = 'oh_ai_session';
const LEASE_MS = 60_000;
const USER_SELECT = 'id, username, display_name, password_hash, role, active, email';

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function number(value: unknown, field: string, min: number, max: number): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} is invalid`); return value; }
function normalisePlate(value: unknown): string { const plate = string(value, 'plate').replace(/[\s-]/g, '').toUpperCase(); if (!/^[A-Z0-9]{5,10}$/.test(plate)) throw new Error('plate is invalid'); return plate; }
function bboxIntersectsRoi(box: unknown, roi: unknown): boolean {
  if (!Array.isArray(box) || !Array.isArray(roi) || box.length !== 4 || roi.length !== 4 || !box.every((value) => typeof value === 'number' && value >= 0 && value <= 1)) return false;
  const [x, y, width, height] = box as number[]; const [roiX, roiY, roiWidth, roiHeight] = roi as number[];
  return x < roiX + roiWidth && x + width > roiX && y < roiY + roiHeight && y + height > roiY;
}
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function isEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function userDto(user: UserRow) { return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, active: user.active, email: user.email }; }
function generatePasscode(): string { return String(Math.floor(100_000 + Math.random() * 900_000)); }

export class RealtimeHub {
  private readonly subscribers = new Map<string, Set<{ send: (value: string) => void }>>();
  private readonly patrolSubscribers = new Set<PatrolSocket>();
  subscribe(vehicleId: string, socket: { send: (value: string) => void }) { const set = this.subscribers.get(vehicleId) ?? new Set(); set.add(socket); this.subscribers.set(vehicleId, set); return () => { set.delete(socket); if (!set.size) this.subscribers.delete(vehicleId); }; }
  publish(vehicleId: string, payload: unknown) {
    for (const socket of this.subscribers.get(vehicleId) ?? []) socket.send(JSON.stringify({ type: 'vehicle.position', vehicleId, payload }));
    const pose = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    for (const socket of this.patrolSubscribers) {
      if (socket.vehicleId && socket.vehicleId !== vehicleId) continue;
      socket.send(JSON.stringify({ type: 'pose_update', vehicleId, ...pose }));
    }
  }
  subscribePatrol(socket: { send: (value: string) => void }, vehicleId?: string) {
    const entry: PatrolSocket = { send: socket.send.bind(socket), vehicleId };
    this.patrolSubscribers.add(entry);
    return () => { this.patrolSubscribers.delete(entry); };
  }
  publishPatrol(msg: unknown) {
    const text = JSON.stringify(msg);
    for (const socket of this.patrolSubscribers) socket.send(text);
  }
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
    const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE id=$1`, [claim.sub]);
    return result.rows[0]?.active ? result.rows[0] : null;
  }
  function issueSession(reply: { setCookie: (name: string, value: string, options: Record<string, unknown>) => void }, user: UserRow) {
    const token = sign({ sub: user.id, role: user.role, exp: Date.now() + 8 * 60 * 60_000 }, config.sessionSecret);
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 8 * 60 * 60 });
  }
  async function requireUser(request: FastifyRequest): Promise<UserRow> { const user = await currentUser(request); if (!user) throw Object.assign(new Error('Authentication required'), { statusCode: 401 }); return user; }
  async function requireAdmin(request: FastifyRequest): Promise<UserRow> { const user = await requireUser(request); if (user.role !== 'admin') throw Object.assign(new Error('Administrator role required'), { statusCode: 403 }); return user; }
  async function canAccessVehicle(user: UserRow, vehicleId: string): Promise<boolean> {
    if (user.role === 'admin') return true;
    const result = await db.query('SELECT 1 FROM vehicle_members WHERE vehicle_id=$1 AND user_id=$2', [vehicleId, user.id]);
    return result.rowCount === 1;
  }
  async function deviceVehicle(request: FastifyRequest): Promise<string> {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const [credentialId, secret] = token.split('.');
    if (!credentialId || !secret) throw Object.assign(new Error('Invalid device credential'), { statusCode: 401 });
    const credential = await db.query<DeviceCredentialRow>('SELECT vehicle_id,secret_hash FROM device_credentials WHERE id=$1 AND active=true', [credentialId]);
    if (!credential.rows[0] || credential.rows[0].secret_hash !== hashSecret(secret)) throw Object.assign(new Error('Invalid device credential'), { statusCode: 401 });
    return credential.rows[0].vehicle_id;
  }
  function vehicleDto(row: VehicleRow) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      host: row.tcp_host,
      tcpPort: row.tcp_port,
      videoPort: row.video_port,
      bridgeUrl: row.bridge_url ?? '',
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
      lastPatrolAt: row.last_patrol_at ? new Date(row.last_patrol_at).toISOString() : null,
      archived: row.archived,
    };
  }
  function leaseToken(leaseId: string, vehicleId: string, user: UserRow, expiresAt: Date) { return sign({ sub: user.id, role: user.role, leaseId, vehicleId, exp: expiresAt.getTime() }, config.sessionSecret); }

  app.setErrorHandler((error, _request, reply) => reply.status((error as { statusCode?: number }).statusCode ?? 400).send({ error: error instanceof Error ? error.message : 'Request failed' }));
  app.get('/health', async () => ({ ok: true }));

  app.post('/api/auth/login', async (request, reply) => {
    const body = object(request.body); const username = string(body?.username, 'username'); const password = string(body?.password, 'password');
    const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE username=$1`, [username]);
    const user = result.rows[0];
    if (!user || !user.active || !await argon2.verify(user.password_hash, password)) { await audit('auth.login', 'rejected', undefined, undefined, { username }); return reply.status(401).send({ error: 'Invalid username or password' }); }
    issueSession(reply, user);
    await audit('auth.login', 'success', user.id); return { user: userDto(user) };
  });
  app.post('/api/auth/request-otp', async (request, reply) => {
    const body = object(request.body); const username = string(body?.username, 'username');
    const generic = { ok: true as const, message: '若账号已登记将收到验证码', time: String(config.otpExpiryMinutes) };
    const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE username=$1 AND active=true`, [username]);
    const user = result.rows[0];
    if (!user || !user.email) {
      await audit('auth.otp.request', 'unknown_user', undefined, undefined, { username });
      return generic;
    }
    const email = normalizeEmail(user.email);
    const recent = await db.query<{ created_at: Date }>('SELECT created_at FROM auth_otps WHERE email=$1 ORDER BY created_at DESC LIMIT 1', [email]);
    if (recent.rows[0] && Date.now() - recent.rows[0].created_at.getTime() < config.otpResendCooldownSeconds * 1000) {
      await audit('auth.otp.request', 'throttled', undefined, undefined, { username, email });
      return reply.status(429).send({ error: '请稍后再获取验证码' });
    }
    const passcode = generatePasscode();
    const expiresAt = new Date(Date.now() + config.otpExpiryMinutes * 60_000);
    await db.query('INSERT INTO auth_otps (id, user_id, email, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), user.id, email, await argon2.hash(passcode), expiresAt]);
    await audit('auth.otp.request', 'success', user.id, undefined, { username, email });
    // Delivery is intentionally server-side only. Do not disclose a usable code
    // to the requesting browser or let a public EmailJS credential send it.
    app.log.warn({ userId: user.id }, 'OTP created but no server-side delivery provider is configured');
    return generic;
  });
  app.post('/api/auth/verify-otp', async (request, reply) => {
    const body = object(request.body); const username = string(body?.username, 'username'); const passcode = string(body?.passcode, 'passcode');
    if (!/^\d{6}$/.test(passcode)) throw Object.assign(new Error('passcode is invalid'), { statusCode: 400 });
    const userResult = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE username=$1 AND active=true`, [username]);
    const candidate = userResult.rows[0];
    if (!candidate?.email) {
      await audit('auth.otp.verify', 'rejected', undefined, undefined, { username });
      return reply.status(401).send({ error: '验证码无效或已过期' });
    }
    const email = normalizeEmail(candidate.email);
    const otp = await db.query<{ id: string; user_id: string; code_hash: string; expires_at: Date }>('SELECT id, user_id, code_hash, expires_at FROM auth_otps WHERE email=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1', [email]);
    const row = otp.rows[0];
    if (!row || row.expires_at.getTime() < Date.now() || !await argon2.verify(row.code_hash, passcode)) {
      await audit('auth.otp.verify', 'rejected', undefined, undefined, { username, email });
      return reply.status(401).send({ error: '验证码无效或已过期' });
    }
    await db.query('UPDATE auth_otps SET consumed_at=now() WHERE id=$1', [row.id]);
    const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE id=$1 AND active=true`, [row.user_id]);
    const user = result.rows[0];
    if (!user) { await audit('auth.otp.verify', 'rejected', undefined, undefined, { username, email }); return reply.status(401).send({ error: '验证码无效或已过期' }); }
    issueSession(reply, user);
    await audit('auth.otp.verify', 'success', user.id, undefined, { username, email });
    return { user: userDto(user) };
  });
  app.post('/api/auth/logout', async (request, reply) => { const user = await currentUser(request); reply.clearCookie(SESSION_COOKIE, { path: '/' }); if (user) await audit('auth.logout', 'success', user.id); return { ok: true }; });
  app.get('/api/auth/me', async (request) => { const user = await requireUser(request); return { user: userDto(user) }; });
  app.patch('/api/auth/profile', async (request) => {
    const user = await requireUser(request);
    if (user.role !== 'admin') throw Object.assign(new Error('Administrator role required'), { statusCode: 403 });
    const body = object(request.body);
    const displayNameProvided = Object.prototype.hasOwnProperty.call(body ?? {}, 'displayName');
    const emailProvided = Object.prototype.hasOwnProperty.call(body ?? {}, 'email');
    const passwordProvided = Object.prototype.hasOwnProperty.call(body ?? {}, 'password');
    if (!displayNameProvided && !emailProvided && !passwordProvided) throw Object.assign(new Error('displayName, email, or password is required'), { statusCode: 400 });

    let displayName: string | undefined;
    if (displayNameProvided) displayName = string(body?.displayName, 'displayName');

    let email: string | null | undefined;
    if (emailProvided) {
      if (body?.email === null || body?.email === '') email = null;
      else {
        email = normalizeEmail(string(body?.email, 'email'));
        if (!isEmail(email)) throw Object.assign(new Error('email is invalid'), { statusCode: 400 });
        const clash = await db.query<{ id: string }>('SELECT id FROM users WHERE email=$1 AND id<>$2', [email, user.id]);
        if (clash.rows[0]) throw Object.assign(new Error('email is already in use'), { statusCode: 409 });
      }
    }

    let passwordHash: string | undefined;
    if (passwordProvided) {
      const password = string(body?.password, 'password');
      const currentPassword = string(body?.currentPassword, 'currentPassword');
      if (!await argon2.verify(user.password_hash, currentPassword)) {
        await audit('auth.profile', 'rejected', user.id, undefined, { reason: 'bad_current_password' });
        throw Object.assign(new Error('当前密码不正确'), { statusCode: 401 });
      }
      passwordHash = await argon2.hash(password);
    }

    const next = await db.query<UserRow>(
      `UPDATE users SET
        display_name = COALESCE($1, display_name),
        email = CASE WHEN $2::boolean THEN $3 ELSE email END,
        password_hash = COALESCE($4, password_hash),
        updated_at = now()
      WHERE id=$5
      RETURNING ${USER_SELECT}`,
      [
        displayName ?? null,
        emailProvided,
        emailProvided ? email ?? null : null,
        passwordHash ?? null,
        user.id,
      ],
    );
    const updated = next.rows[0];
    await audit('auth.profile', 'success', user.id, undefined, {
      displayName: displayNameProvided,
      email: emailProvided,
      password: passwordProvided,
    });
    return { user: userDto(updated) };
  });

  app.get('/api/users', async (request) => { await requireAdmin(request); const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users ORDER BY username`); return { users: result.rows.map(userDto) }; });
  app.post('/api/users', async (request) => {
    const admin = await requireAdmin(request); const body = object(request.body); const username = string(body?.username, 'username'); const displayName = string(body?.displayName, 'displayName'); const password = string(body?.password, 'password'); const role = body?.role === 'admin' ? 'admin' : body?.role === 'operator' ? 'operator' : (() => { throw new Error('role is invalid'); })();
    const emailRaw = typeof body?.email === 'string' && body.email.trim() ? normalizeEmail(body.email) : null;
    if (emailRaw && !isEmail(emailRaw)) throw Object.assign(new Error('email is invalid'), { statusCode: 400 });
    const id = randomUUID();
    await db.query('INSERT INTO users (id,username,display_name,password_hash,role,email) VALUES ($1,$2,$3,$4,$5,$6)', [id, username, displayName, await argon2.hash(password), role, emailRaw]);
    await audit('user.create', 'success', admin.id, undefined, { createdUserId: id });
    return { user: { id, username, displayName, role, active: true, email: emailRaw } };
  });
  app.patch('/api/users/:id', async (request) => {
    const admin = await requireAdmin(request); const body = object(request.body); const id = (request.params as { id: string }).id;
    const active = body?.active; const emailProvided = Object.prototype.hasOwnProperty.call(body ?? {}, 'email');
    if (typeof active !== 'boolean' && !emailProvided) throw new Error('active or email is required');
    let email: string | null | undefined;
    if (emailProvided) {
      if (body?.email === null || body?.email === '') email = null;
      else { email = normalizeEmail(string(body?.email, 'email')); if (!isEmail(email)) throw Object.assign(new Error('email is invalid'), { statusCode: 400 }); }
    }
    if (typeof active === 'boolean' && email !== undefined) await db.query('UPDATE users SET active=$1,email=$2,updated_at=now() WHERE id=$3', [active, email, id]);
    else if (typeof active === 'boolean') await db.query('UPDATE users SET active=$1,updated_at=now() WHERE id=$2', [active, id]);
    else await db.query('UPDATE users SET email=$1,updated_at=now() WHERE id=$2', [email, id]);
    await audit('user.update', 'success', admin.id, undefined, { targetUserId: id, active, email });
    return { ok: true };
  });

  app.get('/api/vehicles', async (request) => {
    const user = await requireUser(request); const result = user.role === 'admin' ? await db.query<VehicleRow>('SELECT * FROM vehicles WHERE archived=false ORDER BY name') : await db.query<VehicleRow>('SELECT v.* FROM vehicles v JOIN vehicle_members m ON m.vehicle_id=v.id WHERE m.user_id=$1 AND v.archived=false ORDER BY v.name', [user.id]);
    return { vehicles: result.rows.map(vehicleDto) };
  });
  app.post('/api/vehicles', async (request) => {
    const admin = await requireAdmin(request); const body = object(request.body); const id = randomUUID(); const code = string(body?.code, 'code'); const name = string(body?.name, 'name'); const host = string(body?.host, 'host'); const tcpPort = number(body?.tcpPort, 'tcpPort', 1, 65535); const videoPort = number(body?.videoPort, 'videoPort', 1, 65535); const description = typeof body?.description === 'string' ? body.description : ''; const bridgeUrl = typeof body?.bridgeUrl === 'string' ? body.bridgeUrl : '';
    await db.query('INSERT INTO vehicles (id,code,name,description,tcp_host,tcp_port,video_port,bridge_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, code, name, description, host, tcpPort, videoPort, bridgeUrl]); await audit('vehicle.create', 'success', admin.id, id); return { vehicle: { id, code, name, description, host, tcpPort, videoPort, bridgeUrl, lastSeenAt: null, lastPatrolAt: null, archived: false } };
  });
  app.get('/api/vehicles/:id', async (request) => { const user = await requireUser(request); const id = (request.params as { id: string }).id; if (!await canAccessVehicle(user, id)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const result = await db.query<VehicleRow>('SELECT * FROM vehicles WHERE id=$1', [id]); if (!result.rows[0]) throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 }); return { vehicle: vehicleDto(result.rows[0]) }; });
  app.patch('/api/vehicles/:id', async (request) => { const admin = await requireAdmin(request); const id = (request.params as { id: string }).id; const body = object(request.body); const description = typeof body?.description === 'string' ? body.description : ''; await db.query('UPDATE vehicles SET name=COALESCE($1,name),description=$2,updated_at=now() WHERE id=$3', [typeof body?.name === 'string' ? body.name.trim() : null, description, id]); await audit('vehicle.update', 'success', admin.id, id); return { ok: true }; });
  app.put('/api/vehicles/:id/members', async (request) => { const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const body = object(request.body); if (!Array.isArray(body?.userIds) || !body.userIds.every((id) => typeof id === 'string')) throw new Error('userIds must be strings'); await db.transaction(async (client) => { await client.query('DELETE FROM vehicle_members WHERE vehicle_id=$1', [vehicleId]); for (const userId of body.userIds as string[]) await client.query('INSERT INTO vehicle_members (vehicle_id,user_id) VALUES ($1,$2)', [vehicleId, userId]); }); await audit('vehicle.members.update', 'success', admin.id, vehicleId); return { ok: true }; });
  app.post('/api/vehicles/:id/device-credentials', async (request) => { const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const id = randomUUID(); const secret = randomSecret(); await db.transaction(async (client) => { await client.query('UPDATE device_credentials SET active=false,revoked_at=now() WHERE vehicle_id=$1 AND active=true', [vehicleId]); await client.query('INSERT INTO device_credentials (id,vehicle_id,secret_hash) VALUES ($1,$2,$3)', [id, vehicleId, hashSecret(secret)]); }); await audit('device-credential.rotate', 'success', admin.id, vehicleId); return { credential: { id, token: `${id}.${secret}` } }; });

  async function acquireLease(client: PoolClient, user: UserRow, vehicleId: string) {
    await client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [vehicleId]);
    const patrol = await client.query("SELECT status FROM patrol_tasks WHERE vehicle_id=$1 AND status IN ('queued','running','cancellation_requested') LIMIT 1", [vehicleId]);
    if (patrol.rowCount) throw Object.assign(new Error('Patrol is active or awaiting zero-velocity stop confirmation'), { statusCode: 409 });
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
    await db.query('UPDATE vehicles SET last_seen_at=now() WHERE id=$1', [vehicleId]);
    return { accepted };
  });
  app.get('/device/v1/patrol/tasks/next', async (request) => {
    const vehicleId = await deviceVehicle(request);
    const task = await db.transaction(async (client) => {
      const claimed = await client.query<{ id: string; route_id: string }>("UPDATE patrol_tasks SET status='running',started_at=COALESCE(started_at,now()) WHERE id=(SELECT id FROM patrol_tasks WHERE vehicle_id=$1 AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,route_id", [vehicleId]);
      return claimed.rows[0] ?? null;
    });
    if (!task) return { task: null };
    const waypoints = await db.query('SELECT id,ordinal,name,x,y,yaw,dwell_seconds AS "dwellSeconds",no_parking_roi AS "noParkingRoi" FROM patrol_waypoints WHERE route_id=$1 ORDER BY ordinal', [task.route_id]);
    hub.publishPatrol({ type: 'patrol_status', taskId: task.id, vehicleId, status: 'running' });
    return { task: { id: task.id, vehicleId, waypoints: waypoints.rows } };
  });
  app.post('/device/v1/patrol/tasks/:id/events', async (request) => {
    const vehicleId = await deviceVehicle(request);
    const taskId = (request.params as { id: string }).id;
    const body = object(request.body);
    const task = await db.query<{ status: string; whitelist_id: string; route_id: string }>('SELECT status,whitelist_id,route_id FROM patrol_tasks WHERE id=$1 AND vehicle_id=$2', [taskId, vehicleId]);
    if (!task.rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    if (body?.type === 'stop_confirmed') {
      if (task.rows[0].status !== 'cancellation_requested' || body.zeroVelocity !== true) throw Object.assign(new Error('Zero-velocity confirmation is required'), { statusCode: 409 });
      await db.transaction(async (client) => {
        await client.query("UPDATE patrol_tasks SET status='stopped',stop_confirmed_at=now(),zero_velocity_confirmed_at=now(),finished_at=now() WHERE id=$1", [taskId]);
        await client.query("INSERT INTO patrol_events (id,task_id,event_type,details) VALUES ($1,$2,'status',$3)", [randomUUID(), taskId, JSON.stringify({ status: 'stopped', zeroVelocity: true })]);
      });
      hub.publishPatrol({ type: 'patrol_status', taskId, vehicleId, status: 'stopped' });
      return { ok: true };
    }
    if (task.rows[0].status !== 'running') throw Object.assign(new Error('Task is not accepting scheduler events'), { statusCode: 409 });
    if (body?.type === 'status' && (body.status === 'completed' || body.status === 'failed')) {
      await db.query("UPDATE patrol_tasks SET status=$1,finished_at=now(),failure_reason=$2 WHERE id=$3", [body.status, typeof body.reason === 'string' ? body.reason : null, taskId]);
      hub.publishPatrol({ type: 'patrol_status', taskId, vehicleId, status: body.status });
      return { ok: true };
    }
    if (body?.type === 'observation') {
      const waypointId = string(body.waypointId, 'waypointId');
      const waypoint = await db.query<{ no_parking_roi: unknown; name: string }>('SELECT no_parking_roi, name FROM patrol_waypoints WHERE id=$1 AND route_id=$2', [waypointId, task.rows[0].route_id]);
      if (!waypoint.rows[0]) throw Object.assign(new Error('Waypoint not found'), { statusCode: 404 });
      const confidence = number(body.confidence, 'confidence', 0, 1);
      const occurredAt = string(body.occurredAt, 'occurredAt');
      const occurred = new Date(occurredAt);
      if (Number.isNaN(occurred.getTime())) throw Object.assign(new Error('occurredAt is invalid'), { statusCode: 400 });
      const plate = typeof body.plate === 'string' && body.plate.trim() ? normalisePlate(body.plate) : null;
      const whitelist = plate && confidence >= 0.75
        ? await db.query<{ category: 'private' | 'visitor' }>('SELECT category FROM whitelist_entries WHERE whitelist_id=$1 AND plate=$2', [task.rows[0].whitelist_id, plate])
        : { rows: [] as Array<{ category: 'private' | 'visitor' }> };
      const classification = confidence < 0.75 || !plate
        ? 'pending_review'
        : whitelist.rows[0]?.category === 'private' ? 'registered_private'
          : whitelist.rows[0]?.category === 'visitor' ? 'visitor' : 'suspected_external';
      const noParking = bboxIntersectsRoi(body.vehicleBox, waypoint.rows[0].no_parking_roi);
      const longitude = body.longitude === undefined ? null : number(body.longitude, 'longitude', -180, 180);
      const latitude = body.latitude === undefined ? null : number(body.latitude, 'latitude', -90, 90);
      const bucket = new Date(Math.floor(occurred.getTime() / 1_800_000) * 1_800_000).toISOString();
      const dedupeKey = plate && confidence >= 0.75 ? plate : randomUUID();
      // FR-005: plate_observations + patrol_events + reviews 原子写入，防止部分失败导致 review 队列缺项
      const { observationId, observationCount } = await db.transaction(async (client) => {
        const obs = await client.query<{ id: string; observation_count: number }>(
          `INSERT INTO plate_observations (id,task_id,waypoint_id,occurred_at,dedupe_bucket,dedupe_key,plate,confidence,classification,no_parking,evidence_image_url,annotated_image_url,longitude,latitude,last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$4)
           ON CONFLICT (task_id,waypoint_id,dedupe_key,dedupe_bucket) DO UPDATE SET
             observation_count=plate_observations.observation_count+1,
             last_seen_at=GREATEST(plate_observations.last_seen_at, EXCLUDED.last_seen_at),
             confidence=GREATEST(plate_observations.confidence, EXCLUDED.confidence),
             classification=CASE WHEN EXCLUDED.confidence >= plate_observations.confidence THEN EXCLUDED.classification ELSE plate_observations.classification END,
             no_parking=plate_observations.no_parking OR EXCLUDED.no_parking,
             evidence_image_url=COALESCE(EXCLUDED.evidence_image_url, plate_observations.evidence_image_url),
             annotated_image_url=COALESCE(EXCLUDED.annotated_image_url, plate_observations.annotated_image_url)
           RETURNING id,observation_count`,
          [randomUUID(), taskId, waypointId, occurred.toISOString(), bucket, dedupeKey, plate, confidence, classification, noParking, typeof body.evidenceImageUrl === 'string' ? body.evidenceImageUrl : null, typeof body.annotatedImageUrl === 'string' ? body.annotatedImageUrl : null, longitude, latitude],
        );
        if (classification === 'pending_review' && obs.rows[0].observation_count === 1) {
          const eventId = randomUUID();
          await client.query(
            `INSERT INTO patrol_events
               (id, task_id, event_type, waypoint_id, waypoint, plate, confidence, evidence_url, review_status, occurred_at, details)
             VALUES ($1, $2, 'observation', $3, $4, $5, $6, $7, 'pending', $8, $9)`,
            [
              eventId,
              taskId,
              waypointId,
              waypoint.rows[0].name,
              plate,
              confidence,
              typeof body.evidenceImageUrl === 'string' ? body.evidenceImageUrl : null,
              occurred.toISOString(),
              JSON.stringify({ observationId: obs.rows[0].id, source: 'device' }),
            ],
          );
          await client.query(
            `INSERT INTO reviews (id, event_id, reason, status) VALUES ($1, $2, 'low_confidence', 'pending')`,
            [randomUUID(), eventId],
          );
        }
        return { observationId: obs.rows[0].id, observationCount: obs.rows[0].observation_count };
      });
      return { ok: true, observationId, classification, noParking, deduplicated: observationCount > 1 };
    }
    if (body?.type !== 'waypoint' || typeof body.waypointId !== 'string') throw Object.assign(new Error('Unsupported scheduler event'), { statusCode: 400 });
    await db.query("INSERT INTO patrol_events (id,task_id,event_type,waypoint_id,details) VALUES ($1,$2,'waypoint',$3,$4)", [randomUUID(), taskId, body.waypointId, JSON.stringify(body)]);
    return { ok: true };
  });
  app.get('/api/vehicles/:id/track', async (request) => { const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const query = request.query as { from?: string; to?: string }; const result = await db.query('SELECT occurred_at AS "occurredAt",longitude,latitude,altitude_m AS "altitudeM",accuracy_m AS "accuracyM",speed_kph AS "speedKph",heading_deg AS "headingDeg",battery_pct AS "batteryPct",mode FROM telemetry_points WHERE vehicle_id=$1 AND occurred_at >= COALESCE($2::timestamptz,now()-interval \'24 hours\') AND occurred_at <= COALESCE($3::timestamptz,now()) ORDER BY occurred_at', [vehicleId, query.from ?? null, query.to ?? null]); return { points: result.rows }; });
  app.get('/api/audit-logs', async (request) => { await requireAdmin(request); const result = await db.query('SELECT id,actor_user_id AS "actorUserId",vehicle_id AS "vehicleId",action,outcome,metadata,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 200'); return { logs: result.rows }; });

  app.get('/ws', { websocket: true }, async (socket, request) => { const user = await currentUser(request); if (!user) return socket.close(1008, 'Authentication required'); let unsubscribe: (() => void) | undefined; socket.on('message', async (raw: Buffer) => { try { const message = JSON.parse(raw.toString()) as { type?: string; vehicleId?: string }; if (message.type !== 'subscribe' || !message.vehicleId || !await canAccessVehicle(user, message.vehicleId)) return socket.send(JSON.stringify({ type: 'error', message: 'Vehicle access denied' })); unsubscribe?.(); unsubscribe = hub.subscribe(message.vehicleId, socket); socket.send(JSON.stringify({ type: 'subscribed', vehicleId: message.vehicleId })); } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); } }); socket.on('close', () => unsubscribe?.()); });

  registerPatrolPlatformRoutes(app, {
    db,
    requireUser,
    requireAdmin,
    canAccessVehicle: (user, vehicleId) => canAccessVehicle(user as UserRow, vehicleId),
    vehicleDto: (row) => vehicleDto(row),
    acquireLease: (client, user, vehicleId) => acquireLease(client, user as UserRow, vehicleId),
    leaseToken: (leaseId, vehicleId, user, expiresAt) => leaseToken(leaseId, vehicleId, user as UserRow, expiresAt),
    audit,
    hub,
  });

  app.addHook('onClose', async () => { if (!services.db) await db.close(); });
  return app;
}
