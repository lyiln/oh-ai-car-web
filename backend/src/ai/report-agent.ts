import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { createDeepSeekChat, isAiConfigured } from './llm.js';
import {
  buildDailyReportStats,
  classifyObservationHighlight,
  queryDailyObservations,
} from './tools/observations.js';
import type { AiAuthUser, DailyReportResult, DailyReportStats, ToolContext } from './types.js';

const ReportSchema = z.object({
  narrativeMarkdown: z.string(),
  highlights: z.array(z.string()),
});

function memberIdFor(user: AiAuthUser): string | null {
  return user.role === 'admin' ? null : user.id;
}

function templateNarrative(stats: DailyReportStats, highlights: string[]): string {
  const lines = [
    `# 巡牌通 AI 日报（${stats.reportDate}）`,
    '',
    '## 概览',
    `- 巡检任务数：${stats.patrolTaskCount}`,
    `- 观测记录（去重）：${stats.observationCount}`,
    `- 违规记录：${stats.violationCount}`,
    `- 闯入/外来车：${stats.intrusionCount}（${stats.intrusionPlates.join('、') || '无'}）`,
    `- 乱停车辆：${stats.illegalParkingCount}（${stats.illegalParkingPlates.join('、') || '无'}）`,
    `- 待人工复核：${stats.pendingReviewCount}`,
    '',
    '## 重点事项',
    ...(highlights.length ? highlights.map((item) => `- ${item}`) : ['- 当日无闯入或乱停重点事项']),
    '',
    '## 物业建议',
    '- 对闯入车辆与乱停车辆进行现场确认并留存证据。',
    '- 低置信度识别请在「待人工审核」中复核，勿仅凭 AI 叙事定案。',
    '- 需要通知车主时由人工确认后通过 WxPusher 发送，勿由系统自动派车或控车。',
  ];
  return lines.join('\n');
}

async function narrateWithAi(
  config: Config,
  stats: DailyReportStats,
  highlights: string[],
  observationSample: string,
): Promise<{ narrativeMarkdown: string; highlights: string[]; source: 'ai' | 'template' }> {
  if (!isAiConfigured(config)) {
    return { narrativeMarkdown: templateNarrative(stats, highlights), highlights, source: 'template' };
  }
  try {
    const model = createDeepSeekChat(config, 'pro');
    const structured = model.withStructuredOutput(ReportSchema);
    const result = await structured.invoke([
      {
        role: 'system',
        content: `你是巡牌通后续报告生成助手。根据当日采集数据写一份中文物业日报 Markdown。
必须包含：概览、闯入车辆、乱停车辆、待复核、物业跟进建议。
禁止建议 AI 直接控车或发送 TCP。不要编造统计数字；以给定 stats 为准。`,
      },
      {
        role: 'user',
        content: JSON.stringify({ stats, highlights, observationSample }, null, 2),
      },
    ]);
    const parsed = ReportSchema.parse(result);
    return {
      narrativeMarkdown: parsed.narrativeMarkdown.trim() || templateNarrative(stats, highlights),
      highlights: parsed.highlights.length ? parsed.highlights : highlights,
      source: 'ai',
    };
  } catch {
    return { narrativeMarkdown: templateNarrative(stats, highlights), highlights, source: 'template' };
  }
}

export async function generateDailyReport(
  db: Database,
  config: Config,
  user: AiAuthUser,
  options: { date: string; deviceId?: string },
): Promise<DailyReportResult> {
  const ctx: ToolContext = { user, memberId: memberIdFor(user) };
  if (options.deviceId) {
    const access = await db.query<{ ok: number }>(
      `SELECT 1 AS ok FROM vehicles v
       WHERE v.id=$1 AND v.archived=false
         AND ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.id AND vm.user_id=$2
         ))`,
      [options.deviceId, ctx.memberId],
    );
    if (!access.rows[0]) {
      throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    }
  }

  const data = await queryDailyObservations(db, ctx, options.date, options.deviceId);
  const stats = buildDailyReportStats(options.date, data);
  const highlights = data.observations
    .map(classifyObservationHighlight)
    .filter((item): item is string => Boolean(item))
    .slice(0, 40);

  const observationSample = data.observations.slice(0, 80).map((obs) => ({
    plate: obs.plate,
    classification: obs.classification,
    noParking: obs.noParking,
    waypoint: obs.waypointName,
    confidence: obs.confidence,
    occurredAt: obs.occurredAt,
    deviceName: obs.deviceName,
  }));

  const narrated = await narrateWithAi(config, stats, highlights, JSON.stringify(observationSample));
  const reportId = randomUUID();
  await db.query(
    `INSERT INTO ai_daily_reports (id, report_date, vehicle_id, created_by_user_id, stats, narrative_markdown)
     VALUES ($1, $2::date, $3, $4, $5, $6)`,
    [
      reportId,
      options.date,
      options.deviceId ?? null,
      user.id,
      JSON.stringify({ ...stats, highlights: narrated.highlights }),
      narrated.narrativeMarkdown,
    ],
  );

  return {
    reportId,
    reportDate: options.date,
    vehicleId: options.deviceId ?? null,
    narrativeMarkdown: narrated.narrativeMarkdown,
    stats,
    highlights: narrated.highlights,
    source: narrated.source,
  };
}

/** Exported for unit tests */
export { templateNarrative };
