import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { runAdvisorChat } from '../ai/advisor-agent.js';
import { generateDailyReport } from '../ai/report-agent.js';
import type { ChatMessage } from '../ai/types.js';

type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'operator';
  active: boolean;
};

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw httpError('date must be YYYY-MM-DD', 400);
  return raw;
}

export function registerAiPlatformRoutes(app: FastifyInstance, deps: {
  db: Database;
  config: Config;
  requireUser: (request: FastifyRequest) => Promise<AuthUser>;
}) {
  const { db, config, requireUser } = deps;

  app.post('/api/ai/advisor/chat', async (request) => {
    const user = await requireUser(request);
    const body = object(request.body) ?? {};
    const rawMessages = Array.isArray(body.messages) ? body.messages : null;
    if (!rawMessages?.length) throw httpError('messages is required', 400);

    const messages: ChatMessage[] = [];
    for (const item of rawMessages) {
      const row = object(item);
      if (!row) continue;
      const role = row.role === 'assistant' || row.role === 'system' ? row.role : 'user';
      const content = typeof row.content === 'string' ? row.content.trim() : '';
      if (!content) continue;
      messages.push({ role, content });
    }
    if (!messages.some((m) => m.role === 'user')) throw httpError('at least one user message is required', 400);

    const result = await runAdvisorChat(db, config, user, messages);
    return {
      reply: result.reply,
      source: result.source,
    };
  });

  app.post('/api/ai/reports/daily', async (request) => {
    const user = await requireUser(request);
    const body = object(request.body) ?? {};
    const date = body.date ? parseDate(body.date) : todayIsoDate();
    const deviceId = typeof body.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : undefined;
    try {
      const report = await generateDailyReport(db, config, user, { date, deviceId });
      return { report };
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw error;
    }
  });

  app.get('/api/ai/reports/daily', async (request) => {
    const user = await requireUser(request);
    const query = request.query as { date?: string; deviceId?: string };
    const date = query.date ? parseDate(query.date) : null;
    const deviceId = query.deviceId?.trim() || null;
    const memberId = user.role === 'admin' ? null : user.id;

    const result = await db.query<{
      id: string;
      report_date: Date;
      vehicle_id: string | null;
      stats: Record<string, unknown>;
      narrative_markdown: string;
      created_at: Date;
      device_name: string | null;
    }>(
      `SELECT r.id, r.report_date, r.vehicle_id, r.stats, r.narrative_markdown, r.created_at,
              v.name AS device_name
       FROM ai_daily_reports r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE ($1::date IS NULL OR r.report_date = $1::date)
         AND ($2::uuid IS NULL OR r.vehicle_id = $2)
         AND (
           $3::uuid IS NULL
           OR r.vehicle_id IS NULL
           OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = r.vehicle_id AND vm.user_id = $3)
           OR r.created_by_user_id = $3
         )
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [date, deviceId, memberId],
    );

    return {
      reports: result.rows.map((row) => ({
        id: row.id,
        reportDate: row.report_date instanceof Date
          ? row.report_date.toISOString().slice(0, 10)
          : String(row.report_date).slice(0, 10),
        vehicleId: row.vehicle_id,
        deviceName: row.device_name,
        stats: row.stats,
        narrativeMarkdown: row.narrative_markdown,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });

  app.get('/api/ai/reports/daily/:id', async (request) => {
    const user = await requireUser(request);
    const id = (request.params as { id: string }).id;
    const memberId = user.role === 'admin' ? null : user.id;
    const result = await db.query<{
      id: string;
      report_date: Date;
      vehicle_id: string | null;
      stats: Record<string, unknown>;
      narrative_markdown: string;
      created_at: Date;
      device_name: string | null;
    }>(
      `SELECT r.id, r.report_date, r.vehicle_id, r.stats, r.narrative_markdown, r.created_at,
              v.name AS device_name
       FROM ai_daily_reports r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.id = $1
         AND (
           $2::uuid IS NULL
           OR r.vehicle_id IS NULL
           OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = r.vehicle_id AND vm.user_id = $2)
           OR r.created_by_user_id = $2
         )`,
      [id, memberId],
    );
    if (!result.rows[0]) throw httpError('Report not found', 404);
    const row = result.rows[0];
    return {
      report: {
        id: row.id,
        reportDate: row.report_date instanceof Date
          ? row.report_date.toISOString().slice(0, 10)
          : String(row.report_date).slice(0, 10),
        vehicleId: row.vehicle_id,
        deviceName: row.device_name,
        stats: row.stats,
        narrativeMarkdown: row.narrative_markdown,
        createdAt: row.created_at.toISOString(),
      },
    };
  });
}
