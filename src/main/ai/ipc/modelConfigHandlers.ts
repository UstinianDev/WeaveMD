// ============================================
// AI Model Configs IPC Handlers（多模型配置 CRUD + 激活）
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { ModelProtocol, IAIModelConfig } from '@shared/ai';
import {
  listModelConfigs,
  getModelConfig,
  createModelConfig,
  updateModelConfig,
  deleteModelConfig,
} from '../../db/modelConfigs';
import { getAiConfig, upsertAiConfig } from '../../db/ai';
import { getDatabase } from '../../db/index';
import { encryptApiKey } from '../secureConfig';
import { toIAIConfig } from './shared';

function toIAIModelConfig(row: {
  id: string;
  name: string;
  protocol: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyEnc: string | null;
  hint: string;
}): IAIModelConfig {
  return {
    id: row.id,
    name: row.name || `${row.provider} - ${row.model}`,
    protocol: (row.protocol as ModelProtocol) || 'openai',
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    hasApiKey: !!row.apiKeyEnc,
    hint: row.hint,
  };
}

export function registerModelConfigHandlers(): void {
  // 列出用户所有模型配置
  ipcMain.handle(
    IPC_CHANNELS.AI_MODEL_CONFIGS_LIST,
    (_event, userId: string) => {
      try {
        const rows = listModelConfigs(userId);
        return { success: true, data: rows.map(toIAIModelConfig) };
      } catch {
        return { success: false, message: 'Failed to list model configs' };
      }
    }
  );

  // 新建模型配置
  ipcMain.handle(
    IPC_CHANNELS.AI_MODEL_CONFIGS_CREATE,
    (
      _event,
      payload: {
        userId: string;
        config: {
          name?: string;
          protocol: ModelProtocol;
          provider: string;
          baseUrl: string;
          model: string;
          apiKey?: string;
          hint?: string;
        };
      }
    ) => {
      try {
        const apiKeyEnc = payload.config.apiKey
          ? encryptApiKey(payload.config.apiKey).enc
          : null;
        const row = createModelConfig(payload.userId, {
          name: payload.config.name,
          protocol: payload.config.protocol,
          provider: payload.config.provider,
          baseUrl: payload.config.baseUrl,
          model: payload.config.model,
          apiKeyEnc,
          hint: payload.config.hint,
        });
        return { success: true, data: toIAIModelConfig(row) };
      } catch (err) {
        console.error('[modelConfigHandlers] create error:', err);
        return { success: false, message: `Failed to create model config: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  );

  // 更新模型配置
  ipcMain.handle(
    IPC_CHANNELS.AI_MODEL_CONFIGS_UPDATE,
    (
      _event,
      payload: {
        id: string;
        config: {
          protocol?: ModelProtocol;
          provider?: string;
          baseUrl?: string;
          model?: string;
          apiKey?: string;
          hint?: string;
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
        const row = updateModelConfig(payload.id, {
          ...payload.config,
          apiKeyEnc,
        });
        if (!row) return { success: false, message: 'Config not found' };
        return { success: true, data: toIAIModelConfig(row) };
      } catch {
        return { success: false, message: 'Failed to update model config' };
      }
    }
  );

  // 删除模型配置
  ipcMain.handle(
    IPC_CHANNELS.AI_MODEL_CONFIGS_DELETE,
    (_event, configId: string) => {
      try {
        const deleted = deleteModelConfig(configId);
        return { success: true, data: { deleted } };
      } catch {
        return { success: false, message: 'Failed to delete model config' };
      }
    }
  );

  // 激活模型配置（设置 ai_config.active_model_config_id 并同步 remoteBaseUrl/model/apiKeyEnc）
  ipcMain.handle(
    IPC_CHANNELS.AI_MODEL_CONFIGS_ACTIVATE,
    (_event, payload: { userId: string; configId: string }) => {
      try {
        const modelConfig = getModelConfig(payload.configId);
        if (!modelConfig) {
          return { success: false, message: 'Model config not found' };
        }
        // 同步到 ai_config（兼容旧代码读取 ai_config.remoteBaseUrl/model 的路径）
        const row = upsertAiConfig(payload.userId, {
          remoteBaseUrl: modelConfig.baseUrl,
          model: modelConfig.model,
          ...(modelConfig.apiKeyEnc ? { apiKeyEnc: modelConfig.apiKeyEnc } : {}),
        });
        // 设置 active_model_config_id
        const db = getDatabase();
        db.prepare(
          'UPDATE ai_config SET active_model_config_id = ? WHERE user_id = ?'
        ).run(payload.configId, payload.userId);

        return {
          success: true,
          data: toIAIConfig({ ...row, activeModelConfigId: payload.configId }),
        };
      } catch (err) {
        console.error('[modelConfigHandlers] activate error:', err);
        return { success: false, message: `Failed to activate model config: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  );
}
