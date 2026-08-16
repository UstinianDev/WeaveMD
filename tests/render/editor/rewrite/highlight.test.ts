// ============================================
// WeaveMD — 选区整块渐变高亮定位纯函数 buildHighlightRanges 单测（M5）
// buildHighlightRanges(content, sel) 按叶序下标映射到当前 markdownToState 解析树
// 的叶节点，**整块（start:0 / end:叶长）** 返回叶级范围，供 EditorV2 纯 CSS overlay 消费。
// 设计约束：
//   - leafIndex 为 documentOrderLeaves 叶序下标（与 SelectionRef 对齐）
//   - 选区覆盖的每个叶都必须整块高亮（任何块类型一视同仁、跨块各块均整块）
//   - start/end 不再取选区 offset，固定整块 [0, len]
//   - 失同步 / 越界 / 解析失败 / 空 content → 返回空数组（保守，不阻断面板）
//   - 空文本叶、offset 越界/负数 → 不抛错，整块或保守空
// ============================================
import { describe, expect, it } from 'vitest';

import { buildHighlightRanges } from '@render/editor/rewrite/highlight';
import type { SelectionRef } from '@shared/ai';

describe('buildHighlightRanges — M5 选区覆盖块整块高亮 [0, len]', () => {
  it('同叶选区（部分选中）：整块 [leafIndex: 0, start: 0, end: 叶长]（不再 [3,8] 子串）', () => {
    const content = 'first block';
    // 叶序 [first-block]；选区 [3, 8) —— 现应整块而非子串
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 3,
      endLeafIndex: 0,
      endOffset: 8,
    };
    const ranges = buildHighlightRanges(content, sel);
    expect(ranges).toEqual([{ leafIndex: 0, start: 0, end: 'first block'.length }]);
  });

  it('跨叶选区：每叶整块 [0, len]，与前 offset 无关', () => {
    const content = 'aaa\n\nbbb\n\nccc';
    // 叶序 [aaa, bbb, ccc]；整段跨三叶（0 → 2），offset [1,2] 应被忽略
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 1,
      endLeafIndex: 2,
      endOffset: 2,
    };
    const ranges = buildHighlightRanges(content, sel);
    expect(ranges).toEqual([
      { leafIndex: 0, start: 0, end: 3 }, // aaa 整块
      { leafIndex: 1, start: 0, end: 3 }, // bbb 整块
      { leafIndex: 2, start: 0, end: 3 }, // ccc 整块
    ]);
  });

  it('容器叶（列表/引用）跨到正文：各叶整块 [0, len]', () => {
    const content = '- item-a\n\n- item-b\n\noutside';
    // 叶序（leaf-only，markdownToState 聚合）[item-a, item-b, outside]
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 0,
      endLeafIndex: 1,
      endOffset: 2, // item-b 的 [0,2) —— 现整块
    };
    const ranges = buildHighlightRanges(content, sel);
    expect(ranges).toEqual([
      { leafIndex: 0, start: 0, end: 'item-a'.length },
      { leafIndex: 1, start: 0, end: 'item-b'.length },
    ]);
  });

  it('start 叶序下标越界 / 空 content → 空数组（保守不阻断）', () => {
    expect(buildHighlightRanges('', { startLeafIndex: 0, startOffset: 0, endLeafIndex: 0, endOffset: 1 })).toEqual([]);
    expect(
      buildHighlightRanges('aaa', { startLeafIndex: 5, startOffset: 0, endLeafIndex: 5, endOffset: 1 })
    ).toEqual([]);
  });

  it('start>end 下标 / 叶序非数 / 负数 → 空数组（保守）', () => {
    expect(
      buildHighlightRanges('aaa', { startLeafIndex: 1, startOffset: 0, endLeafIndex: 0, endOffset: 1 } as SelectionRef)
    ).toEqual([]);
    expect(
      buildHighlightRanges('aaa', { startLeafIndex: -1, startOffset: 0, endLeafIndex: 0, endOffset: 1 } as SelectionRef)
    ).toEqual([]);
  });

  it('endOffset 超长 / 负数不抛错，且该叶仍整块或整体保守空（fold-safe）', () => {
    // endOffset=99 远超叶长、startOffset 负数 → 不抛错；被覆盖叶仍整块
    const content = 'aaa\n\nbbb';
    const sel: SelectionRef = {
      startLeafIndex: 0,
      startOffset: 0,
      endLeafIndex: 1,
      endOffset: 99,
    };
    expect(() => buildHighlightRanges(content, sel)).not.toThrow();
    const ranges = buildHighlightRanges(content, sel);
    expect(ranges).toEqual([
      { leafIndex: 0, start: 0, end: 3 },
      { leafIndex: 1, start: 0, end: 3 },
    ]);
    // 负数 offset 同保守
    expect(() =>
      buildHighlightRanges('aaa', {
        startLeafIndex: 0,
        startOffset: -5,
        endLeafIndex: 0,
        endOffset: -1,
      } as SelectionRef)
    ).not.toThrow();
  });

  it('空 text / 空 content → 空数组（无内容无从高亮，保守不阻断）', () => {
    // 空 content 无叶可高亮 → 保守空
    expect(buildHighlightRanges('', { startLeafIndex: 0, startOffset: 0, endLeafIndex: 0, endOffset: 0 })).toEqual([]);
    // 仅空行/空白 → markdownToState 无叶子（或空文本叶 len=0）→ 保守空
    expect(buildHighlightRanges('   \n\n   ', { startLeafIndex: 0, startOffset: 0, endLeafIndex: 0, endOffset: 1 })).toEqual(
      []
    );
  });
});
