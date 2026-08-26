// AI 配置与同意类型

export type ChatBackend = 'remote';

/** 写操作模式：auto 自动应用 / manual 需用户确认（覆盖 editBlocks / createFile / createFolder）。 */
export type WriteMode = 'auto' | 'manual';

export interface IAIConfig {
  backend: ChatBackend;
  remoteBaseUrl: string;
  model: string;
  /** 是否已配置 API key（仅布尔标记，绝不含 key 明文） */
  hasApiKey: boolean;
  /** 当前激活的模型配置 ID（多模型配置支持）。 */
  activeModelConfigId?: string;
}

export interface IAIConsent {
  allowNetwork: boolean;
  allowSend: boolean;
  consentUpdatedAt: string | null;
}

/**
 * 知情同意判定 — 恒返回 false（铁律二已移除：联网/外发不再需要用户同意）。
 * 保留函数签名供下游 import 不报错。
 */
export function needsConsent(_consent: IAIConsent | null): boolean {
  return false;
}

/** setConfig 单次更新载荷。 */
export interface AiConfigUpdate {
  backend?: ChatBackend;
  remoteBaseUrl?: string;
  model?: string;
  apiKey?: string;
}
