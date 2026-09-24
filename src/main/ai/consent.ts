import type { IAIConsent } from '@shared/ai';

export { needsConsent } from '@shared/ai';

/**
 * 笔记内容外发闸（铁律二现存部分）：
 * 未授权外发（allowSend）-> 需同意。
 * 联网同意闸 needsConsent 已停用（见 @shared/ai）。
 */
export function needsKbSendConsent(_config: unknown, consent: IAIConsent): boolean {
  return !consent.allowSend;
}
