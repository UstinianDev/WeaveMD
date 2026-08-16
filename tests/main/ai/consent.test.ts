import { describe, expect, it } from 'vitest';
import { needsConsent, needsKbSendConsent } from '@main/ai/consent';
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

describe('needsConsent', () => {
  it('returns true when network not consented', () => {
    expect(needsConsent(makeConfig(), makeConsent(false, false), 'chat')).toBe(true);
    expect(needsConsent(makeConfig(), makeConsent(false, true), 'chat')).toBe(true);
  });

  it('returns false when network already consented', () => {
    expect(needsConsent(makeConfig(), makeConsent(true, false), 'chat')).toBe(false);
    expect(needsConsent(makeConfig(), makeConsent(true, true), 'chat')).toBe(false);
  });

  describe('agent', () => {
    // 分层语义：needsConsent('agent') 只判联网闸（!allowNetwork —— 已恒 remote）。
    it('requires allowNetwork for agent (network gate)', () => {
      expect(needsConsent(makeConfig(), makeConsent(false, false), 'agent')).toBe(true);
      expect(needsConsent(makeConfig(), makeConsent(false, true), 'agent')).toBe(true);
    });

    it('network gate passes when allowNetwork granted even without allowSend', () => {
      // 已允许联网但未允许外发（allowSend）-> 联网闸通过（false）
      // allowSend 由 needsKbSendConsent 单独把关，不再混入本函数。
      expect(needsConsent(makeConfig(), makeConsent(true, false), 'agent')).toBe(false);
    });

    it('returns false for agent with both network and send consented', () => {
      expect(needsConsent(makeConfig(), makeConsent(true, true), 'agent')).toBe(false);
    });
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
