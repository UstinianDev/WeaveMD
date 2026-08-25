// ============================================
// WeaveMD — 模型目录管理
// ============================================
// 管理预定义的模型目录（L2）。
// 提供常用模型的元数据和推荐配置。

export interface CatalogEntry {
  id: string;
  name: string;
  provider: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  description: string;
  capabilities: string[];
  recommended: boolean;
}

/** 预定义模型目录。 */
const MODEL_CATALOG: CatalogEntry[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    description: 'DeepSeek V3 对话模型，性价比高',
    capabilities: ['text', 'code'],
    recommended: true,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    provider: 'deepseek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    description: 'DeepSeek R1 推理模型，擅长复杂推理',
    capabilities: ['text', 'code', 'reasoning'],
    recommended: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    description: 'OpenAI 多模态模型',
    capabilities: ['text', 'vision', 'code'],
    recommended: true,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    description: 'Anthropic 高性能模型',
    capabilities: ['text', 'vision', 'code'],
    recommended: true,
  },
  {
    id: 'qwen-plus',
    name: '通义千问 Plus',
    provider: 'qwen',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    description: '阿里云通义千问增强版',
    capabilities: ['text', 'code'],
    recommended: false,
  },
];

/** 获取完整模型目录。 */
export function getModelCatalog(): CatalogEntry[] {
  return [...MODEL_CATALOG];
}

/** 获取推荐模型。 */
export function getRecommendedModels(): CatalogEntry[] {
  return MODEL_CATALOG.filter((m) => m.recommended);
}

/** 按提供商筛选模型。 */
export function getModelsByProvider(provider: string): CatalogEntry[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

/** 按 ID 获取目录条目。 */
export function getCatalogEntry(id: string): CatalogEntry | null {
  return MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/** 搜索模型目录。 */
export function searchModelCatalog(query: string): CatalogEntry[] {
  const q = query.toLowerCase();
  return MODEL_CATALOG.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
  );
}
