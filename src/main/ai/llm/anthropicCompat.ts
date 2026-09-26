// ============================================
// WeaveMD — Anthropic API 适配层
// ============================================
// Anthropic API 兼容层（L5）。
// 将 OpenAI 格式转换为 Anthropic 格式。
// B6 五-1：content 数组（text + image_url part）→ Anthropic text/image block 两套协议分流。

import { basename } from 'path';

import { resolveContentForWire, type ContentPart, type MessageContent } from './llmClient';

/** Anthropic 图片 source（base64 / url 两态）。 */
export interface AnthropicImageSource {
  type: 'base64' | 'url';
  media_type?: string;
  data?: string;
  url?: string;
}

/** Anthropic content block（text / image）。 */
export interface AnthropicContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: AnthropicImageSource;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  stream?: boolean;
}

/** 解析 data URL → { mediaType, base64 }；非 data URL 返回 null。 */
function parseDataUrl(url: string): { mediaType: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

/**
 * 单条消息 content → Anthropic 格式。
 * - string 原样返回（纯文本链路零变化）
 * - 数组先经 resolveContentForWire（本地路径 → data URL），再转 block：
 *   data URL → base64 image block；http(s) → url image block；
 *   读取失败的占位文本由 resolveContentForWire 产出，此处照常透传。
 */
export function toAnthropicContent(content: MessageContent): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content;
  const resolved = resolveContentForWire([{ role: 'user', content }])[0].content;
  if (typeof resolved === 'string') return resolved;

  const blocks: AnthropicContentBlock[] = [];
  for (const part of resolved as ContentPart[]) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
      continue;
    }
    const url = part.image_url?.url ?? '';
    const data = parseDataUrl(url);
    if (data) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: data.mediaType, data: data.base64 },
      });
    } else if (/^https?:\/\//i.test(url)) {
      blocks.push({ type: 'image', source: { type: 'url', url } });
    } else {
      // resolveContentForWire 未覆盖的异常形态（如空 url）→ 显式占位，不静默丢图
      blocks.push({ type: 'text', text: `[图片无法读取: ${basename(url || 'unknown')}]` });
    }
  }
  return blocks;
}

/** 将 OpenAI 消息转换为 Anthropic 格式。 */
export function convertToAnthropicFormat(
  messages: Array<{ role: string; content: MessageContent }>
): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Anthropic system 只接受文本：数组 content 取文本拼接（不注入 system 图片）
      system = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('');
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      anthropicMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: toAnthropicContent(msg.content),
      });
    }
  }

  return { system, messages: anthropicMessages };
}

/** 构建 Anthropic API 请求体。 */
export function buildAnthropicRequest(params: {
  model: string;
  messages: Array<{ role: string; content: MessageContent }>;
  maxTokens?: number;
  stream?: boolean;
}): AnthropicRequest {
  const { system, messages } = convertToAnthropicFormat(params.messages);

  return {
    model: params.model,
    max_tokens: params.maxTokens ?? 4096,
    messages,
    ...(system ? { system } : {}),
    stream: params.stream ?? false,
  };
}

/** 检查是否为 Anthropic 模型。 */
export function isAnthropicModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('claude');
}

/** Anthropic API 端点。 */
export const ANTHROPIC_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
