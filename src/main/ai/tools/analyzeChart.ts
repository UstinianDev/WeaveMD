// ============================================
// WeaveMD — analyzeChart tool handler（B8 六-1 文档工具集）
// ============================================
// 图表分析（只读）：定位图表所在页/章节，返回上下文文本摘录与关联数据表
// （CSV），供 LLM 基于结构化数据分析——不在工具内做像素识读：
// 解析期 D 路线（B7）已把图表转为数据表，工具期重复识读会二次烧 token。
// 定位锚点二选一：page（分页产物）/ image_index（结构化图片序号，docx 等）。

import type { ToolCtx, ToolResult } from '../toolTypes';
import {
  collectHeadingMarks,
  resolveAttachmentTarget,
} from './searchDocument';

/** 上下文摘录上限（完整表格不在此截断，超预算交 S6 落盘）。 */
const EXCERPT_MAX = 2000;

/** 图表分析提示语（显式说明工具不做像素识读，防模型误期待）。 */
export const CHART_ANALYZE_NOTE =
  '图表像素不在工具内识读（解析期 D 路线已将图表转为数据表）；请基于关联数据表与上下文文本分析。';

/** 从正文提取某章节文本（起始于标题行，止于下一同级或更高标题）。 */
function sectionExcerpt(content: string, sectionPath: string[]): string {
  const marks = collectHeadingMarks(content);
  const target = sectionPath[sectionPath.length - 1];
  let startMark: { offset: number; level: number; path: string[] } | undefined;
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    if (marks[i].path[marks[i].path.length - 1] === target) {
      startMark = marks[i];
      break;
    }
  }
  if (!startMark) return '';
  // 起点含标题行本身
  let end = content.length;
  for (const m of marks) {
    if (m.offset > startMark.offset && m.level <= startMark.level) {
      end = m.offset;
      break;
    }
  }
  return content.slice(startMark.offset, end).trim().slice(0, EXCERPT_MAX);
}

export async function handleAnalyzeChart(
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<ToolResult> {
  const rawPage = args.page;
  const rawImageIndex = args.image_index;
  const hasPage = typeof rawPage === 'number' && Number.isInteger(rawPage) && rawPage >= 1;
  const hasImage =
    typeof rawImageIndex === 'number' && Number.isInteger(rawImageIndex) && rawImageIndex >= 1;
  if (!hasPage && !hasImage) {
    return {
      content: '',
      status: 'error',
      errorDesc: '缺少 page 或 image_index 参数（二者至少提供一个用于定位图表）',
    };
  }

  const target = resolveAttachmentTarget(args, ctx);
  if (!target.ok) return { content: '', status: 'error', errorDesc: target.error };
  const rec = target.record;

  let page: number | undefined = hasPage ? (rawPage as number) : undefined;
  let imageIndex: number | undefined;
  let sectionPath: string[] | undefined;

  if (hasImage) {
    const idx = rawImageIndex as number;
    const images = rec.structure?.images ?? [];
    const image = images.find((i) => i.index === idx);
    if (!image) {
      return {
        content: '',
        status: 'error',
        errorDesc: `未找到序号 ${idx} 的图片（该附件未记录图片序号）`,
      };
    }
    imageIndex = image.index;
    sectionPath = image.sectionPath.length > 0 ? image.sectionPath : undefined;
    if (image.pageIndex != null) page = image.pageIndex;
  }

  const offsets = rec.structure?.pageOffsets;
  let excerpt = '';

  if (page != null) {
    if (!offsets || offsets.length === 0) {
      if (!sectionPath) {
        return {
          content: '',
          status: 'error',
          errorDesc: '该附件没有页码结构，无法按页定位图表（可用 image_index）',
        };
      }
    } else {
      if (page > offsets.length) {
        return {
          content: '',
          status: 'error',
          errorDesc: `页码超出范围（1-${offsets.length}）`,
        };
      }
      const start = offsets[page - 1];
      const end = page < offsets.length ? offsets[page] : rec.content.length;
      excerpt = rec.content.slice(start, end).trim().slice(0, EXCERPT_MAX);
    }
  }

  if (!excerpt && sectionPath && sectionPath.length > 0) {
    excerpt = sectionExcerpt(rec.content, sectionPath);
  }

  const tables = rec.structure?.tables ?? [];
  let related: typeof tables = [];
  if (page != null) {
    related = tables.filter((t) => t.pageIndex === page);
    if (related.length === 0 && sectionPath && sectionPath.length > 0) {
      related = tables.filter(
        (t) =>
          t.sectionPath.length >= sectionPath!.length &&
          t.sectionPath.slice(0, sectionPath!.length).every((seg, i) => seg === sectionPath![i])
      );
    }
  } else if (sectionPath && sectionPath.length > 0) {
    related = tables.filter(
      (t) =>
        t.sectionPath.length >= sectionPath!.length &&
        t.sectionPath.slice(0, sectionPath!.length).every((seg, i) => seg === sectionPath![i])
    );
  }

  return {
    content: JSON.stringify({
      attachmentId: rec.id,
      fileName: rec.fileName,
      location: {
        ...(page != null ? { page } : {}),
        ...(imageIndex != null ? { imageIndex } : {}),
        ...(sectionPath && sectionPath.length > 0 ? { sectionPath } : {}),
      },
      ...(excerpt ? { excerpt } : {}),
      tables: related.map((t) => ({
        index: t.index,
        sectionPath: t.sectionPath,
        ...(t.pageIndex != null ? { pageIndex: t.pageIndex } : {}),
        ...(typeof t.csv === 'string' ? { csv: t.csv } : {}),
      })),
      note: CHART_ANALYZE_NOTE,
    }),
    status: 'ok',
  };
}
