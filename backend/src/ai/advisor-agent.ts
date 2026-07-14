import { createAgent } from 'langchain';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { createDeepSeekChat, isAiConfigured } from './llm.js';
import { createAdvisorTools } from './tools/index.js';
import type { AiAuthUser, ChatMessage } from './types.js';

/** Exported for unit tests that assert formatting guidance. */
export const ADVISOR_SYSTEM_PROMPT = `你是「巡牌通 · PatrolPlate」物业运维顾问助手。
用简洁中文回答操作员问题。必须先调用合适的工具获取事实，再给出结论。
你可以查询：项目工作流程、白名单、设备状态、连接诊断、某日巡检任务与报告、工作台摘要。

安全与事实规则：
1. 不确定时明确说明需要人工复核，不要臆造数据。
2. 禁止建议 AI 直接控制车辆、发送 TCP 报文或绕过人工确认。
3. 涉及车牌时可用完整车牌作运营查询展示；不要编造未在工具结果中出现的车牌。
4. 连接故障请基于 diagnose_device_connection 的 issues/suggestions 说明。
5. 无数据时明确写「暂无记录」。

输出排版（Markdown）：
- 白名单、设备、巡检任务等列表数据：优先用 Markdown 表格（含表头分隔行）。
  白名单示例列：序号、车牌、车主、楼栋、车位、类型；空字段写「—」。
  开头可用一句统计摘要，如「当前白名单共有 **N 辆**车：」。
- 统计摘要：用 \`##\` 小标题 + 无序列表。
- 连接诊断：分「问题」与「建议」两个列表块。
- 纯叙述段落保持简短；可用 **加粗** 强调关键数字与车牌。
- 不要输出 HTML；只用 Markdown。`;

function memberIdFor(user: AiAuthUser): string | null {
  return user.role === 'admin' ? null : user.id;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text: unknown }).text);
        return '';
      })
      .join('')
      .trim();
  }
  return content == null ? '' : String(content);
}

export async function runAdvisorChat(
  db: Database,
  config: Config,
  user: AiAuthUser,
  messages: ChatMessage[],
): Promise<{ reply: string; source: 'ai' | 'fallback' }> {
  if (!isAiConfigured(config)) {
    return {
      reply: 'AI 未配置。请在后端环境变量中设置 AI_BASE_URL、AI_API_KEY，并将 AI_MODEL 设为 deepseek-v4-pro。',
      source: 'fallback',
    };
  }

  const ctx = { user, memberId: memberIdFor(user) };
  const tools = createAdvisorTools(db, ctx);
  const model = createDeepSeekChat(config, 'pro');
  const agent = createAgent({
    model,
    tools,
    systemPrompt: ADVISOR_SYSTEM_PROMPT,
  });

  const invokeMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const result = await agent.invoke({ messages: invokeMessages });
    const last = result.messages?.[result.messages.length - 1];
    const reply = extractText(last && typeof last === 'object' && 'content' in last ? last.content : last).trim();
    return {
      reply: reply || '未能生成有效答复，请稍后重试或换一种问法。',
      source: 'ai',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return {
      reply: `顾问调用失败：${detail}。请检查 DeepSeek API 配置后重试。`,
      source: 'fallback',
    };
  }
}
