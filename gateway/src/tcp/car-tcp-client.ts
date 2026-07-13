import net from 'node:net';
import type { ConnectionConfig, ProbeResult } from '@oh-ai-car-web/shared';

const DEFAULT_PROBE_TIMEOUT_MS = 2000;

export class CarTcpClient {
  private socket: net.Socket | null = null;
  private target: ConnectionConfig | null = null;
  /** Preserved after unexpected close so write() can reconnect once. */
  private lastTarget: ConnectionConfig | null = null;
  private connected = false;
  private readonly stateListeners = new Set<(connected: boolean, target: ConnectionConfig | null, error?: string) => void>();

  onState(listener: (connected: boolean, target: ConnectionConfig | null, error?: string) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private emit(error?: string): void {
    for (const listener of this.stateListeners) listener(this.connected, this.target, error);
  }

  async connect(target: ConnectionConfig): Promise<void> {
    this.disconnect();
    this.target = target;
    this.lastTarget = target;
    const socket = new net.Socket();
    this.socket = socket;
    const timeoutMs = target.timeoutMs ?? 3000;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        socket.removeAllListeners();
        socket.destroy();
        if (this.socket === socket) this.socket = null;
        this.connected = false;
        this.target = null;
        this.emit(error.message);
        reject(error);
      };
      socket.setTimeout(timeoutMs, () => fail(new Error(`TCP connection timed out after ${timeoutMs}ms`)));
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.removeListener('error', fail);
        socket.setTimeout(0);
        socket.on('error', (error) => this.handleSocketError(socket, error));
        socket.on('close', () => this.handleSocketClose(socket));
        this.connected = true;
        this.emit();
        resolve();
      });
      socket.connect(target.tcpPort, target.host);
    });
  }

  private handleSocketError(socket: net.Socket, error: Error): void {
    if (this.socket !== socket) return;
    this.connected = false;
    this.emit(error.message);
  }

  private handleSocketClose(socket: net.Socket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.connected = false;
    this.target = null;
    this.emit();
  }

  private writeOnce(message: string): Promise<void> {
    if (!this.socket || !this.connected || this.socket.destroyed) throw new Error('TCP socket is not connected');
    return new Promise<void>((resolve, reject) => {
      this.socket?.write(message, (error) => error ? reject(error) : resolve());
    });
  }

  /**
   * Write a control packet. If the socket is down, reconnect once to lastTarget
   * and retry (APP-like TCPClientManager reconnect behavior, plus resend).
   */
  async write(message: string): Promise<void> {
    try {
      await this.writeOnce(message);
    } catch (firstError) {
      const retryTarget = this.target ?? this.lastTarget;
      if (!retryTarget) throw firstError;
      await this.connect(retryTarget);
      await this.writeOnce(message);
    }
  }

  /** Short TCP reachability check without claiming the control session. */
  static async probe(host: string, tcpPort: number, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<ProbeResult> {
    const trimmed = host.trim();
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (result: ProbeResult) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs, () => finish({
        status: 'TIMEOUT',
        host: trimmed,
        tcpPort,
        message: `TCP probe timed out after ${timeoutMs}ms`,
      }));
      socket.once('error', (error: NodeJS.ErrnoException) => {
        const refused = error.code === 'ECONNREFUSED';
        finish({
          status: refused ? 'REFUSED' : 'ERROR',
          host: trimmed,
          tcpPort,
          message: error.message,
        });
      });
      socket.once('connect', () => finish({ status: 'REACHABLE', host: trimmed, tcpPort }));
      socket.connect(tcpPort, trimmed);
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.target = null;
    if (socket) socket.destroy();
    this.emit();
  }

  /** Clear reconnect target when the operator explicitly disconnects. */
  clearLastTarget(): void {
    this.lastTarget = null;
  }

  get isConnected(): boolean { return this.connected; }
  get currentTarget(): ConnectionConfig | null { return this.target; }
  /** True when an unexpected drop left a target we can reconnect to. */
  get hasReconnectTarget(): boolean { return this.lastTarget !== null; }
}
