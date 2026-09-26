// ============================================
// WeaveMD — PDF 版面还原 TDD（doc-pipeline B7 二-3）
// ============================================
// 覆盖：双栏坐标聚类阅读顺序（先左后右）、字号判标题层级、无框线表格
// 行列还原（Markdown+CSV 两态）、跨页表格合并补表头、页眉页脚跨页重复
// 检测剔除入 metadata、无文本层检测、D 路线显式触发条件。
// analyzePdfLayout 为纯函数：输入结构化 items（liteparse textItems 同构），
// 不依赖 native 模块，固定样例锁定六-3 评测指标前置用例。

import { describe, expect, it } from 'vitest';

import type { IDocumentHeading, IDocumentSection } from '@shared/ai';
import {
  analyzePdfLayout,
  shouldUseDRoute,
  type PdfLayoutItem,
  type PdfLayoutPage,
} from '@main/ai/files/pdfLayout';

// ---------------------------------------------------------------------------
// 固定样例构造器（viewport top-left origin，y 向下增大 —— liteparse 实测坐标系）
// ---------------------------------------------------------------------------

function item(
  text: string,
  x: number,
  y: number,
  opts: { width?: number; height?: number; fontSize?: number } = {}
): PdfLayoutItem {
  return {
    text,
    x,
    y,
    width: opts.width ?? text.length * 7,
    height: opts.height ?? 14,
    fontSize: opts.fontSize ?? 12,
  };
}

/** 单页：612×792（letter），items 直接给定 */
function page(pageNum: number, items: PdfLayoutItem[], width = 612, height = 792): PdfLayoutPage {
  return { pageNum, width, height, items };
}

/** 双栏样例：左栏 x=72、右栏 x=320，标题全宽横跨 */
function twoColumnPage(pageNum: number): PdfLayoutPage {
  const items: PdfLayoutItem[] = [
    item('Chapter One Introduction', 72, 40, { width: 240, height: 28, fontSize: 24 }),
    // 左栏（先画，期待先输出）
    item('Left column paragraph one alpha.', 72, 100),
    item('Left column paragraph two beta.', 72, 130),
    item('Left column paragraph three gamma.', 72, 160),
    // 右栏
    item('Right column paragraph one delta.', 320, 100),
    item('Right column paragraph two epsilon.', 320, 130),
    item('Right column paragraph three zeta.', 320, 160),
  ];
  return page(pageNum, items);
}

/** 无框线表格样例：3 列 × 4 行（含表头），x 对齐 72/200/330 */
function borderlessTableItems(): PdfLayoutItem[] {
  const xs = [72, 200, 330];
  const grid = [
    ['Region', 'Q1', 'Q2'],
    ['North', '10', '20'],
    ['South', '30', '40'],
    ['East', '50', '60'],
  ];
  const items: PdfLayoutItem[] = [];
  grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      // 自然字宽（表格填充率信号：单元格窄于行跨度）
      items.push(item(cell, xs[c], 100 + r * 24));
    });
  });
  return items;
}

// ---------------------------------------------------------------------------
// 1. 无文本层检测（二-3②：抽取字符数/页面积比）
// ---------------------------------------------------------------------------

describe('analyzePdfLayout — 无文本层检测', () => {
  it('完全无 items 的页面判定 noTextLayer=true', () => {
    const r = analyzePdfLayout([page(1, []), page(2, [])]);
    expect(r.analysis.noTextLayer).toBe(true);
  });

  it('有实质文本的页面判定 noTextLayer=false（不误伤稀疏文本页）', () => {
    const r = analyzePdfLayout([page(1, [item('Hello PDF Test', 72, 700)])]);
    expect(r.analysis.noTextLayer).toBe(false);
    expect(r.text).toContain('Hello PDF Test');
  });

  it('多页空 items 依旧无文本层', () => {
    const r = analyzePdfLayout([page(1, []), page(2, []), page(3, [])]);
    expect(r.analysis.noTextLayer).toBe(true);
    expect(r.analysis.totalChars).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. 双栏阅读顺序（二-3②：先左栏后右栏）
// ---------------------------------------------------------------------------

describe('analyzePdfLayout — 双栏阅读顺序', () => {
  it('左栏文本全部先于右栏文本（先左后右）', () => {
    const r = analyzePdfLayout([twoColumnPage(1)]);
    const lastLeft = Math.max(
      ...['Left column paragraph one alpha.', 'Left column paragraph two beta.', 'Left column paragraph three gamma.']
        .map((t) => r.text.indexOf(t))
    );
    const firstRight = r.text.indexOf('Right column paragraph one delta.');
    expect(lastLeft).toBeGreaterThanOrEqual(0);
    expect(firstRight).toBeGreaterThan(lastLeft);
  });

  it('栏内保持从上到下（y 升序）', () => {
    const r = analyzePdfLayout([twoColumnPage(1)]);
    const i1 = r.text.indexOf('Left column paragraph one alpha.');
    const i2 = r.text.indexOf('Left column paragraph two beta.');
    const i3 = r.text.indexOf('Left column paragraph three gamma.');
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it('全宽标题在双栏内容之前输出（band 分隔语义）', () => {
    const r = analyzePdfLayout([twoColumnPage(1)]);
    const title = r.text.indexOf('Chapter One Introduction');
    const left = r.text.indexOf('Left column paragraph one alpha.');
    expect(title).toBeGreaterThanOrEqual(0);
    expect(title).toBeLessThan(left);
  });

  it('单栏页面按 y 升序输出（不误分栏）', () => {
    const r = analyzePdfLayout([
      page(1, [
        item('First line.', 72, 100),
        item('Second line.', 72, 130),
        item('Third line.', 72, 160),
      ]),
    ]);
    const a = r.text.indexOf('First line.');
    const b = r.text.indexOf('Second line.');
    const c = r.text.indexOf('Third line.');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(r.analysis.columnDetectFailed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. 字号判标题层级（二-3②：字体大小判断标题层级）
// ---------------------------------------------------------------------------

describe('analyzePdfLayout — 字号判标题层级', () => {
  it('大于正文的字号识别为标题并映射层级', () => {
    const r = analyzePdfLayout([
      page(1, [
        item('Big Title', 72, 40, { width: 100, height: 26, fontSize: 24 }),
        item('body text one', 72, 100, { fontSize: 12 }),
        item('Sub Heading', 72, 140, { width: 90, height: 18, fontSize: 16 }),
        item('body text two', 72, 180, { fontSize: 12 }),
      ]),
    ]);
    expect(r.headings.length).toBeGreaterThanOrEqual(2);
    const h1 = r.headings.find((h: IDocumentHeading) => h.text === 'Big Title');
    const h2 = r.headings.find((h: IDocumentHeading) => h.text === 'Sub Heading');
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
    expect(h1!.level).toBeLessThan(h2!.level);
    // 正文不进 headings
    expect(r.headings.find((h) => h.text === 'body text one')).toBeUndefined();
  });

  it('章节路径反映层级嵌套', () => {
    const r = analyzePdfLayout([
      page(1, [
        item('Top Title', 72, 40, { width: 90, height: 26, fontSize: 24 }),
        item('Mid Section', 72, 100, { width: 90, height: 18, fontSize: 16 }),
        item('body', 72, 140, { fontSize: 12 }),
      ]),
    ]);
    const sub = r.headings.find((h) => h.text === 'Mid Section');
    expect(sub).toBeDefined();
    expect(sub!.path).toContain('Top Title');
    const section = r.sections.find((s: IDocumentSection) => s.title === 'Mid Section');
    expect(section).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. 无框线表格行列还原（二-3②：基于文字位置对齐还原行列）
// ---------------------------------------------------------------------------

describe('analyzePdfLayout — 无框线表格', () => {
  it('对齐的多行多列还原为表格（行列准确）', () => {
    const r = analyzePdfLayout([page(1, borderlessTableItems())]);
    expect(r.tables.length).toBe(1);
    const t = r.tables[0];
    expect(t.rows.length).toBe(4);
    expect(t.rows[0]).toEqual(['Region', 'Q1', 'Q2']);
    expect(t.rows[3]).toEqual(['East', '50', '60']);
  });

  it('表格同时产出 Markdown 与 CSV 两态（二-6②）', () => {
    const r = analyzePdfLayout([page(1, borderlessTableItems())]);
    const t = r.tables[0];
    expect(t.markdown).toContain('| Region | Q1 | Q2 |');
    expect(t.markdown).toContain('| --- | --- | --- |');
    expect(t.markdown).toContain('| North | 10 | 20 |');
    expect(t.csv.split('\n')[0]).toBe('Region,Q1,Q2');
    expect(t.csv.split('\n')[3]).toBe('East,50,60');
  });

  it('普通段落不误判为表格（tableConfidence=1 无候选）', () => {
    const r = analyzePdfLayout([
      page(1, [
        item('Just a sentence one.', 72, 100),
        item('Just a sentence two.', 72, 130),
        item('Just a sentence three.', 72, 160),
      ]),
    ]);
    expect(r.tables.length).toBe(0);
    expect(r.analysis.tableConfidence).toBe(1);
  });

  it('表格行参与阅读顺序（表格位置处输出 markdown）', () => {
    const r = analyzePdfLayout([page(1, borderlessTableItems())]);
    expect(r.text).toContain('| Region | Q1 | Q2 |');
  });
});

// ---------------------------------------------------------------------------
// 5. 跨页表格合并（二-3②：检测切断并合并 + 全局补全表头）
// ---------------------------------------------------------------------------

describe('analyzePdfLayout — 跨页表格合并', () => {
  function tableRows(startY: number, rows: string[][]): PdfLayoutItem[] {
    const xs = [72, 200, 330];
    const items: PdfLayoutItem[] = [];
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        items.push(item(cell, xs[c], startY + r * 24));
      });
    });
    return items;
  }

  it('页末表格与次页页首表格合并，续页重复表头被丢弃', () => {
    const p1 = page(1, tableRows(600, [
      ['Name', 'Score'],
      ['Alice', '95'],
      ['Bob', '87'],
    ]));
    const p2 = page(2, [
      ...tableRows(40, [
        ['Name', 'Score'], // 续页重复表头
        ['Carol', '76'],
      ]),
      item('After table body text.', 72, 200),
    ]);
    const r = analyzePdfLayout([p1, p2]);
    expect(r.tables.length).toBe(1);
    const t = r.tables[0];
    // 全局一张表：表头来自第一页，重复表头丢弃，续行追加
    expect(t.rows.length).toBe(4);
    expect(t.rows[0]).toEqual(['Name', 'Score']);
    expect(t.rows[3]).toEqual(['Carol', '76']);
    expect(t.startPage).toBe(1);
    expect(t.endPage).toBe(2);
    expect(t.csv.split('\n').length).toBe(4);
  });

  it('续页无表头行时直接追加数据（表头仍由首表补全）', () => {
    const p1 = page(1, tableRows(600, [
      ['Name', 'Score'],
      ['Alice', '95'],
    ]));
    const p2 = page(2, tableRows(40, [['Dave', '66']]));
    const r = analyzePdfLayout([p1, p2]);
    expect(r.tables.length).toBe(1);
    const t = r.tables[0];
    expect(t.rows.length).toBe(3);
    expect(t.rows[0]).toEqual(['Name', 'Score']);
    expect(t.rows[2]).toEqual(['Dave', '66']);
  });

  it('非页末/页首相邻的独立表格不合并', () => {
    const p1 = page(1, [
      item('intro', 72, 60),
      ...tableRows(100, [
        ['A', 'B'],
        ['1', '2'],
        ['3', '4'],
      ]),
      item('tail after table', 72, 300),
    ]);
    const p2 = page(2, [
      item('body before', 72, 60),
      ...tableRows(300, [
        ['C', 'D'],
        ['5', '6'],
        ['7', '8'],
      ]),
    ]);
    const r = analyzePdfLayout([p1, p2]);
    expect(r.tables.length).toBe(2);
    expect(r.tables[0].rows[0]).toEqual(['A', 'B']);
    expect(r.tables[1].rows[0]).toEqual(['C', 'D']);
  });
});

// ---------------------------------------------------------------------------
// 6. 页眉页脚跨页重复检测（二-3②：剔除入 metadata）
// ---------------------------------------------------------------------------

describe('analyzePdfLayout — 页眉页脚检测', () => {
  it('顶部带跨页重复文本剔除并入 metadata', () => {
    const p1 = page(1, [
      item('ACME Confidential Report', 72, 20, { width: 160 }),
      item('Body content page one.', 72, 100),
    ]);
    const p2 = page(2, [
      item('ACME Confidential Report', 72, 20, { width: 160 }),
      item('Body content page two.', 72, 100),
    ]);
    const r = analyzePdfLayout([p1, p2]);
    expect(r.metadata.headersFooters).toContain('ACME Confidential Report');
    expect(r.text).not.toContain('ACME Confidential Report');
    expect(r.text).toContain('Body content page one.');
    expect(r.text).toContain('Body content page two.');
  });

  it('底部页码行剔除（数字归一化跨页匹配）', () => {
    const p1 = page(1, [
      item('Content on page one.', 72, 100),
      item('Page 3', 290, 760),
    ]);
    const p2 = page(2, [
      item('Content on page two.', 72, 100),
      item('Page 4', 290, 760),
    ]);
    const r = analyzePdfLayout([p1, p2]);
    expect(r.text).not.toContain('Page 3');
    expect(r.text).not.toContain('Page 4');
    // 归一化原文之一入 metadata
    expect(r.metadata.headersFooters.some((h) => h.startsWith('Page'))).toBe(true);
  });

  it('仅出现一次的带内文本不剔除（正文含标题页场景）', () => {
    const r = analyzePdfLayout([
      page(1, [
        item('Unique Chapter Title', 72, 30, { width: 180, fontSize: 22, height: 26 }),
        item('Some body.', 72, 100),
      ]),
    ]);
    expect(r.text).toContain('Unique Chapter Title');
    expect(r.metadata.headersFooters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. D 路线显式触发条件（二-4②：不得全量烧 token）
// ---------------------------------------------------------------------------

describe('shouldUseDRoute — 显式触发条件', () => {
  it('无文本层 → 触发', () => {
    const d = shouldUseDRoute({
      noTextLayer: true,
      columnDetectFailed: false,
      tableConfidence: 1,
    });
    expect(d.trigger).toBe(true);
    expect(d.reasons).toContain('no-text-layer');
  });

  it('双栏检测失败 → 触发', () => {
    const d = shouldUseDRoute({
      noTextLayer: false,
      columnDetectFailed: true,
      tableConfidence: 1,
    });
    expect(d.trigger).toBe(true);
    expect(d.reasons).toContain('column-detect-failed');
  });

  it('表格置信度低于阈值 → 触发', () => {
    const d = shouldUseDRoute({
      noTextLayer: false,
      columnDetectFailed: false,
      tableConfidence: 0.4,
    });
    expect(d.trigger).toBe(true);
    expect(d.reasons).toContain('low-table-confidence');
  });

  it('全部正常 → 不触发（不全量烧 token）', () => {
    const d = shouldUseDRoute({
      noTextLayer: false,
      columnDetectFailed: false,
      tableConfidence: 1,
    });
    expect(d.trigger).toBe(false);
    expect(d.reasons).toHaveLength(0);
  });

  it('置信度等于阈值不触发（边界语义）', () => {
    const d = shouldUseDRoute({
      noTextLayer: false,
      columnDetectFailed: false,
      tableConfidence: 0.6,
    });
    expect(d.trigger).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. 双栏检测失败判定 + pageOffsets 溯源
// ---------------------------------------------------------------------------

describe('analyzePdfLayout — columnDetectFailed 与 pageOffsets', () => {
  it('行中线严重交叠（双栏迹象但无清晰 gutter）→ columnDetectFailed', () => {
    // 两组行 x-center 分布左右各半，但行横跨中线导致无 gutter
    const items: PdfLayoutItem[] = [];
    for (let i = 0; i < 5; i++) {
      // 左起但极宽（跨中线）的行
      items.push(item(`wide row alpha ${i} with long text spanning columns`, 72, 100 + i * 30, {
        width: 500,
      }));
      // 右侧起始行
      items.push(item(`right row beta ${i}`, 340, 115 + i * 30, { width: 120 }));
    }
    const r = analyzePdfLayout([page(1, items)]);
    expect(r.analysis.columnDetectFailed).toBe(true);
  });

  it('pageOffsets 记录每页在 text 中的起始偏移', () => {
    const p1 = page(1, [item('Page one body text.', 72, 100)]);
    const p2 = page(2, [item('Page two body text.', 72, 100)]);
    const r = analyzePdfLayout([p1, p2]);
    expect(r.pageOffsets.length).toBe(2);
    expect(r.pageOffsets[0]).toBe(0);
    expect(r.pageOffsets[1]).toBeGreaterThan(0);
    const page2Slice = r.text.slice(r.pageOffsets[1]);
    expect(page2Slice).toContain('Page two body text.');
    expect(page2Slice).not.toContain('Page one body text.');
  });

  it('页数为 0 时安全返回空产物', () => {
    const r = analyzePdfLayout([]);
    expect(r.text).toBe('');
    expect(r.pageOffsets).toEqual([]);
    expect(r.analysis.noTextLayer).toBe(true);
  });
});
