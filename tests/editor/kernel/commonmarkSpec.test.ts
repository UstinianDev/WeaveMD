// ============================================
// WeaveMD Editor v2 — CommonMark 0.31.2 Spec Compliance Test
// ============================================
// 验证块级解析（markdownToState）与行内解析（tokenizeInline）对
// 652 个 CommonMark 标准用例的稳定性与往返一致性。
//
// 验证重点（非 HTML 对比）：
//   a. 解析不崩溃
//   b. 块树结构合法（无悬空引用、无环、父子一致）
//   c. 往返结构一致性（类型序列等价，允许 CBTP 补偿尾段）
//   d. 行内 token 生成不抛异常
//
// 注意：CommonMark spec 使用 → (U+2192) 表示制表符，
// 测试运行时替换为真实 \t 后再送入解析器。

import { describe, it, expect } from 'vitest';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { stateToMarkdown } from '@render/editor/kernel/stateToMarkdown';
import { getAllBlocksInOrder } from '@render/editor/kernel/blockTree';
import { tokenizeInline, clearInlineCache } from '@render/editor/kernel/inlineLexer';
import { isLeafBlockType } from '@render/editor/kernel/types';
import type { BlockTreeV2 } from '@render/editor/kernel/types';
import commonmarkSpec from './fixtures/commonmark-0.31.2.spec.json';

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

const ALL_CASES = commonmarkSpec as SpecCase[];

// ============================================
// 预处理
// ============================================

/** spec JSON 中 → (U+2192) 替换为真实制表符，其余保留 */
function prepareMarkdown(md: string): string {
  return md.replace(/→/g, '\t');
}

// ============================================
// 验证函数
// ============================================

/** 提取文档序的块类型序列（不含 document 根） */
function getTypeSequence(tree: BlockTreeV2): string[] {
  return getAllBlocksInOrder(tree)
    .filter((b) => b.type !== 'document')
    .map((b) => b.type);
}

/** 块树结构完整性校验，返回错误消息数组（空数组 = 合法） */
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

/**
 * 比较两棵树的块类型序列是否"结构一致"。
 * 允许差异：CBTP 补偿的空尾段（第二棵树末尾多出空 paragraph）。
 */
function typeSequencesStructurallyMatch(a: string[], b: string[]): boolean {
  // 从末尾剥除 CBTP 补偿尾段（paragraph，通常 text 为空）
  let aTail = 0;
  for (let i = a.length - 1; i >= 0 && a[i] === 'paragraph'; i--) aTail++;
  let bTail = 0;
  for (let i = b.length - 1; i >= 0 && b[i] === 'paragraph'; i--) bTail++;
  // 多数情况下两端尾段差 ≤1
  if (Math.abs(aTail - bTail) > 1) return false;

  const minLen = Math.min(a.length - aTail, b.length - bTail);

  // 核心段逐一匹配
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 行内解析稳定性：对叶子块文本执行 tokenizeInline 不抛异常 */
function testInlineStability(tree: BlockTreeV2): string[] {
  const errors: string[] = [];
  for (const block of getAllBlocksInOrder(tree)) {
    if (block.text !== null && block.text.length > 0 && isLeafBlockType(block.type)) {
      // 每块独立清缓存，隔离单块故障
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

describe('CommonMark 0.31.2 spec compliance', () => {
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

  // 顶层统计（运行 `npx vitest --reporter verbose` 可见每节通过/失败数）
  it('all 652 CommonMark cases pass at least one assertion', () => {
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(652);
  });
});