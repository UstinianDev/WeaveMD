// 模型配置类型

/** 模型兼容协议。 */
export type ModelProtocol = 'openai' | 'anthropic';

/** 单个 AI 模型配置条目。 */
export interface IAIModelConfig {
  id: string;
  name: string;
  protocol: ModelProtocol;
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  hint: string;
}

/** 新建/更新模型配置的载荷。 */
export interface AIModelConfigPayload {
  name?: string;
  protocol: ModelProtocol;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  hint?: string;
}
