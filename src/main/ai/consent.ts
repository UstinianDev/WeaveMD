// ============================================
// WeaveMD — AI 知情同意判定（纯函数，可单测）
// ============================================

import type { IAIConfig, IAIConsent } from '@shared/ai';

export type ConsentAction = 'chat' | 'agent';

/**
 * 判定某动作是否需要用户知情同意（联网闸）。分层语义：
 *
 * - chat（第2期现状）：backend === 'remote' 且允许联网未开启 -> 需要同意。
 *   本地 Ollama 无网络外发，纯对话无需同意。
 * - agent（第4期）：仅**联网闸** `remote && !allowNetwork`。
 *   KB 检索外发给笔记再加一层 allowSend（`needsKbSendConsent`）；
 *   allowSend 不在本函数内判定，由 agentLoop 注入 searchKB 工具时把关。
 */
export function needsConsent(
  config: IAIConfig,
  consent: IAIConsent,
  action: ConsentAction = 'chat'
): boolean {
  if (action === 'agent') {
    // remote Agent 必须允许联网；ollama 本地 agent（降级纯生成）无外发，不要求。
    return config.backend === 'remote' && !consent.allowNetwork;
  }
  // chat（向后兼容现状）
  if (config.backend === 'remote' && !consent.allowNetwork) {
    return true;
  }
  return false;
}

/**
 * KB 检索外发闸（笔记内容外发给远端模型）：
 * remote 后端已授权联网但未授权外发（allowSend）-> 需同意。
 * ollama 本地 agent（纯生成、无 KB 外发）-> false。
 * 供 agentLoop 在注入 searchKB 工具前把关：allowSend 未授权则不提供工具。
 */
export function needsKbSendConsent(config: IAIConfig, consent: IAIConsent): boolean {
  return config.backend === 'remote' && !consent.allowSend;
}
