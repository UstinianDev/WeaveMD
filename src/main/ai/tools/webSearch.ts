// ============================================
// WeaveMD — web_search Agent Tool
// ============================================
// 联网搜索工具，集成 searchClient 多引擎搜索能力。
// 配置从 ai_search_config 表读取（provider + apiKey），解密后传给 searchClient。
// 铁律：搜索结果只读返回给 LLM，不做任何落盘操作。

import type { SearchProvider, ToolDef } from '@shared/ai';
import { search, type SearchResponse } from '../searchClient';
import { getSearchConfig } from '../../db/searchConfig';
import { decryptApiKey } from '../secureConfig';

// ---------------------------------------------------------------------------
// Tool Schema（OpenAI function JSON Schema）
// ---------------------------------------------------------------------------

export const webSearchSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for current information. Use when you need up-to-date facts, news, or information not available in the knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (keywords or natural language)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default 5, max 10)',
        },
      },
      required: ['query'],
    },
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  success: boolean;
  results: WebSearchResult[];
  provider?: SearchProvider;
  error?: string;
}

// ---------------------------------------------------------------------------
// Config Resolution
// ---------------------------------------------------------------------------

/** 从 ai_search_config 表解析搜索配置（provider + 明文 apiKey）。 */
export function resolveSearchConfig(userId: string): {
  provider: SearchProvider;
  apiKey: string;
} | null {
  const row = getSearchConfig(userId);
  if (!row || !row.enabled) return null;

  const provider = row.provider;
  // 根据 provider 选择对应的加密 key 字段
  const encField = `${provider}KeyEnc` as keyof typeof row;
  const enc = row[encField];
  if (typeof enc !== 'string' || !enc) return null;

  try {
    const apiKey = decryptApiKey(enc);
    if (!apiKey) return null;
    return { provider, apiKey };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * 执行联网搜索。从 DB 读取配置并解密 key，调用 searchClient。
 * 错误收敛为结构化响应，不抛异常（agentLoop 依赖此行为）。
 */
export async function executeWebSearch(
  args: Record<string, unknown>,
  userId: string
): Promise<WebSearchResponse> {
  // 参数提取与验证
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return { success: false, results: [], error: 'Search query cannot be empty' };
  }

  const rawMax = typeof args.maxResults === 'number' ? args.maxResults : 5;
  const maxResults = Math.min(Math.max(Math.floor(rawMax), 1), 10);

  // 解析搜索配置
  const config = resolveSearchConfig(userId);
  if (!config) {
    return {
      success: false,
      results: [],
      error: 'Web search not configured. Please enable search and set API key in Settings > Search.',
    };
  }

  // 调用 searchClient
  try {
    const response: SearchResponse = await search({
      provider: config.provider,
      apiKey: config.apiKey,
      query,
      maxResults,
    });

    const results: WebSearchResult[] = response.results.map((r) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.snippet || '',
    }));

    return { success: true, results, provider: response.provider };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, results: [], error: `Search failed: ${message}` };
  }
}
