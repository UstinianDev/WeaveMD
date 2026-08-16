// ============================================
// WeaveMD — AI 知情同意判定（纯函数，可单测）
// ============================================

import type { IAIConsent } from '@shared/ai';

export type ConsentAction = 'chat' | 'agent';

/**
 * 判定某动作是否需要用户知情同意（联网闸）。后端恒 remote（ollama 已去除），
 * 因此联网即外发。
 *
 * - chat/agent：均按 **联网闸** `!allowNetwork` 判定——未授权联网 → 需要同意。
 *   KB 检索外发给笔记再加一层 allowSend（`needsKbSendConsent`）；
 *   allowSend 不在本函数内判定，由 agentLoop 注入 searchKB 工具时把关。
 */
export function needsConsent(
  _config: unknown,
  consent: IAIConsent,
  _action: ConsentAction = 'chat'
): boolean {
  return !consent.allowNetwork;
}

/**
 * KB 检索外发闸（笔记内容外发给远端模型）：
 * 已授权联网但未授权外发（allowSend）-> 需同意。
 * 供 agentLoop 在注入 searchKB 工具前把关：allowSend 未授权则不提供工具。
 */
export function needsKbSendConsent(_config: unknown, consent: IAIConsent): boolean {
  return !consent.allowSend;
}
