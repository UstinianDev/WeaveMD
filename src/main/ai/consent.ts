// ============================================
// WeaveMD — AI 知情同意判定（纯函数，可单测）
// ============================================

import type { IAIConfig, IAIConsent } from '@shared/ai';

export type ConsentAction = 'chat';

/**
 * 判定某动作是否需要用户知情同意。
 *
 * 第2期只服务 Chat 开通：backend === 'remote' 且允许联网未开启 -> 需要同意。
 * 本地 Ollama 无网络外发，纯对话无需同意。
 * 第3期 Agent 工具/知识库外发再叠加 allowSend 判定（届时扩 consent 语义）。
 */
export function needsConsent(
  config: IAIConfig,
  consent: IAIConsent,
  _action: ConsentAction = 'chat'
): boolean {
  if (config.backend === 'remote' && !consent.allowNetwork) {
    return true;
  }
  return false;
}
