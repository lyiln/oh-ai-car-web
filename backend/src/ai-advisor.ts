export interface AdviceContext {
  plate: string;
  building: string;
  waypoint: string;
  confidence: number;
}

export interface AdviceResult {
  suggestion: string;
  notification: string;
  source: 'ai' | 'template';
}

export function templateAdvice(context: AdviceContext): AdviceResult {
  return {
    suggestion: `已确认登记车辆在${context.waypoint}违规停放。建议物业确认现场安全后，派遣空闲小车前往${context.building}一层公共门口留证，并由物业联系车主挪车。`,
    notification: `您好，您的车辆（尾号 ${context.plate.slice(-4)}）被发现停放在${context.waypoint}禁停区域，请尽快前往处理。`,
    source: 'template',
  };
}

export async function generateAdvice(
  context: AdviceContext,
  config: { baseUrl?: string; apiKey?: string; model: string },
  fetcher: typeof fetch = fetch,
): Promise<AdviceResult> {
  const fallback = templateAdvice(context);
  if (!config.baseUrl || !config.apiKey) return fallback;
  try {
    const response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: `为物业生成简短处置建议和车主通知。只输出 JSON {"suggestion":"...","notification":"..."}。车辆尾号：${context.plate.slice(-4)}；楼栋：${context.building}；位置：${context.waypoint}；识别置信度：${context.confidence.toFixed(2)}。不得建议 AI 直接控制车辆。`,
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return fallback;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}') as { suggestion?: unknown; notification?: unknown };
    if (typeof parsed.suggestion !== 'string' || typeof parsed.notification !== 'string') return fallback;
    return { suggestion: parsed.suggestion.trim(), notification: parsed.notification.trim(), source: 'ai' };
  } catch {
    return fallback;
  }
}
