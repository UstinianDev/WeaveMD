// ============================================
// WeaveMD — useJsonParserWorker Hook
// ============================================
// 管理 JSON Parser Web Worker 生命周期。
// Worker 创建失败时回退到同步 JSON.parse。

import { useEffect, useRef, useCallback } from 'react';

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * 提供异步 JSON.parse 能力。
 * Worker 在组件挂载时创建，卸载时终止。
 */
export function useJsonParserWorker(): {
  parseJson: (json: string) => Promise<unknown>;
} {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<string, PendingEntry>>(new Map());
  const idCounterRef = useRef(0);
  const fallbackRef = useRef(false);

  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('./jsonParser.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent<{ id: string; result?: unknown; error?: string }>) => {
        const { id, result, error } = e.data;
        const pending = pendingRef.current.get(id);
        if (!pending) return;
        pendingRef.current.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
      };

      worker.onerror = () => {
        // Worker 出错时回退到同步解析
        fallbackRef.current = true;
        for (const [, pending] of pendingRef.current) {
          pending.reject(new Error('Worker error'));
        }
        pendingRef.current.clear();
        worker.terminate();
        workerRef.current = null;
      };

      workerRef.current = worker;
    } catch {
      // Worker 创建失败（如 CSP 限制），回退到同步解析
      fallbackRef.current = true;
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error('Worker terminated'));
      }
      pendingRef.current.clear();
    };
  }, []);

  const parseJson = useCallback((json: string): Promise<unknown> => {
    // 回退模式：同步解析
    if (fallbackRef.current || !workerRef.current) {
      return Promise.resolve(JSON.parse(json));
    }

    return new Promise<unknown>((resolve, reject) => {
      const id = `json-${++idCounterRef.current}`;
      pendingRef.current.set(id, { resolve, reject });
      workerRef.current!.postMessage({ id, json });
    });
  }, []);

  return { parseJson };
}
