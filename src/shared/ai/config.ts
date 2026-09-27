// AI 配置与同意类型

import type { ModelProtocol } from './model';

export type ChatBackend = 'remote';

/** 写操作模式：auto 自动应用 / manual 需用户确认（覆盖 editBlocks / createFile / createFolder）。 */
export type WriteMode = 'auto' | 'manual';

export interface IAIConfig {
  backend: ChatBackend;
  /** LLM 协议：openai 走 /v1/chat/completions，anthropic 走 /v1/messages。
   *  缺省（旧数据/未配置）按 openai 处理。 */
  protocol?: ModelProtocol;
  remoteBaseUrl: string;
  model: string;
  /** 是否已配置 API key（仅布尔标记，绝不含 key 明文） */
  hasApiKey: boolean;
  /** 当前激活的模型配置 ID（多模型配置支持）。 */
  activeModelConfigId?: string;
  /**
   * remedial Bug B —— vision 能力用户覆盖（ai_config.vision_override 三态）：
   * true=强制支持图片理解 / false=强制不支持 / 缺省（undefined）=自动判定
   * （已知能力表 → 未知模型乐观注入）。注入与识别两链路统一经
   * resolveVisionSupport 消费。
   */
  visionOverride?: boolean;
}

export interface IAIConsent {
  allowNetwork: boolean;
  allowSend: boolean;
  consentUpdatedAt: string | null;
}

/**
 * 联网同意闸（已停用）。
 * 后端恒 remote，且 Agent 解锁要求 LLM/Embedding/搜索三配置齐全（`isConfigured`），
 * 配置行为本身已表达联网意愿，再弹一次联网同意属重复确认 —— 故恒返回 false。
 * 笔记内容外发（allowSend）仍由 needsKbSendConsent 单独把关，不在此闸。
 * 保留签名与导出，供既有 4 个主进程调用点与 agentStore re-export 兼容。
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
