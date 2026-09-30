// ============================================
// WeaveMD — memory_read tool handler（agent-memory-optimize 第二批 C1）
// ============================================
// 查询 agent_memory 当前有效记忆（只读）。按 kind / subject / 关键词三类参数过滤：
//   - kind / subject 走 DAO 的 `?` 占位符查询（user_id 归属过滤恒在 SQL 内）；
//   - 关键词在 TS 侧对已取出的本用户行做不区分大小写的子串匹配——避免 LIKE 模糊
//     值进 SQL，SQL 文本里永远不出现用户输入（SECURITY.md）。
// agent-memory-optimize-3 D6 追加语义检索（**向后兼容**：既有调用不传新参数时走原路径零变化）：
//   - 传 `queryVector` → DAO `searchMemories` 混合召回（FTS5 + 向量 RRF 融合）；
//   - 只传 `query` → `searchMemories` 的 trigram FTS-only 召回（未配置 embedding 天然降级）；
//   - 两者都不传 → 既有 kind/subject/keyword 过滤路径，**逐字不变**；
//   - `subject` / `keyword` 在语义路径下仍作 AND 过滤（口径不变）。
// 结果恒为 JSON：{ count, total, items: [...] }，空结果不抛错、不返回 error。

import type { ToolDef } from '@shared/ai';
import type { ToolHandler, ToolResult } from '../toolTypes';
import {
  getActiveBySubject,
  listActiveMemories,
  searchMemories,
  type AgentMemoryKind,
  type AgentMemoryRow,
  type SearchMemoriesOptions,
} from '../../db/agentMemory';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const memoryReadSchema: ToolDef = {
  type: 'function',
  function: {
    name: 'memory_read',
    description:
      '读取本用户的长期记忆（画像/事实/实体，当前有效行）。按 kind 分类、按 subject 精确主题、按 keyword 关键词命中主题或内容；需要跨主题的相似召回时传 query（关键词召回），或同时传 queryVector 走语义混合召回。记忆为空时返回空列表，属正常结果。',
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
        query: {
          type: 'string',
          description:
            '语义检索文本（跨主题相似召回）。不传时保持原有 kind/subject/keyword 过滤行为',
        },
        queryVector: {
          type: 'array',
          items: { type: 'number' },
          description:
            '查询向量（调用方已算好时传入）。传入即走 FTS5 + 向量混合召回；不传则只做关键词召回',
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

/**
 * queryVector 预校验：必须是非空数字数组（且每个分量有限）才进入语义路径。
 * 非法值一律降级为「不传向量」——既有调用方传了垃圾也不会让工具报错。
 */
function parseQueryVector(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw as unknown[];
  if (list.length === 0) return null;
  for (const value of list) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  }
  return list as number[];
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
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const queryVector = parseQueryVector(args.queryVector);

  let rows: AgentMemoryRow[];
  if (query || queryVector) {
    // D6 语义路径：有向量走混合召回，只有 query 走 trigram FTS-only（未配置 embedding 天然降级）
    const opts: SearchMemoriesOptions = { limit };
    if (query) opts.query = query;
    if (queryVector) opts.queryVector = queryVector;
    if (kind) opts.kind = kind;
    try {
      rows = searchMemories(ctx.db, ctx.userId, opts).map((hit) => hit.row);
    } catch (error) {
      return {
        content: '',
        status: 'error',
        errorDesc: `memory_read: 语义检索失败 → ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    // subject 在语义路径下仍是 AND 过滤（口径与既有路径一致）
    if (subject) rows = rows.filter((r) => r.subject === subject);
  } else if (subject && kind) {
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
