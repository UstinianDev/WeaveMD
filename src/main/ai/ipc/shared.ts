// ============================================
// IPC Handler 共享工具（内部模块）
// ============================================
// toIAIConfig / toIAIConsent / activeStreams / sendStream —— 供各域 handler 共用。

import { BrowserWindow } from 'electron';
import type { ChatBackend, IAIConfig, IAIConsent, ModelProtocol, WriteMode } from '@shared/ai';

export function toIAIConfig(config: {
  backend: ChatBackend;
  remoteBaseUrl: string;
  model: string;
  apiKeyEnc: string | null;
  protocol?: ModelProtocol;
  activeModelConfigId?: string | null;
  /** remedial D8：vision 覆盖三态（null=自动判定，映射为不下发） */
  visionOverride?: boolean | null;
  /** 写模式（任务 13）：行缺省不下发（旧库/测试行），消费点按 auto 处理 */
  writeMode?: WriteMode | null;
}): IAIConfig {
  return {
    // 后端恒 remote（ollama 已去除，收敛标识）
    backend: 'remote',
    // 旧库无 protocol 列时兜底 openai，避免误走 anthropic 路径
    protocol: config.protocol ?? 'openai',
    remoteBaseUrl: config.remoteBaseUrl,
    model: config.model,
    hasApiKey: !!config.apiKeyEnc,
    ...(config.activeModelConfigId ? { activeModelConfigId: config.activeModelConfigId } : {}),
    ...(config.visionOverride != null ? { visionOverride: config.visionOverride } : {}),
    // 任务 13：writeMode 透传（缺省不下发 → 消费点按 auto = P0 现行为）
    ...(config.writeMode != null ? { writeMode: config.writeMode } : {}),
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
  protocol: 'openai',
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
