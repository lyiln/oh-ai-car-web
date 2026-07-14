export type WxPusherConfig = {
  appToken?: string;
  endpoint?: string;
};

export type SendWxPusherInput = {
  uid: string;
  content: string;
  summary?: string;
};

export type SendWxPusherResult = {
  ok: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
  code?: number;
};

export function isWxPusherConfigured(config: WxPusherConfig): boolean {
  return Boolean(config.appToken?.trim());
}

export function normalizeWxUid(value: string): string {
  return value.trim();
}

export async function sendWxPusherMessage(
  config: WxPusherConfig,
  input: SendWxPusherInput,
  fetcher: typeof fetch = fetch,
): Promise<SendWxPusherResult> {
  if (!isWxPusherConfigured(config)) {
    return { ok: false, skipped: true, error: 'WxPusher is not configured' };
  }
  const uid = normalizeWxUid(input.uid);
  if (!uid) {
    return { ok: false, skipped: true, error: 'WxPusher UID is empty' };
  }
  const endpoint = (config.endpoint?.trim() || 'https://wxpusher.zjiecode.com').replace(/\/$/, '');
  try {
    const response = await fetcher(`${endpoint}/api/send/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appToken: config.appToken!.trim(),
        content: input.content,
        summary: (input.summary ?? input.content).slice(0, 100),
        contentType: 1,
        uids: [uid],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json() as {
      code?: number;
      msg?: string;
      data?: Array<{ messageId?: string | number; status?: string; uid?: string }> | { messageId?: string | number };
    };
    if (!response.ok || payload.code !== 1000) {
      return {
        ok: false,
        code: payload.code,
        error: payload.msg ?? `HTTP ${response.status}`,
      };
    }
    const data = payload.data;
    const messageId = Array.isArray(data)
      ? String(data[0]?.messageId ?? '')
      : data && typeof data === 'object'
        ? String(data.messageId ?? '')
        : '';
    return { ok: true, messageId: messageId || undefined, code: payload.code };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'WxPusher request failed' };
  }
}
