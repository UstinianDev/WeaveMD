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

describe('SPEC-EDIT-FT2 CSS: .md-syntax 方案 B（始终隐藏，无聚焦灰显）', () => {
  it('CS1: .md-syntax 默认隐藏（font-size: 0 且 opacity: 0）', () => {
    const b = blockText('.md-syntax');
    expect(b).toMatch(/font-size:\s*0/);
    expect(b).toMatch(/opacity:\s*0/);
  });

  it('CS2: 无聚焦灰显规则（纯 WYSIWYG——语法标记聚焦时也不显现）', () => {
    expect(css).not.toContain('.block-content:focus .md-syntax');
    expect(css).not.toContain('.block-content:focus-within .md-syntax');
    expect(css).not.toMatch(/opacity:\s*0\.55/);
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

describe('SPEC-EDIT-LINK-IMAGE CSS: tooltip + 图片占位（editor-link-image-fix D1）', () => {
  it('CL1: a.inline-link:hover::after 用新提示文案「ctrl + 左键  打开网页」且全文件无 --link-tip 残留（R3）', () => {
    const b = blockText('a.inline-link:hover::after');
    // R3：不再展示原始 URL，改为深蓝加粗斜体操作提示（键字后双空格字面量）
    expect(b).not.toMatch(/content:\s*attr\(data-href\)/);
    expect(b).toMatch(/content:\s*'ctrl \+ 左键 {2}打开网页'/);
    expect(b).toMatch(/color:\s*#1d4ed8/);
    expect(b).toMatch(/font-weight:\s*700/);
    expect(b).toMatch(/font-style:\s*italic/);
    expect(b).toMatch(/font-size:\s*12px/);
    expect(b).toMatch(/letter-spacing:\s*0\.5px/);
    // 通用提示样式断言（定位沿用）
    expect(b).toMatch(/position:\s*absolute/);
    expect(b).toMatch(/border-radius/);
    expect(b).toMatch(/box-shadow/);
    expect(b).toMatch(/pointer-events:\s*none/);
    expect(b).toMatch(/z-index/);
    // --link-tip 已删除
    expect(b).not.toContain('var(--link-tip)');
    expect(css).not.toContain('--link-tip');
  });

  it('CL2: .inline-image-fallback 占位样式存在（灰显 / 虚线 / 圆角 / 斜体）', () => {
    const b = blockText('.inline-image-fallback');
    expect(b).toMatch(/display:\s*inline-block/);
    expect(b).toMatch(/color:\s*var\(--text-muted\)/);
    expect(b).toMatch(/border-radius/);
    expect(b).toMatch(/font-style:\s*italic/);
  });
});

describe('SPEC-EDIT-CBSS CSS: 代码块字号与内边距（U3）', () => {
  it('CS7: .code-fence-content 字号为 15px', () => {
    const b = blockText('.code-fence-content');
    expect(b).toMatch(/font-size:\s*15px/);
  });

  it('CS8: .code-fence-content pre 内边距上下 20px 左右 24px', () => {
    const b = blockText('.code-fence-content pre');
    expect(b).toMatch(/padding:\s*20px\s+24px\s+20px/);
  });

  it('CS9: .code-fence-textarea 字号同步 15px', () => {
    const b = blockText('.code-fence-textarea');
    expect(b).toMatch(/font-size:\s*15px/);
  });
});

describe('EDIT-IMAGE-INSERT-MARKTEXT CSS: 空 src 图片占位（K5）', () => {
  it('CK1: .inline-image-empty 声明存在（inline-block / min 尺寸 / 虚线边框 / 圆角 / 留白 / muted 灰 / 可点击 / 垂直对齐）', () => {
    const b = blockText('.inline-image-empty');
    expect(b).toMatch(/display:\s*inline-block/);
    expect(b).toMatch(/min-width:\s*2\.5em/);
    expect(b).toMatch(/min-height:\s*1\.4em/);
    expect(b).toMatch(/border:\s*1px\s+dashed\s+var\(--border-color\)/);
    expect(b).toMatch(/border-radius:\s*6px/);
    expect(b).toMatch(/padding:\s*0\s+6px/);
    expect(b).toMatch(/color:\s*var\(--text-muted\)/);
    expect(b).toMatch(/cursor:\s*pointer/);
    expect(b).toMatch(/vertical-align:\s*middle/);
  });

  it('CK2: 视觉提示图标走 ::before 伪元素（🖼），不写入 DOM 文本节点', () => {
    const b = blockText('.inline-image-empty::before');
    expect(b).toMatch(/content:\s*'🖼'/);
    expect(b).toMatch(/margin-right:\s*4px/);
    // 图标绝不得出现在 DOM 文本节点：整条选择器必须带 ::before，且规则中不得有内联图标字符兜底
    const main = blockText('.inline-image-empty');
    expect(main).not.toContain('🖼');
  });
});

describe('SPEC-INSERT-URL-MODAL CSS: InsertUrlModal（U4）', () => {
  // blockText 用行前缀定位存在歧义：.insert-url-modal 会先匹配到
  // .insert-url-modal-overlay 等带后缀类的规则（与既有 -dot/-dots 同理）。
  // 此处用「选择器 + 空格 + {」字面量精确定位，花括号配平逻辑与 blockText 一致。
  function modalBlock(selector: string): string {
    const token = `${selector} {`;
    const start = css.indexOf(token);
    expect(start, `selector ${selector} { should exist`).toBeGreaterThan(-1);
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

  it('CM1: .insert-url-modal-overlay fixed 遮罩居中且 z-index 120', () => {
    const b = blockText('.insert-url-modal-overlay');
    expect(b).toMatch(/position:\s*fixed/);
    expect(b).toMatch(/z-index:\s*120/);
    expect(b).toMatch(/display:\s*flex/);
    expect(b).toMatch(/align-items:\s*center/);
    expect(b).toMatch(/justify-content:\s*center/);
    expect(b).toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.45\)/);
  });

  it('CM2: .insert-url-modal 卡片用 --bg-secondary + border + radius + min-width', () => {
    const b = modalBlock('.insert-url-modal');
    expect(b).toMatch(/min-width:\s*320px/);
    expect(b).toMatch(/background:\s*var\(--bg-secondary\)\s*;/);
    expect(b).toMatch(/border:\s*1px\s+solid\s+var\(--border-color\)/);
    expect(b).toMatch(/border-radius:\s*12px/);
  });

  it('CM3: .insert-url-modal-dot 三色窗口控件（红/黄/绿）', () => {
    const dot = modalBlock('.insert-url-modal-dot');
    expect(dot).toMatch(/width:\s*12px/);
    expect(dot).toMatch(/height:\s*12px/);
    expect(dot).toMatch(/border-radius:\s*999px/);
    expect(modalBlock('.insert-url-modal-dot--close')).toMatch(/background:\s*#ff5f56/);
    expect(modalBlock('.insert-url-modal-dot--minimize')).toMatch(/background:\s*#ffbd2e/);
    expect(modalBlock('.insert-url-modal-dot--zoom')).toMatch(/background:\s*#27c93f/);
  });

  it('CM4: .insert-url-modal-actions / .insert-url-modal-input / .insert-url-modal-btn 存在', () => {
    const actions = modalBlock('.insert-url-modal-actions');
    expect(actions).toMatch(/display:\s*flex/);
    expect(actions).toMatch(/justify-content:\s*flex-end/);
    const input = modalBlock('.insert-url-modal-input');
    expect(input).toMatch(/width:\s*100%/);
    expect(input).toMatch(/border-radius:\s*var\(--radius-input\)/);
    expect(modalBlock('.insert-url-modal-btn')).toMatch(/cursor:\s*pointer/);
    expect(modalBlock('.insert-url-modal-btn--primary')).toMatch(/background:\s*var\(--accent\)/);
  });
});
