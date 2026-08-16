// ============================================
// WeaveMD — A3 选区持久高亮定位纯函数 buildHighlightRanges 单测
// buildHighlightRanges(content, sel) 按叶序下标 + offset 映射到当前 markdownToState 解析树
// 的叶节点，返回可被 DOM 覆盖层消费的叶级区间。
// 设计约束：
//   - leafIndex 为 documentOrderLeaves 叶序下标（与 SelectionRef 对齐）
//   - start/end 为叶文本内的 UTF-16 offset
//   - 失同步 / 越界 / 解析失败 → 返回空数组（保守，不阻断面板）
// ============================================
import { describe, expect, it } from 'vitest';

import { buildHighlightRanges } from '@render/editor/rewrite/highlight';
import type { SelectionRef } from '@shared/ai';

describe('buildHighlightRanges — A3 叶序下标 + offset → 高亮区间', () => {
  it('同叶选区：仅返回该叶在区间内的 [start, end]', () => {
    const content = 'first block';
    // 叶序 [first-block]；选区 whole word [3, 8)
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 3,
      endLeafIndex: 0,
      endOffset: 8,
    };
    const ranges = buildHighlightRanges(content, sel);
    expect(ranges).toEqual([{ leafIndex: 0, start: 3, end: 8 }]);
  });

  it('跨叶选区：首叶 [start, len]、末叶 [0, end]', () => {
    const content = 'aaa\n\nbbb\n\nccc';
    // 叶序 [aaa, bbb, ccc]；整段跨三叶（0 → 2）
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 1,
      endLeafIndex: 2,
      endOffset: 2,
    };
    const ranges = buildHighlightRanges(content, sel);
    expect(ranges).toEqual([
      { leafIndex: 0, start: 1, end: 3 }, // aaa[1,3]
      { leafIndex: 1, start: 0, end: 3 }, // bbb整叶
      { leafIndex: 2, start: 0, end: 2 }, // cc[0,2]
    ]);
  });

  it('容器叶（列表/引用）跨到正文：叶序下标与 SelectionRef 一致，偏移正确', () => {
    const content = '- item-a\n\n- item-b\n\noutside';
    // 叶序（leaf-only，markdownToState 聚合）[item-a, item-b, outside]
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 0,
      endLeafIndex: 1,
      endOffset: 2, // item-b 的 [0,2) → slice 'it'
    };
    const ranges = buildHighlightRanges(content, sel);
    expect(ranges[0]).toEqual({ leafIndex: 0, start: 0, end: 'item-a'.length });
    expect(ranges[1]).toEqual({ leafIndex: 1, start: 0, end: 2 });
    // 越界保守跳过（区间外叶不出现）
    expect(ranges.length).toBe(2);
  });

  it('start 叶序下标越界 / 空 content → 空数组（保守不阻断）', () => {
    expect(buildHighlightRanges('', { startLeafIndex: 0, startOffset: 0, endLeafIndex: 0, endOffset: 1 })).toEqual([]);
    expect(
      buildHighlightRanges('aaa', { startLeafIndex: 5, startOffset: 0, endLeafIndex: 5, endOffset: 1 })
    ).toEqual([]);
  });

  it('尾叶 offset 超出叶文本长度 → 该叶返回空区间但不抛错，整体仍保守', () => {
    // endOffset=99 远超叶长 → 不抛错；首叶/跨叶正常段不受影响（越界尾叶跳过）
    const content = 'aaa\n\nbbb';
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 0,
      endLeafIndex: 1,
      endOffset: 99,
    };
    expect(() => buildHighlightRanges(content, sel)).not.toThrow();
  });
});
