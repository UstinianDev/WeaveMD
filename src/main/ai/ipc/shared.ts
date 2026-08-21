// ============================================
// IPC Handler 共享工具（内部模块）
// ============================================
// toIAIConfig / toIAIConsent / activeStreams / sendStream —— 供各域 handler 共用。

import { BrowserWindow } from 'electron';
import type { ChatBackend, IAIConfig, IAIConsent } from '@shared/ai';

export function toIAIConfig(config: {
  backend: ChatBackend;
  remoteBaseUrl: string;
  model: string;
  apiKeyEnc: string | null;
}): IAIConfig {
  return {
    // 后端恒 remote（ollama 已去除，收敛标识）
    backend: 'remote',
    remoteBaseUrl: config.remoteBaseUrl,
    model: config.model,
    hasApiKey: !!config.apiKeyEnc,
  };
}

export function toIAIConsent(config: {
  allowNetwork: boolean;
  allowSend: boolean;
  consentUpdatedAt: string | null;
}): IAIConsent {
  return {
    allowNetwork: config.allowNetwork,
    allowSend: config.allowSend,
    consentUpdatedAt: config.consentUpdatedAt,
  };
}

/** 活动流：conversationId -> AbortController（chat/agent 共用）。 */
export const activeStreams = new Map<string, AbortController>();

export function sendStream(
  event: Electron.IpcMainInvokeEvent,
  channel: string,
  payload: unknown
): void {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.webContents.send(channel, payload);
}

/** 默认 AI 配置（无 DB 行时的兜底值）。 */
export const DEFAULT_AI_CONFIG: IAIConfig = {
  backend: 'remote',
  remoteBaseUrl: 'https://api.deepseek.com',
  model: '',
  hasApiKey: false,
};

/** 默认同意状态（无 DB 行时的兜底值）。 */
export const DEFAULT_CONSENT: IAIConsent = {
  allowNetwork: false,
  allowSend: false,
  consentUpdatedAt: null,
};
