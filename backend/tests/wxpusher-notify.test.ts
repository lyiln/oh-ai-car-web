import { describe, expect, it, vi } from 'vitest';
import { notifyOwnerPush } from '../src/routes/response-platform.js';
import type { Database } from '../src/db/index.js';

function mockDb(queries: Array<{ match?: RegExp; rows?: unknown[] }> = []) {
  const query = vi.fn(async (sql: string) => {
    for (const entry of queries) {
      if (!entry.match || entry.match.test(sql)) return { rows: entry.rows ?? [], rowCount: (entry.rows ?? []).length };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query } as unknown as Database & { query: ReturnType<typeof vi.fn> };
}

describe('notifyOwnerPush', () => {
  it('skips when wxUid is empty', async () => {
    const db = mockDb();
    const result = await notifyOwnerPush(db, {}, {
      responseTaskId: 't1', plate: '京A12345', wxUid: '', location: '东门', content: '请挪车',
    });
    expect(result.status).toBe('skipped_no_uid');
    expect(db.query).toHaveBeenCalled();
  });

  it('skips when WxPusher is not configured', async () => {
    const db = mockDb();
    const result = await notifyOwnerPush(db, {}, {
      responseTaskId: 't1', plate: '京A12345', wxUid: 'UID_abc', location: '东门', content: '请挪车',
    });
    expect(result.status).toBe('skipped_not_configured');
  });
});
