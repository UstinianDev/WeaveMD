// ============================================
// WeaveMD — LLM 流式请求共享脚手架
// ============================================
// 从 llmClient.ts / anthropicClient.ts 提取的公共 abort/timeout/finalize 逻辑。
// 纯函数，不 import Electron，可单测。

const DEFAULT_TIMEOUT = 60_000;

/** 统一构造带 code 的 Error（主进程 / 测试共用）。 */
export function makeError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** 流式请求控制器：封装 AbortController + 外部信号转发 + 超时。 */
export interface StreamController {
  controller: AbortController;
  /** 清理定时器和事件监听，必须在流结束/错误时调用。 */
  finalize: () => void;
  /** 根据 abort 原因返回规范化错误。 */
  abortError: () => Error & { code: string };
}

/**
 * 创建流式请求控制器。
 * - 外部 signal abort → 内部 controller abort
 * - 超时 → 内部 controller abort（reason='timeout'）
 */
export function createStreamController(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT
): StreamController {
  const controller = new AbortController();

  if (externalSignal?.aborted) {
    throw makeError('aborted', 'Request aborted');
  }

  const doAbort = (reason: string): void => {
    try {
      controller.abort(reason);
    } catch {
      controller.abort();
    }
  };

  const onExternalAbort = (): void => doAbort('external');
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  const timeout = setTimeout(() => doAbort('timeout'), timeoutMs);

  const finalize = (): void => {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  const abortError = (): Error & { code: string } => {
    const reason = (controller.signal as unknown as { reason?: string }).reason;
    if (reason === 'timeout') return makeError('timeout', 'Request timed out');
    return makeError('aborted', 'Request aborted');
  };

  return { controller, finalize, abortError };
}

/**
 * 标准化 baseUrl：去除尾部 /v1 和 /，避免双重 /v1/v1/。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}
