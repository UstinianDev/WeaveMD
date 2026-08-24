// ============================================
// WeaveMD — AI model list (ai.list-models IPC)
// ============================================
// 纯函数：除 global fetch + getAiConfig 外不 import Electron，可单测（mock global fetch）。
// 仿 llmClient：AbortSignal.timeout + 失败/非 200/半包静默返回 []（不抛不阻断）。
// 后端恒 remote：GET {remoteBaseUrl}/models（Bearer key）→ data[].id。
// SECURITY：remote 后端用 decryptApiKey 解出明文 key 仅存在于主进程内存，绝不落渲染进程响应。

import { decryptApiKey } from './secureConfig';

const REQUEST_TIMEOUT_MS = 8_000;

/** 按 remote /models 响应（data[].id）归一为模型名/ID 数组。顶层导出，可单测。 */
export function normalizeModels(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  const data = Array.isArray(obj.data) ? (obj.data as unknown[]) : [];
  return data
    .map((d) => {
      if (!d || typeof d !== 'object') return '';
      const id = (d as Record<string, unknown>).id;
      return typeof id === 'string' ? id.trim() : '';
    })
    .filter((s): s is string => s.length > 0);
}

/**
 * 拉取某用户的可用模型列表（超时 8s）。
 * remote → GET {remoteBaseUrl}/models（Bearer key）→ data[].id。
 * 无 key 直接空（不发网）。失败/非 200/半包 → []（静默，不抛不阻断）。config 行缺失返回 []。
 * 返回值仅模型名字符串，绝不含 API key。
 *
 * 参数接受部分 AiConfigRow（仅需 remoteBaseUrl + apiKeyEnc），兼容 active_model_config 路径。
 */
export async function listModelsForUser(
  configOrNull: { remoteBaseUrl: string; apiKeyEnc: string | null } | null
): Promise<string[]> {
  if (!configOrNull) return [];

  // remote：需 key；无 key 直接空（不发网）。key 明文只在主进程内存。
  if (!configOrNull.apiKeyEnc) return [];
  const apiKey = decryptApiKey(configOrNull.apiKeyEnc);
  if (!apiKey) return [];
  // 规范化 baseUrl：去除尾部 /v1 和 /，避免双重 /v1/v1/
  const normalizedBase = configOrNull.remoteBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const json = await safeGetJson(`${normalizedBase}/v1/models`, {
    Authorization: `Bearer ${apiKey}`,
  });
  return normalizeModels(json);
}

/** 带超时 GET 并解析 JSON；任何异常/非 200/解析失败返回 null（调用方归一为 []）。 */
async function safeGetJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    const init: RequestInit = AbortSignal.timeout
      ? { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      : {};
    if (headers) init.headers = headers;
    res = await fetch(url, init);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
