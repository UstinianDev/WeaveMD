// 搜索配置类型

/** 搜索服务商枚举。 */
export type SearchProvider = 'firecrawl' | 'zhipu' | 'tavily' | 'exa';

/** 搜索错误码（机器可读，用于 guard 检测和前端展示）。 */
export type SearchErrorCode =
  | 'SEARCH_NOT_CONFIGURED'
  | 'SEARCH_FAILED'
  | 'SEARCH_TIMEOUT'
  | 'SEARCH_API_KEY_INVALID';

/** 搜索引擎配置。 */
export interface ISearchConfig {
  enabled: boolean;
  provider: SearchProvider;
  callMode: string;
  maxResults: number;
  hasApiKeys: Record<SearchProvider, boolean>;
}
