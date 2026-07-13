import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { ControlServer } from '../src/websocket/control-server.js';
import { createFakeCarTcpServer } from './helpers/fake-car-tcp-server.js';

const servers: ControlServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
const ORIGIN = 'http://127.0.0.1:8787';
const ALLOWED_ORIGINS = [
  'http://127.0.0.1:8787',
  'http://localhost:8787',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
];

function request(ws: WebSocket, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const handler = (data: RawData) => {
      const response = JSON.parse(data.toString()) as Record<string, unknown>;
      if (response.requestId === message.requestId) { ws.removeListener('message', handler); resolve(response); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

async function open(port: number, origin = ORIGIN): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/control`, { origin });
  await new Promise<void>((resolve) => ws.once('open', resolve));
  return ws;
}

async function connect(ws: WebSocket, tcpPort: number, requestId = 'connect'): Promise<Record<string, unknown>> {
  return request(ws, { type: 'command', requestId, command: 'connect', payload: { host: '127.0.0.1', tcpPort, videoPort: 6500 } });
}

function receivedStates(ws: WebSocket): Record<string, unknown>[] {
  const states: Record<string, unknown>[] = [];
  ws.on('message', (data: RawData) => {
    const message = JSON.parse(data.toString()) as Record<string, unknown>;
    if (message.type === 'state') states.push(message);
  });
  return states;
}

describe('localhost control gateway', () => {
  it('writes high-level commands to TCP and rejects raw command passthrough', async () => {
    const fake = await createFakeCarTcpServer();
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = await open(port);
    expect((await connect(ws, fake.port)).type).toBe('result');
    expect((await request(ws, { type: 'command', requestId: 'move', command: 'button', payload: { direction: 'Front' } })).encoded).toBe('$011504011B#');
    expect((await request(ws, { type: 'command', requestId: 'photo', command: 'photo', payload: {} })).encoded).toMatch(/^\$016002[0-9A-F]{2}#$/);
    expect((await request(ws, { type: 'command', requestId: 'tracking', command: 'tracking', payload: { enabled: true } })).encoded).toMatch(/^\$016302[0-9A-F]{2}#$/);
    expect((await request(ws, { type: 'command', requestId: 'wheels', command: 'wheelSpeeds', payload: { l1: -100, l2: 0, r1: 1, r2: 100 } })).encoded).toMatch(/^\$01210A9C000164[0-9A-F]{2}#$/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.messages).toContain('$011504011B#');
    expect((await request(ws, { type: 'command', requestId: 'raw', command: 'raw', payload: { value: '$01#' } })).code).toBe('UNSUPPORTED_COMMAND');
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    ws.close(); await closed;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.messages).toContain('$011504001A#');
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await fake.close();
  });

  it('rejects all movement while the car TCP socket is disconnected', async () => {
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = await open(port);
    const response = await request(ws, { type: 'command', requestId: 'blocked', command: 'rocker', payload: { x: 0, y: 20 } });
    expect(response).toMatchObject({ type: 'error', code: 'NOT_CONNECTED', requestId: 'blocked' });
    ws.close();
  });

  it('rejects WebSocket upgrades from an untrusted browser origin', async () => {
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/control`, { origin: 'https://example.invalid' });
    ws.on('error', () => undefined);
    const status = await new Promise<number | undefined>((resolve) => ws.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    }));
    expect(status).toBe(403);
  });

  it('rejects WebSocket upgrades without an Origin header', async () => {
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/control`);
    ws.on('error', () => undefined);
    const status = await new Promise<number | undefined>((resolve) => ws.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    }));
    expect(status).toBe(403);
  });

  it.each(ALLOWED_ORIGINS)('accepts documented local Origin %s', async (origin) => {
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = await open(port, origin);
    ws.close();
  });

  it('rejects a listen failure instead of leaving startup pending', async () => {
    const first = new ControlServer({ port: 0 }); servers.push(first);
    const occupiedPort = await first.listen();
    const second = new ControlServer({ port: occupiedPort }); servers.push(second);

    await expect(second.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('sends each browser its own controller state and releases control after disconnect', async () => {
    const firstCar = await createFakeCarTcpServer();
    const secondCar = await createFakeCarTcpServer();
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const controller = await open(port);
    const observer = await open(port);
    const controllerStates = receivedStates(controller);
    const observerStates = receivedStates(observer);
    expect((await connect(controller, firstCar.port)).type).toBe('result');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controllerStates.at(-1)).toMatchObject({ connected: true, ownsControl: true, controlAvailable: true });
    expect(observerStates.at(-1)).toMatchObject({ connected: true, ownsControl: false, controlAvailable: false });
    expect(await request(observer, { type: 'command', requestId: 'other-connect', command: 'connect', payload: { host: '127.0.0.1', tcpPort: secondCar.port, videoPort: 6500 } })).toMatchObject({ type: 'error', code: 'CONTROLLER_BUSY' });
    expect((await connect(controller, secondCar.port, 'reconnect')).type).toBe('result');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(firstCar.messages).toContain('$011504001A#');
    expect(await request(controller, { type: 'command', requestId: 'disconnect', command: 'disconnect', payload: {} })).toMatchObject({ type: 'result', encoded: '$011504001A#' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(observerStates.at(-1)).toMatchObject({ connected: false, ownsControl: false, controlAvailable: true });
    expect((await connect(observer, secondCar.port, 'take-control')).type).toBe('result');
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondCar.messages.filter((message) => message === '$011504001A#').length).toBeGreaterThanOrEqual(2);
    controller.close(); observer.close();
    await firstCar.close(); await secondCar.close();
  });

  it('reports STOP_FAILED while still closing the TCP connection', async () => {
    const fake = await createFakeCarTcpServer();
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = await open(port);
    await connect(ws, fake.port);
    server.client.write = async () => { throw new Error('simulated stop failure'); };
    expect(await request(ws, { type: 'command', requestId: 'disconnect', command: 'disconnect', payload: {} })).toMatchObject({ type: 'error', code: 'STOP_FAILED' });
    expect(server.client.isConnected).toBe(false);
    ws.close();
    await fake.close();
  });

  it('does not connect a new target when the old target Stop write fails during reconnect', async () => {
    const firstCar = await createFakeCarTcpServer();
    const secondCar = await createFakeCarTcpServer();
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = await open(port);
    await connect(ws, firstCar.port);
    server.client.write = async () => { throw new Error('simulated stop failure'); };

    expect(await connect(ws, secondCar.port, 'reconnect-failure')).toMatchObject({ type: 'error', code: 'STOP_FAILED' });
    expect(server.client.isConnected).toBe(false);
    expect(secondCar.connections()).toBe(0);

    ws.close();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await firstCar.close();
    await secondCar.close();
  });

  it('probes TCP reachability without claiming the controller session', async () => {
    const fake = await createFakeCarTcpServer();
    const server = new ControlServer({
      port: 0,
      leaseVerifier: {
        verify: async (token, vehicleId) => {
          if (token !== 'lease-token') return null;
          if (vehicleId === 'vehicle-1') return { vehicle: { host: '127.0.0.1', tcpPort: fake.port, videoPort: 6500 }, expiresAt: '2099-01-01T00:00:00.000Z' };
          if (vehicleId === 'refused') return { vehicle: { host: '127.0.0.1', tcpPort: 1, videoPort: 6500 }, expiresAt: '2099-01-01T00:00:00.000Z' };
          return null;
        },
      },
    }); servers.push(server);
    const port = await server.listen();
    const ws = await open(port);
    const reachable = await request(ws, {
      type: 'command',
      requestId: 'probe-ok',
      command: 'probe',
      payload: { host: '127.0.0.1', tcpPort: fake.port, videoPort: 6500, vehicleId: 'vehicle-1', leaseToken: 'lease-token', timeoutMs: 1000 },
    });
    expect(reachable).toMatchObject({
      type: 'result',
      probe: { status: 'REACHABLE', host: '127.0.0.1', tcpPort: fake.port },
    });
    expect(server.client.isConnected).toBe(false);

    const missingLease = await request(ws, {
      type: 'command', requestId: 'probe-missing-lease', command: 'probe',
      payload: { host: '127.0.0.1', tcpPort: fake.port, videoPort: 6500, vehicleId: 'vehicle-1' },
    });
    expect(missingLease).toMatchObject({ type: 'error', code: 'PLATFORM_AUTH_REQUIRED' });

    const refused = await request(ws, {
      type: 'command',
      requestId: 'probe-refused',
      command: 'probe',
      payload: { host: '127.0.0.1', tcpPort: 1, videoPort: 6500, vehicleId: 'refused', leaseToken: 'lease-token', timeoutMs: 500 },
    });
    expect(refused.type).toBe('result');
    expect((refused.probe as { status: string }).status).toMatch(/REFUSED|TIMEOUT|ERROR/);

    const mismatched = await request(ws, {
      type: 'command', requestId: 'probe-mismatch', command: 'probe',
      payload: { host: '127.0.0.1', tcpPort: 1, videoPort: 6500, vehicleId: 'vehicle-1', leaseToken: 'lease-token' },
    });
    expect(mismatched).toMatchObject({ type: 'error', code: 'PLATFORM_AUTH_REQUIRED' });

    ws.close();
    await fake.close();
  });

  it('rejects movement after an unexpected TCP close without reconnecting or resending', async () => {
    const fake = await createFakeCarTcpServer();
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = await open(port);
    expect((await connect(ws, fake.port)).type).toBe('result');

    const internal = server.client as unknown as { socket: { destroy: () => void } | null };
    expect(internal.socket).toBeTruthy();
    internal.socket!.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await request(ws, {
      type: 'command',
      requestId: 'after-drop',
      command: 'button',
      payload: { direction: 'Front' },
    });
    expect(response).toMatchObject({ type: 'error', code: 'NOT_CONNECTED' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.messages).not.toContain('$011504011B#');
    expect(fake.connections()).toBe(1);

    ws.close();
    await fake.close();
  });
});
