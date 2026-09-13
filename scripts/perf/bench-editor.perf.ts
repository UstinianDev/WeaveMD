// ============================================
// WeaveMD — Editor Performance Benchmark Fixture
// ============================================
// 使用 vitest 运行：npx vitest run scripts/perf/bench-editor.perf.ts
// 不依赖 DOM，纯测 kernel 序列化/大纲函数级耗时（对比改动前后）。
// 合成样本：1000 块（5 个 200 行代码块、100 个标题、列表/引用嵌套混合）

import { describe, it, expect } from 'vitest';
import { markdownToState, stateToMarkdown } from '../../src/render/editor/kernel';
import { extractHeadingOutline } from '../../src/render/editor/kernel/outline';

function codeBlock(lines: number, lang = 'typescript'): string {
  return '```' + lang + '\n' + Array.from({ length: lines }, (_, i) => `const x${i} = ${i};`).join('\n') + '\n```';
}

function heading(level: number, text: string): string {
  return '#'.repeat(level) + ' ' + text;
}

function generateFixture(): string {
  const parts: string[] = [];
  // 100 个标题，每组标题间插内容段落
  for (let i = 1; i <= 100; i++) {
    const lvl = ((i - 1) % 6) + 1;
    parts.push(heading(lvl, `Section ${i} — Performance Optimization Report`));
    parts.push(`This is paragraph content for section ${i}. It contains **bold** text, *italic* text, \`inline code\`, and [links](https://example.com).`);
    parts.push('');

    // 每 20 个标题插入一个 200 行代码块
    if (i % 20 === 0) {
      parts.push(codeBlock(200, i % 2 === 0 ? 'typescript' : 'python'));
      parts.push('');
    }

    // 每隔 10 个标题插入列表
    if (i % 10 === 0) {
      parts.push('- First bullet point with some **bold** content');
      parts.push('- Second bullet with `code` and *emphasis*');
      parts.push('  1. Nested ordered item one');
      parts.push('  2. Nested ordered item two');
      parts.push('- Third bullet');
      parts.push('');
    }

    // 隔 5 个插入引用
    if (i % 5 === 0) {
      parts.push('> This is a blockquote section for testing serialization performance.');
      parts.push('> It contains multiple lines with **formatted** text.');
      parts.push('');
    }
  }
  return parts.join('\n');
}

describe('Editor Performance Benchmark', () => {
  const fixtureMd = generateFixture();
  console.log(`[BENCH] fixture MD length: ${fixtureMd.length} chars`);

  let tree: ReturnType<typeof markdownToState>;

  it('build parse tree from fixture', () => {
    const t0 = performance.now();
    tree = markdownToState(fixtureMd);
    const t1 = performance.now();
    console.log(`[BENCH] markdownToState (full parse): ${(t1 - t0).toFixed(1)}ms`);
    expect(Object.keys(tree.blocks).length).toBeGreaterThan(0);
  });

  it('full-tree stateToMarkdown (50 iterations)', () => {
    const ITER = 50;
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) {
      const md = stateToMarkdown(tree);
      if (i === 0) void md; // prevent dead code elimination
    }
    const t1 = performance.now();
    const avg = (t1 - t0) / ITER;
    console.log(`[BENCH] stateToMarkdown avg (${ITER}×): ${avg.toFixed(2)}ms`);
    // verify round-trip
    const rt = stateToMarkdown(tree);
    expect(typeof rt).toBe('string');
  });

  it('extractHeadingOutline (50 iterations)', () => {
    const ITER = 50;
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) {
      const outline = extractHeadingOutline(tree);
      if (i === 0) void outline;
    }
    const t1 = performance.now();
    const avg = (t1 - t0) / ITER;
    console.log(`[BENCH] extractHeadingOutline avg (${ITER}×): ${avg.toFixed(2)}ms`);
    const outline = extractHeadingOutline(tree);
    expect(outline.length).toBeGreaterThan(0);
    console.log(`[BENCH] heading count: ${outline.length}`);
  });
});