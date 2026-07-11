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
async function waitForDatabase(database: Database): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await database.query('SELECT 1'); return; }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  throw lastError;
}
async function login(username: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { username, password } });
  expect(response.statusCode).toBe(200); return cookie(response);
}
async function waitForVehicleLock(vehicleId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await db.transaction((client) => client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE NOWAIT', [vehicleId]));
    } catch (error) {
      if ((error as { code?: string }).code === '55P03') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for whitelist import to lock the vehicle');
}

beforeAll(async () => {
  container = await new GenericContainer('postgis/postgis:16-3.4')
    .withEnvironment({ POSTGRES_DB: 'platform', POSTGRES_USER: 'platform', POSTGRES_PASSWORD: 'platform' })
    .withExposedPorts(5432)
    // The PostGIS image starts a temporary PostgreSQL instance for extension
    // initialization, then restarts the server. Waiting for its first ready log
    // races that restart and produces ECONNRESET on the initial migration query.
    .withWaitStrategy(Wait.forLogMessage(/PostgreSQL init process complete; ready for start up/))
    .start();
  db = new Database(`postgres://platform:platform@${container.getHost()}:${container.getMappedPort(5432)}/platform`);
  await waitForDatabase(db);
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
    expect(body.passcode).toBeUndefined();
    expect(body.deliveryEmail).toBeUndefined();

    const throttled = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'operator-a' } });
    expect(throttled.statusCode).toBe(429);

    const rejected = await app.inject({ method: 'POST', url: '/api/auth/verify-otp', headers: { origin }, payload: { username: 'operator-a', passcode: '000000' } });
    expect(rejected.statusCode).toBe(401);

    const unavailable = await app.inject({ method: 'POST', url: '/api/auth/verify-otp', headers: { origin }, payload: { username: 'operator-a', passcode: '111111' } });
    expect(unavailable.statusCode).toBe(401);
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

  it('keeps manual control blocked until a cancelled patrol reports zero velocity', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-SAFETY', name: '安全巡检车', host: '192.168.1.22', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA] } });
    const routeId = randomUUID();
    const whitelistId = randomUUID();
    await db.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, '安全路线', 'v1', 'generated', ids.admin]);
    for (const [ordinal, name] of ['起点', '中点', '终点'].entries()) await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), routeId, ordinal, name, ordinal, ordinal, 0, 8]);
    await db.query('INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id) VALUES ($1,$2,$3,$4)', [whitelistId, vehicleId, '安全白名单', ids.admin]);
    await db.query("INSERT INTO whitelist_entries (id,whitelist_id,plate,owner_name,building,category) VALUES ($1,$2,'A12345','测试','1号楼','private')", [randomUUID(), whitelistId]);

    const lease = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/control-lease`, headers: { origin, cookie: operatorCookie } });
    expect(lease.statusCode).toBe(200);
    const blocked = await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } });
    expect(blocked.statusCode).toBe(409);
    await app.inject({ method: 'DELETE', url: `/api/control-leases/${lease.json<{ leaseId: string }>().leaseId}`, headers: { origin, cookie: operatorCookie } });

    const started = await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } });
    expect(started.statusCode).toBe(200);
    const taskId = started.json<{ task: { id: string; status: string } }>().task.id;
    const credential = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie } });
    const token = credential.json<{ credential: { token: string } }>().credential.token;
    expect((await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } })).json<{ task: { id: string } }>().task.id).toBe(taskId);
    expect((await app.inject({ method: 'POST', url: '/api/patrol/stop', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/control-lease`, headers: { origin, cookie: operatorCookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'stop_confirmed', zeroVelocity: false } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'stop_confirmed', zeroVelocity: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/control-lease`, headers: { origin, cookie: operatorCookie } })).statusCode).toBe(200);
  });

  it('classifies and deduplicates device observations using the task whitelist snapshot', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-OBS', name: '观测巡检车', host: '192.168.1.23', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA] } });
    const routeId = randomUUID(); const waypointId = randomUUID(); const whitelistId = randomUUID();
    await db.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, '观测路线', 'v1', 'generated', ids.admin]);
    await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,0,$3,0,0,0,8,$4)', [waypointId, routeId, '识别点', JSON.stringify([0.1, 0.1, 0.5, 0.5])]);
    for (const ordinal of [1, 2]) await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,0,0,0,8)', [randomUUID(), routeId, ordinal, `点${ordinal}`]);
    await db.query('INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id) VALUES ($1,$2,$3,$4)', [whitelistId, vehicleId, '观测白名单', ids.admin]);
    expect((await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } })).statusCode).toBe(409);
    await db.query("INSERT INTO whitelist_entries (id,whitelist_id,plate,owner_name,building,category) VALUES ($1,$2,'A12345','测试','1号楼','private')", [randomUUID(), whitelistId]);
    const started = await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } });
    expect(started.statusCode).toBe(200);
    const taskId = started.json<{ task: { id: string } }>().task.id;
    const credential = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie } });
    const token = credential.json<{ credential: { token: string } }>().credential.token;
    await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } });
    const observation = { type: 'observation', waypointId, occurredAt: '2026-07-11T01:01:00.000Z', plate: 'a-12345', confidence: 0.91, vehicleBox: [0.2, 0.2, 0.2, 0.2] };
    const first = await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: observation });
    expect(first.statusCode).toBe(200); expect(first.json()).toMatchObject({ classification: 'registered_private', noParking: true, deduplicated: false });
    const second = await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { ...observation, occurredAt: '2026-07-11T01:05:00.000Z' } });
    expect(second.json()).toMatchObject({ deduplicated: true });
    const events = await app.inject({ method: 'GET', url: `/api/patrol/tasks/${taskId}/events`, headers: { origin, cookie: operatorCookie } });
    expect(events.json<{ observations: Array<{ observationCount: number; classification: string; noParking: boolean }> }>().observations).toEqual([expect.objectContaining({ observationCount: 2, classification: 'registered_private', noParking: true })]);
    await db.query("UPDATE patrol_tasks SET status='completed', finished_at=now() WHERE id=$1", [taskId]);
    const report = await app.inject({ method: 'GET', url: `/api/patrol/tasks/${taskId}/report`, headers: { origin, cookie: operatorCookie } });
    expect(report.json<{ report: { stats: { observationCount: number; registeredPrivate: number; noParkingCount: number } } }>().report.stats).toMatchObject({ observationCount: 1, registeredPrivate: 1, noParkingCount: 1 });
  });

  it('creates patrol_events and reviews for pending-review observations, and whitelist snapshot is immutable', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-REVIEW', name: '审核测试车', host: '192.168.1.25', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA] } });
    const routeId = randomUUID(); const waypointId = randomUUID();
    await db.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, '审核路线', 'v1', 'generated', ids.admin]);
    await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,0,$3,0,0,0,8)', [waypointId, routeId, '审核点']);
    for (const ordinal of [1, 2]) await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,0,0,0,8)', [randomUUID(), routeId, ordinal, `点${ordinal}`]);
    // Seed live whitelist, start patrol (creates immutable snapshot)
    const whitelistId = randomUUID();
    await db.query('INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id) VALUES ($1,$2,$3,$4)', [whitelistId, vehicleId, '审核白名单', ids.admin]);
    await db.query("INSERT INTO whitelist_entries (id,whitelist_id,plate,owner_name,building,category) VALUES ($1,$2,'X99999','测试','3号楼','private')", [randomUUID(), whitelistId]);
    const started = await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } });
    expect(started.statusCode).toBe(200);
    const taskId = started.json<{ task: { id: string } }>().task.id;
    const credential = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie } });
    const token = credential.json<{ credential: { token: string } }>().credential.token;
    await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } });
    // Mutate live whitelist after task start — snapshot must stay isolated
    await app.inject({ method: 'POST', url: '/api/whitelist/import', headers: { origin, cookie: adminCookie }, payload: { deviceId: vehicleId, rows: [{ plate: 'X99999', owner: '篡改', building: '99号楼', vehicleType: 'visitor' }] } });
    // Low-confidence observation → pending_review → must create patrol_event + review
    const lowConf = await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'observation', waypointId, occurredAt: '2026-07-11T03:00:00.000Z', plate: 'B99998', confidence: 0.5 } });
    expect(lowConf.statusCode).toBe(200);
    expect(lowConf.json()).toMatchObject({ classification: 'pending_review', deduplicated: false });
    // High-confidence observation for X99999 — snapshot still classifies it as private, not visitor
    const highConf = await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'observation', waypointId, occurredAt: '2026-07-11T03:01:00.000Z', plate: 'X99999', confidence: 0.92 } });
    expect(highConf.json()).toMatchObject({ classification: 'registered_private' });
    // Review queue must contain the low-confidence observation
    const reviews = await app.inject({ method: 'GET', url: '/api/reviews/pending', headers: { origin, cookie: operatorCookie } });
    expect(reviews.statusCode).toBe(200);
    expect(reviews.json<{ reviews: Array<{ reason: string; deviceName: string }> }>().reviews).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'low_confidence', deviceName: '审核测试车' })]),
    );
    // Task events must include the 'observation' type event
    const events = await app.inject({ method: 'GET', url: `/api/patrol/tasks/${taskId}/events`, headers: { origin, cookie: operatorCookie } });
    expect(events.json<{ events: Array<{ eventType: string }> }>().events).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'observation' })]),
    );
  });

  it('scopes operational records and whitelist changes to the authorised vehicle', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorACookie = await login('operator-a', 'password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-PRIVATE', name: '私有巡检车', host: '192.168.1.24', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorB] } });
    expect((await app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { deviceId: vehicleId, plate: 'B12345', vehicleType: 'commercial' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { deviceId: vehicleId, plate: 'B12345', owner: '乙', building: '2号楼', vehicleType: 'visitor' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/whitelist?deviceId=${vehicleId}`, headers: { origin, cookie: operatorACookie } })).statusCode).toBe(403);
  });

  it('serializes a blocked whitelist import with patrol snapshot creation', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-WL-LOCK', name: '白名单锁测试车', host: '192.168.1.26', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA] } });
    const routeId = randomUUID();
    await db.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, '锁测试路线', 'v1', 'generated', ids.admin]);
    for (const ordinal of [0, 1, 2]) await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,0,0,0,8)', [randomUUID(), routeId, ordinal, `点${ordinal}`]);
    const whitelistId = randomUUID();
    await db.query('INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id) VALUES ($1,$2,$3,$4)', [whitelistId, vehicleId, '锁测试白名单', ids.admin]);
    await db.query("INSERT INTO whitelist_entries (id,whitelist_id,plate,owner_name,building,category) VALUES ($1,$2,'B10001','旧业主','1号楼','private')", [randomUUID(), whitelistId]);

    const blocker = await db.pool.connect();
    let blockerTransactionOpen = false;
    try {
      await blocker.query('BEGIN');
      blockerTransactionOpen = true;
      await blocker.query("SELECT id FROM whitelist_entries WHERE whitelist_id=$1 AND plate='B10001' FOR UPDATE", [whitelistId]);
      const importing = app.inject({
        method: 'POST',
        url: '/api/whitelist/import',
        headers: { origin, cookie: adminCookie },
        payload: {
          deviceId: vehicleId,
          rows: [
            { plate: 'N10001', owner: '新业主', building: '2号楼', vehicleType: 'private' },
            { plate: 'B10001', owner: '更新业主', building: '3号楼', vehicleType: 'visitor' },
          ],
        },
      });
      await waitForVehicleLock(vehicleId);

      const starting = app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } });
      await blocker.query('COMMIT');
      blockerTransactionOpen = false;

      expect((await importing).statusCode).toBe(200);
      const started = await starting;
      expect(started.statusCode).toBe(200);
      const taskId = started.json<{ task: { id: string } }>().task.id;
      const snapshot = await db.query<{ plate: string; owner_name: string; category: string }>(
        `SELECT e.plate, e.owner_name, e.category
         FROM whitelist_entries e
         JOIN patrol_tasks t ON t.whitelist_id=e.whitelist_id
         WHERE t.id=$1
         ORDER BY e.plate`,
        [taskId],
      );
      expect(snapshot.rows).toEqual([
        { plate: 'B10001', owner_name: '更新业主', category: 'visitor' },
        { plate: 'N10001', owner_name: '新业主', category: 'private' },
      ]);
    } finally {
      if (blockerTransactionOpen) await blocker.query('ROLLBACK');
      blocker.release();
    }
  });

  it('keeps one live whitelist when two first writes race for the same vehicle', async () => {
    const adminCookie = await login('admin', 'new-password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-WL-UNIQUE', name: '白名单唯一性测试车', host: '192.168.1.27', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    const writes = await Promise.all([
      app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { deviceId: vehicleId, plate: 'C10001', owner: '甲', building: '1号楼', vehicleType: 'private' } }),
      app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { deviceId: vehicleId, plate: 'C10002', owner: '乙', building: '2号楼', vehicleType: 'visitor' } }),
    ]);
    expect(writes.map((response) => response.statusCode)).toEqual([200, 200]);
    const live = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM whitelist_imports WHERE vehicle_id=$1 AND is_snapshot=false', [vehicleId]);
    expect(live.rows[0].c).toBe(1);
  });
});
