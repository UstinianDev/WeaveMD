// ============================================
// Embedding Config IPC Handlers（独立配置 CRUD）
// 测试/创建通道（AI_EMBEDDING_TEST/CREATE）由 embeddingHandlers.ts 注册，此处不重复。
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { IEmbeddingConfig } from '@shared/ai';
import { getEmbeddingConfig, upsertEmbeddingConfig } from '../../db/embeddingConfig';
import { encryptApiKey } from '../secureConfig';

function toIEmbeddingConfig(row: {
  baseUrl: string;
  model: string;
  apiKeyEnc: string | null;
  multimodal: boolean;
}): IEmbeddingConfig {
  return {
    baseUrl: row.baseUrl,
    model: row.model,
    hasApiKey: !!row.apiKeyEnc,
    multimodal: row.multimodal,
  };
}

export function registerEmbeddingConfigHandlers(): void {
  // 获取 Embedding 配置
  ipcMain.handle(
    IPC_CHANNELS.AI_EMBEDDING_GET_CONFIG,
    (_event, userId: string) => {
      try {
        const row = getEmbeddingConfig(userId);
        if (!row) {
          return {
            success: true,
            data: {
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              model: 'text-embedding-v3',
              hasApiKey: false,
              multimodal: false,
            },
          };
        }
        return { success: true, data: toIEmbeddingConfig(row) };
      } catch (err) {
        console.error('[embeddingConfigHandlers] get error:', err);
        return { success: false, message: 'Failed to get embedding config' };
      }
    }
  );

  // 保存 Embedding 配置
  ipcMain.handle(
    IPC_CHANNELS.AI_EMBEDDING_SET_CONFIG,
    (
      _event,
      payload: {
        userId: string;
        config: {
          baseUrl?: string;
          model?: string;
          apiKey?: string;
          multimodal?: boolean;
        };
      }
    ) => {
      try {
        const apiKeyEnc =
          payload.config.apiKey !== undefined
            ? payload.config.apiKey
              ? encryptApiKey(payload.config.apiKey).enc
              : null
            : undefined;
        const row = upsertEmbeddingConfig(payload.userId, {
          ...payload.config,
          apiKeyEnc,
        });
        return { success: true, data: toIEmbeddingConfig(row) };
      } catch (err) {
        console.error('[embeddingConfigHandlers] set error:', err);
        return { success: false, message: `Failed to save embedding config: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  );

}
