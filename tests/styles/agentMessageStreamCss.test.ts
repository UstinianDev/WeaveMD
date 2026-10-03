// ============================================
// WeaveMD — .ai-message-stream 消息流楷体 CSS 静态断言（agent-kb-ux R5）
// ============================================
// vitest.config.ts 为 css:false，jsdom 无法加载/计算 globals.css，
// 故用 node:fs 读取源码做规则存在性断言（沿用 tests/styles/ft2Css.test.ts 手法；
// 计算样式核对放 Playwright E2E）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS_PATH = 'src/render/styles/globals.css';
const css = readFileSync(CSS_PATH, 'utf-8').replace(/\r\n/g, '\n');
// 先剥 /* ... */ 注释：注释内可能含选择器字面量（双向锚定注释），会污染扫描
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取选择器首个规则块体（行锚定 + 花括号配平，与 ft2Css.blockText 同法） */
function blockText(selector: string): string {
  const start = cssRules.search(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  expect(start, `selector ${selector} should exist`).toBeGreaterThan(-1);
  const braceStart = cssRules.indexOf('{', start);
  let depth = 0;
  let i = braceStart;
  for (; i < cssRules.length; i++) {
    if (cssRules[i] === '{') depth++;
    else if (cssRules[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return cssRules.slice(braceStart + 1, i);
}

describe('agent-kb-ux R5 CSS: .ai-message-stream 消息流楷体', () => {
  it('CM1: .ai-message-stream 规则存在且含 KaiTi + Consolas', () => {
    const b = blockText('.ai-message-stream');
    expect(b).toMatch(/font-family/);
    expect(b).toContain('KaiTi');
    expect(b).toContain('Consolas');
  });

  it('CM2: .chat-scroll 未被加 font-family（防误伤 home/history/composer）', () => {
    // .chat-scroll 选择器的任何规则块都不得出现 font-family（当前可无任何规则块）
    const selectorRe = /(?:^|\n)[^{}]*\.chat-scroll[^{}]*\{[^{}]*\}/g;
    const blocks = cssRules.match(selectorRe) ?? [];
    for (const blk of blocks) {
      expect(blk, `chat-scroll 规则不得含 font-family:\n${blk}`).not.toMatch(/font-family/);
    }
    // 同口径兜底：全文无「.chat-scroll … { … font-family」形态
    expect(cssRules).not.toMatch(/\.chat-scroll[^{}]*\{[^}]*font-family/);
  });
});
