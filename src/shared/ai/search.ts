// 搜索配置类型

/** 搜索服务商枚举。 */
export type SearchProvider = 'firecrawl' | 'zhipu' | 'tavily' | 'exa';

/** 搜索引擎配置。 */
export interface ISearchConfig {
  enabled: boolean;
  provider: SearchProvider;
  callMode: string;
  maxResults: number;
  hasApiKeys: Record<SearchProvider, boolean>;
}
