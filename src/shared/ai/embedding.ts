// Embedding 配置类型

/** Embedding 模型配置。 */
export interface IEmbeddingConfig {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  multimodal: boolean;
}
