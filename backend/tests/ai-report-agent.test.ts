import { describe, expect, it } from 'vitest';
import { templateNarrative } from '../src/ai/report-agent.js';
import { buildDailyReportStats, classifyObservationHighlight } from '../src/ai/tools/observations.js';
import type { DailyObservationRow } from '../src/ai/types.js';

describe('report agent', () => {
  it('builds a template narrative covering intrusion and illegal parking', () => {
    const observations: DailyObservationRow[] = [
      {
        plate: '京C99999',
        classification: 'suspected_external',
        confidence: 0.88,
        noParking: true,
        waypointName: '西门',
        occurredAt: '2026-07-14T10:00:00.000Z',
        deviceName: '车2',
        taskId: 't2',
        observationCount: 3,
      },
      {
        plate: '京A11111',
        classification: 'visitor',
        confidence: 0.9,
        noParking: true,
        waypointName: '停车场入口',
        occurredAt: '2026-07-14T11:00:00.000Z',
        deviceName: '车2',
        taskId: 't2',
        observationCount: 1,
      },
    ];
    const stats = buildDailyReportStats('2026-07-14', {
      observations,
      violationCount: 2,
      patrolTaskCount: 1,
    });
    const highlights = observations
      .map(classifyObservationHighlight)
      .filter((item): item is string => Boolean(item));
    const narrative = templateNarrative(stats, highlights);
    expect(narrative).toContain('巡牌通 AI 日报');
    expect(narrative).toContain('京C99999');
    expect(narrative).toContain('闯入');
    expect(narrative).toContain('乱停');
    expect(stats.intrusionCount).toBe(1);
    expect(stats.illegalParkingCount).toBe(2);
  });
});
