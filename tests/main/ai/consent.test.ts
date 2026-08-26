import { describe, expect, it } from 'vitest';
import { needsConsent } from '@shared/ai';
import type { IAIConsent } from '@shared/ai';

function makeConsent(allowNetwork: boolean, allowSend: boolean): IAIConsent {
  return { allowNetwork, allowSend, consentUpdatedAt: null };
}

describe('needsConsent（铁律二已移除，恒返回 false）', () => {
  it('未授权联网 -> false', () => {
    expect(needsConsent(makeConsent(false, false))).toBe(false);
    expect(needsConsent(makeConsent(false, true))).toBe(false);
  });

  it('已授权联网 -> false', () => {
    expect(needsConsent(makeConsent(true, false))).toBe(false);
    expect(needsConsent(makeConsent(true, true))).toBe(false);
  });

  it('consent 为 null -> false', () => {
    expect(needsConsent(null)).toBe(false);
  });
});
