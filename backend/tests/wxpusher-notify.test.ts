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

  it('records a successful WxPusher request id', async () => {
    const db = mockDb();
    const sender = vi.fn(async () => ({ ok: true, messageId: 'request-42', code: 1000 }));
    const result = await notifyOwnerPush(db, { appToken: 'AT_test' }, {
      responseTaskId: 't1', plate: '京A12345', wxUid: 'UID_abc', location: '东门', content: '请挪车',
    }, sender);

    expect(result).toEqual({ status: 'sent', message: '车主 WxPusher 推送已发送', requestId: 'request-42' });
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("sms_status='sent'"))).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('provider_request_id'))).toBe(true);
  });

  it('keeps a failed request retryable and records the provider error', async () => {
    const db = mockDb();
    const sender = vi.fn(async () => ({ ok: false, messageId: 'request-failed', error: 'timeout' }));
    const result = await notifyOwnerPush(db, { appToken: 'AT_test' }, {
      responseTaskId: 't1', plate: '京A12345', wxUid: 'UID_abc', location: '东门', content: '请挪车',
    }, sender);

    expect(result).toEqual({ status: 'failed', message: '推送失败：timeout', requestId: 'request-failed' });
    expect(db.query.mock.calls.some(([sql, values]) => String(sql).includes("sms_status='failed'") && values?.includes('timeout'))).toBe(true);
  });
});
