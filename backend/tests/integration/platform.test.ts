import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createApp } from '../../src/app.js';
import { Database } from '../../src/db/index.js';

const origin = 'https://platform.example.test';
let container: StartedTestContainer;
let db: Database;
let app: Awaited<ReturnType<typeof createApp>>;
const ids = { admin: randomUUID(), operatorA: randomUUID(), operatorB: randomUUID() };

function cookie(response: { headers: Record<string, unknown> }) { return String(response.headers['set-cookie']).split(';')[0]; }
async function login(username: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { username, password } });
  expect(response.statusCode).toBe(200); return cookie(response);
}

beforeAll(async () => {
  container = await new GenericContainer('postgis/postgis:16-3.4')
    .withEnvironment({ POSTGRES_DB: 'platform', POSTGRES_USER: 'platform', POSTGRES_PASSWORD: 'platform' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start();
  db = new Database(`postgres://platform:platform@${container.getHost()}:${container.getMappedPort(5432)}/platform`);
  await db.migrate();
  for (const [name, id, role, email] of [
    ['admin', ids.admin, 'admin', 'admin@example.test'],
    ['operator-a', ids.operatorA, 'operator', 'operator-a@example.test'],
    ['operator-b', ids.operatorB, 'operator', 'operator-b@example.test'],
  ] as const) {
    await db.query('INSERT INTO users (id,username,display_name,password_hash,role,email) VALUES ($1,$2,$3,$4,$5,$6)', [id, name, name, await argon2.hash('password'), role, email]);
  }
  app = await createApp({ db, config: { sessionSecret: 'integration-secret', publicOrigin: origin, allowedOrigins: [origin], otpExpiryMinutes: 5, otpResendCooldownSeconds: 60 } });
}, 120_000);

afterAll(async () => { if (app) await app.close(); if (db) await db.close(); if (container) await container.stop(); });

describe('platform API against PostGIS', () => {
  it('enforces roles, serializes leases, and accepts idempotent telemetry', async () => {
    const adminCookie = await login('admin', 'password');
    const created = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-1', name: '巡检车', host: '192.168.1.11', tcpPort: 6000, videoPort: 6500 } });
    expect(created.statusCode).toBe(200); const vehicleId = created.json<{ vehicle: { id: string } }>().vehicle.id;
    const members = await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA, ids.operatorB] } });
    expect(members.statusCode).toBe(200);
    const operatorACookie = await login('operator-a', 'password'); const operatorBCookie = await login('operator-b', 'password');
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: operatorACookie } })).statusCode).toBe(403);
    const firstLease = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/control-lease`, headers: { origin, cookie: operatorACookie } });
    expect(firstLease.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/control-lease`, headers: { origin, cookie: operatorBCookie } })).statusCode).toBe(409);
    const credential = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie } });
    const token = credential.json<{ credential: { token: string } }>().credential.token;
    const point = { occurredAt: '2026-07-11T00:00:00.000Z', longitude: 116.3, latitude: 39.8 };
    expect((await app.inject({ method: 'POST', url: '/device/v1/telemetry', headers: { authorization: `Bearer ${token}` }, payload: { points: [point] } })).json()).toEqual({ accepted: 1 });
    expect((await app.inject({ method: 'POST', url: '/device/v1/telemetry', headers: { authorization: `Bearer ${token}` }, payload: { points: [point] } })).json()).toEqual({ accepted: 0 });
    const track = await app.inject({ method: 'GET', url: `/api/vehicles/${vehicleId}/track`, headers: { cookie: operatorACookie } });
    expect(track.statusCode).toBe(200); expect(track.json<{ points: unknown[] }>().points).toHaveLength(1);
  });

  it('supports username OTP login without leaking unregistered accounts', async () => {
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'nobody' } });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toMatchObject({ ok: true, message: '若账号已登记将收到验证码', time: '5' });
    expect(unknown.json<{ passcode?: string; deliveryEmail?: string }>().passcode).toBeUndefined();
    expect(unknown.json<{ deliveryEmail?: string }>().deliveryEmail).toBeUndefined();

    const noEmailId = randomUUID();
    await db.query('INSERT INTO users (id,username,display_name,password_hash,role,email) VALUES ($1,$2,$3,$4,$5,$6)', [
      noEmailId, 'no-email-user', 'no-email-user', await argon2.hash('password'), 'operator', null,
    ]);
    const noEmail = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'no-email-user' } });
    expect(noEmail.statusCode).toBe(200);
    expect(noEmail.json<{ passcode?: string }>().passcode).toBeUndefined();

    const requested = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'operator-a' } });
    expect(requested.statusCode).toBe(200);
    const body = requested.json<{ passcode?: string; deliveryEmail?: string }>();
    const passcode = body.passcode;
    expect(passcode).toMatch(/^\d{6}$/);
    expect(body.deliveryEmail).toBe('operator-a@example.test');

    const throttled = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'operator-a' } });
    expect(throttled.statusCode).toBe(429);

    const rejected = await app.inject({ method: 'POST', url: '/api/auth/verify-otp', headers: { origin }, payload: { username: 'operator-a', passcode: '000000' } });
    expect(rejected.statusCode).toBe(401);

    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify-otp', headers: { origin }, payload: { username: 'operator-a', passcode } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json<{ user: { username: string; email: string | null } }>().user).toMatchObject({ username: 'operator-a', email: 'operator-a@example.test' });
    const session = cookie(verified);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: session } });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { email: string | null } }>().user.email).toBe('operator-a@example.test');
  });

  it('allows admin to update own profile and rejects operators', async () => {
    const adminCookie = await login('admin', 'password');
    const operatorCookie = await login('operator-a', 'password');

    expect((await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { origin, cookie: operatorCookie },
      payload: { displayName: 'Nope' },
    })).statusCode).toBe(403);

    const badPassword = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { origin, cookie: adminCookie },
      payload: { password: 'new-password', currentPassword: 'wrong' },
    });
    expect(badPassword.statusCode).toBe(401);

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { origin, cookie: adminCookie },
      payload: { displayName: 'Admin Renamed', email: 'admin-new@example.test' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ user: { displayName: string; email: string | null } }>().user).toMatchObject({
      displayName: 'Admin Renamed',
      email: 'admin-new@example.test',
    });

    const passwordChanged = await app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { origin, cookie: adminCookie },
      payload: { password: 'new-password', currentPassword: 'password' },
    });
    expect(passwordChanged.statusCode).toBe(200);
    expect((await login('admin', 'new-password')).length).toBeGreaterThan(0);
  });
});
