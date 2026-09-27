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
 * 已知支持 vision 的 id 模式（命中 → true；按序匹配，vision 模式优先于非 vision，
 * 保证 `llama-3.2-11b-vision` 之类「参数量命名 + vision 标识」不被误判）。
 * remedial 扩展（诊断 B-1 漏判项）：glm-4v / minicpm / cogvlm / fuyu / kosmos。
 */
const VISION_ID_PATTERNS: RegExp[] = [
  /vision/,
  /claude/,
  /\bgpt-4/,
  /\bo[134](-|$)/,
  /(^|[-_])vl\d*([-_]|$)/,
  /(llava|moondream|internvl|pixtral)/,
  /gemini/,
  /(glm-4v|minicpm|cogvlm|fuyu|kosmos)/,
];

/**
 * 已知纯文本模型 id 模式（命中 → false；向其发图片会导致整条请求被 API 拒绝）。
 * remedial 扩展：显式负表取代「未知恒 false」——未知模型改走乐观注入。
 */
const NON_VISION_ID_PATTERNS: RegExp[] = [
  /^deepseek-(chat|reasoner)/,
  /gpt-3\.5/,
  // 参数量命名（llama-3.1-8b / qwen2.5-7b-instruct / mixtral-8x7b / chatglm3-6b）
  /(^|[-_])\d+(\.\d+)?[bB](-|$)/,
  /-instruct(-|$)/,
  /embedding/,
  /(davinci|curie|babbage|ada)([-_]\d+)?$/,
  /^qwen-(turbo|plus|max|math|coder)([-:.]|$)/,
  /^glm-\d+(\.\d+)?($|[-_](?!v))/,
];

/**
 * vision 能力判定（B6 五-1②：**发送前**检测，不支持则降级纯文本 + 提示）。
 * remedial Bug B 判定链中段：已知 vision 模式 → 已知非 vision 模式 →
 * **未知模型乐观返回 true**（裁定：默认乐观注入，由既有降级链兜底 ——
 * 文件缺失占位 / VISION_DEGRADED_NOTICE / API 拒绝错误上屏）。
 * 用户覆盖（ai_config.vision_override）见 resolveVisionSupport。
 */
export function supportsVision(modelId: string): boolean {
  const id = (modelId || '').toLowerCase().trim();
  if (!id) return false;
  if (VISION_ID_PATTERNS.some((p) => p.test(id))) return true;
  if (NON_VISION_ID_PATTERNS.some((p) => p.test(id))) return false;
  // 未知模型：乐观注入（deterministic 表之外的私有部署多为多模态或由降级链兜底）
  return true;
}

/**
 * 发送前最终判定链（remedial Bug B，注入/识别两链路统一来源）：
 * ① 用户覆盖 visionOverride（true/false）优先；
 * ② 无覆盖 → supportsVision（已知能力表 → 未知乐观）。
 */
export function resolveVisionSupport(modelId: string, visionOverride?: boolean): boolean {
  if (typeof visionOverride === 'boolean') return visionOverride;
  return supportsVision(modelId);
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
