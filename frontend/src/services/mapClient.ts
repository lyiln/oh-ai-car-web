import { apiRequest, type MapMeta, type MapZone, type Waypoint } from './api.js';
import type { FloorMapMeta } from '../lib/floormap.js';

export async function map(): Promise<MapMeta | null> {
  try {
    const result = await apiRequest<{ map: MapMeta }>('/api/map');
    return result.map ?? null;
  } catch {
    return null;
  }
}

// 读取楼道 SLAM 底图元数据（可按车辆），无底图时返回 null。
export async function basemap(vehicleId?: string | null): Promise<FloorMapMeta | null> {
  const qs = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : '';
  try {
    const result = await apiRequest<{ basemap: FloorMapMeta | null }>(`/api/map/basemap${qs}`);
    return result.basemap ?? null;
  } catch {
    return null;
  }
}

export interface UploadBasemapInput {
  vehicleId?: string | null;
  name?: string;
  mapVersion: string;
  resolution: number;
  originX: number;
  originY: number;
  originYaw?: number;
  imageWidth: number;
  imageHeight: number;
  imageDataUrl: string;
}

export async function uploadBasemap(input: UploadBasemapInput): Promise<FloorMapMeta> {
  const result = await apiRequest<{ basemap: FloorMapMeta }>('/api/map/basemap', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.basemap;
}

export async function waypoints(vehicleId?: string | null): Promise<Waypoint[]> {
  const qs = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : '';
  try {
    const result = await apiRequest<{ waypoints: Waypoint[] }>(`/api/map/waypoints${qs}`);
    return result.waypoints ?? [];
  } catch {
    return [];
  }
}

export async function zones(): Promise<MapZone[]> {
  try {
    const result = await apiRequest<{ zones: MapZone[] }>('/api/map/zones');
    return result.zones ?? [];
  } catch {
    return [];
  }
}

export async function createZone(input: {
  name: string;
  type?: string;
  coordinates: Array<[number, number]>;
}): Promise<MapZone> {
  const result = await apiRequest<{ zone: MapZone }>('/api/map/zones', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.zone;
}

export async function updateZone(id: string, patch: Partial<MapZone>): Promise<MapZone> {
  const result = await apiRequest<{ zone: MapZone }>(`/api/map/zones/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return result.zone;
}

export async function deleteZone(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/map/zones/${id}`, { method: 'DELETE' });
}
