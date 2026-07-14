import { apiRequest } from './api.js';

export type AdvisorChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type AiDailyReport = {
  id: string;
  reportDate: string;
  vehicleId?: string | null;
  deviceName?: string | null;
  stats?: Record<string, unknown>;
  narrativeMarkdown: string;
  createdAt: string;
};

export async function advisorChat(messages: AdvisorChatMessage[]): Promise<{ reply: string; source: string }> {
  return apiRequest<{ reply: string; source: string }>('/api/ai/advisor/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
}

export async function generateDailyAiReport(input: {
  date?: string;
  deviceId?: string;
}): Promise<{
  report: {
    reportId: string;
    reportDate: string;
    vehicleId: string | null;
    narrativeMarkdown: string;
    stats: Record<string, unknown>;
    highlights: string[];
    source: string;
  };
}> {
  return apiRequest('/api/ai/reports/daily', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listDailyAiReports(params?: {
  date?: string;
  deviceId?: string;
}): Promise<AiDailyReport[]> {
  const search = new URLSearchParams();
  if (params?.date) search.set('date', params.date);
  if (params?.deviceId) search.set('deviceId', params.deviceId);
  const qs = search.toString();
  const result = await apiRequest<{ reports: AiDailyReport[] }>(
    `/api/ai/reports/daily${qs ? `?${qs}` : ''}`,
  );
  return result.reports ?? [];
}

export async function getDailyAiReport(id: string): Promise<AiDailyReport> {
  const result = await apiRequest<{ report: AiDailyReport }>(`/api/ai/reports/daily/${id}`);
  return result.report;
}
