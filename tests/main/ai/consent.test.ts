import { describe, expect, it } from 'vitest';
import { needsConsent, needsKbSendConsent } from '@main/ai/consent';
import type { IAIConfig, IAIConsent } from '@shared/ai';

function makeConfig(backend: IAIConfig['backend']): IAIConfig {
  return {
    backend,
    ollamaBaseUrl: 'http://localhost:11434',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: '',
    hasApiKey: false,
  };
}

function makeConsent(allowNetwork: boolean, allowSend: boolean): IAIConsent {
  return { allowNetwork, allowSend, consentUpdatedAt: null };
}

describe('needsConsent', () => {
  it('returns true when remote backend and network not consented', () => {
    expect(needsConsent(makeConfig('remote'), makeConsent(false, false), 'chat')).toBe(true);
    expect(needsConsent(makeConfig('remote'), makeConsent(false, true), 'chat')).toBe(true);
  });

  it('returns false when remote backend and network already consented', () => {
    expect(needsConsent(makeConfig('remote'), makeConsent(true, false), 'chat')).toBe(false);
    expect(needsConsent(makeConfig('remote'), makeConsent(true, true), 'chat')).toBe(false);
  });

  it('returns false for local ollama chat', () => {
    expect(needsConsent(makeConfig('ollama'), makeConsent(false, false), 'chat')).toBe(false);
    expect(needsConsent(makeConfig('ollama'), makeConsent(true, true), 'chat')).toBe(false);
  });

  describe('agent', () => {
    // 分层语义：needsConsent('agent') 只判联网闸（remote && !allowNetwork）。
    it('requires allowNetwork for remote agent (network gate)', () => {
      expect(needsConsent(makeConfig('remote'), makeConsent(false, false), 'agent')).toBe(true);
      expect(needsConsent(makeConfig('remote'), makeConsent(false, true), 'agent')).toBe(true);
    });

    it('network gate passes when allowNetwork granted even without allowSend', () => {
      // remote 已允许联网但未允许外发（allowSend）-> 联网闸通过（false）
      // allowSend 由 needsKbSendConsent 单独把关，不再混入本函数。
      expect(needsConsent(makeConfig('remote'), makeConsent(true, false), 'agent')).toBe(false);
    });

    it('returns false for remote agent with both network and send consented', () => {
      expect(needsConsent(makeConfig('remote'), makeConsent(true, true), 'agent')).toBe(false);
    });

    it('returns false for local ollama agent (pure generation, no egress)', () => {
      // ollama 本地 agent 降级纯生成、无外发，不要求 allowNetwork/allowSend
      expect(needsConsent(makeConfig('ollama'), makeConsent(false, false), 'agent')).toBe(false);
      expect(needsConsent(makeConfig('ollama'), makeConsent(true, false), 'agent')).toBe(false);
    });
  });
});

describe('needsKbSendConsent', () => {
  it('remote backend without allowSend -> true (KB egress needs consent)', () => {
    expect(needsKbSendConsent(makeConfig('remote'), makeConsent(true, false))).toBe(true);
    expect(needsKbSendConsent(makeConfig('remote'), makeConsent(false, false))).toBe(true);
  });

  it('remote backend with allowSend granted -> false', () => {
    expect(needsKbSendConsent(makeConfig('remote'), makeConsent(true, true))).toBe(false);
  });

  it('ollama local (no egress) -> false regardless of allowSend', () => {
    expect(needsKbSendConsent(makeConfig('ollama'), makeConsent(true, false))).toBe(false);
    expect(needsKbSendConsent(makeConfig('ollama'), makeConsent(false, false))).toBe(false);
  });
});
