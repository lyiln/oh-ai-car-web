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
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  db = new Database(`postgres://platform:platform@${container.getHost()}:${container.getMappedPort(5432)}/platform`);
  await db.migrate();
  for (const [name, id, role] of [['admin', ids.admin, 'admin'], ['operator-a', ids.operatorA, 'operator'], ['operator-b', ids.operatorB, 'operator']] as const) {
    await db.query('INSERT INTO users (id,username,display_name,password_hash,role) VALUES ($1,$2,$3,$4,$5)', [id, name, name, await argon2.hash('password'), role]);
  }
  app = await createApp({ db, config: { sessionSecret: 'integration-secret', publicOrigin: origin, allowedOrigins: [origin] } });
});

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

  it('runs a route patrol, classifies evidence, and deduplicates a plate observation', async () => {
    const adminCookie = await login('admin', 'password'); const operatorCookie = await login('operator-a', 'password');
    const vehicle = await app.inject({ method: 'POST', url: '/api/vehicles', headers: { origin, cookie: adminCookie }, payload: { code: 'CAR-PATROL', name: '路线巡检车', host: '192.168.1.12', tcpPort: 6000, videoPort: 6500 } });
    const vehicleId = vehicle.json<{ vehicle: { id: string } }>().vehicle.id;
    await app.inject({ method: 'PUT', url: `/api/vehicles/${vehicleId}/members`, headers: { origin, cookie: adminCookie }, payload: { userIds: [ids.operatorA] } });
    const route = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-routes`, headers: { origin, cookie: adminCookie }, payload: { name: '日常路线', mapVersion: 'map-v1', yaml: `waypoints:\n  - name: 南门\n    x: 1\n    y: 2\n    yaw: 0\n    dwellSeconds: 8\n    roi: [0.1, 0.2, 0.5, 0.5]\n  - name: 1号楼\n    x: 3\n    y: 4\n    yaw: 1\n    dwellSeconds: 8\n  - name: 消防通道\n    x: 5\n    y: 6\n    yaw: 2\n    dwellSeconds: 10` } });
    expect(route.statusCode).toBe(200); const routeId = route.json<{ routeId: string }>().routeId;
    const whitelist = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/whitelists`, headers: { origin, cookie: adminCookie }, payload: { name: '业主名单', csv: 'plate,ownerName,building,category\nA12345,张三,1号楼,private' } });
    const task = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-tasks`, headers: { origin, cookie: operatorCookie }, payload: { routeId, whitelistId: whitelist.json<{ whitelistId: string }>().whitelistId, shift: '日间巡检' } });
    const taskId = task.json<{ taskId: string }>().taskId;
    const preStartLease = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/control-lease`, headers: { origin, cookie: operatorCookie } });
    expect(preStartLease.statusCode).toBe(200);
    const blockedStart = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-tasks/${taskId}/start`, headers: { origin, cookie: operatorCookie } });
    expect(blockedStart.statusCode).toBe(409); expect(blockedStart.json()).toMatchObject({ error: expect.stringContaining('release the active control lease') });
    const blockedTask = await app.inject({ method: 'GET', url: `/api/vehicles/${vehicleId}/patrol-tasks/${taskId}`, headers: { cookie: operatorCookie } });
    expect(blockedTask.json<{ task: { status: string } }>().task.status).toBe('draft');
    expect((await app.inject({ method: 'DELETE', url: `/api/control-leases/${preStartLease.json<{ leaseId: string }>().leaseId}`, headers: { origin, cookie: operatorCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-tasks/${taskId}/start`, headers: { origin, cookie: operatorCookie } })).statusCode).toBe(200);
    const credential = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/device-credentials`, headers: { origin, cookie: adminCookie } }); const token = credential.json<{ credential: { token: string } }>().credential.token;
    const claimed = await app.inject({ method: 'GET', url: '/device/v1/patrol/tasks/next', headers: { authorization: `Bearer ${token}` } }); expect(claimed.statusCode).toBe(200); const waypointId = claimed.json<{ task: { waypoints: Array<{ id: string }> } }>().task.waypoints[0].id;
    const observation = { type: 'observation', waypointId, occurredAt: '2026-07-11T08:00:00.000Z', plate: 'A-12345', confidence: 0.92, vehicleBox: [0.2, 0.3, 0.2, 0.2], evidenceImageUrl: '/evidence/a.jpg' };
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: observation })).json()).toMatchObject({ classification: 'registered_private', noParking: true });
    await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: observation });
    const detail = await app.inject({ method: 'GET', url: `/api/vehicles/${vehicleId}/patrol-tasks/${taskId}`, headers: { cookie: operatorCookie } }); expect(detail.json<{ observations: Array<{ observationCount: number }> }>().observations).toEqual([expect.objectContaining({ observationCount: 2 })]);
    const report = await app.inject({ method: 'GET', url: `/api/vehicles/${vehicleId}/patrol-tasks/${taskId}/report`, headers: { cookie: operatorCookie } }); expect(report.json<{ summary: { registeredPrivate: number; noParking: number } }>().summary).toEqual(expect.objectContaining({ registeredPrivate: 1, noParking: 1 }));
    const lease = await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/control-lease`, headers: { origin, cookie: operatorCookie } }); const leaseToken = lease.json<{ gatewayToken: string }>().gatewayToken;
    expect((await app.inject({ method: 'POST', url: '/internal/control-lease/verify', payload: { token: leaseToken } })).json()).toEqual({ valid: false });
    expect((await app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-tasks/${taskId}/stop`, headers: { origin, cookie: operatorCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'status', status: 'completed' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'status', status: 'failed', reason: 'cancelled' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/api/vehicles/${vehicleId}/patrol-tasks/active`, headers: { cookie: operatorCookie } })).json<{ task: { status: string } }>().task.status).toBe('cancellation_requested');
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'waypoint', waypointId } })).statusCode).not.toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: observation })).statusCode).not.toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'stop_confirmed', zeroVelocity: false } })).statusCode).not.toBe(200);
    expect((await app.inject({ method: 'POST', url: `/device/v1/patrol/tasks/${taskId}/events`, headers: { authorization: `Bearer ${token}` }, payload: { type: 'stop_confirmed', zeroVelocity: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/vehicles/${vehicleId}/patrol-tasks/active`, headers: { cookie: operatorCookie } })).json()).toEqual({ task: null });
    expect((await app.inject({ method: 'POST', url: '/internal/control-lease/verify', payload: { token: leaseToken } })).json()).toMatchObject({ valid: true });
    expect((await app.inject({ method: 'DELETE', url: `/api/control-leases/${lease.json<{ leaseId: string }>().leaseId}`, headers: { origin, cookie: operatorCookie } })).statusCode).toBe(200);
    const createDraft = () => app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-tasks`, headers: { origin, cookie: operatorCookie }, payload: { routeId, whitelistId: whitelist.json<{ whitelistId: string }>().whitelistId, shift: '并发巡检' } });
    const [firstDraft, secondDraft] = await Promise.all([createDraft(), createDraft()]); const [firstStart, secondStart] = await Promise.all([app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-tasks/${firstDraft.json<{ taskId: string }>().taskId}/start`, headers: { origin, cookie: operatorCookie } }), app.inject({ method: 'POST', url: `/api/vehicles/${vehicleId}/patrol-tasks/${secondDraft.json<{ taskId: string }>().taskId}/start`, headers: { origin, cookie: operatorCookie } })]);
    expect([firstStart.statusCode, secondStart.statusCode].sort()).toEqual([200, 409]);
  });
});
