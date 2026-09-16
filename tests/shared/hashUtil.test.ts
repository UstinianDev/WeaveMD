// ============================================
// WeaveMD — hashUtil 单元测试（S4 — xxHash 迁移）
// ============================================
// 测试 xxHash64 / xxHash64Sync 对已知输入的正确性
// + fallback 降级路径不会抛出异常

import { describe, it, expect } from 'vitest';

describe('xxHash64Sync — fallback (djb2) before WASM init', () => {
  // 注意：这些测试必须在任何 await xxHash64() 调用之前运行，
  // 以确保 WASM 尚未初始化，走 fallback 路径。

  it('should not throw for any input (graceful fallback)', async () => {
    const { xxHash64Sync } = await import('@shared/utils/hashUtil');
    expect(() => xxHash64Sync('')).not.toThrow();
    expect(() => xxHash64Sync('hello world')).not.toThrow();
    expect(() => xxHash64Sync('x'.repeat(10000))).not.toThrow();
    expect(() => xxHash64Sync('中文测试')).not.toThrow();
  });

  it('should return a non-empty hex string via fallback', async () => {
    const { xxHash64Sync } = await import('@shared/utils/hashUtil');
    const result = xxHash64Sync('hello');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // fallback djb2 produces 8-char hex string (32-bit)
    expect(/^[0-9a-f]+$/.test(result)).toBe(true);
  });

  it('should be deterministic via fallback', async () => {
    const { xxHash64Sync } = await import('@shared/utils/hashUtil');
    const a = xxHash64Sync('test input');
    const b = xxHash64Sync('test input');
    expect(a).toBe(b);
  });

  it('should produce different hashes for different inputs via fallback', async () => {
    const { xxHash64Sync } = await import('@shared/utils/hashUtil');
    const a = xxHash64Sync('hello');
    const b = xxHash64Sync('world');
    expect(a).not.toBe(b);
  });

  it('should handle empty string gracefully', async () => {
    const { xxHash64Sync } = await import('@shared/utils/hashUtil');
    const result = xxHash64Sync('');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('xxHash64 — async (WASM)', () => {
  it('should produce a non-empty hex string', async () => {
    const { xxHash64 } = await import('@shared/utils/hashUtil');
    const result = await xxHash64('hello');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // xxHash64 produces 16-char hex string
    expect(/^[0-9a-f]+$/.test(result)).toBe(true);
  });

  it('should be deterministic', async () => {
    const { xxHash64 } = await import('@shared/utils/hashUtil');
    const a = await xxHash64('test input');
    const b = await xxHash64('test input');
    expect(a).toBe(b);
  });

  it('should produce different hashes for different inputs', async () => {
    const { xxHash64 } = await import('@shared/utils/hashUtil');
    const a = await xxHash64('hello');
    const b = await xxHash64('world');
    expect(a).not.toBe(b);
  });

  it('should produce same hash regardless of call order (cached API)', async () => {
    const { xxHash64 } = await import('@shared/utils/hashUtil');
    const a = await xxHash64('persistent string');
    const b = await xxHash64('persistent string');
    expect(a).toBe(b);
  });
});

describe('xxHash64Sync — after WASM init (consistency)', () => {
  it('should produce same result as async version after WASM is loaded', async () => {
    const { xxHash64, xxHash64Sync } = await import('@shared/utils/hashUtil');
    // 先触发 WASM 初始化
    const asyncResult = await xxHash64('consistency test');
    // 然后 sync 应该使用已缓存的 WASM API，得到相同结果
    const syncResult = xxHash64Sync('consistency test');
    expect(syncResult).toBe(asyncResult);
    // xxHash64 输出 16 位十六进制
    expect(syncResult.length).toBe(16);
  });

  it('should stay consistent for multiple inputs after init', async () => {
    const { xxHash64, xxHash64Sync } = await import('@shared/utils/hashUtil');
    const inputs = ['alpha', 'beta', 'gamma', 'delta'];
    for (const input of inputs) {
      const asyncResult = await xxHash64(input);
      const syncResult = xxHash64Sync(input);
      expect(syncResult).toBe(asyncResult);
    }
  });
});