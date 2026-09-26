// ============================================
// B8 六-3：评测闭环 —— 可自动化指标回归集
// ============================================
// 四项指标落点（TDD 报告引用）：
//   1) 表格行列还原固定样例断言 → 本文件（PDF 无框线 / 跨页合并 / Markdown 两态）
//   2) chunk 页码溯源单测        → kbIndexer.test（B8「页码溯源回归」describe）
//   3) 固定 query 集检索命中率   → kbSearch.test（5 条固定样例 top1 命中率）
//   4) 多模态降级路径行为断言    → 本文件 + agentMedia.test / multimodalParse.test /
//                                  agentLoop.test（VISION_DEGRADED_NOTICE 注入）
// OCR 指标不做（决策基线：本期无 OCR）。
// ============================================
import { describe, expect, it, vi } from 'vitest';

import {
  analyzePdfLayout,
  type PdfLayoutItem,
  type PdfLayoutPage,
} from '@main/ai/files/pdfLayout';
import { parseDocument } from '@main/ai/files/documentParser';
import { runDRoute } from '@main/ai/files/multimodalParse';
import { buildImageParts, VISION_DEGRADED_NOTICE } from '@main/ai/agent/agentMedia';

// ---------------------------------------------------------------------------
// 固定样例构造器（viewport top-left origin —— liteparse 实测坐标系）
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

function page(pageNum: number, items: PdfLayoutItem[], width = 612, height = 792): PdfLayoutPage {
  return { pageNum, width, height, items };
}

function gridItems(xs: number[], startY: number, rows: string[][]): PdfLayoutItem[] {
  const items: PdfLayoutItem[] = [];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      items.push(item(cell, xs[c], startY + r * 24));
    });
  });
  return items;
}

// ---------------------------------------------------------------------------
// 指标 1：表格行列还原固定样例断言
// ---------------------------------------------------------------------------

describe('六-3 指标① 表格行列还原（固定样例回归）', () => {
  it('PDF 无框线表格 3 列 × 4 行 → Markdown/CSV 两态行列精确', () => {
    const grid = [
      ['Region', 'Q1', 'Q2'],
      ['North', '10', '20'],
      ['South', '30', '40'],
      ['East', '50', '60'],
    ];
    const r = analyzePdfLayout([page(1, gridItems([72, 200, 330], 100, grid))]);
    expect(r.tables).toHaveLength(1);
    const t = r.tables[0];
    expect(t.rows).toHaveLength(4);
    for (const row of t.rows) expect(row).toHaveLength(3);
    const csvLines = t.csv.split('\n');
    expect(csvLines).toHaveLength(4);
    expect(csvLines[0]).toBe('Region,Q1,Q2');
    expect(csvLines[3]).toBe('East,50,60');
    // Markdown 两态：表头 + 分隔行 + 3 数据行 = 5 行
    expect(t.markdown.split('\n')).toHaveLength(5);
  });

  it('跨页表格合并 → 全局一张表行数精确、重复表头丢弃', () => {
    const p1 = page(
      1,
      gridItems(
        [72, 200, 330],
        600,
        [
          ['Name', 'Score'],
          ['Alice', '95'],
          ['Bob', '87'],
        ]
      )
    );
    const p2 = page(2, [
      ...gridItems(
        [72, 200, 330],
        40,
        [
          ['Name', 'Score'],
          ['Carol', '76'],
        ]
      ),
      item('After table body text.', 72, 200),
    ]);
    const r = analyzePdfLayout([p1, p2]);
    expect(r.tables).toHaveLength(1);
    const t = r.tables[0];
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toEqual(['Name', 'Score']);
    expect(t.rows[3]).toEqual(['Carol', '76']);
    expect(t.csv.split('\n')).toHaveLength(4);
  });

  it('Markdown 表格（md 附件解析）→ CSV 两态行列精确（B7 两态契约回归）', async () => {
    const md = ['# 报表', '| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    const res = await parseDocument(Buffer.from(md, 'utf-8'), 'sample.md');
    expect(res.error).toBeUndefined();
    expect(res.tables).toHaveLength(1);
    const csv = res.tables[0].csv ?? '';
    const lines = csv.split('\n');
    // CSV 跳过分隔行：表头 + 2 数据行 = 3 行
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('A,B');
    expect(lines[2]).toBe('3,4');
    expect(res.tables[0].index).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 指标 4：多模态降级路径行为断言（模型不支持 vision）
// ---------------------------------------------------------------------------

describe('六-3 指标④ 多模态降级路径（行为断言）', () => {
  const imageMeta = {
    id: 'i1',
    type: 'image' as const,
    name: 'photo.png',
    parseStatus: 'done' as const,
    path: 'attachments/u1/c1/i1.png',
  };

  it('模型不支持 vision → 图片不产 part + degraded=true（不静默丢图）', () => {
    const res = buildImageParts([imageMeta], { supportsVision: false });
    expect(res.parts).toHaveLength(0);
    expect(res.degraded).toBe(true);
    expect(VISION_DEGRADED_NOTICE).toContain('不支持图片理解');
  });

  it('模型支持 vision → 正常产 part 且无降级标记', () => {
    // 支持分支需文件真实存在；缺失图 → unreadable 但不误标 degraded
    const res = buildImageParts([imageMeta], { supportsVision: true });
    expect(res.degraded).toBe(false);
    expect(res.unreadable).toContain('photo.png');
  });

  it('D 路线 vision 前置判定失败 → 显式降级提示含模型名，零渲染零调用', async () => {
    const renderPages = vi.fn(async () => []);
    const readPage = vi.fn(async () => '');
    const outcome = await runDRoute({
      buffer: Buffer.from('fake-pdf'),
      fileName: 'scan.pdf',
      fileType: 'pdf',
      pageCount: 3,
      fallbackText: 'A 路线文本',
      userId: 'u1', // 有 userId 才走 config 解析 → 进入 vision 判定
      deps: {
        resolveConfig: () => ({ model: 'text-only-x', baseUrl: 'https://x' }),
        renderPages,
        readPage,
        supportsVision: () => false,
      },
    });
    expect(outcome.status).toBe('degraded');
    if (outcome.status === 'degraded') {
      expect(outcome.reason).toBe('no-vision');
      expect(outcome.notice).toContain('text-only-x');
      expect(outcome.text).toBe('A 路线文本');
    }
    expect(renderPages).not.toHaveBeenCalled();
    expect(readPage).not.toHaveBeenCalled();
  });
});
