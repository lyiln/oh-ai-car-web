import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { parseDocument } from 'yaml';
import { loadConfig, type Config } from './config.js';
import { Database } from './db/index.js';
import { readEvidenceJpeg, saveEvidenceJpeg } from './evidence-storage.js';
import { createSmtpOtpMailer, type OtpMailer } from './otp-mailer.js';
import {
  classificationFromMatch,
  matchWhitelistPlate,
  normalisePlate,
  plateMatchDto,
} from './plate-match.js';
import { registerAiPlatformRoutes } from './routes/ai-platform.js';
import { registerPatrolPlatformRoutes } from './routes/patrol-platform.js';
import { createResponseCandidate, registerResponsePlatformRoutes } from './routes/response-platform.js';
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
type PatrolSocket = { send: (value: string) => void; vehicleId: string };
const SESSION_COOKIE = 'oh_ai_session';
const LEASE_MS = 60_000;
const USER_SELECT = 'id, username, display_name, password_hash, role, active, email';

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function number(value: unknown, field: string, min: number, max: number): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} is invalid`); return value; }
function bboxIntersectsRoi(box: unknown, roi: unknown): boolean {
  if (!Array.isArray(box) || !Array.isArray(roi) || box.length !== 4 || roi.length !== 4 || !box.every((value) => typeof value === 'number' && value >= 0 && value <= 1)) return false;
  const [x, y, width, height] = box as number[]; const [roiX, roiY, roiWidth, roiHeight] = roi as number[];
  return x < roiX + roiWidth && x + width > roiX && y < roiY + roiHeight && y + height > roiY;
}
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function isEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function normalizedAuthUsername(request: FastifyRequest): string {
  const body = object(request.body);
  return typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
}
function authRateKey(request: FastifyRequest): string {
  const username = normalizedAuthUsername(request);
  const usableUsername = username.length <= 128 && !/[\u0000-\u001f\u007f]/.test(username);
  return username && usableUsername ? `username:${username}` : `ip:${request.ip}`;
}
function userDto(user: UserRow) { return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, active: user.active, email: user.email }; }
function generatePasscode(): string { return String(Math.floor(100_000 + Math.random() * 900_000)); }
type ImportedWaypoint = { name: string; x: number; y: number; yaw: number; dwellSeconds: number; noParkingRoi: number[] | null };
function parsePatrolRouteYaml(source: string): ImportedWaypoint[] {
  const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length) throw Object.assign(new Error(`YAML 解析失败：${document.errors[0]?.message ?? '格式错误'}`), { statusCode: 400 });
  const root = object(document.toJS());
  if (!root || !Array.isArray(root.waypoints) || root.waypoints.length < 3 || root.waypoints.length > 8) {
    throw Object.assign(new Error('waypoints 必须包含 3 到 8 个航点'), { statusCode: 400 });
  }
  const names = new Set<string>();
  return root.waypoints.map((raw, index) => {
    const point = object(raw); const name = string(point?.name, `waypoints[${index}].name`);
    if (names.has(name)) throw Object.assign(new Error(`航点名称重复：${name}`), { statusCode: 400 });
    names.add(name);
    const x = number(point?.x, `waypoints[${index}].x`, -Number.MAX_VALUE, Number.MAX_VALUE);
    const y = number(point?.y, `waypoints[${index}].y`, -Number.MAX_VALUE, Number.MAX_VALUE);
    const yaw = number(point?.yaw, `waypoints[${index}].yaw`, -Number.MAX_VALUE, Number.MAX_VALUE);
    const dwellSeconds = number(point?.dwellSeconds, `waypoints[${index}].dwellSeconds`, 8, 10);
    if (!Number.isInteger(dwellSeconds)) throw Object.assign(new Error(`waypoints[${index}].dwellSeconds 必须为整数`), { statusCode: 400 });
    const roi = point?.noParkingRoi;
    if (roi !== undefined && (!Array.isArray(roi) || roi.length !== 4 || !roi.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1))) {
      throw Object.assign(new Error(`waypoints[${index}].noParkingRoi 必须为 4 个 0 到 1 的数值`), { statusCode: 400 });
    }
    return { name, x, y, yaw, dwellSeconds, noParkingRoi: roi ? roi as number[] : null };
  });
}

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
  subscribePatrol(socket: { send: (value: string) => void }, vehicleId: string) {
    const entry: PatrolSocket = { send: socket.send.bind(socket), vehicleId };
    this.patrolSubscribers.add(entry);
    return () => { this.patrolSubscribers.delete(entry); };
  }
  publishPatrol(msg: { vehicleId: string; [key: string]: unknown }) {
    const text = JSON.stringify(msg);
    for (const socket of this.patrolSubscribers) {
      if (socket.vehicleId !== msg.vehicleId) continue;
      socket.send(text);
    }
  }
}

export interface AppServices {
  db?: Database;
  config?: Partial<Config>;
  mailer?: OtpMailer;
  authRateLimits?: { loginMax: number; otpRequestMax: number; otpVerifyMax: number };
}
export async function createApp(services: AppServices = {}) {
  const config = loadConfig(services.config);
  const db = services.db ?? new Database(config.databaseUrl);
  const mailer = services.mailer ?? createSmtpOtpMailer(config);
  const hub = new RealtimeHub();
  const authRateLimits = services.authRateLimits ?? { loginMax: 10, otpRequestMax: 5, otpVerifyMax: 5 };
  const pendingRateLimitAudits = new WeakMap<FastifyRequest, { action: string; metadata: Record<string, unknown> }>();
  const app = Fastify({ logger: true, trustProxy: config.trustProxy });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    errorResponseBuilder: () => Object.assign(new Error('请求过于频繁，请稍后重试'), { statusCode: 429 }),
  });
  const trustedOrigins = new Set(config.allowedOrigins);
  const isTrustedOrigin = (origin: string | undefined) => Boolean(origin && trustedOrigins.has(origin));
  await app.register(cors, { origin: (origin, callback) => callback(null, isTrustedOrigin(origin)), credentials: true });
  await app.register(websocket);
  app.addHook('onRequest', async (request, reply) => {
    const mutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    const exempt = request.url.startsWith('/device/') || request.url.startsWith('/internal/');
    if (mutating && !exempt && !isTrustedOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Untrusted request origin' });
  });

  async function audit(action: string, outcome: string, actorUserId?: string, vehicleId?: string, metadata: Record<string, unknown> = {}) {
    await db.query('INSERT INTO audit_logs (id, actor_user_id, vehicle_id, action, outcome, metadata) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), actorUserId ?? null, vehicleId ?? null, action, outcome, JSON.stringify(metadata)]);
  }
  function markRateLimitAudit(action: string) {
    return (request: FastifyRequest) => {
      const username = normalizedAuthUsername(request);
      const usableUsername = username.length <= 128 && !/[\u0000-\u001f\u007f]/.test(username);
      pendingRateLimitAudits.set(request, { action, metadata: username && usableUsername ? { username } : {} });
    };
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

  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 400;
    const pendingAudit = statusCode === 429 ? pendingRateLimitAudits.get(request) : undefined;
    if (pendingAudit) {
      pendingRateLimitAudits.delete(request);
      try {
        await audit(pendingAudit.action, 'throttled', undefined, undefined, pendingAudit.metadata);
      } catch (auditError) {
        request.log.error({ error: auditError }, 'Failed to audit authentication rate limit');
      }
    }
    return reply.status(statusCode).send({ error: error instanceof Error ? error.message : 'Request failed' });
  });
  app.get('/health', async () => ({ ok: true }));

  app.post('/api/auth/login', {
    config: { rateLimit: { max: authRateLimits.loginMax, timeWindow: '15 minutes', keyGenerator: authRateKey, onExceeded: markRateLimitAudit('auth.login') } },
  }, async (request, reply) => {
    const body = object(request.body); const username = string(body?.username, 'username'); const password = string(body?.password, 'password');
    const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE username=$1`, [username]);
    const user = result.rows[0];
    if (!user || !user.active || !await argon2.verify(user.password_hash, password)) { await audit('auth.login', 'rejected', undefined, undefined, { username }); return reply.status(401).send({ error: 'Invalid username or password' }); }
    issueSession(reply, user);
    await audit('auth.login', 'success', user.id); return { user: userDto(user) };
  });
  app.post('/api/auth/request-otp', {
    config: { rateLimit: { max: authRateLimits.otpRequestMax, timeWindow: '15 minutes', keyGenerator: authRateKey, onExceeded: markRateLimitAudit('auth.otp.request') } },
  }, async (request, reply) => {
    const body = object(request.body); const username = string(body?.username, 'username');
    const sent = { ok: true as const, message: '如该管理员账号已登记邮箱，验证码将发送至绑定邮箱', time: String(config.otpExpiryMinutes) };
    if (!mailer.available) {
      await audit('auth.otp.request', 'delivery_unavailable', undefined, undefined, { username });
      return reply.status(503).send({ error: '邮箱登录暂不可用，请使用账号密码登录' });
    }
    const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE username=$1 AND active=true AND role='admin'`, [username]);
    const user = result.rows[0];
    if (!user || !user.email) {
      await audit('auth.otp.request', 'ineligible', user?.id, undefined, { username });
      return sent;
    }
    const email = normalizeEmail(user.email);
    const recent = await db.query<{ created_at: Date }>('SELECT created_at FROM auth_otps WHERE email=$1 ORDER BY created_at DESC LIMIT 1', [email]);
    if (recent.rows[0] && Date.now() - recent.rows[0].created_at.getTime() < config.otpResendCooldownSeconds * 1000) {
      await audit('auth.otp.request', 'throttled', user.id, undefined, { username, email });
      return sent;
    }
    const passcode = generatePasscode();
    const expiresAt = new Date(Date.now() + config.otpExpiryMinutes * 60_000);
    const otpId = randomUUID();
    await db.query('INSERT INTO auth_otps (id, user_id, email, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5)', [otpId, user.id, email, await argon2.hash(passcode), expiresAt]);
    try {
      await mailer.sendLoginPasscode({ to: email, passcode, expiresInMinutes: config.otpExpiryMinutes });
      await audit('auth.otp.request', 'success', user.id, undefined, { username, email });
    } catch (error) {
      await db.query('DELETE FROM auth_otps WHERE id=$1', [otpId]);
      await audit('auth.otp.request', 'delivery_failed', user.id, undefined, { username, error: error instanceof Error ? error.message : 'unknown' });
      return reply.status(503).send({ error: '邮箱登录暂不可用，请使用账号密码登录' });
    }
    return sent;
  });
  app.post('/api/auth/verify-otp', {
    config: { rateLimit: { max: authRateLimits.otpVerifyMax, timeWindow: '5 minutes', keyGenerator: authRateKey, onExceeded: markRateLimitAudit('auth.otp.verify') } },
  }, async (request, reply) => {
    const body = object(request.body); const username = string(body?.username, 'username'); const passcode = string(body?.passcode, 'passcode');
    if (!/^\d{6}$/.test(passcode)) throw Object.assign(new Error('passcode is invalid'), { statusCode: 400 });
    const userResult = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE username=$1 AND active=true AND role='admin'`, [username]);
    const candidate = userResult.rows[0];
    if (!candidate?.email) {
      await audit('auth.otp.verify', 'rejected', undefined, undefined, { username });
      return reply.status(401).send({ error: '验证码无效或已过期' });
    }
    const email = normalizeEmail(candidate.email);
    const verification = await db.transaction(async (client) => {
      const otp = await client.query<{ id: string; user_id: string; code_hash: string; expires_at: Date; failed_attempts: number }>(
        'SELECT id, user_id, code_hash, expires_at, failed_attempts FROM auth_otps WHERE email=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
        [email],
      );
      const row = otp.rows[0];
      if (!row || row.expires_at.getTime() < Date.now() || row.failed_attempts >= 5) {
        return { valid: false as const, attemptLimitReached: Boolean(row && row.failed_attempts >= 5) };
      }
      if (!await argon2.verify(row.code_hash, passcode)) {
        const updated = await client.query<{ failed_attempts: number }>(
          `UPDATE auth_otps
           SET failed_attempts=LEAST(failed_attempts+1,5),
               consumed_at=CASE WHEN failed_attempts+1>=5 THEN now() ELSE consumed_at END
           WHERE id=$1 RETURNING failed_attempts`,
          [row.id],
        );
        return { valid: false as const, attemptLimitReached: updated.rows[0]?.failed_attempts === 5 };
      }
      await client.query('UPDATE auth_otps SET consumed_at=now() WHERE id=$1', [row.id]);
      return { valid: true as const, userId: row.user_id };
    });
    if (!verification.valid) {
      await audit('auth.otp.verify', verification.attemptLimitReached ? 'attempt_limit_reached' : 'rejected', undefined, undefined, { username, email });
      return reply.status(401).send({ error: '验证码无效或已过期' });
    }
    const result = await db.query<UserRow>(`SELECT ${USER_SELECT} FROM users WHERE id=$1 AND active=true AND role='admin'`, [verification.userId]);
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
    const user = await requireUser(request);
    const q = typeof (request.query as { q?: unknown }).q === 'string' ? (request.query as { q: string }).q.trim() : '';
    const pattern = q ? `%${q}%` : null;
    const result = user.role === 'admin'
      ? await db.query<VehicleRow>(
        `SELECT * FROM vehicles
         WHERE archived=false
           AND ($1::text IS NULL OR name ILIKE $1 OR code ILIKE $1 OR tcp_host ILIKE $1 OR description ILIKE $1)
         ORDER BY name`,
        [pattern],
      )
      : await db.query<VehicleRow>(
        `SELECT v.* FROM vehicles v JOIN vehicle_members m ON m.vehicle_id=v.id
         WHERE m.user_id=$1 AND v.archived=false
           AND ($2::text IS NULL OR v.name ILIKE $2 OR v.code ILIKE $2 OR v.tcp_host ILIKE $2 OR v.description ILIKE $2)
         ORDER BY v.name`,
        [user.id, pattern],
      );
    return { vehicles: result.rows.map(vehicleDto) };
  });
  app.post('/api/vehicles', async (request) => {
    const admin = await requireAdmin(request); const body = object(request.body); const id = randomUUID(); const code = string(body?.code, 'code'); const name = string(body?.name, 'name'); const host = string(body?.host, 'host'); const tcpPort = number(body?.tcpPort, 'tcpPort', 1, 65535); const videoPort = number(body?.videoPort, 'videoPort', 1, 65535); const description = typeof body?.description === 'string' ? body.description : ''; const bridgeUrl = typeof body?.bridgeUrl === 'string' ? body.bridgeUrl : '';
    await db.query('INSERT INTO vehicles (id,code,name,description,tcp_host,tcp_port,video_port,bridge_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, code, name, description, host, tcpPort, videoPort, bridgeUrl]); await audit('vehicle.create', 'success', admin.id, id); return { vehicle: { id, code, name, description, host, tcpPort, videoPort, bridgeUrl, lastSeenAt: null, lastPatrolAt: null, archived: false } };
  });
  app.get('/api/vehicles/:id', async (request) => { const user = await requireUser(request); const id = (request.params as { id: string }).id; if (!await canAccessVehicle(user, id)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const result = await db.query<VehicleRow>('SELECT * FROM vehicles WHERE id=$1', [id]); if (!result.rows[0]) throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 }); return { vehicle: vehicleDto(result.rows[0]) }; });
  app.patch('/api/vehicles/:id', async (request) => {
    const admin = await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const body = object(request.body);
    const description = typeof body?.description === 'string' ? body.description : '';
    const archive = body?.archived === true;
    await db.query(
      `UPDATE vehicles SET
         name=COALESCE($1,name),
         description=$2,
         archived=CASE WHEN $3 THEN true ELSE archived END,
         updated_at=now()
       WHERE id=$4`,
      [typeof body?.name === 'string' ? body.name.trim() : null, description, archive, id],
    );
    await audit(archive ? 'vehicle.archive' : 'vehicle.update', 'success', admin.id, id);
    return { ok: true };
  });
  app.put('/api/vehicles/:id/members', async (request) => { const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const body = object(request.body); if (!Array.isArray(body?.userIds) || !body.userIds.every((id) => typeof id === 'string')) throw new Error('userIds must be strings'); await db.transaction(async (client) => { await client.query('DELETE FROM vehicle_members WHERE vehicle_id=$1', [vehicleId]); for (const userId of body.userIds as string[]) await client.query('INSERT INTO vehicle_members (vehicle_id,user_id) VALUES ($1,$2)', [vehicleId, userId]); }); await audit('vehicle.members.update', 'success', admin.id, vehicleId); return { ok: true }; });
  app.post('/api/vehicles/:id/device-credentials', async (request) => { const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const id = randomUUID(); const secret = randomSecret(); await db.transaction(async (client) => { await client.query('UPDATE device_credentials SET active=false,revoked_at=now() WHERE vehicle_id=$1 AND active=true', [vehicleId]); await client.query('INSERT INTO device_credentials (id,vehicle_id,secret_hash) VALUES ($1,$2,$3)', [id, vehicleId, hashSecret(secret)]); }); await audit('device-credential.rotate', 'success', admin.id, vehicleId); return { credential: { id, token: `${id}.${secret}` } }; });
  app.get('/api/vehicles/:id/patrol-routes', async (request) => {
    const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id;
    if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    const result = await db.query<{ id: string; name: string; mapVersion: string; waypointCount: number }>(
      `SELECT r.id,r.name,r.map_version AS "mapVersion",count(w.id)::int AS "waypointCount"
       FROM patrol_routes r LEFT JOIN patrol_waypoints w ON w.route_id=r.id WHERE r.vehicle_id=$1
       GROUP BY r.id ORDER BY r.created_at DESC`, [vehicleId],
    );
    return { routes: result.rows };
  });
  app.post('/api/vehicles/:id/patrol-routes', async (request) => {
    const admin = await requireAdmin(request); const vehicleId = (request.params as { id: string }).id; const body = object(request.body);
    const name = string(body?.name, 'name'); const mapVersion = string(body?.mapVersion, 'mapVersion'); const yaml = string(body?.yaml, 'yaml');
    const waypoints = parsePatrolRouteYaml(yaml); const routeId = randomUUID();
    await db.transaction(async (client) => {
      const vehicle = await client.query('SELECT id FROM vehicles WHERE id=$1 AND archived=false FOR UPDATE', [vehicleId]);
      if (!vehicle.rowCount) throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });
      const duplicate = await client.query('SELECT id FROM patrol_routes WHERE vehicle_id=$1 AND name=$2 AND map_version=$3', [vehicleId, name, mapVersion]);
      if (duplicate.rowCount) throw Object.assign(new Error('该设备已存在相同名称和地图版本的路线'), { statusCode: 409 });
      await client.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, name, mapVersion, yaml, admin.id]);
      for (const [ordinal, waypoint] of waypoints.entries()) {
        await client.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), routeId, ordinal, waypoint.name, waypoint.x, waypoint.y, waypoint.yaw, waypoint.dwellSeconds, waypoint.noParkingRoi ? JSON.stringify(waypoint.noParkingRoi) : null]);
      }
    });
    await audit('patrol-route.import', 'success', admin.id, vehicleId, { routeId, name, mapVersion, waypointCount: waypoints.length });
    return { route: { id: routeId, name, mapVersion, waypointCount: waypoints.length } };
  });

  async function acquireLease(client: PoolClient, user: UserRow, vehicleId: string) {
    await client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [vehicleId]);
    const patrol = await client.query("SELECT status FROM patrol_tasks WHERE vehicle_id=$1 AND status IN ('queued','running','cancellation_requested') LIMIT 1", [vehicleId]);
    if (patrol.rowCount) throw Object.assign(new Error('Patrol is active or awaiting zero-velocity stop confirmation'), { statusCode: 409 });
    const response = await client.query("SELECT status FROM response_tasks WHERE assigned_vehicle_id=$1 AND status IN ('assigned','navigating','arrived','cancellation_requested') LIMIT 1", [vehicleId]);
    if (response.rowCount) throw Object.assign(new Error('Doorstep response is active or awaiting safe completion'), { statusCode: 409 });
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
  app.post('/internal/control-lease/verify', async (request) => { const body = object(request.body); const token = string(body?.token, 'token'); const claim = verify<LeasePayload>(token, config.sessionSecret); if (!claim?.leaseId || !claim.vehicleId) return { valid: false }; const result = await db.query<VehicleRow>(`SELECT v.* FROM control_leases l JOIN vehicles v ON v.id=l.vehicle_id JOIN users u ON u.id=l.user_id
    WHERE l.id=$1 AND l.vehicle_id=$2 AND l.user_id=$3 AND l.released_at IS NULL AND l.expires_at>now() AND u.active=true
      AND NOT EXISTS (SELECT 1 FROM response_tasks rt WHERE rt.assigned_vehicle_id=l.vehicle_id AND rt.status IN ('assigned','navigating','arrived','cancellation_requested'))`, [claim.leaseId, claim.vehicleId, claim.sub]); return result.rows[0] ? { valid: true, vehicle: vehicleDto(result.rows[0]), expiresAt: new Date(claim.exp).toISOString() } : { valid: false };
  });

  app.post('/device/v1/telemetry', async (request, reply) => {
    const authorization = request.headers.authorization; const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''; const [credentialId, secret] = token.split('.'); if (!credentialId || !secret) return reply.status(401).send({ error: 'Invalid device credential' });
    const credential = await db.query<{ vehicle_id: string; secret_hash: string }>('SELECT vehicle_id,secret_hash FROM device_credentials WHERE id=$1 AND active=true', [credentialId]); if (!credential.rows[0] || credential.rows[0].secret_hash !== hashSecret(secret)) return reply.status(401).send({ error: 'Invalid device credential' });
    const body = object(request.body); if (!Array.isArray(body?.points) || !body.points.length) throw new Error('points must be a non-empty array'); const vehicleId = credential.rows[0].vehicle_id; let accepted = 0;
    for (const raw of body.points) { const point = object(raw); const occurredAt = string(point?.occurredAt, 'occurredAt'); const longitude = number(point?.longitude, 'longitude', -180, 180); const latitude = number(point?.latitude, 'latitude', -90, 90); const optional = (key: string, min = -Infinity, max = Infinity) => point?.[key] === undefined || point?.[key] === null ? null : number(point?.[key], key, min, max); const row = await db.query('INSERT INTO telemetry_points (id,vehicle_id,occurred_at,longitude,latitude,altitude_m,accuracy_m,speed_kph,heading_deg,battery_pct,mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (vehicle_id,occurred_at) DO NOTHING RETURNING id', [randomUUID(), vehicleId, occurredAt, longitude, latitude, optional('altitudeM'), optional('accuracyM', 0), optional('speedKph', 0), optional('headingDeg', 0, 360), optional('batteryPct', 0, 100), typeof point?.mode === 'string' ? point.mode : null]); if (row.rowCount) { accepted++; hub.publish(vehicleId, { occurredAt, longitude, latitude, altitudeM: optional('altitudeM'), accuracyM: optional('accuracyM', 0), speedKph: optional('speedKph', 0), headingDeg: optional('headingDeg', 0, 360), batteryPct: optional('batteryPct', 0, 100), mode: typeof point?.mode === 'string' ? point.mode : null }); } }
    await db.query('UPDATE vehicles SET last_seen_at=now() WHERE id=$1', [vehicleId]);
    return { accepted };
  });
  app.post('/device/v1/evidence', { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const [credentialId, secret] = token.split('.');
    if (!credentialId || !secret) return reply.status(401).send({ error: 'Invalid device credential' });
    const credential = await db.query<{ vehicle_id: string; secret_hash: string }>(
      'SELECT vehicle_id,secret_hash FROM device_credentials WHERE id=$1 AND active=true',
      [credentialId],
    );
    if (!credential.rows[0] || credential.rows[0].secret_hash !== hashSecret(secret)) {
      return reply.status(401).send({ error: 'Invalid device credential' });
    }
    const body = object(request.body);
    const jpegBase64 = typeof body?.jpegBase64 === 'string' ? body.jpegBase64.trim() : '';
    if (!jpegBase64) throw Object.assign(new Error('jpegBase64 is required'), { statusCode: 400 });
    const kind = typeof body?.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'evidence';
    let bytes: Buffer;
    try {
      bytes = Buffer.from(jpegBase64.replace(/^data:image\/jpeg;base64,/i, ''), 'base64');
    } catch {
      throw Object.assign(new Error('jpegBase64 is invalid'), { statusCode: 400 });
    }
    const saved = saveEvidenceJpeg(bytes, kind);
    await db.query('UPDATE vehicles SET last_seen_at=now() WHERE id=$1', [credential.rows[0].vehicle_id]);
    return { url: saved.publicPath, fileName: saved.fileName };
  });
  app.get('/api/evidence/:fileName', async (request, reply) => {
    const user = await requireUser(request);
    const fileName = (request.params as { fileName: string }).fileName;
    const publicPath = `/api/evidence/${fileName}`;
    const authorized = await db.query(
      `WITH evidence_vehicles AS (
         SELECT t.vehicle_id FROM patrol_events e JOIN patrol_tasks t ON t.id=e.task_id WHERE e.evidence_url=$1
         UNION
         SELECT t.vehicle_id FROM plate_observations po JOIN patrol_tasks t ON t.id=po.task_id
           WHERE po.evidence_image_url=$1 OR po.annotated_image_url=$1
         UNION
         SELECT COALESCE(v.vehicle_id, direct_task.vehicle_id, event_task.vehicle_id)
         FROM violations v
         LEFT JOIN patrol_tasks direct_task ON direct_task.id=v.task_id
         LEFT JOIN patrol_events violation_event ON violation_event.id=v.event_id
         LEFT JOIN patrol_tasks event_task ON event_task.id=violation_event.task_id
         WHERE v.evidence_url=$1
         UNION
         SELECT rt.source_vehicle_id FROM response_tasks rt WHERE rt.arrival_evidence_url=$1
         UNION
         SELECT rt.assigned_vehicle_id FROM response_tasks rt WHERE rt.arrival_evidence_url=$1 AND rt.assigned_vehicle_id IS NOT NULL
       )
       SELECT 1 FROM evidence_vehicles ev
       WHERE $2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=ev.vehicle_id AND vm.user_id=$2
       ) LIMIT 1`,
      [publicPath, user.role === 'admin' ? null : user.id],
    );
    if (!authorized.rowCount) return reply.status(404).send({ error: 'Evidence not found' });
    const bytes = readEvidenceJpeg(fileName);
    if (!bytes) return reply.status(404).send({ error: 'Evidence not found' });
    return reply.type('image/jpeg').header('cache-control', 'private, max-age=3600').send(bytes);
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
    const task = await db.query<{ status: string; whitelist_id: string; route_id: string; review_confidence_threshold: number; dedupe_window_sec: number }>('SELECT status,whitelist_id,route_id,review_confidence_threshold,dedupe_window_sec FROM patrol_tasks WHERE id=$1 AND vehicle_id=$2', [taskId, vehicleId]);
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
      const threshold = task.rows[0].review_confidence_threshold;
      const dedupeWindowMs = task.rows[0].dedupe_window_sec * 1000;
      // Always compute plateMatch for admin hints; only apply for classification when confidence is high enough.
      const whitelistEntries = plate
        ? await db.query<{ plate: string; category: 'private' | 'visitor' }>(
          'SELECT plate, category FROM whitelist_entries WHERE whitelist_id=$1',
          [task.rows[0].whitelist_id],
        )
        : { rows: [] as Array<{ plate: string; category: 'private' | 'visitor' }> };
      const plateMatch = plate ? matchWhitelistPlate(plate, whitelistEntries.rows) : null;
      const classification = confidence < threshold || !plate
        ? 'pending_review'
        : classificationFromMatch(plateMatch);
      const matchedPlate = plateMatch?.matchedPlate ?? plate;
      const noParking = bboxIntersectsRoi(body.vehicleBox, waypoint.rows[0].no_parking_roi);
      const longitude = body.longitude === undefined ? null : number(body.longitude, 'longitude', -180, 180);
      const latitude = body.latitude === undefined ? null : number(body.latitude, 'latitude', -90, 90);
      const bucket = new Date(Math.floor(occurred.getTime() / dedupeWindowMs) * dedupeWindowMs).toISOString();
      // Prefer matched full plate for dedupe so incomplete OCR merges with later full reads.
      const dedupeKey = plate && confidence >= threshold ? (matchedPlate ?? plate) : randomUUID();
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
             annotated_image_url=COALESCE(EXCLUDED.annotated_image_url, plate_observations.annotated_image_url),
             longitude=COALESCE(EXCLUDED.longitude, plate_observations.longitude),
             latitude=COALESCE(EXCLUDED.latitude, plate_observations.latitude)
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
              JSON.stringify({
                observationId: obs.rows[0].id,
                source: 'device',
                plateMatch: plateMatchDto(plateMatch),
              }),
            ],
          );
          await client.query(
            `INSERT INTO reviews (id, event_id, reason, status) VALUES ($1, $2, 'low_confidence', 'pending')`,
            [randomUUID(), eventId],
          );
        }
        return { observationId: obs.rows[0].id, observationCount: obs.rows[0].observation_count };
      });
      const response = await createResponseCandidate(db, hub, {
          observationId,
          taskId,
          vehicleId,
          plate,
          matchedPlate: matchedPlate ?? null,
          plateMatch,
          confidence,
          noParking,
          evidenceUrl: typeof body.evidenceImageUrl === 'string' ? body.evidenceImageUrl : null,
        });
      return {
        ok: true,
        observationId,
        classification,
        noParking,
        deduplicated: observationCount > 1,
        plateMatch: plateMatchDto(plateMatch),
        ...response,
      };
    }
    if (body?.type !== 'waypoint' || typeof body.waypointId !== 'string') throw Object.assign(new Error('Unsupported scheduler event'), { statusCode: 400 });
    await db.query("INSERT INTO patrol_events (id,task_id,event_type,waypoint_id,details) VALUES ($1,$2,'waypoint',$3,$4)", [randomUUID(), taskId, body.waypointId, JSON.stringify(body)]);
    return { ok: true };
  });
  app.get('/api/vehicles/:id/track', async (request) => { const user = await requireUser(request); const vehicleId = (request.params as { id: string }).id; if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 }); const query = request.query as { from?: string; to?: string }; const result = await db.query('SELECT occurred_at AS "occurredAt",longitude,latitude,altitude_m AS "altitudeM",accuracy_m AS "accuracyM",speed_kph AS "speedKph",heading_deg AS "headingDeg",battery_pct AS "batteryPct",mode FROM telemetry_points WHERE vehicle_id=$1 AND occurred_at >= COALESCE($2::timestamptz,now()-interval \'24 hours\') AND occurred_at <= COALESCE($3::timestamptz,now()) ORDER BY occurred_at', [vehicleId, query.from ?? null, query.to ?? null]); return { points: result.rows }; });
  app.get('/api/audit-logs', async (request) => { await requireAdmin(request); const result = await db.query('SELECT id,actor_user_id AS "actorUserId",vehicle_id AS "vehicleId",action,outcome,metadata,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 200'); return { logs: result.rows }; });

  app.get('/ws', { websocket: true }, async (socket, request) => { if (!isTrustedOrigin(request.headers.origin)) return socket.close(1008, 'Untrusted WebSocket origin'); const user = await currentUser(request); if (!user) return socket.close(1008, 'Authentication required'); let unsubscribe: (() => void) | undefined; socket.on('message', async (raw: Buffer) => { try { const message = JSON.parse(raw.toString()) as { type?: string; vehicleId?: string }; if (message.type !== 'subscribe' || !message.vehicleId || !await canAccessVehicle(user, message.vehicleId)) return socket.send(JSON.stringify({ type: 'error', message: 'Vehicle access denied' })); unsubscribe?.(); unsubscribe = hub.subscribe(message.vehicleId, socket); socket.send(JSON.stringify({ type: 'subscribed', vehicleId: message.vehicleId })); } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); } }); socket.on('close', () => unsubscribe?.()); });

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
    isTrustedOrigin,
  });

  registerResponsePlatformRoutes(app, {
    db,
    requireUser,
    requireAdmin,
    canAccessVehicle: (user, vehicleId) => canAccessVehicle(user as UserRow, vehicleId),
    deviceVehicle,
    audit,
    hub,
    ai: { baseUrl: config.aiBaseUrl, apiKey: config.aiApiKey, model: config.aiModel },
    wxPusher: {
      appToken: config.wxPusherAppToken,
      endpoint: config.wxPusherEndpoint,
    },
  });

  registerAiPlatformRoutes(app, {
    db,
    config,
    requireUser,
  });

  app.addHook('onClose', async () => { if (!services.db) await db.close(); });
  return app;
}
