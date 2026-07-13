import { createReadStream, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { GatewayEnvelope } from '@oh-ai-car-web/shared';
import { fetchCarVideoSnapshot, SnapshotError } from '../http/video-snapshot.js';
import { CarTcpClient } from '../tcp/car-tcp-client.js';
import { CommandError, dispatch, parseCommand, parseConnectionConfig, probeTarget, stopCommand, type ParsedCommand } from './command-dispatcher.js';
import type { ProbeResult } from '@oh-ai-car-web/shared';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1:8787',
  'http://localhost:8787',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
];
const STOP_TIMEOUT_MS = 500;

export interface LeaseVerification { vehicle: { host: string; tcpPort: number; videoPort: number }; expiresAt: string; }
export interface LeaseVerifier { verify(token: string, vehicleId: string): Promise<LeaseVerification | null>; }
export interface ControlServerOptions { port?: number; staticDir?: string; allowedOrigins?: readonly string[]; leaseVerifier?: LeaseVerifier; }

export class ControlServer {
  readonly client = new CarTcpClient();
  private readonly http: Server;
  private readonly sockets = new Set<WebSocket>();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly allowedOrigins: Set<string>;
  private controller: WebSocket | null = null;
  private lifecycle: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private readonly leaseVerifier: LeaseVerifier | undefined;
  private leaseTimer: NodeJS.Timeout | null = null;
  private port = 0;

  constructor(options: ControlServerOptions = {}) {
    const staticDir = options.staticDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist');
    this.allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
    this.leaseVerifier = options.leaseVerifier;
    this.http = createServer((request, response) => {
      void this.handleHttp(request, response, staticDir);
    });
    this.http.on('upgrade', (request, socket, head) => {
      if (request.url !== '/control' || !this.isAllowedOrigin(request)) { this.rejectUpgrade(socket); return; }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit('connection', ws));
    });
    this.wss.on('connection', (ws) => this.attach(ws));
    this.client.onState((_connected, _target, lastError) => this.broadcastState(lastError ?? null));
    if (options.port !== undefined) this.port = options.port;
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onListening = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => {
        this.http.removeListener('listening', onListening);
        this.http.removeListener('error', onError);
      };
      this.http.once('listening', onListening);
      this.http.once('error', onError);
      this.http.listen(this.port, '127.0.0.1');
    });
    const address = this.http.address();
    if (!address || typeof address === 'string') throw new Error('Gateway did not bind a TCP port');
    this.port = address.port;
    return this.port;
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.closeInternal();
    return this.closing;
  }

  private async closeInternal(): Promise<void> {
    await this.enqueue(async () => {
      try { await this.safeDisconnect(); }
      catch (error) { console.error('Gateway Stop failed during shutdown', error); }
    });
    for (const ws of this.sockets) ws.close();
    await new Promise<void>((resolve, reject) => this.http.close((error) => {
      if (!error || (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') resolve();
      else reject(error);
    }));
  }

  private isAllowedOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    return typeof origin === 'string' && this.allowedOrigins.has(origin);
  }

  /** Allow same-origin / no-origin for local img tags; require Origin when present. */
  private isAllowedHttpOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    return this.allowedOrigins.has(origin);
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse, staticDir: string): Promise<void> {
    const url = new URL(request.url ?? '/', `http://127.0.0.1`);
    if (url.pathname === '/api/video/snapshot') {
      await this.handleVideoSnapshot(request, response, url);
      return;
    }

    const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const file = path.resolve(staticDir, requested);
    if (!file.startsWith(path.resolve(staticDir)) || !existsSync(file)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css' });
    createReadStream(file).pipe(response);
  }

  private async handleVideoSnapshot(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    if (!this.isAllowedHttpOrigin(request)) {
      response.writeHead(403).end('Forbidden origin');
      return;
    }

    const host = url.searchParams.get('host')?.trim() ?? '';
    const portRaw = url.searchParams.get('port') ?? '6500';
    const videoPort = Number(portRaw);
    if (!host || !Number.isInteger(videoPort) || videoPort < 1 || videoPort > 65535) {
      response.writeHead(400).end('host and port query params are required');
      return;
    }

    const target = this.client.currentTarget;
    if (!this.client.isConnected || !target) {
      response.writeHead(403).end('TCP not connected; connect the gateway before requesting a video snapshot');
      return;
    }
    if (target.host !== host || target.videoPort !== videoPort) {
      response.writeHead(403).end('host/port must match the currently connected vehicle video target');
      return;
    }

    try {
      const jpeg = await fetchCarVideoSnapshot({ host, videoPort });
      response.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'Content-Length': jpeg.length,
        'Access-Control-Allow-Origin': request.headers.origin ?? 'http://127.0.0.1:5173',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      response.end(jpeg);
    } catch (error) {
      if (error instanceof SnapshotError) {
        response.writeHead(error.statusCode).end(error.message);
        return;
      }
      response.writeHead(502).end(error instanceof Error ? error.message : 'Snapshot failed');
    }
  }

  private rejectUpgrade(socket: import('node:stream').Duplex): void {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  }

  private attach(ws: WebSocket): void {
    this.sockets.add(ws);
    this.sendState(ws, null);
    ws.on('message', (input) => { void this.enqueue(() => this.handleMessage(ws, input.toString())); });
    ws.on('close', () => {
      this.sockets.delete(ws);
      if (this.controller === ws) void this.enqueue(async () => {
        if (this.controller !== ws) return;
        try { await this.safeDisconnect(); }
        catch (error) { console.error('Gateway Stop failed after controller disconnect', error); }
      });
    });
  }

  private async handleMessage(ws: WebSocket, input: string): Promise<void> {
    let parsed: unknown;
    try { parsed = JSON.parse(input); }
    catch { this.send(ws, { type: 'error', requestId: '', code: 'INVALID_JSON', message: 'Message must be valid JSON' }); return; }
    let command: ParsedCommand;
    try { command = parseCommand(parsed); }
    catch (error) { this.sendError(ws, typeof (parsed as { requestId?: unknown }).requestId === 'string' ? (parsed as { requestId: string }).requestId : '', error); return; }

    try {
      const result = await this.handleCommand(ws, command);
      this.send(ws, {
        type: 'result',
        requestId: result.requestId,
        ok: true,
        ...(result.encoded ? { encoded: result.encoded } : {}),
        ...(result.probe ? { probe: result.probe } : {}),
      });
    } catch (error) {
      this.sendError(ws, command.requestId, error);
    }
  }

  private async handleCommand(ws: WebSocket, command: ParsedCommand): Promise<{ requestId: string; encoded?: string; probe?: ProbeResult }> {
    if (command.command === 'probe') {
      const probe = await probeTarget(command.payload);
      return { requestId: command.requestId, probe };
    }

    if (command.command === 'connect') {
      if (this.controller && this.controller !== ws) throw new CommandError('CONTROLLER_BUSY', 'Another local browser session controls the car');
      try {
        if (this.client.isConnected) await this.safeDisconnect();
        this.controller = ws;
        this.broadcastState(null);
        const target = await this.authorizeConnection(command.payload);
        await this.client.connect(target);
        return { requestId: command.requestId };
      } catch (error) {
        if (this.controller === ws) {
          this.controller = null;
          this.broadcastState(error instanceof Error ? error.message : 'TCP connection failed');
        }
        throw error;
      }
    }

    this.requireController(ws);
    if (command.command === 'leaseRefresh') {
      await this.authorizeConnection(command.payload, true);
      return { requestId: command.requestId };
    }
    if (command.command === 'disconnect') {
      const encoded = await this.safeDisconnect();
      return { requestId: command.requestId, encoded };
    }
    return dispatch(this.client, command);
  }

  private requireController(ws: WebSocket): void {
    if (this.controller === ws) return;
    if (this.controller) throw new CommandError('CONTROLLER_BUSY', 'Another local browser session controls the car');
    throw new CommandError('NOT_CONNECTED', 'TCP socket is not connected');
  }

  private async safeDisconnect(): Promise<string | undefined> {
    let encoded: string | undefined;
    let failure: unknown;
    try {
      if (this.client.isConnected) encoded = (await this.withTimeout(dispatch(this.client, stopCommand), STOP_TIMEOUT_MS)).encoded;
    } catch (error) {
      failure = error;
    } finally {
      this.clearLeaseTimer();
      this.controller = null;
      this.client.disconnect();
      this.client.clearLastTarget();
    }
    if (failure) throw new CommandError('STOP_FAILED', failure instanceof Error ? `Stop write failed: ${failure.message}` : 'Stop write failed');
    return encoded;
  }

  /**
   * Verify platform lease for vehicleId when required, then connect to the
   * operator-supplied host/ports (APP NetworkSettings-style override).
   */
  private async authorizeConnection(payload: unknown, refresh = false) {
    const target = parseConnectionConfig(payload);
    if (!this.leaseVerifier) return target;
    const value = payload as { vehicleId?: unknown; leaseToken?: unknown };
    if (typeof value.vehicleId !== 'string' || typeof value.leaseToken !== 'string') throw new CommandError('PLATFORM_AUTH_REQUIRED', 'A valid platform control lease is required');
    const lease = await this.leaseVerifier.verify(value.leaseToken, value.vehicleId);
    if (!lease) throw new CommandError('PLATFORM_AUTH_REQUIRED', 'Platform control lease is invalid or expired');
    if (refresh) {
      const current = this.client.currentTarget;
      if (!current || current.host !== target.host || current.tcpPort !== target.tcpPort || current.videoPort !== target.videoPort) {
        throw new CommandError('PLATFORM_AUTH_REQUIRED', 'Lease refresh does not match the connected vehicle');
      }
    }
    this.scheduleLeaseExpiry(lease.expiresAt);
    return target;
  }

  private scheduleLeaseExpiry(expiresAt: string): void {
    this.clearLeaseTimer();
    const waitMs = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    this.leaseTimer = setTimeout(() => {
      void this.enqueue(async () => {
        try { await this.safeDisconnect(); }
        catch (error) { console.error('Gateway Stop failed after platform lease expiry', error); }
      });
    }, waitMs);
  }

  private clearLeaseTimer(): void { if (this.leaseTimer) clearTimeout(this.leaseTimer); this.leaseTimer = null; }

  private withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Stop write timed out after ${timeoutMs}ms`)), timeoutMs);
      operation.then((result) => { clearTimeout(timer); resolve(result); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(operation, operation);
    this.lifecycle = next.then(() => undefined, () => undefined);
    return next;
  }

  private sendError(ws: WebSocket, requestId: string, error: unknown): void {
    const known = error instanceof CommandError;
    this.send(ws, { type: 'error', requestId, code: known ? error.code : 'TCP_ERROR', message: error instanceof Error ? error.message : 'Command failed' });
  }

  private send(ws: WebSocket, message: GatewayEnvelope): void { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
  private sendState(ws: WebSocket, lastError: string | null): void {
    const ownsControl = this.controller === ws;
    this.send(ws, {
      type: 'state',
      connected: this.client.isConnected,
      target: this.client.currentTarget,
      ownsControl,
      controlAvailable: !this.controller || ownsControl,
      lastError,
    });
  }

  private broadcastState(lastError: string | null): void {
    for (const ws of this.sockets) this.sendState(ws, lastError);
  }
}
