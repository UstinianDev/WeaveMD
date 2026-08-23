// ============================================
// WeaveMD — Embedding 客户端
// ============================================
// 调用 OpenAI 兼容 /embeddings 端点，支持单文本和批量文本。
// 纯函数：除 node fetch 外不 import Electron，可单测（mock global fetch）。

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

const TIMEOUT_MS = 30_000;

function makeError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
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

/**
 * 调用 OpenAI 兼容 /embeddings 端点。
 * 支持单文本和批量文本，超时 30 秒。
 */
export async function createEmbedding(req: EmbeddingRequest): Promise<EmbeddingResponse> {
  if (!req.apiKey) {
    throw makeError('config_incomplete', 'Embedding API key is required');
  }

  const url = `${req.baseUrl.replace(/\/+$/, '')}/embeddings`;

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
