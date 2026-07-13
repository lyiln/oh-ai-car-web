import { afterEach, describe, expect, it, vi } from 'vitest';
import * as deviceClient from '../src/services/deviceClient.js';

describe('deviceClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests devices with q query string', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      devices: [{ id: '1', name: 'Jetson', code: 'jetson-01', host: '10.0.0.1', tcpPort: 6000, videoPort: 6500 }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const list = await deviceClient.devices('jetson-01');
    expect(list).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/devices?q=jetson-01');
  });

  it('surfaces DELETE errors instead of silently succeeding', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'Administrator role required' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deviceClient.deleteDevice('device-1')).rejects.toThrow(/Administrator role required|请求失败/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/devices/device-1');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('content-type')).toBeNull();
  });

  it('omits content-type on DELETE so Fastify accepts empty body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deviceClient.deleteDevice('device-2')).resolves.toEqual({ ok: true });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has('content-type')).toBe(false);
  });

  it('updates devices via PUT /api/devices/:id without vehicles fallback', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      device: {
        id: 'device-1',
        name: '新名称',
        code: 'jetson-01',
        host: '10.82.66.180',
        tcpPort: 6001,
        videoPort: 6500,
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const device = await deviceClient.updateDevice('device-1', {
      name: '新名称',
      host: '10.82.66.180',
      tcpPort: 6001,
    });
    expect(device).toMatchObject({ name: '新名称', host: '10.82.66.180', tcpPort: 6001 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/devices/device-1');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
  });
});
