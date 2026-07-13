import { apiRequest, type Device, type DevicePose, type DeviceStatus } from './api.js';
import type { TrackPoint, Vehicle } from './platformClient.js';

function vehicleToDevice(vehicle: Vehicle): Device {
  return {
    id: vehicle.id,
    name: vehicle.name,
    code: vehicle.code,
    host: vehicle.host,
    tcpPort: vehicle.tcpPort,
    videoPort: vehicle.videoPort,
    description: vehicle.description,
    archived: vehicle.archived,
    status: vehicle.archived ? 'offline' : 'offline',
  };
}

export async function devices(q?: string): Promise<Device[]> {
  const search = new URLSearchParams();
  const trimmed = q?.trim();
  if (trimmed) search.set('q', trimmed);
  const qs = search.toString();
  const suffix = qs ? `?${qs}` : '';
  try {
    const result = await apiRequest<{ devices: Device[] }>(`/api/devices${suffix}`);
    return result.devices ?? [];
  } catch {
    const result = await apiRequest<{ vehicles: Vehicle[] }>(`/api/vehicles${suffix}`);
    return (result.vehicles ?? []).map(vehicleToDevice);
  }
}

export async function createDevice(input: {
  name: string;
  code: string;
  host: string;
  tcpPort?: number;
  videoPort?: number;
  bridgeUrl?: string;
  description?: string;
}): Promise<Device> {
  try {
    const result = await apiRequest<{ device: Device }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        code: input.code,
        host: input.host,
        tcpPort: input.tcpPort ?? 6000,
        videoPort: input.videoPort ?? 6500,
        bridgeUrl: input.bridgeUrl,
        description: input.description ?? '',
      }),
    });
    return result.device;
  } catch {
    const result = await apiRequest<{ vehicle: Vehicle }>('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        code: input.code,
        host: input.host,
        tcpPort: input.tcpPort ?? 6000,
        videoPort: input.videoPort ?? 6500,
        description: input.description ?? '',
      }),
    });
    return vehicleToDevice(result.vehicle);
  }
}

export async function updateDevice(
  id: string,
  patch: Partial<Pick<Device, 'name' | 'host' | 'tcpPort' | 'videoPort' | 'bridgeUrl' | 'description'>>,
): Promise<Device> {
  const result = await apiRequest<{ device: Device }>(`/api/devices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return result.device;
}

export async function deleteDevice(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/devices/${id}`, { method: 'DELETE' });
}

export async function connectDevice(
  id: string,
  override?: { host?: string; tcpPort?: number; videoPort?: number },
): Promise<{
  host: string;
  tcpPort: number;
  videoPort: number;
  gatewayToken?: string;
  leaseId?: string;
  expiresAt?: string;
}> {
  let session: {
    host: string;
    tcpPort: number;
    videoPort: number;
    gatewayToken?: string;
    leaseId?: string;
    expiresAt?: string;
  };
  try {
    session = await apiRequest(`/api/devices/${id}/connect`, { method: 'POST', body: '{}' });
  } catch {
    const lease = await apiRequest<{ leaseId: string; expiresAt: string; gatewayToken: string }>(
      `/api/vehicles/${id}/control-lease`,
      { method: 'POST', body: '{}' },
    );
    const list = await devices();
    const device = list.find((entry) => entry.id === id);
    if (!device) throw new Error('设备不存在');
    session = {
      host: device.host,
      tcpPort: device.tcpPort,
      videoPort: device.videoPort,
      gatewayToken: lease.gatewayToken,
      leaseId: lease.leaseId,
      expiresAt: lease.expiresAt,
    };
  }

  return {
    ...session,
    host: override?.host?.trim() || session.host,
    tcpPort: override?.tcpPort ?? session.tcpPort,
    videoPort: override?.videoPort ?? session.videoPort,
  };
}

export async function renewLease(leaseId: string): Promise<{ expiresAt: string; gatewayToken: string }> {
  return apiRequest(`/api/control-leases/${leaseId}/renew`, { method: 'POST', body: '{}' });
}

export async function releaseLease(leaseId: string): Promise<{ ok: true }> {
  return apiRequest(`/api/control-leases/${leaseId}`, { method: 'DELETE' });
}

export async function deviceStatus(id: string): Promise<DeviceStatus> {
  try {
    return await apiRequest<DeviceStatus>(`/api/devices/${id}/status`);
  } catch {
    return { online: false, message: '状态暂不可用' };
  }
}

export async function devicePose(id: string): Promise<DevicePose | null> {
  try {
    return await apiRequest<DevicePose>(`/api/devices/${id}/pose`);
  } catch {
    return null;
  }
}

export async function track(id: string, from?: string, to?: string): Promise<TrackPoint[]> {
  const search = new URLSearchParams();
  if (from) search.set('from', from);
  if (to) search.set('to', to);
  const qs = search.toString();
  const result = await apiRequest<{ points: TrackPoint[] }>(
    `/api/vehicles/${id}/track${qs ? `?${qs}` : ''}`,
  );
  return result.points ?? [];
}
