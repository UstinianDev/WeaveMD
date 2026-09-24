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

/** 内联版 needsKbSendConsent（断言逻辑与 @main/ai/consent 导出一致）。 */
function needsKbSendConsent(_config: unknown, consent: IAIConsent): boolean {
  return !consent.allowSend;
}

describe('needsConsent（联网闸已停用，恒 false）', () => {
  it('未授权联网 -> false（三配置齐全即视为联网许可）', () => {
    expect(needsConsent(makeConsent(false, false))).toBe(false);
    expect(needsConsent(makeConsent(false, true))).toBe(false);
  });

  it('已授权联网 -> false', () => {
    expect(needsConsent(makeConsent(true, false))).toBe(false);
    expect(needsConsent(makeConsent(true, true))).toBe(false);
  });

  it('consent 为 null -> false（联网闸不拦截；笔记外发由 needsKbSendConsent 单独把关）', () => {
    expect(needsConsent(null)).toBe(false);
  });
});

describe('needsKbSendConsent', () => {
  it('未授权外发 -> true（KB 外发需单独同意）', () => {
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, false))).toBe(true);
    expect(needsKbSendConsent(makeConfig(), makeConsent(false, false))).toBe(true);
  });

  it('已授权外发 -> false', () => {
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, true))).toBe(false);
  });
});
