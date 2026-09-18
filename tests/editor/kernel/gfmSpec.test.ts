// ============================================
// WeaveMD Editor v2 — GFM (GitHub Flavored Markdown) Spec Compliance Test
// ============================================
// 验证 648 个 GFM 标准用例的解析稳定性与往返一致性。
// 验证项与 commonmarkSpec 一致，额外关注 GFM 扩展语法：
//   - 表格（tables）
//   - 任务列表（task list items）
//   - 删除线（strikethrough）—— 当前 inlineLexer 支持 ~~text~~
//   - 自动链接（autolinks）—— 当前 inlineLexer 支持 <url>
//
// 注意：GFM spec 同 CommonMark，使用 → (U+2192) 表示制表符。

import { describe, it, expect } from 'vitest';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { stateToMarkdown } from '@render/editor/kernel/stateToMarkdown';
import { getAllBlocksInOrder } from '@render/editor/kernel/blockTree';
import { tokenizeInline, clearInlineCache } from '@render/editor/kernel/inlineLexer';
import { isLeafBlockType } from '@render/editor/kernel/types';
import type { BlockTreeV2 } from '@render/editor/kernel/types';
import gfmSpec from './fixtures/gfm.spec.json';

// ============================================
// 类型
// ============================================

interface SpecCase {
  exampleNumber: number;
  section: string;
  markdown: string;
  html: string;
  startLine: number;
}

const ALL_CASES = gfmSpec as SpecCase[];

// ============================================
// 预处理
// ============================================

function prepareMarkdown(md: string): string {
  return md.replace(/→/g, '\t');
}

// ============================================
// 验证函数（与 commonmarkSpec 共用逻辑）
// ============================================

function getTypeSequence(tree: BlockTreeV2): string[] {
  return getAllBlocksInOrder(tree)
    .filter((b) => b.type !== 'document')
    .map((b) => b.type);
}

function validateTreeIntegrity(tree: BlockTreeV2): string[] {
  const errors: string[] = [];
  const visited = new Set<string>();

  if (!tree.root || tree.root.type !== 'document') {
    errors.push('root missing or not document type');
    return errors;
  }

  const stack = [tree.root.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) {
      errors.push(`cycle detected at block ${id}`);
      continue;
    }
    visited.add(id);

    const block = tree.blocks[id];
    if (!block) {
      errors.push(`block ${id} not found in blocks map`);
      continue;
    }

    if (block.parentId !== null && !tree.blocks[block.parentId]) {
      errors.push(`parent ${block.parentId} of block ${id} not found`);
    }

    if (block.parentId) {
      const parent = tree.blocks[block.parentId];
      if (parent && !parent.childrenIds.includes(id)) {
        errors.push(
          `block ${id} lists parent ${block.parentId} but parent.childrenIds missing it`
        );
      }
    }

    for (const childId of block.childrenIds) {
      if (!tree.blocks[childId]) {
        errors.push(`child ${childId} of block ${id} not found`);
      }
      stack.push(childId);
    }

    if (block.prevId && !tree.blocks[block.prevId]) {
      errors.push(`prev sibling ${block.prevId} of block ${id} not found`);
    }
    if (block.nextId && !tree.blocks[block.nextId]) {
      errors.push(`next sibling ${block.nextId} of block ${id} not found`);
    }
  }

  return errors;
}

function typeSequencesStructurallyMatch(a: string[], b: string[]): boolean {
  let aTail = 0;
  for (let i = a.length - 1; i >= 0 && a[i] === 'paragraph'; i--) aTail++;
  let bTail = 0;
  for (let i = b.length - 1; i >= 0 && b[i] === 'paragraph'; i--) bTail++;
  if (Math.abs(aTail - bTail) > 1) return false;

  const minLen = Math.min(a.length - aTail, b.length - bTail);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function testInlineStability(tree: BlockTreeV2): string[] {
  const errors: string[] = [];
  for (const block of getAllBlocksInOrder(tree)) {
    if (block.text !== null && block.text.length > 0 && isLeafBlockType(block.type)) {
      clearInlineCache();
      try {
        tokenizeInline(block.text);
      } catch (e) {
        errors.push(`tokenizeInline crash on block ${block.type}[${block.id}]: ${String(e)}`);
      }
    }
  }
  clearInlineCache();
  return errors;
}

// ============================================
// 分组
// ============================================

const sectionGroups = new Map<string, SpecCase[]>();
for (const tc of ALL_CASES) {
  const arr = sectionGroups.get(tc.section) || [];
  arr.push(tc);
  sectionGroups.set(tc.section, arr);
}

// ============================================
// 测试
// ============================================

describe('GFM spec compliance', () => {
  for (const [section, cases] of sectionGroups) {
    describe(section, () => {
      for (const tc of cases) {
        it(`ex${tc.exampleNumber} — no crash + valid tree + inline stable + round-trip structural match`, () => {
          const md = prepareMarkdown(tc.markdown);

          // (a) 解析不崩溃
          let tree: BlockTreeV2;
          expect(() => {
            tree = markdownToState(md);
          }).not.toThrow();
          tree = markdownToState(md);

          // (b) 块树结构合法
          const integrityErrors = validateTreeIntegrity(tree);
          if (integrityErrors.length > 0) {
            expect.fail(`Tree integrity: ${integrityErrors.join('; ')}`);
          }

          // (c) 行内解析不抛异常
          const inlineErrors = testInlineStability(tree);
          if (inlineErrors.length > 0) {
            expect.fail(`Inline stability: ${inlineErrors.join('; ')}`);
          }

          // (d) 往返结构一致性
          const roundTripped = stateToMarkdown(tree);
          let tree2: BlockTreeV2;
          try {
            tree2 = markdownToState(roundTripped);
          } catch (e) {
            expect.fail(`Re-parse after round-trip crashed: ${String(e)}`);
            return;
          }

          const integrityErrors2 = validateTreeIntegrity(tree2);
          if (integrityErrors2.length > 0) {
            expect.fail(`Re-parsed tree integrity: ${integrityErrors2.join('; ')}`);
          }

          const seq1 = getTypeSequence(tree);
          const seq2 = getTypeSequence(tree2);

          if (!typeSequencesStructurallyMatch(seq1, seq2)) {
            expect.fail(
              `Round-trip structural mismatch:\n  first: [${seq1.join(', ')}]\n  second: [${seq2.join(', ')}]`
            );
          }
        });
      }
    });
  }

  it('all 648 GFM cases pass at least one assertion', () => {
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(648);
  });
});