import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/index.js';
import { sign } from '../src/security.js';

const origin = 'https://platform.example.test';
const secret = 'route-security-test-secret';

function sessionCookie(userId = '11111111-1111-4111-8111-111111111111') {
  const token = sign({ sub: userId, role: 'operator', exp: Date.now() + 60_000 }, secret);
  return `oh_ai_session=${token}`;
}

function result(rows: unknown[] = []) {
  return { rows, rowCount: rows.length };
}

describe('route-level security controls', () => {
  it('rejects a route owned by a vehicle outside the operator membership', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM users WHERE id=')) {
        return result([{ id: '11111111-1111-4111-8111-111111111111', username: 'operator', display_name: 'Operator', password_hash: 'unused', role: 'operator', active: true, email: null }]);
      }
      if (sql.includes('SELECT vehicle_id FROM patrol_routes')) return result([{ vehicle_id: '22222222-2222-4222-8222-222222222222' }]);
      if (sql.includes('FROM vehicle_members WHERE')) return result();
      return result();
    });
    const app = await createApp({
      db: { query } as unknown as Database,
      config: { sessionSecret: secret, publicOrigin: origin, allowedOrigins: [origin] },
      authRateLimits: { loginMax: 1_000, otpRequestMax: 1_000, otpVerifyMax: 1_000 },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/map/waypoints?routeId=33333333-3333-4333-8333-333333333333',
        headers: { cookie: sessionCookie() },
      });
      expect(response.statusCode).toBe(403);
      expect(query.mock.calls.some(([sql]) => String(sql).includes('FROM patrol_waypoints'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('returns 404 for evidence without an authorized business association', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM users WHERE id=')) {
        return result([{ id: '11111111-1111-4111-8111-111111111111', username: 'operator', display_name: 'Operator', password_hash: 'unused', role: 'operator', active: true, email: null }]);
      }
      if (sql.includes('WITH evidence_vehicles AS')) return result();
      return result();
    });
    const app = await createApp({
      db: { query } as unknown as Database,
      config: { sessionSecret: secret, publicOrigin: origin, allowedOrigins: [origin] },
      authRateLimits: { loginMax: 1_000, otpRequestMax: 1_000, otpVerifyMax: 1_000 },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/evidence/evidence-0123456789abcdef.jpg', headers: { cookie: sessionCookie() } });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Evidence not found' });
    } finally {
      await app.close();
    }
  });

  it('returns 429 with Retry-After after ten login attempts for one normalized username', async () => {
    const query = vi.fn(async () => result());
    const app = await createApp({
      db: { query } as unknown as Database,
      config: { sessionSecret: secret, publicOrigin: origin, allowedOrigins: [origin] },
    });
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { username: 'Missing-User', password: 'wrong' } });
        expect(response.statusCode).toBe(401);
      }
      const throttled = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { username: 'missing-user', password: 'wrong' } });
      expect(throttled.statusCode).toBe(429);
      expect(throttled.headers['retry-after']).toBeDefined();
      expect(throttled.json()).toEqual({ error: '请求过于频繁，请稍后重试' });
      const auditCall = query.mock.calls.find(([sql, params]) => String(sql).includes('INSERT INTO audit_logs') && params?.[4] === 'throttled');
      expect(auditCall).toBeDefined();
      expect(JSON.parse(String(auditCall?.[1]?.[5]))).toEqual({ username: 'missing-user' });
    } finally {
      await app.close();
    }
  });

  it('uses forwarded client IP only when the trusted proxy setting is enabled', async () => {
    const invalidUsername = 'x'.repeat(129);
    const createLimitedApp = (trustProxy: boolean) => createApp({
      db: { query: vi.fn(async () => result()) } as unknown as Database,
      config: { sessionSecret: secret, publicOrigin: origin, allowedOrigins: [origin], trustProxy },
      authRateLimits: { loginMax: 1, otpRequestMax: 1_000, otpVerifyMax: 1_000 },
    });

    const trusted = await createLimitedApp(true);
    try {
      const first = await trusted.inject({ method: 'POST', url: '/api/auth/login', headers: { origin, 'x-forwarded-for': '198.51.100.10' }, payload: { username: invalidUsername, password: 'wrong' } });
      const sameClient = await trusted.inject({ method: 'POST', url: '/api/auth/login', headers: { origin, 'x-forwarded-for': '198.51.100.10' }, payload: { username: invalidUsername, password: 'wrong' } });
      const otherClient = await trusted.inject({ method: 'POST', url: '/api/auth/login', headers: { origin, 'x-forwarded-for': '198.51.100.11' }, payload: { username: invalidUsername, password: 'wrong' } });
      expect(first.statusCode).toBe(401);
      expect(sameClient.statusCode).toBe(429);
      expect(otherClient.statusCode).toBe(401);
    } finally {
      await trusted.close();
    }

    const direct = await createLimitedApp(false);
    try {
      const first = await direct.inject({ method: 'POST', url: '/api/auth/login', headers: { origin, 'x-forwarded-for': '198.51.100.20' }, payload: { username: invalidUsername, password: 'wrong' } });
      const spoofed = await direct.inject({ method: 'POST', url: '/api/auth/login', headers: { origin, 'x-forwarded-for': '198.51.100.21' }, payload: { username: invalidUsername, password: 'wrong' } });
      expect(first.statusCode).toBe(401);
      expect(spoofed.statusCode).toBe(429);
    } finally {
      await direct.close();
    }
  });
});
