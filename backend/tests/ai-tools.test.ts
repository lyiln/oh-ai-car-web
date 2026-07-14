import { describe, expect, it, vi } from 'vitest';
import { getProjectWorkflow } from '../src/ai/tools/docs.js';
import {
  buildDailyReportStats,
  classifyObservationHighlight,
} from '../src/ai/tools/observations.js';
import { queryWhitelist } from '../src/ai/tools/whitelist.js';
import type { Database } from '../src/db/index.js';
import type { DailyObservationRow } from '../src/ai/types.js';

describe('ai tools', () => {
  it('returns project workflow knowledge', () => {
    const doc = getProjectWorkflow();
    expect(doc.title).toContain('工作流程');
    expect(doc.content).toContain('白名单');
    expect(doc.content).toContain('不得建议 AI 直接控制车辆');
  });

  it('queries whitelist via SQL against live global import', async () => {
    const query = vi.fn(async () => ({
      rows: [{
        id: '1',
        plate: '京A12345',
        owner_name: '张三',
        building: '1号楼',
        category: 'private',
        parking_spot: 'A1',
        valid_until: null,
      }],
    }));
    const db = { query } as unknown as Database;
    const result = await queryWhitelist(db, '京A');
    expect(result.count).toBe(1);
    expect(result.entries[0]?.plate).toBe('京A12345');
    expect(String(query.mock.calls[0]?.[0])).toContain('is_snapshot = false');
    expect(query.mock.calls[0]?.[1]).toEqual(['%京A%']);
  });

  it('builds daily stats and highlights for intrusion and illegal parking', () => {
    const observations: DailyObservationRow[] = [
      {
        plate: '京B88888',
        classification: 'suspected_external',
        confidence: 0.91,
        noParking: false,
        waypointName: '东门',
        occurredAt: '2026-07-14T08:00:00.000Z',
        deviceName: '车1',
        taskId: 't1',
        observationCount: 2,
      },
      {
        plate: '京A12345',
        classification: 'registered_private',
        confidence: 0.95,
        noParking: true,
        waypointName: '1号楼门口',
        occurredAt: '2026-07-14T09:00:00.000Z',
        deviceName: '车1',
        taskId: 't1',
        observationCount: 1,
      },
    ];
    const stats = buildDailyReportStats('2026-07-14', {
      observations,
      violationCount: 1,
      patrolTaskCount: 2,
    });
    expect(stats.intrusionPlates).toEqual(['京B88888']);
    expect(stats.illegalParkingPlates).toEqual(['京A12345']);
    expect(classifyObservationHighlight(observations[0]!)).toContain('闯入');
    expect(classifyObservationHighlight(observations[1]!)).toContain('乱停');
  });
});
