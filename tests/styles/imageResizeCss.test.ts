// ============================================
// R1：globals.css 静态断言——图片选中框 + 手柄样式
// ============================================
// vitest.config.ts css:false，jsdom 无法加载/计算 globals.css，故用 node:fs
// 读取源码做规则存在性断言（与 ft2Css.test.ts 同约定，选择器字面量 + 花括号配平）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS_PATH = 'src/render/styles/globals.css';
const css = readFileSync(CSS_PATH, 'utf-8').replace(/\r\n/g, '\n');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockText(selector: string): string {
  const start = css.search(new RegExp(`(?:^|\\n)\\s*${escapeRe(selector)}`));
  expect(start, `selector ${selector} should exist`).toBeGreaterThan(-1);
  const braceStart = css.indexOf('{', start);
  let depth = 0;
  let i = braceStart;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return css.slice(braceStart + 1, i);
}

describe('R1 CSS: 图片选中框 + 缩放手柄（G1/G2/G6）', () => {
  it('CP1: .image-resize-box 存在且 pointer-events:none 不挡交互（G6）', () => {
    const b = blockText('.image-resize-box');
    expect(b).toMatch(/pointer-events:\s*none/);
    expect(b).toMatch(/border/);
  });

  it('CP2: .image-resize-handle 存在且 pointer-events:auto（可拖拽）、可点击热区、对角光标', () => {
    const b = blockText('.image-resize-handle');
    expect(b).toMatch(/position:\s*absolute/);
    expect(b).toMatch(/pointer-events:\s*auto/);
    expect(b).toMatch(/width:\s*9px/);
    expect(b).toMatch(/height:\s*9px/);
    expect(b).toMatch(/cursor/);
    // 对角光标细分存在
    expect(blockText(".image-resize-handle[data-handle='se']")).toMatch(/cursor:\s*nwse-resize/);
    expect(blockText(".image-resize-handle[data-handle='ne']")).toMatch(/cursor:\s*nesw-resize/);
  });
});
