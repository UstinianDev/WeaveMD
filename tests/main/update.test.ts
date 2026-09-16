// ============================================
// WeaveMD — Auto-Updater: isLatestVersion() Unit Tests
// ============================================

import { describe, it, expect } from 'vitest';
import { isLatestVersion } from '../../src/main/update';

describe('isLatestVersion — version comparison guard', () => {
  it('returns true when installed equals latest', () => {
    expect(isLatestVersion('2.0.6', '2.0.6')).toBe(true);
  });

  it('returns false when installed is older than latest', () => {
    expect(isLatestVersion('2.0.4', '2.0.6')).toBe(false);
  });

  it('returns true when latest is null (no GitHub release)', () => {
    expect(isLatestVersion('2.0.1', null)).toBe(true);
  });

  it('returns true when latest is undefined', () => {
    expect(isLatestVersion('2.0.1', undefined)).toBe(true);
  });

  it('handles prerelease versions', () => {
    expect(isLatestVersion('2.0.6-beta.1', '2.0.6-beta.1')).toBe(true);
    expect(isLatestVersion('2.0.6-beta.1', '2.0.6')).toBe(false);
  });

  it('handles major.minor.patch format', () => {
    expect(isLatestVersion('1.3.1', '2.0.0')).toBe(false);
    expect(isLatestVersion('2.0.0', '2.0.0')).toBe(true);
  });
});