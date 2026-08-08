// ============================================
// SPEC-EDIT-FT2 阶段 2：globals.css 静态断言（D9）
// ============================================
// vitest.config.ts 为 css:false，jsdom 无法加载/计算 globals.css，
// 故用 node:fs 读取源码做规则存在性断言（计算样式断言放 Playwright E2E）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS_PATH = 'src/render/styles/globals.css';
const css = readFileSync(CSS_PATH, 'utf-8').replace(/\r\n/g, '\n');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 取选择器对应的规则块体。
 * - 选择器含换行（如 `:root,\nhtml.light-header`）→ 字面量定位；
 * - 否则行锚定（`(?:^|\n)\s*`）定位，避免误匹配
 *   `.markdown-preview mark {` 这类「类名前缀 + mark」的规则。
 */
function blockText(selector: string): string {
  let start: number;
  if (selector.includes('\n')) {
    start = css.indexOf(selector);
  } else {
    start = css.search(new RegExp(`(?:^|\\n)\\s*${escapeRe(selector)}`));
  }
  expect(start, `selector ${selector} should exist`).toBeGreaterThan(-1);
  // 从 { 后开始，做花括号配平，截取到匹配的 } 结束（嵌套 + var() 括号不干扰花括号计数）
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

describe('SPEC-EDIT-FT2 CSS: .md-syntax 方案 B（隐藏 + 聚焦灰显）', () => {
  it('CS1: .md-syntax 默认隐藏（font-size: 0 且 opacity: 0）', () => {
    const b = blockText('.md-syntax');
    expect(b).toMatch(/font-size:\s*0/);
    expect(b).toMatch(/opacity:\s*0/);
  });

  it('CS2: .block-content:focus .md-syntax 聚焦灰显（opacity: 0.55）', () => {
    const b = blockText('.block-content:focus .md-syntax');
    expect(b).toMatch(/opacity:\s*0\.55/);
  });
});

describe('SPEC-EDIT-FT2 CSS: mark 高亮黄色', () => {
  it('CS3: mark 使用 --highlight-bg / --highlight-text', () => {
    const b = blockText('mark');
    expect(b).toMatch(/var\(--highlight-bg\)/);
    expect(b).toMatch(/var\(--highlight-text\)/);
  });

  it('CS4: 5 个主题块均定义 highlight 变量（浅色黄 / 深色可读黄）', () => {
    const themes: Array<{ selector: string; bg: RegExp; text: string }> = [
      { selector: ':root,\nhtml.light-header', bg: /#ffeb3b/i, text: '#1a1a1a' },
      { selector: 'html.light', bg: /#ffeb3b/i, text: '#1a1a1a' },
      { selector: 'html.dark', bg: /rgba\(255,\s*235,\s*59,\s*0\.35\)/i, text: '#ffffff' },
      { selector: 'html.custom', bg: /rgba\(255,\s*235,\s*59,\s*0\.35\)/i, text: '#ffffff' },
      { selector: 'html.high-contrast', bg: /#ffeb3b/i, text: '#1a1a1a' },
    ];
    for (const t of themes) {
      const b = blockText(t.selector);
      expect(b).toMatch(/--highlight-bg:\s*[^;]+/);
      expect(b).toMatch(/--highlight-text:\s*[^;]+/);
      expect(b.match(/--highlight-bg:\s*([^;]+)/)![1].trim()).toMatch(t.bg);
      expect(b.match(/--highlight-text:\s*([^;]+)/)![1].trim()).toBe(t.text);
    }
  });
});

describe('SPEC-EDIT-FT3 CSS: 工具栏尺寸缩小（G4，SPEC-EDIT-FT3 §4.4）', () => {
  it('CS5: .floating-toolbar-v2 尺寸规则存在（gap=4px / 字号13px / padding 3px 6px）', () => {
    const b = blockText('.floating-toolbar-v2');
    expect(b).toMatch(/gap:\s*4px/);
    expect(b).toMatch(/font-size:\s*13px/);
    expect(b).toMatch(/padding:\s*3px\s+6px/);
  });

  it('CS5b: 工具栏按钮与下拉尺寸类存在（按钮32×28 / trigger 28+px6 / option 6px 10px / menu 176px / divider 1×16 margin 0 2px）', () => {
    const btn = blockText('.floating-toolbar-v2 .ft-btn');
    expect(btn).toMatch(/width:\s*32px/);
    expect(btn).toMatch(/height:\s*28px/);
    expect(btn).toMatch(/font-size:\s*13px/);
    const trigger = blockText('.block-type-trigger');
    expect(trigger).toMatch(/height:\s*28px/);
    expect(trigger).toMatch(/padding:\s*0\s+6px/);
    expect(trigger).toMatch(/font-size:\s*13px/);
    const option = blockText('.block-type-option');
    expect(option).toMatch(/padding:\s*6px\s+10px/);
    expect(option).toMatch(/font-size:\s*13px/);
    const menu = blockText('.block-type-menu');
    expect(menu).toMatch(/min-width:\s*176px/);
    const divider = blockText('.ft-divider');
    expect(divider).toMatch(/width:\s*1px/);
    expect(divider).toMatch(/height:\s*16px/);
    expect(divider).toMatch(/margin:\s*0\s+2px/);
  });

  it('CS5c: 总高构成 ≤ 34px（按钮 28px + 容器垂直 padding 3px×2，含 padding 不含 border）', () => {
    const btn = blockText('.floating-toolbar-v2 .ft-btn');
    const container = blockText('.floating-toolbar-v2');
    expect(btn).toMatch(/height:\s*28px/);
    expect(container).toMatch(/padding:\s*3px\s+6px/);
  });
});

describe('SPEC-EDIT-FT2 CSS: 新增行内对象类', () => {
  it('CS6: .inline-image / .math-inline 规则存在', () => {
    expect(blockText('.inline-image')).toMatch(/max-width:\s*100%/);
    expect(blockText('.math-inline')).toMatch(/display:\s*inline-block/);
  });
});
