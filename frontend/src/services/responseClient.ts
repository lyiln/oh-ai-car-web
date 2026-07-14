import { apiBaseUrl, apiRequest, type ResidentDestination, type ResponseTask } from './api.js';

export async function destinations(vehicleId: string): Promise<ResidentDestination[]> {
  const result = await apiRequest<{ destinations: ResidentDestination[] }>(`/api/resident-destinations?vehicleId=${encodeURIComponent(vehicleId)}`);
  return result.destinations;
}

export async function createDestination(input: Omit<ResidentDestination, 'id' | 'active' | 'residentKey'> & { residentKey?: string }): Promise<ResidentDestination> {
  const result = await apiRequest<{ destination: ResidentDestination }>('/api/resident-destinations', {
    method: 'POST', body: JSON.stringify(input),
  });
  return result.destination;
}

export async function tasks(): Promise<ResponseTask[]> {
  const result = await apiRequest<{ tasks: ResponseTask[] }>('/api/response-tasks');
  return result.tasks;
}

export async function confirm(id: string): Promise<{
  ok: true;
  assignedVehicleId: string | null;
  assignmentPending: boolean;
  advice: { suggestion: string; notification: string; source: string };
  push?: { status: string; message: string; requestId?: string };
}> {
  return apiRequest(`/api/response-tasks/${id}/confirm`, { method: 'POST', body: '{}' });
}

export async function assign(id: string): Promise<{ ok: true; assignedVehicleId: string; deduplicated: boolean }> {
  return apiRequest(`/api/response-tasks/${id}/assign`, { method: 'POST', body: '{}' });
}

export async function cancel(id: string): Promise<{ ok: true; cancellationRequested: boolean; deduplicated: boolean }> {
  return apiRequest(`/api/response-tasks/${id}/cancel`, { method: 'POST', body: '{}' });
}

export function liveUrl(): string {
  const url = new URL('/patrol/live', apiBaseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
