// ============================================
// WeaveMD — Anthropic API 适配层
// ============================================
// Anthropic API 兼容层（L5）。
// 将 OpenAI 格式转换为 Anthropic 格式。

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; source?: unknown }>;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  stream?: boolean;
}

/** 将 OpenAI 消息转换为 Anthropic 格式。 */
export function convertToAnthropicFormat(
  messages: Array<{ role: string; content: string }>
): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      anthropicMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return { system, messages: anthropicMessages };
}

/** 构建 Anthropic API 请求体。 */
export function buildAnthropicRequest(params: {
  model: string;
  messages: Array<{ role: string; content: string }>;
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
