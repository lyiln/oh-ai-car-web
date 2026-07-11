import { describe, expect, it, vi } from 'vitest';
import { generateAdvice, templateAdvice } from '../src/ai-advisor.js';

const context = { plate: '京A12345', building: '1号楼', waypoint: '东门', confidence: 0.93 };

describe('doorstep response AI advisor', () => {
  it('uses a privacy-limited deterministic template when AI is not configured', async () => {
    const result = await generateAdvice(context, { model: 'test' });
    expect(result.source).toBe('template');
    expect(result.notification).toContain('尾号 2345');
    expect(result.notification).not.toContain('京A12345');
  });

  it('accepts an OpenAI-compatible JSON response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestion":"人工确认后派车","notification":"请及时挪车"}' } }] }), { status: 200 }));
    const result = await generateAdvice(context, { baseUrl: 'https://ai.example/v1/', apiKey: 'secret', model: 'test' }, fetcher as typeof fetch);
    expect(result).toEqual({ suggestion: '人工确认后派车', notification: '请及时挪车', source: 'ai' });
    const request = String(fetcher.mock.calls[0]?.[0]);
    expect(request).toBe('https://ai.example/v1/chat/completions');
  });

  it('falls back when the provider fails', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    await expect(generateAdvice(context, { baseUrl: 'https://ai.example/v1', apiKey: 'secret', model: 'test' }, fetcher as typeof fetch))
      .resolves.toEqual(templateAdvice(context));
  });
});
