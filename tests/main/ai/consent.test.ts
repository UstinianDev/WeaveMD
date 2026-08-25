import { describe, expect, it } from 'vitest';
import { needsConsent } from '@shared/ai';
import type { IAIConfig, IAIConsent } from '@shared/ai';

function makeConfig(): IAIConfig {
  return {
    backend: 'remote',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: '',
    hasApiKey: false,
  };
}

function makeConsent(allowNetwork: boolean, allowSend: boolean): IAIConsent {
  return { allowNetwork, allowSend, consentUpdatedAt: null };
}

/** 内联版 needsKbSendConsent（原 consent.ts 已删除，逻辑内联到 agentLoop.ts）。 */
function needsKbSendConsent(_config: unknown, consent: IAIConsent): boolean {
  return !consent.allowSend;
}

describe('needsConsent（统一版，从 @shared/ai 导入）', () => {
  it('returns true when network not consented', () => {
    expect(needsConsent(makeConsent(false, false))).toBe(true);
    expect(needsConsent(makeConsent(false, true))).toBe(true);
  });

  it('returns false when network already consented', () => {
    expect(needsConsent(makeConsent(true, false))).toBe(false);
    expect(needsConsent(makeConsent(true, true))).toBe(false);
  });

  it('consent 为 null -> true（需配置后再同意）', () => {
    expect(needsConsent(null)).toBe(true);
  });
});

describe('needsKbSendConsent', () => {
  it('without allowSend -> true (KB egress needs consent)', () => {
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, false))).toBe(true);
    expect(needsKbSendConsent(makeConfig(), makeConsent(false, false))).toBe(true);
  });

  it('with allowSend granted -> false', () => {
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, true))).toBe(false);
  });
});
