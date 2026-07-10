import type { GatewayEnvelope, StateEnvelope } from '@oh-ai-car-web/shared';

type StateListener = (state: StateEnvelope) => void;
type Pending = { resolve: (encoded?: string) => void; reject: (error: Error) => void };

export class ControlClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<StateListener>();

  async open(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const socket = new WebSocket('ws://127.0.0.1:8787/control');
    this.socket = socket;
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      for (const pending of this.pending.values()) pending.reject(new Error('网关连接已关闭'));
      this.pending.clear();
      this.publish({ type: 'state', connected: false, target: null, ownsControl: false, controlAvailable: false, lastError: '本地网关连接已关闭' });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('无法连接本地网关，请先启动 gateway')), { once: true });
      });
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      socket.close();
      throw error;
    }
  }

  onState(listener: StateListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  send(command: string, payload: unknown): Promise<string | undefined> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('本地网关未连接'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.socket?.send(JSON.stringify({ type: 'command', requestId, command, payload }));
    });
  }

  close(): void { this.socket?.close(); this.socket = null; }

  private receive(raw: unknown): void {
    const message = JSON.parse(String(raw)) as GatewayEnvelope;
    if (message.type === 'state') { this.publish(message); return; }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === 'result') pending.resolve(message.encoded);
    else pending.reject(new Error(message.message));
  }

  private publish(state: StateEnvelope): void {
    for (const listener of this.listeners) listener(state);
  }
}
