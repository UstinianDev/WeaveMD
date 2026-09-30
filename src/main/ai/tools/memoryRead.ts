// ============================================
// WeaveMD — memory_read tool handler（agent-memory-optimize 第二批 C1）
// ============================================
// 查询 agent_memory 当前有效记忆（只读）。按 kind / subject / 关键词三类参数过滤，
// 不做全文语义检索（req C1 边界）：
//   - kind / subject 走 DAO 的 `?` 占位符查询（user_id 归属过滤恒在 SQL 内）；
//   - 关键词在 TS 侧对已取出的本用户行做不区分大小写的子串匹配——避免 LIKE 模糊
//     值进 SQL，SQL 文本里永远不出现用户输入（SECURITY.md）。
// 结果恒为 JSON：{ count, total, items: [...] }，空结果不抛错、不返回 error。

import type { ToolDef } from '@shared/ai';
import type { ToolHandler, ToolResult } from '../toolTypes';
import {
  getActiveBySubject,
  listActiveMemories,
  type AgentMemoryKind,
  type AgentMemoryRow,
} from '../../db/agentMemory';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const memoryReadSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'memory_read',
    description:
      '读取本用户的长期记忆（画像/事实/实体，当前有效行）。只做参数化过滤，不做语义检索：按 kind 分类、按 subject 精确主题、按 keyword 关键词命中主题或内容。记忆为空时返回空列表，属正常结果。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['profile', 'fact', 'entity'],
          description: '记忆分类：profile（用户画像）/ fact（事实）/ entity（实体），缺省查全部',
        },
        subject: {
          type: 'string',
          description: '主题精确匹配（如 city、role）。与 kind 同时给出时读取该主题最新一条',
        },
        keyword: {
          type: 'string',
          description: '关键词（不区分大小写，命中 subject 或 content）',
        },
        limit: {
          type: 'number',
          description: '返回条数上限（默认 20，1~100）',
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 参数预校验
// ---------------------------------------------------------------------------

const KINDS: readonly string[] = ['profile', 'fact', 'entity'];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseKind(raw: unknown): AgentMemoryKind | undefined {
  return typeof raw === 'string' && KINDS.includes(raw)
    ? (raw as AgentMemoryKind)
    : undefined;
}

function parseLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

function matchKeyword(row: AgentMemoryRow, keyword: string): boolean {
  const hay = `${row.subject}\n${row.content}`.toLowerCase();
  return hay.includes(keyword);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handleMemoryRead: ToolHandler = (args, ctx): ToolResult => {
  // kind 给了就必须合法（LLM 传错立刻收到可自纠的错误，而不是静默查空）
  let kind: AgentMemoryKind | undefined;
  if (args.kind !== undefined && args.kind !== null) {
    kind = parseKind(args.kind);
    if (!kind) {
      return {
        content: '',
        status: 'error',
        errorDesc: 'memory_read: kind 必须为 profile | fact | entity',
      };
    }
  }

  if (!ctx.db) {
    return { content: '', status: 'error', errorDesc: 'memory_read: 数据库未就绪' };
  }

  const subject = typeof args.subject === 'string' ? args.subject.trim() : '';
  const keyword =
    typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
  const limit = parseLimit(args.limit);

  let rows: AgentMemoryRow[];
  if (subject && kind) {
    // 精确主题 + 分类 → DAO 单行读取（同主题多条 active 时取最新一条）
    const row = getActiveBySubject(ctx.db, ctx.userId, kind, subject);
    rows = row ? [row] : [];
  } else {
    rows = listActiveMemories(ctx.db, ctx.userId, kind);
    if (subject) rows = rows.filter((r) => r.subject === subject);
  }
  if (keyword) rows = rows.filter((r) => matchKeyword(r, keyword));

  const total = rows.length;
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    content: r.content,
    source: r.source,
    writtenAt: r.writtenAt,
  }));

  return { content: JSON.stringify({ count: items.length, total, items }), status: 'ok' };
};
