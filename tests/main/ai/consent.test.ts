import { describe, expect, it } from 'vitest';
import { needsConsent } from '@main/ai/consent';
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
});
