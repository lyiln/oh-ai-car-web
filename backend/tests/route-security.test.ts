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
    } finally {
      await app.close();
    }
  });
});
