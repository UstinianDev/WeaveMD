// ============================================
// WeaveMD — Embedding 客户端
// ============================================
// 调用 OpenAI 兼容 /embeddings 端点，支持单文本和批量文本。
// 纯函数：除 node fetch 外不 import Electron，可单测（mock global fetch）。

// ---------------------------------------------------------------------------
// 基础类型（向后兼容）
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  baseUrl: string;
  model: string;
  apiKey: string;
  input: string | string[];
  /** 是否启用多模态（图片向量化） */
  multimodal?: boolean;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: { promptTokens: number };
}

// ---------------------------------------------------------------------------
// R1: 提供商配置（与 @shared/ai/kb.ts IEmbeddingProviderConfig 对齐）
// ---------------------------------------------------------------------------

/** Embedding 提供商类型。 */
export type EmbeddingProviderType = 'openai' | 'qwen' | 'doubao' | 'zhipu' | 'custom';

/** Embedding 提供商配置。 */
export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
  /** 批量大小上限（Qwen/Aliyun 限 10，其余默认 20）。 */
  batchSize?: number;
  /** 多模态模型（图片 embedding）。 */
  multimodal?: boolean;
  multimodalModel?: string;
}

// ---------------------------------------------------------------------------
// 内部常量与工具函数
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 30_000;
const BATCH_INTERVAL_MS = 100;
const DEFAULT_BATCH_SIZE = 20;
const FALLBACK_SIZES = [10, 5, 2, 1];

function makeError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** 规范化 baseUrl：去除尾部 /v1 和 /，统一补 /v1。 */
function normalizeUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

// OpenAI /embeddings 响应结构
interface OpenAIEmbeddingData {
  embedding: number[];
  index: number;
}

interface OpenAIEmbeddingUsage {
  prompt_tokens: number;
}

interface OpenAIEmbeddingResponse {
  data: OpenAIEmbeddingData[];
  model: string;
  usage?: OpenAIEmbeddingUsage;
}

// ---------------------------------------------------------------------------
// 基础 createEmbedding（向后兼容，签名不变）
// ---------------------------------------------------------------------------

/**
 * 调用 OpenAI 兼容 /embeddings 端点。
 * 支持单文本和批量文本，超时 30 秒。
 */
export async function createEmbedding(req: EmbeddingRequest): Promise<EmbeddingResponse> {
  if (!req.apiKey) {
    throw makeError('config_incomplete', 'Embedding API key is required');
  }

  const url = `${normalizeUrl(req.baseUrl)}/v1/embeddings`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        input: req.input,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw makeError('timeout', 'Embedding request timed out (30s)');
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw makeError('aborted', 'Embedding request aborted');
    }
    throw makeError('network', `Embedding network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.text();
      detail = body ? `: ${body.slice(0, 200)}` : '';
    } catch { /* ignore */ }
    throw makeError(`http_${response.status}`, `Embedding HTTP ${response.status} ${response.statusText}${detail}`.trim());
  }

  let json: OpenAIEmbeddingResponse;
  try {
    json = (await response.json()) as OpenAIEmbeddingResponse;
  } catch {
    throw makeError('parse', 'Embedding response is not valid JSON');
  }

  if (!Array.isArray(json.data) || json.data.length === 0) {
    throw makeError('parse', 'Embedding response missing data array');
  }

  // 按 index 排序确保顺序一致
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((d) => {
    if (!Array.isArray(d.embedding)) {
      throw makeError('parse', `Embedding item at index ${d.index} has invalid embedding`);
    }
    return d.embedding;
  });

  return {
    embeddings,
    model: json.model ?? req.model,
    usage: {
      promptTokens: json.usage?.prompt_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// R1: 自适应批量函数
// ---------------------------------------------------------------------------

/** 等待指定毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * 自适应批量 embedding。
 * - 按 batchSize 分批（默认 20，Qwen 限 10）
 * - 失败时自动缩小 batch：20→10→5→2→1
 * - 成功后恢复原始 batchSize
 * - 每批之间 100ms 间隔防限流
 */
export async function createEmbeddingBatch(
  config: EmbeddingProviderConfig,
  texts: string[],
  opts?: { maxRetries?: number }
): Promise<EmbeddingResponse> {
  if (!config.apiKey) {
    throw makeError('config_incomplete', 'Embedding API key is required');
  }
  if (texts.length === 0) {
    return { embeddings: [], model: config.model, usage: { promptTokens: 0 } };
  }

  const url = `${normalizeUrl(config.baseUrl)}/v1/embeddings`;
  const maxRetries = opts?.maxRetries ?? 2;
  const baseBatchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

  const allEmbeddings: number[][] = [];
  let totalPromptTokens = 0;
  let resolvedModel = config.model;

  let i = 0;
  while (i < texts.length) {
    let currentBatchSize = Math.min(baseBatchSize, texts.length - i);
    let success = false;

    // 尝试当前 batch size，失败则缩小
    const sizesToTry = [currentBatchSize, ...FALLBACK_SIZES.filter((s) => s < currentBatchSize)];

    for (const size of sizesToTry) {
      if (size <= 0) continue;
      const batch = texts.slice(i, i + size);
      let attempt = 0;

      while (attempt <= maxRetries) {
        try {
          const resp = await callEmbeddingApi(url, config.apiKey, config.model, batch);
          allEmbeddings.push(...resp.embeddings);
          totalPromptTokens += resp.usage.promptTokens;
          resolvedModel = resp.model;
          currentBatchSize = size;
          success = true;
          break;
        } catch (err) {
          attempt++;
          if (attempt > maxRetries) {
            // 当前 size 重试耗尽，尝试更小的 size
            break;
          }
          // 限流/服务器错误时等待后重试
          const code = (err as Error & { code?: string }).code;
          if (code && code.startsWith('http_4')) {
            // 4xx 客户端错误（非 429）不重试
            if (code !== 'http_429') break;
          }
          await sleep(BATCH_INTERVAL_MS * attempt);
        }
      }

      if (success) break;
    }

    if (!success) {
      throw makeError('batch_failed', `Embedding batch failed at offset ${i}`);
    }

    i += currentBatchSize;

    // 每批之间 100ms 间隔防限流
    if (i < texts.length) {
      await sleep(BATCH_INTERVAL_MS);
    }
  }

  return {
    embeddings: allEmbeddings,
    model: resolvedModel,
    usage: { promptTokens: totalPromptTokens },
  };
}

/** 底层单批 API 调用。 */
async function callEmbeddingApi(
  url: string,
  apiKey: string,
  model: string,
  input: string[]
): Promise<EmbeddingResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw makeError('timeout', 'Embedding request timed out (30s)');
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw makeError('aborted', 'Embedding request aborted');
    }
    throw makeError('network', `Embedding network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.text();
      detail = body ? `: ${body.slice(0, 200)}` : '';
    } catch { /* ignore */ }
    throw makeError(`http_${response.status}`, `Embedding HTTP ${response.status} ${response.statusText}${detail}`.trim());
  }

  let json: OpenAIEmbeddingResponse;
  try {
    json = (await response.json()) as OpenAIEmbeddingResponse;
  } catch {
    throw makeError('parse', 'Embedding response is not valid JSON');
  }

  if (!Array.isArray(json.data) || json.data.length === 0) {
    throw makeError('parse', 'Embedding response missing data array');
  }

  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((d) => {
    if (!Array.isArray(d.embedding)) {
      throw makeError('parse', `Embedding item at index ${d.index} has invalid embedding`);
    }
    return d.embedding;
  });

  return {
    embeddings,
    model: json.model ?? model,
    usage: { promptTokens: json.usage?.prompt_tokens ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// R12: 图片 embedding
// ---------------------------------------------------------------------------

export interface ImageEmbeddingRequest {
  providerConfig: EmbeddingProviderConfig;
  images: Array<{ id: string; base64: string; mimeType: string }>;
  model?: string;
}

/**
 * 图片 embedding。
 * 调用 /v1/embeddings，input 格式为 OpenAI 多模态 embedding 协议：
 * [{type: "image_url", image_url: {url: "data:image/jpeg;base64,..."}}]
 *
 * 单张图片处理，30 秒超时。
 */
export async function createImageEmbedding(
  req: ImageEmbeddingRequest
): Promise<{ embeddings: Array<{ id: string; vector: number[] }>; model: string }> {
  if (!req.providerConfig.apiKey) {
    throw makeError('config_incomplete', 'Embedding API key is required');
  }
  if (req.images.length === 0) {
    return { embeddings: [], model: req.model ?? req.providerConfig.model };
  }

  const url = `${normalizeUrl(req.providerConfig.baseUrl)}/v1/embeddings`;
  const model = req.model ?? req.providerConfig.multimodalModel ?? req.providerConfig.model;
  const results: Array<{ id: string; vector: number[] }> = [];
  let resolvedModel = model;

  // 单张图片处理，避免内存/超时问题
  for (const img of req.images) {
    const input = [{
      type: 'image_url' as const,
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64}`,
      },
    }];

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.providerConfig.apiKey}`,
        },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw makeError('timeout', `Image embedding timed out for ${img.id} (30s)`);
      }
      throw makeError('network', `Image embedding network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.text();
        detail = body ? `: ${body.slice(0, 200)}` : '';
      } catch { /* ignore */ }
      throw makeError(`http_${response.status}`, `Image embedding HTTP ${response.status}${detail}`.trim());
    }

    let json: OpenAIEmbeddingResponse;
    try {
      json = (await response.json()) as OpenAIEmbeddingResponse;
    } catch {
      throw makeError('parse', 'Image embedding response is not valid JSON');
    }

    if (!Array.isArray(json.data) || json.data.length === 0) {
      throw makeError('parse', 'Image embedding response missing data');
    }

    const vector = json.data[0].embedding;
    if (!Array.isArray(vector)) {
      throw makeError('parse', `Image embedding for ${img.id} has invalid vector`);
    }

    results.push({ id: img.id, vector });
    resolvedModel = json.model ?? model;
  }

  return { embeddings: results, model: resolvedModel };
}
