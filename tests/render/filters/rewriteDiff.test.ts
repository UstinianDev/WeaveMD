// ============================================
// WeaveMD — rewriteDiff 纯函数测试（TDD strict）
// ============================================
import { describe, expect, it } from 'vitest';
import { diffLines } from '@render/filters/rewriteDiff';

describe('diffLines 行级 LCS diff', () => {
  it('完全一致：全部 same，无 del/ins', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'same', line: 'a' },
      { type: 'same', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('纯删：仅改写后缺的原文行标记为 del', () => {
    const lines = diffLines('a\nb\nc', 'a\nc');
    expect(lines).toEqual([
      { type: 'same', line: 'a' },
      { type: 'del', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('纯增：仅改写后多的行标记为 ins', () => {
    const lines = diffLines('a\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'same', line: 'a' },
      { type: 'ins', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('混合：删行 + 增行组合（行级 LCS 公共子序列保留）', () => {
    const lines = diffLines('alpha\nbeta\ngamma\ndelta', 'alpha\ngamma\nomega\ndelta');
    // LCS 公共子序列: alpha, gamma, delta；beta 被删、omega 新增
    expect(lines).toEqual([
      { type: 'same', line: 'alpha' },
      { type: 'del', line: 'beta' },
      { type: 'same', line: 'gamma' },
      { type: 'ins', line: 'omega' },
      { type: 'same', line: 'delta' },
    ]);
  });

  it('空串原文：全部改写行为 ins', () => {
    const lines = diffLines('', 'x\ny');
    expect(lines).toEqual([
      { type: 'ins', line: 'x' },
      { type: 'ins', line: 'y' },
    ]);
  });

  it('空串改写结果：全部原文行为 del', () => {
    const lines = diffLines('x\ny', '');
    expect(lines).toEqual([
      { type: 'del', line: 'x' },
      { type: 'del', line: 'y' },
    ]);
  });

  it('两个均空串：空结果', () => {
    expect(diffLines('', '')).toEqual([]);
  });

  it('单行无换行且相同：single same', () => {
    expect(diffLines('hello', 'hello')).toEqual([{ type: 'same', line: 'hello' }]);
  });
});
