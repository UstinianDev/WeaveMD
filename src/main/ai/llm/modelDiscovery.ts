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

/**
 * vision 能力判定（B6 五-1②：**发送前**检测，不支持则降级纯文本 + 提示）。
 * 规则按模型 id 模式匹配；**未知模型按不支持处理**（保守）——
 * 向不支持 vision 的模型发图片会导致整条请求被 API 拒绝，降级只影响图片。
 */
export function supportsVision(modelId: string): boolean {
  const id = (modelId || '').toLowerCase().trim();
  if (!id) return false;
  // 显式 vision 命名
  if (id.includes('vision')) return true;
  // Claude 全系（3.x / sonnet / opus / haiku）均支持图片输入
  if (id.includes('claude')) return true;
  // OpenAI：gpt-4 家族（4 / 4o / 4-turbo / 4.1）支持；gpt-3.5 不支持
  if (/\bgpt-4/.test(id)) return true;
  // OpenAI 推理系列 o1 / o3 / o4（词边界，避免误伤 fuso123 之类）
  if (/\bo[134](-|$)/.test(id)) return true;
  // 视觉语言模型常见命名（qwen-vl / deepseek-vl2 / llava 等）
  if (/(^|[-_])vl\d*([-_]|$)/.test(id)) return true;
  if (id.includes('llava') || id.includes('moondream') || id.includes('internvl') || id.includes('pixtral')) {
    return true;
  }
  // Gemini 多模态系列
  if (id.includes('gemini')) return true;
  return false;
}

/** 根据模型 ID 猜测能力（vision 判定与 supportsVision 同源）。 */
export function guessCapabilities(modelId: string): string[] {
  const caps: string[] = ['text'];
  const id = modelId.toLowerCase();

  if (supportsVision(modelId)) {
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
