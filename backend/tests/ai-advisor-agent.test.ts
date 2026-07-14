import { describe, expect, it, vi } from 'vitest';
import { ADVISOR_SYSTEM_PROMPT, runAdvisorChat } from '../src/ai/advisor-agent.js';
import type { Config } from '../src/config.js';
import type { Database } from '../src/db/index.js';

describe('advisor agent', () => {
  it('returns configuration guidance when AI is not configured', async () => {
    const db = { query: vi.fn() } as unknown as Database;
    const config = {
      aiBaseUrl: undefined,
      aiApiKey: undefined,
      aiModel: 'deepseek-v4-pro',
      aiModelFast: 'deepseek-v4-flash',
    } as Config;
    const result = await runAdvisorChat(db, config, { id: 'u1', role: 'admin' }, [
      { role: 'user', content: '白名单有哪些？' },
    ]);
    expect(result.source).toBe('fallback');
    expect(result.reply).toContain('AI 未配置');
  });

  it('includes Markdown table formatting guidance in the system prompt', () => {
    expect(ADVISOR_SYSTEM_PROMPT).toContain('Markdown 表格');
    expect(ADVISOR_SYSTEM_PROMPT).toContain('序号、车牌、车主、楼栋、车位、类型');
    expect(ADVISOR_SYSTEM_PROMPT).toContain('##');
    expect(ADVISOR_SYSTEM_PROMPT).toContain('禁止建议 AI 直接控制车辆');
  });
});
