// ============================================
// WeaveMD — extractTable tool handler（B8 六-1 文档工具集）
// ============================================
// 提取已解析附件中的表格（只读）。不带 table_index 返回表格清单
// （序号/章节/页码/行列数，供模型先宽后窄选择）；带 table_index 返回
// 该表完整 CSV（B7 两态字段）。handler 层不截断：超预算结果由
// toolResultStorage（S6，10k 单结果/40k 聚合）落盘降级、不丢数据。

import type { ToolCtx, ToolResult } from '../toolTypes';
import { resolveAttachmentTarget } from './searchDocument';

/** 引号感知的最小 CSV 行拆分（计列数用，不引外部库）。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** CSV 行列数（行 = 非空行；列 = 表头行字段数）。 */
function csvDims(csv: string): { rows: number; cols: number } {
  const lines = csv.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: 0, cols: 0 };
  return { rows: lines.length, cols: splitCsvLine(lines[0]).length };
}

export async function handleExtractTable(
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<ToolResult> {
  const rawIndex = args.table_index;
  if (
    rawIndex !== undefined &&
    (typeof rawIndex !== 'number' || !Number.isInteger(rawIndex) || rawIndex < 1)
  ) {
    return { content: '', status: 'error', errorDesc: 'table_index 需为正整数' };
  }

  const target = resolveAttachmentTarget(args, ctx);
  if (!target.ok) return { content: '', status: 'error', errorDesc: target.error };

  const rec = target.record;
  const tables = rec.structure?.tables ?? [];
  if (tables.length === 0) {
    return { content: '', status: 'error', errorDesc: '该附件未解析出表格' };
  }

  if (rawIndex === undefined) {
    // 表格清单：先宽后窄（研究参考 §1 的检索式阅读）
    return {
      content: JSON.stringify({
        attachmentId: rec.id,
        fileName: rec.fileName,
        tables: tables.map((t) => ({
          index: t.index,
          sectionPath: t.sectionPath,
          ...(t.pageIndex != null ? { pageIndex: t.pageIndex } : {}),
          ...(typeof t.csv === 'string' && t.csv ? csvDims(t.csv) : {}),
        })),
        hint: '用 table_index 参数提取指定表格的完整 CSV',
      }),
      status: 'ok',
    };
  }

  const index = rawIndex as number;
  const table = tables.find((t) => t.index === index);
  if (!table) {
    return {
      content: '',
      status: 'error',
      errorDesc: `未找到序号 ${index} 的表格（共 ${tables.length} 张，请先查看清单）`,
    };
  }
  if (typeof table.csv !== 'string' || !table.csv) {
    return {
      content: '',
      status: 'error',
      errorDesc: '该表格缺少 CSV 结构，请用 searchDocument 定位原文',
    };
  }

  const dims = csvDims(table.csv);
  return {
    content: JSON.stringify({
      attachmentId: rec.id,
      fileName: rec.fileName,
      table: {
        index: table.index,
        sectionPath: table.sectionPath,
        ...(table.pageIndex != null ? { pageIndex: table.pageIndex } : {}),
        rows: dims.rows,
        cols: dims.cols,
        csv: table.csv,
      },
    }),
    status: 'ok',
  };
}
