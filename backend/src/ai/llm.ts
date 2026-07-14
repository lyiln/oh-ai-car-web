import { ChatOpenAI } from '@langchain/openai';
import type { Config } from '../config.js';

export function isAiConfigured(config: Pick<Config, 'aiBaseUrl' | 'aiApiKey'>): boolean {
  return Boolean(config.aiBaseUrl?.trim() && config.aiApiKey?.trim());
}

export function createDeepSeekChat(config: Config, tier: 'pro' | 'flash' = 'pro'): ChatOpenAI {
  if (!isAiConfigured(config)) {
    throw new Error('AI is not configured');
  }
  const model = tier === 'pro' ? config.aiModel : config.aiModelFast;
  return new ChatOpenAI({
    model,
    apiKey: config.aiApiKey,
    configuration: { baseURL: config.aiBaseUrl!.replace(/\/$/, '') },
    temperature: 0.2,
  });
}
