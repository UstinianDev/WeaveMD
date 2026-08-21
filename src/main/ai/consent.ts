// ============================================
// WeaveMD — AI 知情同意判定（纯函数，可单测）
// ============================================
// needsConsent 统一从 @shared/ai 导入（主进程/渲染进程共用同一实现）。
// needsKbSendConsent 保留本模块（仅 agentLoop 使用）。

import type { IAIConsent } from '@shared/ai';
export { needsConsent } from '@shared/ai';

/**
 * KB 检索外发闸（笔记内容外发给远端模型）：
 * 已授权联网但未授权外发（allowSend）-> 需同意。
 * 供 agentLoop 在注入 searchKB 工具前把关：allowSend 未授权则不提供工具。
 */
export function needsKbSendConsent(_config: unknown, consent: IAIConsent): boolean {
  return !consent.allowSend;
}
