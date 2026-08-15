// ============================================
// WeaveMD — rewrite/blockEdit 测试（批次 3 / C 渲染侧）
// 覆盖：proposeSelectionRewrite（仅替换选区叶子区间、区间外字节不变、首尾 offset 截取、
// 多块选区、unchanged）;proposeDocumentRewrite（合法映射/越界/JSON 解析失败 locateFailed、
// unchanged）;buildNumberedBlockList。
// 注意：连续行聚合为单个段落叶，多段内容须用空行分隔（'a\n\nb' → 两叶）。
// ============================================
import { describe, expect, it } from 'vitest';
import type { RewriteBlockRef } from '@shared/ai';
import type { SelectionRef } from '@shared/ai';
import {
  buildNumberedBlockList,
  proposeDocumentRewrite,
  proposeSelectionRewrite,
} from '@render/editor/rewrite/blockEdit';

describe('buildNumberedBlockList — 文档序叶子编号', () => {
  it('按文档序对叶子块编号，markdown 为该叶序列化', () => {
    const list = buildNumberedBlockList('foo\n\nbar');
    expect(list).toHaveLength(2);
    expect(list[0].blockIndex).toBe(0);
    expect(list[0].markdown).toBe('foo');
    expect(list[1].blockIndex).toBe(1);
    expect(list[1].markdown).toBe('bar');
    for (const ref of list) {
      expect(typeof ref.blockId).toBe('string');
      expect(ref.blockId.length).toBeGreaterThan(0);
    }
  });
});

describe('proposeSelectionRewrite — 选区叶子区间替换', () => {
  it('单叶选区：首叶前段 + 新块 + 尾叶后段（区间外字节不变）', () => {
    // content 单叶 'abcdef'，选区 'cde'，改写为 'XY'
    const sel: SelectionRef = { startLeafIndex: 0, startOffset: 2, endLeafIndex: 0, endOffset: 5 };
    const p = proposeSelectionRewrite('abcdef', sel, 'XY');
    // 前段 'ab' + 新块 'XY' + 后段 'f'（后缀并入最后一个新块）
    expect(p.rewrittenMd).toBe('ab\n\nXYf');
    expect(p.unchanged).toBe(false);
    expect(p.ops.length).toBeGreaterThan(0);
  });

  it('跨块选区：仅替换选区内叶子区间，区间外字节不变', () => {
    // 三叶：foo/bar/baz（空行分隔）
    const CONTENT = 'foo\n\nbar\n\nbaz';
    const sel: SelectionRef = { startLeafIndex: 0, startOffset: 1, endLeafIndex: 2, endOffset: 1 };
    // 首叶 'foo' 保 0..1='f'，尾叶 'baz' 保 1..='az'，中间 'bar' 整块被回复替换为 'X'
    const p = proposeSelectionRewrite(CONTENT, sel, 'X');
    expect(p.rewrittenMd).toBe('f\n\nX\n\naz');
    expect(p.unchanged).toBe(false);
  });

  it('跨块选区中间叶可替换为多块', () => {
    const CONTENT = 'foo\n\nbar\n\nbaz';
    const sel: SelectionRef = { startLeafIndex: 0, startOffset: 1, endLeafIndex: 2, endOffset: 1 };
    const p = proposeSelectionRewrite(CONTENT, sel, 'X\n\nY');
    expect(p.rewrittenMd).toBe('f\n\nX\n\nY\n\naz');
  });

  it('改写结果与原文一致 → unchanged:true 且 ops 为空', () => {
    // 选择 'foo' 整块替换为 'foo'（选区内内容不变）
    const sel: SelectionRef = { startLeafIndex: 0, startOffset: 0, endLeafIndex: 0, endOffset: 3 };
    const p = proposeSelectionRewrite('foo\n\nbar', sel, 'foo');
    expect(p.unchanged).toBe(true);
    expect(p.ops).toEqual([]);
    expect(p.rewrittenMd).toBe('foo\n\nbar');
  });

  it('选区端点下标越界 → 保守不抛，拒绝改动', () => {
    const sel: SelectionRef = { startLeafIndex: 999, startOffset: 0, endLeafIndex: 1000, endOffset: 0 };
    const p = proposeSelectionRewrite('foo', sel, 'X');
    expect(p.rewrittenMd).toBe('foo');
    expect(p.unchanged).toBe(true);
  });
});

describe('proposeDocumentRewrite — 编号块 JSON 协议', () => {
  const CONTENT = 'alpha\n\nbeta\n\ngamma';
  const numbered: RewriteBlockRef[] = [
    { blockIndex: 0, blockId: 'ignored-a', markdown: 'alpha' },
    { blockIndex: 1, blockId: 'ignored-b', markdown: 'beta' },
    { blockIndex: 2, blockId: 'ignored-c', markdown: 'gamma' },
  ];

  it('合法映射：按 block_index 只改对应块，其余块字节不变', () => {
    const json = JSON.stringify([
      { block_index: 1, new_content: 'BETA' },
      { block_index: 2, new_content: 'GAMMA2' },
    ]);
    const p = proposeDocumentRewrite(CONTENT, numbered, json);
    expect(p.locateFailed).toBeUndefined();
    expect(p.rewrittenMd).toBe('alpha\n\nBETA\n\nGAMMA2');
    expect(p.ops).toHaveLength(2);
    // 未被改的块（alpha）仍原样
    expect(p.rewrittenMd).toContain('alpha');
  });

  it('越界 block_index → locateFailed:true 且不改动文本', () => {
    const json = JSON.stringify([
      { block_index: 0, new_content: 'A' },
      { block_index: 99, new_content: 'X' },
    ]);
    const p = proposeDocumentRewrite(CONTENT, numbered, json);
    expect(p.locateFailed).toBe(true);
    expect(p.rewrittenMd).toBe(CONTENT);
    expect(p.ops).toEqual([]);
  });

  it('JSON 解析失败 → locateFailed:true（定：解析失败置 locateFailed）', () => {
    const p = proposeDocumentRewrite(CONTENT, numbered, 'not-json-at-all');
    expect(p.locateFailed).toBe(true);
    expect(p.rewrittenMd).toBe(CONTENT);
  });

  it('改写为原文相同 → unchanged:true', () => {
    const json = JSON.stringify([{ block_index: 1, new_content: 'beta' }]);
    const p = proposeDocumentRewrite(CONTENT, numbered, json);
    expect(p.unchanged).toBe(true);
    expect(p.rewrittenMd).toBe(CONTENT);
  });
});
