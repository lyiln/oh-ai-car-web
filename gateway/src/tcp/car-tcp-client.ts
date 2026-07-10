import net from 'node:net';
import type { ConnectionConfig } from '@oh-ai-car-web/shared';

export class CarTcpClient {
  private socket: net.Socket | null = null;
  private target: ConnectionConfig | null = null;
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
    const socket = new net.Socket();
    this.socket = socket;
    const timeoutMs = target.timeoutMs ?? 3000;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        socket.removeAllListeners();
        socket.destroy();
        if (this.socket === socket) this.socket = null;
        this.connected = false;
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
    this.emit();
  }

  async write(message: string): Promise<void> {
    if (!this.socket || !this.connected || this.socket.destroyed) throw new Error('TCP socket is not connected');
    await new Promise<void>((resolve, reject) => {
      this.socket?.write(message, (error) => error ? reject(error) : resolve());
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (socket) socket.destroy();
    this.emit();
  }

  get isConnected(): boolean { return this.connected; }
  get currentTarget(): ConnectionConfig | null { return this.target; }
}
