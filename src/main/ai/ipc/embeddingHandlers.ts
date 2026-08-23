// ============================================
// Embedding IPC Handlers
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import { createEmbedding } from '../embeddingClient';

export function registerEmbeddingHandlers(): void {
  // --- 测试 Embedding 连接 ---
  ipcMain.handle(
    IPC_CHANNELS.AI_EMBEDDING_TEST,
    async (
      _event,
      payload: { baseUrl: string; model: string; apiKey: string }
    ) => {
      try {
        if (!payload?.baseUrl || !payload?.model || !payload?.apiKey) {
          return { success: false, message: 'baseUrl, model, apiKey are required' };
        }
        const res = await createEmbedding({
          baseUrl: payload.baseUrl,
          model: payload.model,
          apiKey: payload.apiKey,
          input: 'test',
        });
        return {
          success: true,
          message: `Embedding OK (dims=${res.embeddings[0]?.length ?? 0})`,
        };
      } catch (err) {
        const code = err instanceof Error && 'code' in err ? (err as Error & { code: string }).code : 'unknown';
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message: `[${code}] ${message}` };
      }
    }
  );

  // --- 创建 Embedding ---
  ipcMain.handle(
    IPC_CHANNELS.AI_EMBEDDING_CREATE,
    async (
      _event,
      payload: { baseUrl: string; model: string; apiKey: string; input: string | string[]; multimodal?: boolean }
    ) => {
      try {
        if (!payload?.baseUrl || !payload?.model || !payload?.apiKey) {
          return { success: false, message: 'baseUrl, model, apiKey are required' };
        }
        if (!payload.input || (typeof payload.input === 'string' && !payload.input.trim())) {
          return { success: false, message: 'input must not be empty' };
        }
        const res = await createEmbedding({
          baseUrl: payload.baseUrl,
          model: payload.model,
          apiKey: payload.apiKey,
          input: payload.input,
          multimodal: payload.multimodal,
        });
        return { success: true, data: res };
      } catch (err) {
        const code = err instanceof Error && 'code' in err ? (err as Error & { code: string }).code : 'unknown';
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message: `[${code}] ${message}` };
      }
    }
  );
}
