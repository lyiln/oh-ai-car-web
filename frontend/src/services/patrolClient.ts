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
  try {
    const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    const result = await apiRequest<{ status: PatrolTask | null }>(`/api/patrol/status${qs}`);
    return result.status ?? null;
  } catch {
    return null;
  }
}

export async function tasks(): Promise<PatrolTask[]> {
  try {
    const result = await apiRequest<{ tasks: PatrolTask[] }>('/api/patrol/tasks');
    return result.tasks ?? [];
  } catch {
    return [];
  }
}

export async function task(id: string): Promise<PatrolTask | null> {
  try {
    const result = await apiRequest<{ task: PatrolTask }>(`/api/patrol/tasks/${id}`);
    return result.task;
  } catch {
    return null;
  }
}

export async function events(taskId: string): Promise<PatrolEvent[]> {
  try {
    const result = await apiRequest<{ events: PatrolEvent[] }>(`/api/patrol/tasks/${taskId}/events`);
    return result.events ?? [];
  } catch {
    return [];
  }
}

export async function report(taskId: string): Promise<PatrolReport | null> {
  try {
    const result = await apiRequest<{ report: PatrolReport }>(`/api/patrol/tasks/${taskId}/report`);
    return result.report;
  } catch {
    return null;
  }
}

export async function routes(deviceId?: string | null): Promise<PatrolRoute[]> {
  try {
    const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    const result = await apiRequest<{ routes: PatrolRoute[] }>(`/api/patrol/routes${qs}`);
    return result.routes ?? [];
  } catch {
    return [
      { id: 'route_morning_a', name: '早班路线 A', waypointCount: 8 },
      { id: 'route_noon_b', name: '午班路线 B', waypointCount: 6 },
      { id: 'route_evening_c', name: '晚班路线 C', waypointCount: 7 },
    ];
  }
}
