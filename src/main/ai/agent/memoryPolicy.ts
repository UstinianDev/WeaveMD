// ============================================
// WeaveMD — agent_memory 记忆策略（agent-memory-optimize 第二批 B2）
// ============================================
// Ledger 执行策略（纯策略层）：只读 active 行 + 通过 closeMemory 置 valid_to 关闭，
// **绝不 DELETE、绝不改 content**（Ledger 不删行，req B2）。db 首参注入，不碰 IPC / UI。
// 三条硬规则：
//   1. 时间衰减只作用于 source='auto' —— `memory.md` 手写值（manual）恒免于自动驱逐；
//   2. 冲突合并只关闭「非 manual 的败者」—— manual 恒免于合并覆盖（manual 之间的冲突
//      留给 C3 用户显式删除处置，Policy 不动用户手写行）；
//   3. 全部 SQL 由 DAO 层以 `?` 参数化并带 `user_id = ?`，本文件不写 SQL。
// 时间过滤与分组聚合都在 TS 侧做（记忆量级小，且保持 SQL 简单参数化）。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import {
  closeMemory,
  listActiveMemories,
  memoryNowStamp,
  parseMemoryStamp,
  type AgentMemoryRow,
} from '../../db/agentMemory';

const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// 默认策略常量
// ---------------------------------------------------------------------------

/**
 * 时间衰减默认窗口（天）。
 * 取值依据：**当前无实测数据**，取保守值 90 天——偏长保留，避免误关跨季度才复用的
 * 画像/实体（关闭后 active 视图不再返回）。
 * 待实测校准：建议按 active 行 `written_at` 距今分布的 P90 重设。
 */
export const MEMORY_EVICT_MAX_AGE_DAYS = 90;

// ---------------------------------------------------------------------------
// 时间衰减
// ---------------------------------------------------------------------------

export interface MemoryEvictOptions {
  /** 超龄阈值（天），超过即关闭 */
  maxAgeDays: number;
  /** 判定基准时刻（UTC `YYYY-MM-DD HH:MM:SS`），缺省取当前时刻 */
  now?: string;
}

/**
 * 时间衰减驱逐：active 且非 manual 且 `written_at` 超龄 → closeMemory。
 * 超龄口径：`now - written_at > maxAgeDays * 86400000`（正好等于窗口仍保留，
 * 与 DAO 的 getRecentEntities「近 N 天含边界」互补）。
 * 返回本次关闭条数。
 */
export function evictStale(
  db: BetterSqlite3Database,
  userId: string,
  opts: MemoryEvictOptions
): number {
  const stamp = opts.now ?? memoryNowStamp();
  const nowMs = parseMemoryStamp(stamp);
  const maxAgeMs = Math.max(0, opts.maxAgeDays) * DAY_MS;

  let closed = 0;
  for (const row of listActiveMemories(db, userId)) {
    // 红线：memory.md 手写值永不驱逐
    if (row.source === 'manual') continue;
    if (nowMs - parseMemoryStamp(row.writtenAt) <= maxAgeMs) continue;
    if (closeMemory(db, userId, row.id, stamp)) closed += 1;
  }
  return closed;
}

// ---------------------------------------------------------------------------
// 冲突合并
// ---------------------------------------------------------------------------

/** 胜者排序：manual 优先 → written_at 新者赢 → 同刻 id 大者赢。 */
function compareWinner(a: AgentMemoryRow, b: AgentMemoryRow): number {
  const aRank = a.source === 'manual' ? 0 : 1;
  const bRank = b.source === 'manual' ? 0 : 1;
  if (aRank !== bRank) return aRank - bRank;
  if (a.writtenAt !== b.writtenAt) return a.writtenAt < b.writtenAt ? 1 : -1;
  return b.id - a.id;
}

/**
 * 冲突合并：同 `user_id + kind + subject` 的 active 行 ≥2 时收敛为一条。
 * 胜者 = manual 优先 → 其余按 written_at 新者赢（同刻按 id 大者）；
 * 败者中非 manual 的行全部 closeMemory（仍留在库，Ledger 不删行）。
 * manual 败者不关（红线：manual 恒免于合并覆盖）——因此同组若有多条 manual，
 * 它们会并存，留给 C3 用户显式删除。
 * 返回本次关闭条数。
 */
export function mergeConflicts(
  db: BetterSqlite3Database,
  userId: string,
  now: string = memoryNowStamp()
): number {
  const groups = new Map<string, AgentMemoryRow[]>();
  for (const row of listActiveMemories(db, userId)) {
    // kind 是固定枚举（不含空格），subject 为自由文本 → 分隔符落在 kind 之后不会歧义
    const key = `${row.kind} ${row.subject}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  let closed = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const winner = [...rows].sort(compareWinner)[0];
    for (const row of rows) {
      if (row.id === winner.id) continue;
      if (row.source === 'manual') continue;
      if (closeMemory(db, userId, row.id, now)) closed += 1;
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// 编排入口（供 C2 后台触发复用）
// ---------------------------------------------------------------------------

export interface MemoryPolicyOptions {
  /** 覆盖默认衰减窗口（天），缺省 MEMORY_EVICT_MAX_AGE_DAYS */
  maxAgeDays?: number;
  /** 判定基准时刻（UTC `YYYY-MM-DD HH:MM:SS`），缺省取当前时刻 */
  now?: string;
}

/**
 * 一次性跑完整策略，返回两类计数。
 * 顺序：**先 merge 后 evict** ——
 *   1) merge 关掉的败者随即退出 active，evict 不会再看到它们，计数口径不重叠；
 *   2) 若先 evict，超龄败者会被算进 evicted，且冲突组里被年龄筛剩的幸存者
 *      可能不是「最新」那条，胜者判定会被驱逐顺序干扰。
 */
export function runMemoryPolicy(
  db: BetterSqlite3Database,
  userId: string,
  opts: MemoryPolicyOptions = {}
): { evicted: number; merged: number } {
  const now = opts.now ?? memoryNowStamp();
  const merged = mergeConflicts(db, userId, now);
  const evicted = evictStale(db, userId, {
    maxAgeDays: opts.maxAgeDays ?? MEMORY_EVICT_MAX_AGE_DAYS,
    now,
  });
  return { evicted, merged };
}
