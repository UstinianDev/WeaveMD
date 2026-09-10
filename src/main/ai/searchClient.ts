// ============================================
// WeaveMD — 多引擎搜索客户端
// ============================================
// 统一接口调用四个搜索引擎：Firecrawl / 智谱 / Tavily / Exa。
// 纯函数：除 node fetch 外不 import Electron，可单测（mock global fetch）。

import type { SearchProvider } from '@shared/ai';

export interface SearchRequest {
  provider: SearchProvider;
  apiKey: string;
  query: string;
  maxResults?: number;
  /** 搜索调用模式：search_only（轻量搜索）/ search_and_scrape（搜索+全页面抓取，仅 Firecrawl 有效）。 */
  callMode?: 'search_only' | 'search_and_scrape';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  provider: SearchProvider;
}

const TIMEOUT_MS = 25_000;
const DEFAULT_MAX_RESULTS = 5;

function makeError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** 判断是否为可重试的瞬态错误（复用 llmClient 的判断逻辑）。 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (!code) return false;
  if (code === 'network' || code === 'timeout') return true;
  if (code.startsWith('http_')) {
    const status = parseInt(code.replace('http_', ''), 10);
    return status === 429 || status >= 500;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 各引擎实现
// ---------------------------------------------------------------------------

/** Firecrawl: https://api.firecrawl.dev/v1/search （默认轻量搜索；callMode='search_and_scrape' 时触发全页面抓取） */
async function searchFirecrawl(apiKey: string, query: string, maxResults: number, callMode?: string): Promise<SearchResult[]> {
  const body: Record<string, unknown> = { query, limit: maxResults };
  // 仅在用户明确选择 search_and_scrape 模式时才传 scrapeOptions
  if (callMode === 'search_and_scrape') {
    body.scrapeOptions = { formats: ['markdown'] };
  }

  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw makeError(`http_${response.status}`, `Firecrawl HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  interface FirecrawlResult {
    title?: string;
    url?: string;
    description?: string;
    snippet?: string;
    markdown?: string;
  }
  interface FirecrawlResponse {
    success?: boolean;
    data?: FirecrawlResult[];
  }

  const json = (await response.json()) as FirecrawlResponse;
  if (!json.success || !Array.isArray(json.data)) {
    throw makeError('parse', 'Firecrawl response missing data');
  }

  return json.data.map((item) => {
    // 优先级：snippet > description > markdown（截取前 800 字符）
    let snippet = item.snippet ?? '';
    if (!snippet && item.description) {
      snippet = item.description.slice(0, 800);
    }
    if (!snippet && item.markdown) {
      // markdown 是全页面内容，截取前 800 字符作为摘要
      snippet = item.markdown.slice(0, 800);
    }
    return {
      title: item.title ?? '',
      url: item.url ?? '',
      snippet,
    };
  });
}

/** 智谱: https://open.bigmodel.cn/api/paas/v4/web/search */
async function searchZhipu(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/web/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      search_query: query,
      count: maxResults,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw makeError(`http_${response.status}`, `Zhipu HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  interface ZhipuSearchItem {
    title?: string;
    link?: string;
    content?: string;
    snippet?: string;
  }
  interface ZhipuResponse {
    search_result?: ZhipuSearchItem[];
  }

  const json = (await response.json()) as ZhipuResponse;
  if (!Array.isArray(json.search_result)) {
    throw makeError('parse', 'Zhipu response missing search_result');
  }

  return json.search_result.map((item) => ({
    title: item.title ?? '',
    url: item.link ?? '',
    snippet: item.snippet ?? item.content?.slice(0, 800) ?? '',
  }));
}

/** Tavily: https://api.tavily.com/search */
async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw makeError(`http_${response.status}`, `Tavily HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  interface TavilyResult {
    title?: string;
    url?: string;
    content?: string;
  }
  interface TavilyResponse {
    results?: TavilyResult[];
  }

  const json = (await response.json()) as TavilyResponse;
  if (!Array.isArray(json.results)) {
    throw makeError('parse', 'Tavily response missing results');
  }

  return json.results.map((item) => ({
    title: item.title ?? '',
    url: item.url ?? '',
    snippet: item.content?.slice(0, 800) ?? '',
  }));
}

/** Exa: https://api.exa.ai/search */
async function searchExa(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: maxResults,
      type: 'auto',
      contents: {
        text: { maxCharacters: 800 },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw makeError(`http_${response.status}`, `Exa HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  interface ExaResult {
    title?: string;
    url?: string;
    text?: string;
    snippet?: string;
  }
  interface ExaResponse {
    results?: ExaResult[];
  }

  const json = (await response.json()) as ExaResponse;
  if (!Array.isArray(json.results)) {
    throw makeError('parse', 'Exa response missing results');
  }

  return json.results.map((item) => ({
    title: item.title ?? '',
    url: item.url ?? '',
    snippet: item.snippet ?? item.text?.slice(0, 800) ?? '',
  }));
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

const SEARCH_HANDLERS: Record<SearchProvider, (apiKey: string, query: string, maxResults: number, callMode?: string) => Promise<SearchResult[]>> = {
  firecrawl: searchFirecrawl,
  zhipu: searchZhipu,
  tavily: searchTavily,
  exa: searchExa,
};

/**
 * 统一搜索入口。根据 provider 调用对应引擎，返回标准化结果。
 */
export async function search(req: SearchRequest): Promise<SearchResponse> {
  if (!req.apiKey) {
    throw makeError('config_incomplete', `Search API key is required for ${req.provider}`);
  }
  if (!req.query.trim()) {
    throw makeError('invalid_input', 'Search query must not be empty');
  }

  const handler = SEARCH_HANDLERS[req.provider];
  if (!handler) {
    throw makeError('invalid_input', `Unknown search provider: ${req.provider}`);
  }

  const maxResults = req.maxResults ?? DEFAULT_MAX_RESULTS;

  // 统一超时/网络错误包装（handler 内部已有 AbortSignal.timeout，此处兜底）
  let results: SearchResult[];
  try {
    results = await handler(req.apiKey, req.query.trim(), maxResults, req.callMode);
  } catch (err) {
    // handler 已经抛出结构化错误，直接 re-throw
    if (err instanceof Error && 'code' in err) throw err;
    throw makeError('network', `Search error (${req.provider}): ${err instanceof Error ? err.message : String(err)}`);
  }

  return { results, provider: req.provider };
}

// ---------------------------------------------------------------------------
// 带重试的搜索包装器（指数退避，仅对可恢复错误生效）
// ---------------------------------------------------------------------------

/** 指数退避延迟序列（毫秒）：2次重试，共3次尝试。 */
const SEARCH_RETRY_DELAYS = [3000, 6000];

/**
 * 带重试的搜索入口。
 * 对可恢复错误（网络抖动、429 限流、5xx 服务端错误、超时）进行指数退避重试。
 * 非可恢复错误（配置错误、认证失败等）直接抛出。
 */
export async function searchWithRetry(req: SearchRequest): Promise<SearchResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SEARCH_RETRY_DELAYS.length; attempt++) {
    try {
      return await search(req);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt >= SEARCH_RETRY_DELAYS.length) throw err;
      const delay = SEARCH_RETRY_DELAYS[attempt];
      console.warn(`[Search] Transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${SEARCH_RETRY_DELAYS.length})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
