import {
  apiRequest,
  type DashboardSummary,
  type PatrolReport,
  type Review,
  type Violation,
  type WhitelistEntry,
} from './api.js';

export async function dashboardSummary(): Promise<DashboardSummary> {
  return apiRequest<DashboardSummary>('/api/dashboard/summary');
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

/** Console plate-scan workbench: classify and idempotently record a recognised plate. */
export async function createViolationFromConsoleScan(input: {
  vehicleId: string;
  plate: string;
  jpegBase64: string;
  confidence?: number | null;
  waypoint?: string;
  mapVersion?: string;
}): Promise<{
  recorded: boolean;
  deduplicated: boolean;
  reason: string;
  message?: string;
  violation?: Pick<Violation, 'id' | 'plate' | 'evidenceUrl' | 'deviceId' | 'waypoint' | 'status' | 'type' | 'zoneName'>;
  review?: { id: string; eventId: string };
  noParking?: {
    inNoParking: boolean;
    reason: string;
    pose: { x: number; y: number; mapVersion: string; occurredAt: string } | null;
    zone: { id: string; name: string | null } | null;
  };
}> {
  return apiRequest('/api/violations/from-console-scan', {
    method: 'POST',
    body: JSON.stringify(input),
  });
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

export async function whitelist(q?: string): Promise<WhitelistEntry[]> {
  const search = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const result = await apiRequest<{ entries: WhitelistEntry[] }>(`/api/whitelist${search}`);
  return result.entries ?? [];
}

export async function addWhitelist(entry: Omit<WhitelistEntry, 'id'> & { id?: string }): Promise<WhitelistEntry> {
  const result = await apiRequest<{ entry: WhitelistEntry }>('/api/whitelist', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
  return result.entry;
}

export async function updateWhitelist(id: string, entry: Partial<Omit<WhitelistEntry, 'id'>>): Promise<WhitelistEntry> {
  const result = await apiRequest<{ entry: WhitelistEntry }>(`/api/whitelist/${id}`, {
    method: 'PUT',
    body: JSON.stringify(entry),
  });
  return result.entry;
}

export async function deleteWhitelist(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/whitelist/${id}`, { method: 'DELETE' });
}

export async function importWhitelist(csv: string): Promise<{ imported: number; failed: number; errors?: string[] }> {
  return apiRequest('/api/whitelist/import', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

export async function reports(): Promise<PatrolReport[]> {
  const result = await apiRequest<{ reports: PatrolReport[] }>('/api/reports');
  return result.reports ?? [];
}

export async function report(id: string): Promise<PatrolReport | null> {
  const result = await apiRequest<{ report: PatrolReport }>(`/api/reports/${id}`);
  return result.report;
}

export async function getSettings(): Promise<Record<string, unknown>> {
  const result = await apiRequest<{ settings: Record<string, unknown> }>('/api/settings');
  return result.settings ?? {};
}

export async function putSettings(settings: Record<string, unknown>): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
}
