// ============================================
// WeaveMD — 模型自动发现
// ============================================
// 自动发现可用的 LLM 模型（L1）。
// 支持从 OpenAI 兼容 API 获取模型列表。

import { streamChatCompletion } from './llmClient';

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  /** 模型能力标签。 */
  capabilities: string[];
}

/** 从 OpenAI 兼容 API 发现模型。 */
export async function discoverModels(
  baseUrl: string,
  apiKey: string
): Promise<DiscoveredModel[]> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/models`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn('[modelDiscovery] Failed to fetch models:', response.status);
      return [];
    }

    const data = await response.json() as { data?: Array<{ id: string; name?: string }> };
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      provider: guessProvider(model.id),
      capabilities: guessCapabilities(model.id),
    }));
  } catch (err) {
    console.warn('[modelDiscovery] Error discovering models:', err);
    return [];
  }
}

/** 根据模型 ID 猜测提供商。 */
function guessProvider(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'openai';
  if (id.includes('claude')) return 'anthropic';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('qwen')) return 'qwen';
  if (id.includes('gemini')) return 'google';
  return 'unknown';
}

/** 根据模型 ID 猜测能力。 */
function guessCapabilities(modelId: string): string[] {
  const caps: string[] = ['text'];
  const id = modelId.toLowerCase();

  if (id.includes('vision') || id.includes('4o') || id.includes('claude-3')) {
    caps.push('vision');
  }
  if (id.includes('instruct') || id.includes('chat')) {
    caps.push('chat');
  }
  if (id.includes('code') || id.includes('coder')) {
    caps.push('code');
  }

  return caps;
}
