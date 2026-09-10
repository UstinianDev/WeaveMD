// 搜索配置类型

/** 搜索服务商枚举。 */
export type SearchProvider = 'firecrawl' | 'zhipu' | 'tavily' | 'exa';

/** 搜索错误码（机器可读，用于 guard 检测和前端展示）。 */
export type SearchErrorCode =
  | 'SEARCH_NOT_CONFIGURED'
  | 'SEARCH_FAILED'
  | 'SEARCH_TIMEOUT'
  | 'SEARCH_API_KEY_INVALID';

/** 搜索调用模式：仅搜索 vs 搜索+全页面抓取。 */
export type SearchCallMode = 'search_only' | 'search_and_scrape';

/** 搜索引擎配置。 */
export interface ISearchConfig {
  enabled: boolean;
  provider: SearchProvider;
  callMode: SearchCallMode;
  maxResults: number;
  hasApiKeys: Record<SearchProvider, boolean>;
}
