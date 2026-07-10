import { describe, expect, it, vi } from 'vitest';
import type { StateEnvelope } from '@oh-ai-car-web/shared';
import { ControlClient } from '../src/services/controlClient.js';

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = 0;

  constructor(_url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  open(): void { this.readyState = FakeWebSocket.OPEN; this.dispatchEvent(new Event('open')); }
  close(): void { this.readyState = FakeWebSocket.CLOSED; this.dispatchEvent(new Event('close')); }
  send(): void {}
  receive(data: string): void { this.dispatchEvent(new MessageEvent('message', { data })); }
}

describe('ControlClient', () => {
  it('publishes a safe disconnected state when the gateway closes unexpectedly', async () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new ControlClient();
    const states: StateEnvelope[] = [];
    client.onState((state) => states.push(state));

    const opening = client.open();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    await opening;
    socket.receive(JSON.stringify({ type: 'state', connected: true, target: { host: '127.0.0.1', tcpPort: 6000, videoPort: 6500 }, ownsControl: true, controlAvailable: true, lastError: null }));
    socket.close();

    expect(states.at(-1)).toMatchObject({ connected: false, target: null, ownsControl: false, controlAvailable: false });
  });
});
