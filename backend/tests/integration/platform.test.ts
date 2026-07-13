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
async function waitForWhitelistLock(whitelistId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await db.transaction((client) => client.query('SELECT id FROM whitelist_imports WHERE id=$1 FOR UPDATE NOWAIT', [whitelistId]));
    } catch (error) {
      if ((error as { code?: string }).code === '55P03') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for global whitelist lock');
}

async function resetGlobalWhitelist(entries: Array<{ plate: string; owner?: string; building?: string; category?: 'private' | 'visitor' }> = []): Promise<string> {
  await db.query('UPDATE whitelist_imports SET is_snapshot=true WHERE vehicle_id IS NULL AND is_snapshot=false');
  const whitelistId = randomUUID();
  await db.query(
    'INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id,is_snapshot) VALUES ($1,NULL,$2,$3,false)',
    [whitelistId, '测试全局白名单', ids.admin],
  );
  for (const entry of entries) {
    await db.query(
      'INSERT INTO whitelist_entries (id,whitelist_id,plate,owner_name,building,category) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), whitelistId, entry.plate, entry.owner ?? '测试', entry.building ?? '1号楼', entry.category ?? 'private'],
    );
  }
  return whitelistId;
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

  it('rejects OTP requests for unknown usernames', async () => {
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'nobody' } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ error?: string }>().error).toBe('该用户不存在');

    const noEmailId = randomUUID();
    await db.query('INSERT INTO users (id,username,display_name,password_hash,role,email) VALUES ($1,$2,$3,$4,$5,$6)', [
      noEmailId, 'no-email-user', 'no-email-user', await argon2.hash('password'), 'operator', null,
    ]);
    const noEmail = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'no-email-user' } });
    expect(noEmail.statusCode).toBe(400);
    expect(noEmail.json<{ error?: string }>().error).toBe('该用户未绑定邮箱');

    const requested = await app.inject({ method: 'POST', url: '/api/auth/request-otp', headers: { origin }, payload: { username: 'operator-a' } });
    expect(requested.statusCode).toBe(200);
    const body = requested.json<{ passcode?: string; deliveryEmail?: string; message?: string }>();
    expect(body.message).toBe('验证码已发送');
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
    await db.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, '安全路线', 'v1', 'generated', ids.admin]);
    for (const [ordinal, name] of ['起点', '中点', '终点'].entries()) await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), routeId, ordinal, name, ordinal, ordinal, 0, 8]);
    await resetGlobalWhitelist([{ plate: 'A12345', owner: '测试', building: '1号楼' }]);

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
    const routeId = randomUUID(); const waypointId = randomUUID();
    await db.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, '观测路线', 'v1', 'generated', ids.admin]);
    await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,0,$3,0,0,0,8,$4)', [waypointId, routeId, '识别点', JSON.stringify([0.1, 0.1, 0.5, 0.5])]);
    for (const ordinal of [1, 2]) await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,0,0,0,8)', [randomUUID(), routeId, ordinal, `点${ordinal}`]);
    await resetGlobalWhitelist([]);
    expect((await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } })).statusCode).toBe(409);
    await resetGlobalWhitelist([{ plate: 'A12345', owner: '测试', building: '1号楼' }]);
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
    await resetGlobalWhitelist([{ plate: 'X99999', owner: '测试', building: '3号楼' }]);
    const started = await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } });
    expect(started.statusCode).toBe(200);
    const taskId = started.json<{ task: { id: string } }>().task.id;
    const credential = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie } });
    const token = credential.json<{ credential: { token: string } }>().credential.token;
    await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } });
    // Mutate live whitelist after task start — snapshot must stay isolated
    await app.inject({ method: 'POST', url: '/api/whitelist/import', headers: { origin, cookie: adminCookie }, payload: { rows: [{ plate: 'X99999', owner: '篡改', building: '99号楼', vehicleType: 'visitor' }] } });
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

  it('runs an operator-confirmed doorstep response with zero-velocity and evidence gates', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-DOOR', name: '上门处置车', host: '192.168.1.30', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA] } });
    const destination = await app.inject({ method: 'POST', url: '/api/resident-destinations', headers: { origin, cookie: adminCookie }, payload: { vehicleId, building: '1号楼', displayName: '1号楼一层门口', mapVersion: 'v-door', x: 4, y: 5, yaw: 0 } });
    expect(destination.statusCode).toBe(200);
    const routeId = randomUUID(); const waypointId = randomUUID();
    await db.query('INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)', [routeId, vehicleId, '上门路线', 'v-door', 'generated', ids.admin]);
    await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,0,$3,0,0,0,8,$4)', [waypointId, routeId, '东门禁停点', JSON.stringify([0.1, 0.1, 0.5, 0.5])]);
    for (const ordinal of [1, 2]) await db.query('INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,0,0,0,8)', [randomUUID(), routeId, ordinal, `点${ordinal}`]);
    await resetGlobalWhitelist([{ plate: 'D12345', owner: '住户甲', building: '1号楼' }]);
    const started = await app.inject({ method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie }, payload: { deviceId: vehicleId, routeId, shift: 'morning' } });
    const patrolTaskId = started.json<{ task: { id: string } }>().task.id;
    const credential = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie } });
    const token = credential.json<{ credential: { token: string } }>().credential.token;
    await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } });
    const observed = await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${patrolTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: {
      type: 'observation', waypointId, occurredAt: '2026-07-11T04:00:00.000Z', plate: 'D12345', confidence: 0.95,
      vehicleBox: [0.2, 0.2, 0.2, 0.2], evidenceImageUrl: 'https://evidence.invalid/no-parking.jpg',
    } });
    expect(observed.statusCode).toBe(200);
    const responseTaskId = observed.json<{ responseTaskId: string; responseEligible: boolean }>().responseTaskId;
    expect(observed.json()).toMatchObject({ responseEligible: true, reason: 'operator_confirmation_required', ownerName: '住户甲', building: '1号楼' });
    const blockingLeaseId = randomUUID();
    await db.query('INSERT INTO control_leases (id,vehicle_id,user_id,expires_at) VALUES ($1,$2,$3,now()+interval \'5 minutes\')', [blockingLeaseId, vehicleId, ids.operatorA]);
    const confirmed = await app.inject({ method: 'POST', url: `/api/response-tasks/${responseTaskId}/confirm`, headers: { origin, cookie: operatorCookie }, payload: {} });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ assignedVehicleId: null, assignmentPending: true, advice: { source: 'template' } });
    await db.query('UPDATE control_leases SET released_at=now() WHERE id=$1', [blockingLeaseId]);
    const assigned = await app.inject({ method: 'POST', url: `/api/response-tasks/${responseTaskId}/assign`, headers: { origin, cookie: operatorCookie }, payload: {} });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ assignedVehicleId: vehicleId, deduplicated: false });
    expect((await app.inject({ method: 'POST', url: `/api/response-tasks/${responseTaskId}/assign`, headers: { origin, cookie: operatorCookie }, payload: {} })).json()).toMatchObject({ assignedVehicleId: vehicleId, deduplicated: true });
    const claimed = await app.inject({ method: 'GET', url: '/device/v1/response/tasks/next', headers: { authorization: `Bearer ${token}` } });
    expect(claimed.json<{ task: { id: string; destinationName: string } }>().task).toMatchObject({ id: responseTaskId, destinationName: '1号楼一层门口' });
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${responseTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'nav-1', type: 'navigation_started' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${responseTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'arrive-bad', type: 'arrived', zeroVelocity: false } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${responseTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'arrive-1', type: 'arrived', zeroVelocity: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${responseTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'proof-1', type: 'arrival_evidence', evidenceUrl: 'https://evidence.invalid/door.jpg' } })).statusCode).toBe(200);
    const completed = await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${responseTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'done-1', type: 'completed', zeroVelocity: true } });
    expect(completed.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${responseTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'done-1', type: 'completed', zeroVelocity: true } })).json()).toMatchObject({ deduplicated: true });
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${responseTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'late-failure', type: 'failed', reason: 'late' } })).statusCode).toBe(409);

    const observedForCancel = await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${patrolTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: {
      type: 'observation', waypointId, occurredAt: '2026-07-11T05:00:00.000Z', plate: 'D12345', confidence: 0.96,
      vehicleBox: [0.2, 0.2, 0.2, 0.2], evidenceImageUrl: 'https://evidence.invalid/no-parking-2.jpg',
    } });
    const cancelTaskId = observedForCancel.json<{ responseTaskId: string }>().responseTaskId;
    expect((await app.inject({ method: 'POST', url: `/api/response-tasks/${cancelTaskId}/confirm`, headers: { origin, cookie: operatorCookie }, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${cancelTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'cancel-nav', type: 'navigation_started' } })).statusCode).toBe(200);
    const cancelRequested = await app.inject({ method: 'POST', url: `/api/response-tasks/${cancelTaskId}/cancel`, headers: { origin, cookie: operatorCookie }, payload: {} });
    expect(cancelRequested.json()).toMatchObject({ cancellationRequested: true });
    expect((await app.inject({ method: 'POST', url: `/api/response-tasks/${cancelTaskId}/cancel`, headers: { origin, cookie: operatorCookie }, payload: {} })).json()).toMatchObject({ cancellationRequested: true, deduplicated: true });
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${cancelTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'stop-bad', type: 'stop_confirmed', zeroVelocity: false } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${cancelTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'stop-ok', type: 'stop_confirmed', zeroVelocity: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/response/tasks/${cancelTaskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { eventId: 'cancelled-failure', type: 'failed' } })).statusCode).toBe(409);
  });

  it('resolves violation coordinates from observation or nearest telemetry and enriches owner info', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    const vehicle = await app.inject({
      method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie },
      payload: { code: 'CAR-LOC', name: '定位测试车', host: '192.168.1.40', tcpPort: 6000, videoPort: 6500 },
    });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA] } });
    await app.inject({
      method: 'POST', url: '/api/resident-destinations', headers: { origin, cookie: adminCookie },
      payload: { vehicleId, building: '5号楼', displayName: '5号楼门口', mapVersion: 'v-loc', x: 1, y: 2, yaw: 0 },
    });
    const routeId = randomUUID();
    const waypointId = randomUUID();
    await db.query(
      'INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [routeId, vehicleId, '定位路线', 'v-loc', 'generated', ids.admin],
    );
    await db.query(
      'INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,0,$3,0,0,0,8,$4)',
      [waypointId, routeId, '定位禁停点', JSON.stringify([0.1, 0.1, 0.5, 0.5])],
    );
    for (const ordinal of [1, 2]) {
      await db.query(
        'INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,0,0,0,8)',
        [randomUUID(), routeId, ordinal, `点${ordinal}`],
      );
    }
    await resetGlobalWhitelist([{ plate: 'G12345', owner: '定位住户', building: '5号楼' }]);
    await db.query(
      `UPDATE whitelist_entries SET parking_spot='B-05-12'
       WHERE plate='G12345' AND whitelist_id IN (SELECT id FROM whitelist_imports WHERE vehicle_id IS NULL AND is_snapshot=false)`,
    );
    const started = await app.inject({
      method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie },
      payload: { deviceId: vehicleId, routeId, shift: 'morning' },
    });
    expect(started.statusCode).toBe(200);
    const patrolTaskId = started.json<{ task: { id: string } }>().task.id;
    const credential = await app.inject({
      method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie },
    });
    const token = credential.json<{ credential: { token: string } }>().credential.token;
    await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } });

    await db.query(
      `INSERT INTO telemetry_points (id,vehicle_id,occurred_at,longitude,latitude)
       VALUES ($1,$2,'2026-07-11T06:00:00.000Z',116.401111,39.910222)`,
      [randomUUID(), vehicleId],
    );
    const telemObs = await app.inject({
      method: 'POST', url: `/device/v1/patrol/tasks/${patrolTaskId}/events`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'observation', waypointId, occurredAt: '2026-07-11T06:00:02.000Z', plate: 'G12345', confidence: 0.94,
        vehicleBox: [0.2, 0.2, 0.2, 0.2], evidenceImageUrl: 'https://evidence.invalid/telem.jpg',
      },
    });
    expect(telemObs.statusCode).toBe(200);
    expect(telemObs.json()).toMatchObject({ responseEligible: true });

    const listed = await app.inject({ method: 'GET', url: '/api/violations', headers: { origin, cookie: operatorCookie } });
    expect(listed.statusCode).toBe(200);
    const telemViolation = listed.json<{
      violations: Array<{
        plate: string; longitude: number; latitude: number; coordinateSource: string;
        ownerName: string; building: string; parkingSpot: string; confidence: number; id: string;
      }>;
    }>().violations.find((row) => row.plate === 'G12345');
    expect(telemViolation).toMatchObject({
      longitude: 116.401111,
      latitude: 39.910222,
      coordinateSource: 'telemetry',
      ownerName: '定位住户',
      building: '5号楼',
      parkingSpot: 'B-05-12',
      confidence: 0.94,
    });

    const detail = await app.inject({
      method: 'GET', url: `/api/violations/${telemViolation!.id}`, headers: { origin, cookie: operatorCookie },
    });
    expect(detail.json<{ violation: { coordinateSource: string; parkingSpot: string } }>().violation).toMatchObject({
      coordinateSource: 'telemetry',
      parkingSpot: 'B-05-12',
    });

    await resetGlobalWhitelist([{ plate: 'H67890', owner: '直传住户', building: '5号楼' }]);
    await db.query(
      `UPDATE whitelist_entries SET parking_spot='C-01'
       WHERE plate='H67890' AND whitelist_id IN (SELECT id FROM whitelist_imports WHERE vehicle_id IS NULL AND is_snapshot=false)`,
    );
    await db.query("UPDATE patrol_tasks SET status='completed', finished_at=now() WHERE id=$1", [patrolTaskId]);
    const routeId2 = randomUUID();
    const waypointId2 = randomUUID();
    await db.query(
      'INSERT INTO patrol_routes (id,vehicle_id,name,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [routeId2, vehicleId, '直传路线', 'v-loc', 'generated', ids.admin],
    );
    await db.query(
      'INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,0,$3,0,0,0,8,$4)',
      [waypointId2, routeId2, '直传禁停点', JSON.stringify([0.1, 0.1, 0.5, 0.5])],
    );
    for (const ordinal of [1, 2]) {
      await db.query(
        'INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds) VALUES ($1,$2,$3,$4,0,0,0,8)',
        [randomUUID(), routeId2, ordinal, `点${ordinal}`],
      );
    }
    const started2 = await app.inject({
      method: 'POST', url: '/api/patrol/start', headers: { origin, cookie: operatorCookie },
      payload: { deviceId: vehicleId, routeId: routeId2, shift: 'afternoon' },
    });
    expect(started2.statusCode).toBe(200);
    const patrolTaskId2 = started2.json<{ task: { id: string } }>().task.id;
    await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } });

    const directObs = await app.inject({
      method: 'POST', url: `/device/v1/patrol/tasks/${patrolTaskId2}/events`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'observation', waypointId: waypointId2, occurredAt: '2026-07-11T07:00:00.000Z',
        plate: 'H67890', confidence: 0.97,
        vehicleBox: [0.2, 0.2, 0.2, 0.2], evidenceImageUrl: 'https://evidence.invalid/direct.jpg',
        longitude: 116.405555, latitude: 39.915555,
      },
    });
    expect(directObs.statusCode).toBe(200);

    const listed2 = await app.inject({ method: 'GET', url: '/api/violations', headers: { origin, cookie: operatorCookie } });
    const directViolation = listed2.json<{
      violations: Array<{ plate: string; longitude: number; latitude: number; coordinateSource: string; ownerName: string }>;
    }>().violations.find((row) => row.plate === 'H67890');
    expect(directViolation).toMatchObject({
      longitude: 116.405555,
      latitude: 39.915555,
      coordinateSource: 'observation',
      ownerName: '直传住户',
    });
  });

  it('allows admin to manage global whitelist while operators can only read', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorACookie = await login('operator-a', 'password');
    expect((await app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { plate: 'B12345', vehicleType: 'commercial' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { plate: 'B12345', owner: '乙', building: '2号楼', vehicleType: 'visitor' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: operatorACookie }, payload: { plate: 'B99999', owner: '丙', building: '3号楼', vehicleType: 'private' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/whitelist', headers: { origin, cookie: operatorACookie } })).statusCode).toBe(200);
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
    const whitelistId = await resetGlobalWhitelist([{ plate: 'B10001', owner: '旧业主', building: '1号楼' }]);

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
          rows: [
            { plate: 'N10001', owner: '新业主', building: '2号楼', vehicleType: 'private' },
            { plate: 'B10001', owner: '更新业主', building: '3号楼', vehicleType: 'visitor' },
          ],
        },
      });
      await waitForWhitelistLock(whitelistId);

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

  it('keeps one live global whitelist when two first writes race', async () => {
    const adminCookie = await login('admin', 'new-password');
    await db.query('UPDATE whitelist_imports SET is_snapshot=true WHERE vehicle_id IS NULL AND is_snapshot=false');
    const writes = await Promise.all([
      app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { plate: 'C10001', owner: '甲', building: '1号楼', vehicleType: 'private' } }),
      app.inject({ method: 'POST', url: '/api/whitelist', headers: { origin, cookie: adminCookie }, payload: { plate: 'C10002', owner: '乙', building: '2号楼', vehicleType: 'visitor' } }),
    ]);
    expect(writes.map((response) => response.statusCode)).toEqual([200, 200]);
    const live = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM whitelist_imports WHERE vehicle_id IS NULL AND is_snapshot=false');
    expect(live.rows[0].c).toBe(1);
  });

  it('supports whitelist CRUD fields, fuzzy search, and role checks', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    await resetGlobalWhitelist([]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/whitelist',
      headers: { origin, cookie: adminCookie },
      payload: {
        plate: '京A·F0236',
        owner: '苏有鹏',
        building: '12号楼2单位301',
        parkingSpot: 'B-12-301',
        vehicleType: 'private',
        validUntil: '2027-12-31',
      },
    });
    expect(created.statusCode).toBe(200);
    const entry = created.json<{ entry: { id: string; plate: string; parkingSpot: string; validUntil: string | null; vehicleType: string } }>().entry;
    expect(entry).toMatchObject({
      plate: '京A·F0236',
      parkingSpot: 'B-12-301',
      vehicleType: 'private',
    });
    expect(entry.validUntil).toContain('2027-12-31');

    const listed = await app.inject({ method: 'GET', url: '/api/whitelist', headers: { origin, cookie: operatorCookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ entries: Array<{ plate: string; parkingSpot: string }> }>().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ plate: '京A·F0236', parkingSpot: 'B-12-301' })]),
    );

    const searched = await app.inject({ method: 'GET', url: `/api/whitelist?q=${encodeURIComponent('苏')}`, headers: { origin, cookie: operatorCookie } });
    expect(searched.statusCode).toBe(200);
    expect(searched.json<{ entries: Array<{ owner: string }> }>().entries).toEqual([
      expect.objectContaining({ owner: '苏有鹏' }),
    ]);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/whitelist/${entry.id}`,
      headers: { origin, cookie: adminCookie },
      payload: { building: '8号楼', parkingSpot: 'A-01' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ entry: { building: string; parkingSpot: string } }>().entry).toMatchObject({
      building: '8号楼',
      parkingSpot: 'A-01',
    });

    expect((await app.inject({
      method: 'PUT',
      url: `/api/whitelist/${entry.id}`,
      headers: { origin, cookie: operatorCookie },
      payload: { building: 'hack' },
    })).statusCode).toBe(403);

    expect((await app.inject({
      method: 'DELETE',
      url: `/api/whitelist/${entry.id}`,
      headers: { origin, cookie: operatorCookie },
    })).statusCode).toBe(403);

    expect((await app.inject({
      method: 'DELETE',
      url: `/api/whitelist/${entry.id}`,
      headers: { origin, cookie: adminCookie },
    })).statusCode).toBe(200);

    const afterDelete = await app.inject({ method: 'GET', url: '/api/whitelist', headers: { origin, cookie: adminCookie } });
    expect(afterDelete.json<{ entries: Array<{ id: string }> }>().entries.find((item) => item.id === entry.id)).toBeUndefined();
  });

  it('supports device search, update, archive delete, and rejects operator delete', async () => {
    const adminCookie = await login('admin', 'new-password');
    const operatorCookie = await login('operator-a', 'password');
    const created = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { origin, cookie: adminCookie },
      payload: {
        code: 'JETSON-SEARCH',
        name: 'Jetson巡检车-搜索',
        host: '10.82.66.200',
        tcpPort: 6000,
        videoPort: 6500,
        description: '定位测试设备',
      },
    });
    expect(created.statusCode).toBe(200);
    const deviceId = created.json<{ device: { id: string } }>().device.id;

    const searched = await app.inject({
      method: 'GET',
      url: '/api/devices?q=JETSON-SEARCH',
      headers: { origin, cookie: adminCookie },
    });
    expect(searched.statusCode).toBe(200);
    expect(searched.json<{ devices: Array<{ code: string }> }>().devices).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'JETSON-SEARCH' })]),
    );

    const byHost = await app.inject({
      method: 'GET',
      url: '/api/devices?q=10.82.66.200',
      headers: { origin, cookie: adminCookie },
    });
    expect(byHost.json<{ devices: Array<{ id: string }> }>().devices.some((row) => row.id === deviceId)).toBe(true);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/devices/${deviceId}`,
      headers: { origin, cookie: adminCookie },
      payload: { name: 'Jetson巡检车-已改', host: '10.82.66.201', tcpPort: 6001 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ device: { name: string; host: string; tcpPort: number } }>().device).toMatchObject({
      name: 'Jetson巡检车-已改',
      host: '10.82.66.201',
      tcpPort: 6001,
    });

    expect((await app.inject({
      method: 'DELETE',
      url: `/api/devices/${deviceId}`,
      headers: { origin, cookie: operatorCookie },
    })).statusCode).toBe(403);

    expect((await app.inject({
      method: 'DELETE',
      url: `/api/devices/${deviceId}`,
      headers: { origin, cookie: adminCookie },
    })).statusCode).toBe(200);

    const listed = await app.inject({ method: 'GET', url: '/api/devices', headers: { origin, cookie: adminCookie } });
    expect(listed.json<{ devices: Array<{ id: string }> }>().devices.find((row) => row.id === deviceId)).toBeUndefined();

    const archivedPatch = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { origin, cookie: adminCookie },
      payload: { code: 'JETSON-ARCH', name: '待归档车', host: '10.82.66.202', tcpPort: 6000, videoPort: 6500 },
    });
    const archiveId = archivedPatch.json<{ device: { id: string } }>().device.id;
    expect((await app.inject({
      method: 'PATCH',
      url: `/api/vehicles/${archiveId}`,
      headers: { origin, cookie: adminCookie },
      payload: { archived: true, description: 'archived via patch' },
    })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/devices', headers: { origin, cookie: adminCookie } }))
        .json<{ devices: Array<{ id: string }> }>().devices.find((row) => row.id === archiveId),
    ).toBeUndefined();
  });
});
