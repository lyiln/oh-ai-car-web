import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { ControlServer } from '../src/websocket/control-server.js';
import { createFakeCarTcpServer } from './helpers/fake-car-tcp-server.js';

const servers: ControlServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

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

describe('localhost control gateway', () => {
  it('writes high-level commands to TCP and rejects raw command passthrough', async () => {
    const fake = await createFakeCarTcpServer();
    const server = new ControlServer({ port: 0 }); servers.push(server);
    const port = await server.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/control`);
    await new Promise<void>((resolve) => ws.once('open', resolve));
    expect((await request(ws, { type: 'command', requestId: 'connect', command: 'connect', payload: { host: '127.0.0.1', tcpPort: fake.port, videoPort: 6500 } })).type).toBe('result');
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
    const ws = new WebSocket(`ws://127.0.0.1:${port}/control`);
    await new Promise<void>((resolve) => ws.once('open', resolve));
    const response = await request(ws, { type: 'command', requestId: 'blocked', command: 'rocker', payload: { x: 0, y: 20 } });
    expect(response).toMatchObject({ type: 'error', code: 'NOT_CONNECTED', requestId: 'blocked' });
    ws.close();
  });
});
