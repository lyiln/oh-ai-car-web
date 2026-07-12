import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';

const port = 18080 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const project = `oh-ai-car-live-${randomBytes(4).toString('hex')}`;
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  WEB_PORT: String(port),
  POSTGRES_PASSWORD: 'integration-password',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  BOOTSTRAP_ADMIN_USERNAME: 'integration-admin',
  BOOTSTRAP_ADMIN_PASSWORD: 'integration-password',
  BOOTSTRAP_ADMIN_EMAIL: 'integration-admin@example.test',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'integration-mailer',
  SMTP_PASSWORD: 'integration-mailer-password',
  SMTP_FROM: 'PatrolPlate <no-reply@example.test>',
  PLATFORM_PUBLIC_ORIGIN: origin,
  VITE_AMAP_KEY: 'integration-key',
  AMAP_SECURITY_JS_CODE: 'integration-code',
  COOKIE_SECURE: 'false',
};

function compose(args, allowFailure = false) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: new URL('../..', import.meta.url), env: environment, stdio: 'inherit' });
  if (!allowFailure && result.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed`);
}

function httpJson(path, method = 'GET', payload, cookie) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const req = request(`${origin}${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
    });
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForPlatform() {
  let lastError;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await httpJson('/api/auth/me');
      if (response.status === 401) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError ?? new Error('Platform did not become ready');
}

function connectAndSubscribe(cookie, vehicleId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/patrol/live`, { headers: { origin, cookie } });
    socket.once('error', reject);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'subscribe', vehicleId })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'subscribed' && message.vehicleId === vehicleId) {
        socket.close();
        resolve();
      }
    });
  });
}

function closesUnauthenticated() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/patrol/live`, { headers: { origin } });
    socket.once('error', reject);
    socket.once('close', (code) => code === 1008 ? resolve() : reject(new Error(`Expected 1008, got ${code}`)));
  });
}

try {
  compose(['up', '--build', '-d']);
  await waitForPlatform();
  const login = await httpJson('/api/auth/login', 'POST', { username: 'integration-admin', password: 'integration-password' });
  if (login.status !== 200) throw new Error(`Login failed with ${login.status}`);
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const vehicle = await httpJson('/api/vehicles', 'POST', { code: `LIVE-${randomUUID().slice(0, 8)}`, name: 'Live WebSocket Test', host: '127.0.0.1', tcpPort: 6000, videoPort: 6500 }, cookie);
  if (vehicle.status !== 200) throw new Error(`Vehicle creation failed with ${vehicle.status}`);
  await connectAndSubscribe(cookie, vehicle.body.vehicle.id);
  await closesUnauthenticated();
  console.log('Deployment live WebSocket verification passed');
} finally {
  compose(['down', '-v', '--remove-orphans'], true);
}
