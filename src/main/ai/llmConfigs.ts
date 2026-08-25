// ============================================
// WeaveMD — LLM 配置管理
// ============================================
// LLM 配置管理增强（L4）。
// 提供多配置管理和快速切换。

import type { IAIModelConfig, AIModelConfigPayload } from '@shared/ai';
import { listModelConfigs, createModelConfig, updateModelConfig, deleteModelConfig } from '../db/modelConfigs';

export interface LlmConfigSummary {
  total: number;
  active: IAIModelConfig | null;
  providers: string[];
}

/** 获取 LLM 配置摘要。 */
export function getLlmConfigSummary(userId: string): LlmConfigSummary {
  const configs = listModelConfigs(userId);
  const active = configs.find((c) => c.apiKeyEnc) ?? null;
  const providers = [...new Set(configs.map((c) => c.provider))] as string[];

  return {
    total: configs.length,
    active: active as unknown as IAIModelConfig | null,
    providers,
  };
}

/** 验证配置有效性。 */
export function validateLlmConfig(config: AIModelConfigPayload): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.baseUrl) errors.push('baseUrl 不能为空');
  if (!config.model) errors.push('model 不能为空');
  if (!config.provider) errors.push('provider 不能为空');

  // URL 格式验证
  try {
    new URL(config.baseUrl);
  } catch {
    errors.push('baseUrl 格式无效');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** 测试 LLM 配置连接。 */
export async function testLlmConfig(
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<{ success: boolean; message: string }> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, message: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }

    return { success: true, message: '连接成功' };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
