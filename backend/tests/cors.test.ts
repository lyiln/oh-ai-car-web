import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const trustedOrigin = 'https://platform.example.test';
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('platform CORS and request origins', () => {
  it('rejects cookie-authenticated writes from an untrusted origin', async () => {
    const app = await createApp({ config: { databaseUrl: 'postgres://unused', sessionSecret: 'test-secret', publicOrigin: trustedOrigin, allowedOrigins: [trustedOrigin] } }); apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://attacker.example.test' }, payload: { username: 'admin', password: 'password' } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Untrusted request origin' });
  });

  it('emits credential CORS headers only for configured origins', async () => {
    const app = await createApp({ config: { databaseUrl: 'postgres://unused', sessionSecret: 'test-secret', publicOrigin: trustedOrigin, allowedOrigins: [trustedOrigin] } }); apps.push(app);
    const trusted = await app.inject({ method: 'OPTIONS', url: '/api/auth/login', headers: { origin: trustedOrigin, 'access-control-request-method': 'POST' } });
    expect(trusted.headers['access-control-allow-origin']).toBe(trustedOrigin);
    const untrusted = await app.inject({ method: 'OPTIONS', url: '/api/auth/login', headers: { origin: 'https://attacker.example.test', 'access-control-request-method': 'POST' } });
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
  });
});
