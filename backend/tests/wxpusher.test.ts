import { describe, expect, it, vi } from 'vitest';
import {
  isWxPusherConfigured,
  sendWxPusherMessage,
} from '../src/notify/wxpusher.js';

describe('wxpusher helpers', () => {
  it('reports configured only when appToken is set', () => {
    expect(isWxPusherConfigured({})).toBe(false);
    expect(isWxPusherConfigured({ appToken: '  ' })).toBe(false);
    expect(isWxPusherConfigured({ appToken: 'AT_test' })).toBe(true);
  });

  it('skips when not configured or uid empty', async () => {
    expect(await sendWxPusherMessage({}, { uid: 'UID_1', content: 'hi' })).toMatchObject({
      ok: false,
      skipped: true,
    });
    expect(await sendWxPusherMessage({ appToken: 'AT_x' }, { uid: '', content: 'hi' })).toMatchObject({
      ok: false,
      skipped: true,
    });
  });

  it('posts message payload and returns messageId', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 1000, data: [{ messageId: 42, uid: 'UID_1' }] }),
    })) as unknown as typeof fetch;

    const result = await sendWxPusherMessage(
      { appToken: 'AT_token', endpoint: 'https://wxpusher.example' },
      { uid: 'UID_1', content: '请挪车', summary: '乱停通知' },
      fetcher,
    );

    expect(result).toEqual({ ok: true, messageId: '42', code: 1000 });
    expect(fetcher).toHaveBeenCalledWith(
      'https://wxpusher.example/api/send/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          appToken: 'AT_token',
          content: '请挪车',
          summary: '乱停通知',
          contentType: 1,
          uids: ['UID_1'],
        }),
      }),
    );
  });

  it('returns API error message when code is not 1000', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 1001, msg: 'appToken invalid' }),
    })) as unknown as typeof fetch;

    const result = await sendWxPusherMessage(
      { appToken: 'AT_bad' },
      { uid: 'UID_1', content: 'hi' },
      fetcher,
    );
    expect(result).toMatchObject({ ok: false, code: 1001, error: 'appToken invalid' });
  });
});
