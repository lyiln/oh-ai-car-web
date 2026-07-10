import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { GatewayEnvelope, StateEnvelope } from '@oh-ai-car-web/shared';
import { CarTcpClient } from '../tcp/car-tcp-client.js';
import { CommandError, dispatch, stopCommand } from './command-dispatcher.js';

export interface ControlServerOptions { port?: number; staticDir?: string; }

export class ControlServer {
  readonly client = new CarTcpClient();
  private readonly http: Server;
  private readonly sockets = new Set<WebSocket>();
  private readonly wss = new WebSocketServer({ noServer: true });
  private port = 0;

  constructor(options: ControlServerOptions = {}) {
    const staticDir = options.staticDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist');
    this.http = createServer((request, response) => {
      const requested = request.url === '/' ? 'index.html' : request.url?.replace(/^\//, '') ?? 'index.html';
      const file = path.resolve(staticDir, requested);
      if (!file.startsWith(path.resolve(staticDir)) || !existsSync(file)) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css' });
      createReadStream(file).pipe(response);
    });
    this.http.on('upgrade', (request, socket, head) => {
      if (request.url !== '/control') { socket.destroy(); return; }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit('connection', ws));
    });
    this.wss.on('connection', (ws) => this.attach(ws));
    this.client.onState((connected, target, lastError) => this.broadcast({ type: 'state', connected, target, lastError: lastError ?? null }));
    if (options.port !== undefined) this.port = options.port;
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.http.listen(this.port, '127.0.0.1', resolve));
    const address = this.http.address();
    if (!address || typeof address === 'string') throw new Error('Gateway did not bind a TCP port');
    this.port = address.port;
    return this.port;
  }

  async close(): Promise<void> {
    this.client.disconnect();
    for (const ws of this.sockets) ws.close();
    await new Promise<void>((resolve, reject) => this.http.close((error) => error ? reject(error) : resolve()));
  }

  private attach(ws: WebSocket): void {
    this.sockets.add(ws);
    this.send(ws, { type: 'state', connected: this.client.isConnected, target: this.client.currentTarget, lastError: null });
    ws.on('message', async (input) => {
      let parsed: unknown;
      try { parsed = JSON.parse(input.toString()); }
      catch { this.send(ws, { type: 'error', requestId: '', code: 'INVALID_JSON', message: 'Message must be valid JSON' }); return; }
      try {
        const result = await dispatch(this.client, parsed);
        this.send(ws, { type: 'result', requestId: result.requestId, ok: true, ...(result.encoded ? { encoded: result.encoded } : {}) });
      } catch (error) {
        const known = error instanceof CommandError;
        this.send(ws, { type: 'error', requestId: typeof (parsed as { requestId?: unknown }).requestId === 'string' ? (parsed as { requestId: string }).requestId : '', code: known ? error.code : 'TCP_ERROR', message: error instanceof Error ? error.message : 'Command failed' });
      }
    });
    ws.on('close', async () => {
      this.sockets.delete(ws);
      if (this.client.isConnected) {
        try { await dispatch(this.client, stopCommand); } catch { /* best effort stop */ }
      }
    });
  }

  private send(ws: WebSocket, message: GatewayEnvelope): void { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
  private broadcast(message: StateEnvelope): void { for (const ws of this.sockets) this.send(ws, message); }
}
