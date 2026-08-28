// Embedding 配置类型

/** Embedding 模型配置。 */
export interface IEmbeddingConfig {
  provider?: string;
  baseUrl: string;
  model: string;
  dimension?: number;
  hasApiKey: boolean;
  multimodal: boolean;
}
