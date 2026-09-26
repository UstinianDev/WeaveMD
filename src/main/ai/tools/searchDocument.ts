// ============================================
// WeaveMD — searchDocument tool handler（B8 六-1 文档工具集）
// ============================================
// 在已解析的会话附件正文（parsed_attachments）中做只读关键词检索，
// 返回命中片段 + 真实页码（structure.pageOffsets 二分，承接 B7）+ 章节路径。
// 与 searchKB 的边界：searchKB 查知识库分块索引（跨文档 FTS5/向量），
// 本工具查当前会话附件的页码级原文片段；与 readLocalFile 的边界：本工具不读原始文件。
//
// 附件解析（attachment_id / file_name / 会话唯一附件）为四工具共用，
// 作为本文件导出被 readPage / extractTable / analyzeChart 复用
// （避免为共享逻辑新增范围外文件，取舍记录于 TDD 报告）。

import type { ToolCtx, ToolResult } from '../toolTypes';
import {
  getParsedAttachment,
  listParsedAttachmentsByConversation,
  type ParsedAttachmentRecord,
} from '../../db/attachments';

// ---------------------------------------------------------------------------
// 附件目标解析（四工具共用）
// ---------------------------------------------------------------------------

export type AttachmentTargetResult =
  | { ok: true; record: ParsedAttachmentRecord }
  | { ok: false; error: string };

/** 解析完成且有正文才可被工具消费。 */
function checkParsed(rec: ParsedAttachmentRecord): AttachmentTargetResult {
  if (rec.parseStatus !== 'done' || !rec.content.trim()) {
    return { ok: false, error: `附件尚未解析完成（当前状态: ${rec.parseStatus}）` };
  }
  return { ok: true, record: rec };
}

/**
 * 解析工具入参指向的附件：attachment_id 精确归属（user_id 过滤）→
 * file_name 会话内按名匹配 → 无提示时取当前会话唯一已解析附件
 * （0 个 / 多个均给出可操作错误，引导重试）。
 */
export function resolveAttachmentTarget(
  args: Record<string, unknown>,
  ctx: ToolCtx
): AttachmentTargetResult {
  const attachmentId = typeof args.attachment_id === 'string' ? args.attachment_id.trim() : '';
  const fileName = typeof args.file_name === 'string' ? args.file_name.trim() : '';

  if (attachmentId) {
    const rec = getParsedAttachment(attachmentId, ctx.userId);
    if (!rec) return { ok: false, error: `附件不存在或不属于当前用户: ${attachmentId}` };
    return checkParsed(rec);
  }

  const conversationId = ctx.currentConversationId ?? '';

  if (fileName) {
    if (!conversationId) return { ok: false, error: '缺少 file_name 匹配所需的会话上下文' };
    const list = listParsedAttachmentsByConversation(conversationId, ctx.userId);
    const rec = list.find((a) => a.fileName === fileName);
    if (!rec) {
      const available = list.map((a) => a.fileName).join(', ') || '无';
      return { ok: false, error: `当前会话未找到附件「${fileName}」（可用: ${available}）` };
    }
    return checkParsed(rec);
  }

  if (!conversationId) {
    return { ok: false, error: '缺少 attachment_id/file_name 参数（无当前会话可解析）' };
  }
  const list = listParsedAttachmentsByConversation(conversationId, ctx.userId);
  const ready = list.filter((a) => a.parseStatus === 'done' && a.content.trim());
  if (ready.length === 1) return { ok: true, record: ready[0] };
  if (ready.length === 0) {
    return {
      ok: false,
      error: '当前会话没有已解析的文档附件，请先上传附件或改用 searchKB 检索知识库',
    };
  }
  return {
    ok: false,
    error: `会话中有多个附件，请用 file_name 或 attachment_id 指定：${ready
      .map((a) => a.fileName)
      .join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// 结构定位辅助（页码 / 章节 / 片段）
// ---------------------------------------------------------------------------

/** 标题标记（扫描期计算的绝对偏移 + 标题栈路径）。 */
interface HeadingMark {
  offset: number;
  level: number;
  path: string[];
}

/** 扫描正文中的标题（围栏代码块内忽略），产出各标题处的标题栈路径。 */
export function collectHeadingMarks(content: string): HeadingMark[] {
  const marks: HeadingMark[] = [];
  const stack: Array<{ level: number; text: string }> = [];
  let pos = 0;
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      pos += line.length + 1;
      continue;
    }
    if (!inFence) {
      const m = /^(#{1,6}) (.+)$/.exec(line);
      if (m) {
        const level = m[1].length;
        while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, text: m[2].trim() });
        marks.push({ offset: pos, level, path: stack.map((s) => s.text) });
      }
    }
    pos += line.length + 1;
  }
  return marks;
}

/** 匹配 offset 处的章节路径（最后一个 offset ≤ 目标的标题；无标题 → []）。 */
export function sectionPathAt(marks: HeadingMark[], offset: number): string[] {
  let lo = 0;
  let hi = marks.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid].offset <= offset) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx >= 0 ? marks[idx].path : [];
}

/** offset 所在页码（pageOffsets 二分；无页码结构 → undefined）。 */
export function pageAt(pageOffsets: number[] | undefined, offset: number): number | undefined {
  if (!pageOffsets || pageOffsets.length === 0) return undefined;
  let lo = 0;
  let hi = pageOffsets.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageOffsets[mid] <= offset) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx + 1;
}

const SNIPPET_PAD = 60;

/** 命中片段（前后各 60 字符，换行归一为单行，不截断丢关键词）。 */
function makeSnippet(content: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_PAD);
  const to = Math.min(content.length, end + SNIPPET_PAD);
  return content
    .slice(from, to)
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// searchDocument
// ---------------------------------------------------------------------------

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

export async function handleSearchDocument(
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return { content: '', status: 'error', errorDesc: '缺少 query 参数' };
  }

  const target = resolveAttachmentTarget(args, ctx);
  if (!target.ok) return { content: '', status: 'error', errorDesc: target.error };

  const rec = target.record;
  const topK =
    typeof args.top_k === 'number' && Number.isFinite(args.top_k)
      ? Math.max(1, Math.min(MAX_TOP_K, Math.floor(args.top_k)))
      : DEFAULT_TOP_K;

  const content = rec.content;
  const lower = content.toLowerCase();
  const needle = query.toLowerCase();
  const marks = collectHeadingMarks(content);
  const offsets = rec.structure?.pageOffsets;

  const matches: Array<{
    offset: number;
    snippet: string;
    page?: number;
    sectionPath: string[];
  }> = [];
  let idx = lower.indexOf(needle);
  while (idx >= 0 && matches.length < topK) {
    const page = pageAt(offsets, idx);
    matches.push({
      offset: idx,
      snippet: makeSnippet(content, idx, idx + needle.length),
      ...(page != null ? { page } : {}),
      sectionPath: sectionPathAt(marks, idx),
    });
    idx = lower.indexOf(needle, idx + needle.length);
  }

  return {
    content: JSON.stringify({
      attachmentId: rec.id,
      fileName: rec.fileName,
      query,
      matchCount: matches.length,
      matches,
    }),
    status: 'ok',
  };
}
