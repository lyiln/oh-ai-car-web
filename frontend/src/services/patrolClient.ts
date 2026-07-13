import {
  apiRequest,
  type PatrolEvent,
  type PatrolReport,
  type PatrolRoute,
  type PatrolTask,
} from './api.js';

export async function start(input: {
  deviceId: string;
  routeId: string;
  shift?: string;
}): Promise<PatrolTask> {
  const result = await apiRequest<{ task: PatrolTask }>('/api/patrol/start', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.task;
}

export async function stop(deviceId?: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('/api/patrol/stop', {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}

export async function status(deviceId?: string): Promise<PatrolTask | null> {
  const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
  const result = await apiRequest<{ status: PatrolTask | null }>(`/api/patrol/status${qs}`);
  return result.status ?? null;
}

export async function tasks(): Promise<PatrolTask[]> {
  const result = await apiRequest<{ tasks: PatrolTask[] }>('/api/patrol/tasks');
  return result.tasks ?? [];
}

export async function task(id: string): Promise<PatrolTask | null> {
  const result = await apiRequest<{ task: PatrolTask }>(`/api/patrol/tasks/${id}`);
  return result.task;
}

export async function events(taskId: string): Promise<PatrolEvent[]> {
  const result = await apiRequest<{ events: PatrolEvent[] }>(`/api/patrol/tasks/${taskId}/events`);
  return result.events ?? [];
}

export async function report(taskId: string): Promise<PatrolReport | null> {
  const result = await apiRequest<{ report: PatrolReport }>(`/api/patrol/tasks/${taskId}/report`);
  return result.report;
}

export async function routes(deviceId?: string | null): Promise<PatrolRoute[]> {
  const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
  const result = await apiRequest<{ routes: PatrolRoute[] }>(`/api/patrol/routes${qs}`);
  return result.routes ?? [];
}

export async function importRoute(vehicleId: string, input: { name: string; mapVersion: string; yaml: string }): Promise<PatrolRoute> {
  const result = await apiRequest<{ route: PatrolRoute }>(`/api/vehicles/${vehicleId}/patrol-routes`, {
    method: 'POST', body: JSON.stringify(input),
  });
  return result.route;
}
