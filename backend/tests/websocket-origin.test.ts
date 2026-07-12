import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/index.js';

const trustedOrigin = 'https://platform.example.test';
const apps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function start() {
  const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database;
  const app = await createApp({ db, config: { databaseUrl: 'postgres://unused', sessionSecret: 'test-secret', publicOrigin: trustedOrigin, allowedOrigins: [trustedOrigin] } });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}`;
}

function closes(url: string, origin?: string): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { headers: { origin } } : undefined);
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    socket.once('error', reject);
  });
}

describe('WebSocket origin policy', () => {
  it.each(['/ws', '/patrol/live'])('rejects an untrusted Origin for %s', async (path) => {
    const base = await start();
    await expect(closes(`${base}${path}`, 'https://attacker.example.test')).resolves.toEqual({ code: 1008, reason: 'Untrusted WebSocket origin' });
  });

  it.each(['/ws', '/patrol/live'])('accepts the trusted Origin before authentication for %s', async (path) => {
    const base = await start();
    await expect(closes(`${base}${path}`, trustedOrigin)).resolves.toEqual({ code: 1008, reason: 'Authentication required' });
  });

  it.each(['/ws', '/patrol/live'])('rejects a missing Origin for %s', async (path) => {
    const base = await start();
    await expect(closes(`${base}${path}`)).resolves.toEqual({ code: 1008, reason: 'Untrusted WebSocket origin' });
  });
});
