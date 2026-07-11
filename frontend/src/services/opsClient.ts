import {
  apiRequest,
  type DashboardSummary,
  type PatrolReport,
  type Review,
  type Violation,
  type WhitelistEntry,
} from './api.js';

export async function dashboardSummary(): Promise<DashboardSummary> {
  try {
    return await apiRequest<DashboardSummary>('/api/dashboard/summary');
  } catch {
    return {
      onlineDevices: 0,
      todayPatrols: 0,
      pendingReviews: 0,
      violations: 0,
      recentTasks: [],
      alerts: [],
    };
  }
}

export async function violations(): Promise<Violation[]> {
  const result = await apiRequest<{ violations: Violation[] }>('/api/violations');
  return result.violations ?? [];
}

export async function violation(id: string): Promise<Violation | null> {
  try {
    const result = await apiRequest<{ violation: Violation }>(`/api/violations/${id}`);
    return result.violation;
  } catch {
    return null;
  }
}

export async function pendingReviews(): Promise<Review[]> {
  const result = await apiRequest<{ reviews: Review[] }>('/api/reviews/pending');
  return result.reviews ?? [];
}

export async function resolveReview(
  eventId: string,
  resolution: {
    action: 'confirm' | 'false_positive' | 'whitelist' | 'visitor' | string;
    plate?: string;
    note?: string;
  },
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/reviews/${eventId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(resolution),
  });
}

export async function whitelist(deviceId: string): Promise<WhitelistEntry[]> {
  const result = await apiRequest<{ entries: WhitelistEntry[] }>(`/api/whitelist?deviceId=${encodeURIComponent(deviceId)}`);
  return result.entries ?? [];
}

export async function addWhitelist(deviceId: string, entry: Omit<WhitelistEntry, 'id'> & { id?: string }): Promise<WhitelistEntry> {
  const result = await apiRequest<{ entry: WhitelistEntry }>('/api/whitelist', {
    method: 'POST',
    body: JSON.stringify({ ...entry, deviceId }),
  });
  return result.entry;
}

export async function importWhitelist(deviceId: string, csv: string): Promise<{ imported: number; failed: number; errors?: string[] }> {
  return apiRequest('/api/whitelist/import', {
    method: 'POST',
    body: JSON.stringify({ deviceId, csv }),
  });
}

export async function reports(): Promise<PatrolReport[]> {
  try {
    const result = await apiRequest<{ reports: PatrolReport[] }>('/api/reports');
    return result.reports ?? [];
  } catch {
    return [];
  }
}

export async function report(id: string): Promise<PatrolReport | null> {
  try {
    const result = await apiRequest<{ report: PatrolReport }>(`/api/reports/${id}`);
    return result.report;
  } catch {
    return null;
  }
}

export async function getSettings(): Promise<Record<string, unknown>> {
  try {
    const result = await apiRequest<{ settings: Record<string, unknown> }>('/api/settings');
    return result.settings ?? {};
  } catch {
    return {
      waypointsYaml: '',
      alertConfidence: 0.7,
      dedupeWindowSec: 120,
      bridgeDefault: '',
      connectTimeoutMs: 5000,
    };
  }
}

export async function putSettings(settings: Record<string, unknown>): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
}
