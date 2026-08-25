// ============================================
// AI Config & Consent IPC Handlers
// ============================================

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { ChatBackend, IAIConfig, IAIConsent, WriteMode } from '@shared/ai';
import { getAiConfig, upsertAiConfig } from '../../db/ai';
import { getDatabase } from '../../db/index';
import { encryptApiKey } from '../secureConfig';
import { DEFAULT_AI_CONFIG, DEFAULT_CONSENT, toIAIConfig, toIAIConsent } from './shared';

export function registerConfigConsentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_GET_CONFIG, (_event, userId: string) => {
    try {
      const row = getAiConfig(userId);
      const config: IAIConfig = row ? toIAIConfig(row) : DEFAULT_AI_CONFIG;
      return { success: true, data: config };
    } catch (error) {
      return { success: false, message: 'Failed to get AI config' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AI_SET_CONFIG,
    async (
      _event,
      payload: {
        userId: string;
        config: {
          backend?: ChatBackend;
          remoteBaseUrl?: string;
          model?: string;
          apiKey?: string;
          activeModelConfigId?: string;
        };
      }
    ) => {
      try {
        let apiKeyEnc: string | null | undefined = undefined;
        if (payload.config.apiKey !== undefined) {
          // apiKey 传了就加密落库；空串清除旧 key
          apiKeyEnc = payload.config.apiKey
            ? encryptApiKey(payload.config.apiKey).enc
            : null;
        }
        const row = upsertAiConfig(payload.userId, {
          backend: payload.config.backend,
          remoteBaseUrl: payload.config.remoteBaseUrl,
          model: payload.config.model,
          apiKeyEnc,
        });
        // 设置 active_model_config_id（如果传了）
        if (payload.config.activeModelConfigId !== undefined) {
          const db = getDatabase();
          db.prepare(
            'UPDATE ai_config SET active_model_config_id = ? WHERE user_id = ?'
          ).run(payload.config.activeModelConfigId, payload.userId);
        }
        return { success: true, data: toIAIConfig(row) };
      } catch (error) {
        return { success: false, message: 'Failed to save AI config' };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.AI_GET_CONSENT, (_event, userId: string) => {
    try {
      const row = getAiConfig(userId);
      const consent: IAIConsent = row ? toIAIConsent(row) : DEFAULT_CONSENT;
      return { success: true, data: consent };
    } catch (error) {
      return { success: false, message: 'Failed to get AI consent' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AI_SET_CONSENT,
    async (
      _event,
      payload: { userId: string; consent: Partial<IAIConsent> }
    ) => {
      try {
        const row = upsertAiConfig(payload.userId, {
          allowNetwork: payload.consent.allowNetwork,
          allowSend: payload.consent.allowSend,
          consentUpdatedAt:
            payload.consent.allowNetwork !== undefined || payload.consent.allowSend !== undefined
              ? new Date().toISOString()
              : undefined,
        });
        return { success: true, data: toIAIConsent(row) };
      } catch (error) {
        return { success: false, message: 'Failed to save AI consent' };
      }
    }
  );

  // --- 写模式 get / set ---

  ipcMain.handle(IPC_CHANNELS.AI_GET_WRITE_MODE, (_event, userId: string) => {
    try {
      const row = getAiConfig(userId);
      const mode: WriteMode = row?.writeMode ?? 'manual';
      return { success: true, data: mode };
    } catch {
      return { success: false, message: 'Failed to get write mode' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AI_SET_WRITE_MODE,
    (_event, payload: { userId: string; mode: WriteMode }) => {
      try {
        if (!payload || !payload.userId || !payload.mode) {
          return { success: false, message: 'userId and mode required' };
        }
        if (payload.mode !== 'auto' && payload.mode !== 'manual') {
          return { success: false, message: 'mode must be auto or manual' };
        }
        upsertAiConfig(payload.userId, { writeMode: payload.mode });
        return { success: true, data: payload.mode };
      } catch {
        return { success: false, message: 'Failed to save write mode' };
      }
    }
  );
}
