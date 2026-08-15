// ============================================
// WeaveMD — 本地向量化客户端（Ollama /api/embed）
// ============================================
// 纯 fetch，不 import Electron，可单测（mock global fetch）。
// 批量 POST /api/embed；失败降级逐条 POST /api/embeddings；全失败 throw 结构化错误，
// 由 kbIndexer/kbSearch 降级为仅 FTS5。

// 错误码：'embedding_unavailable'（服务不可用/无模型/维度异常）| 'network'（网络层）。
export interface EmbeddingErrorShape {
  code: 'embedding_unavailable' | 'network';
  message: string;
}

function makeError(code: EmbeddingErrorShape['code'], message: string): EmbeddingError {
  const err = new Error(message) as EmbeddingError;
  err.code = code;
  return err;
}

export type EmbeddingError = Error & EmbeddingErrorShape;

/** 模块级可用性缓存：防止重复探针；dims 以实测 batch 结果刷新。 */
let availabilityCache: { available: boolean; dims: number | null } | null = null;

/** 重置缓存（测试用）。 */
export function resetEmbeddingCache(): void {
  availabilityCache = null;
}

export function getEmbeddingAvailability(): { available: boolean; dims: number | null } {
  return availabilityCache
    ? { ...availabilityCache }
    : { available: false, dims: null };
}

function setAvailability(available: boolean, dims: number | null): void {
  availabilityCache = { available, dims };
}

const DEFAULT_TIMEOUT = 15_000;

function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try {
      controller.abort(new Error('timeout'));
    } catch {
      controller.abort();
    }
  }, timeoutMs);
  const onAbort = () => {
    try {
      controller.abort(new Error('external abort'));
    } catch {
      controller.abort();
    }
  };
  const mergedSignal = init.signal;
  if (mergedSignal) {
    if (mergedSignal.aborted) onAbort();
    else mergedSignal.addEventListener('abort', onAbort, { once: true });
  }
  return fetch(url, { ...init, signal: controller.signal }).then(
    async (res) => {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: res.ok, status: res.status, json: body };
    },
    (err) => {
      let msg = err instanceof Error ? err.message : String(err);
      let code: EmbeddingErrorShape['code'] = 'network';
      if (controller.signal.aborted && !mergedSignal?.aborted) {
        code = 'network';
        msg = 'Embedding request timed out';
      }
      throw makeError(code, msg);
    }
  ).finally(() => {
    clearTimeout(timeout);
    if (mergedSignal) mergedSignal.removeEventListener('abort', onAbort);
  });
}

/**
 * 探测 embedding 模型是否可用（GET /api/tags 判模型存在）。
 * 失败静默返回 ok:false，不抛。
 */
export async function probeEmbedding(
  baseUrl: string,
  model: string
): Promise<{ ok: boolean; dims: number | null }> {
  try {
    const { ok, json } = await fetchJson(`${baseUrl}/api/tags`, { method: 'GET' }, 5_000);
    if (!ok) {
      setAvailability(false, null);
      return { ok: false, dims: null };
    }
    const models = (json.models ?? []) as Array<{ name?: string; model?: string }>;
    const found = models.some((m) => {
      const name = m.name ?? m.model ?? '';
      return name === model || name.startsWith(`${model}:`) || model.startsWith(name.split(':')[0]);
    });
    setAvailability(found, null);
    return { ok: found, dims: null };
  } catch {
    setAvailability(false, null);
    return { ok: false, dims: null };
  }
}

/**
 * 批量向量化文本。优先 POST /api/embed {model, input}；批量失败降级逐条
 * POST /api/embeddings {model, prompt} 收集 {embedding}。全失败 throw 结构化错误。
 */
export async function embedBatch(
  baseUrl: string,
  model: string,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];

  // 批量路
  try {
    const { ok, status, json } = await fetchJson(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    });
    if (ok) {
      const embeddings = json.embeddings;
      if (Array.isArray(embeddings) && embeddings.length === texts.length) {
        const dims = Array.isArray(embeddings[0]) ? (embeddings[0] as number[]).length : 0;
        setAvailability(true, dims);
        return embeddings as number[][];
      }
      throw makeError('embedding_unavailable', 'Malformed /api/embed response');
    }
    if (status !== 404 && status < 500) {
      // 非服务端超时/5xx 的确定性失败，直接视为不可用
      setAvailability(false, null);
      throw makeError('embedding_unavailable', `Embedding HTTP ${status}`);
    }
    // 5xx / 404 落入逐条降级
  } catch (err) {
    const e = err as EmbeddingError;
    if (e.code === 'embedding_unavailable') throw e;
    // 网络/超时 → 尝试逐条降级
  }

  // 逐条降级路
  const out: number[][] = [];
  for (const text of texts) {
    try {
      const { ok, json } = await fetchJson(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!ok || !Array.isArray(json.embedding)) {
        setAvailability(false, null);
        throw makeError('embedding_unavailable', 'Embedding unavailable');
      }
      const vec = json.embedding as number[];
      out.push(vec);
      setAvailability(true, vec.length);
    } catch (err) {
      const e = err as EmbeddingError;
      if (e.code === 'embedding_unavailable') throw e;
      setAvailability(false, null);
      throw makeError('embedding_unavailable', 'Embedding unavailable');
    }
  }
  return out;
}
