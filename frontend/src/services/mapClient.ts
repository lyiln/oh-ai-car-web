import { apiRequest, type MapMeta, type MapZone, type Waypoint } from './api.js';

export async function map(): Promise<MapMeta | null> {
  try {
    const result = await apiRequest<{ map: MapMeta }>('/api/map');
    return result.map ?? null;
  } catch {
    return null;
  }
}

export async function waypoints(): Promise<Waypoint[]> {
  try {
    const result = await apiRequest<{ waypoints: Waypoint[] }>('/api/map/waypoints');
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
