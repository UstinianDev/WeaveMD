// ============================================
// WeaveMD — agent_memory DAO（agent-memory-optimize 第二批 B1）
// ============================================
// 单表承载三类记忆（kind 分区：profile / fact / entity）+ 双时间：
//   valid_from / valid_to（业务有效时间，NULL = 当前有效）+ written_at（系统写入时间）。
// Ledger 规则（req Q10 / B2）：更新走「旧行置 valid_to + 插新行」——
//   closeMemory 只 UPDATE valid_to，绝不改 content、绝不 DELETE；
//   仅 C3 用户在设置页显式单条删除走 deleteMemory 物理 DELETE（req 裁定，带 user_id 条件）。
// 全部 SQL 使用 `?` 占位符，读接口一律带 user_id = ? 归属过滤（SECURITY.md），绝无值拼接。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

export type AgentMemoryKind = 'profile' | 'fact' | 'entity';
export type AgentMemorySource = 'auto' | 'manual';

/** agent_memory 行（11 列全量，camel 映射）。 */
export interface AgentMemoryRow {
  id: number;
  userId: string;
  kind: AgentMemoryKind;
  subject: string;
  content: string;
  /** 'auto'（Agent 写）| 'manual'（用户手写，Q10 恒赢） */
  source: AgentMemorySource;
  conversationId: string | null;
  /** content 归一化 hash，B2 语义去重依据 */
  fingerprint: string;
  validFrom: string;
  /** NULL = 当前有效；置值 = Ledger 关闭（不删行） */
  validTo: string | null;
  writtenAt: string;
}

/** insertMemory 入参：业务列显式给全；source / conversationId 缺省与列 DEFAULT 同口径。 */
export interface AgentMemoryInsert {
  userId: string;
  kind: AgentMemoryKind;
  subject: string;
  content: string;
  fingerprint: string;
  source?: AgentMemorySource;
  conversationId?: string | null;
}

/** upsertMemory 入参（C1 memory_write 直接透传工具入参）。 */
export interface AgentMemoryUpsert {
  userId: string;
  kind: AgentMemoryKind;
  subject: string;
  content: string;
  fingerprint: string;
  source?: AgentMemorySource;
  conversationId?: string | null;
}

/** DB 行（snake_case，与表列一一对应）。 */
interface AgentMemoryDbRow {
  id: number;
  user_id: string;
  kind: string;
  subject: string;
  content: string;
  source: string;
  conversation_id: string | null;
  fingerprint: string;
  valid_from: string;
  valid_to: string | null;
  written_at: string;
}

function mapRow(row: AgentMemoryDbRow): AgentMemoryRow {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as AgentMemoryKind,
    subject: row.subject,
    content: row.content,
    source: row.source as AgentMemorySource,
    conversationId: row.conversation_id,
    fingerprint: row.fingerprint,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    writtenAt: row.written_at,
  };
}

/** 与 SQLite `datetime('now')` 同口径的 UTC 秒级时间戳（关闭旧行时用）。 */
function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** 导出版时间戳口径（memoryPolicy 等策略层复用，避免各自造格式）。 */
export function memoryNowStamp(): string {
  return nowStamp();
}

/**
 * 解析 `YYYY-MM-DD HH:MM:SS`（UTC）为毫秒 epoch。
 * `written_at` / `valid_to` / `valid_from` 三列统一走本函数，保证「近 N 天」与
 * 「超龄驱逐」两处口径一致；无法解析直接抛错（宁可红也不静默算错时间）。
 */
export function parseMemoryStamp(stamp: string): number {
  const normalized = stamp.trim().replace('T', ' ').replace(/Z$/i, '');
  const ms = Date.parse(`${normalized.replace(' ', 'T')}Z`);
  if (Number.isNaN(ms)) throw new Error(`agentMemory: 无法解析时间戳 → ${stamp}`);
  return ms;
}

const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// 写：insert / close / delete
// ---------------------------------------------------------------------------

/** 插入一行记忆，返回新行 id（written_at / valid_from 用 datetime('now')）。 */
export function insertMemory(db: BetterSqlite3Database, row: AgentMemoryInsert): number {
  const info = db
    .prepare(
      `INSERT INTO agent_memory
         (user_id, kind, subject, content, source, conversation_id, fingerprint, valid_from, written_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(
      row.userId,
      row.kind,
      row.subject,
      row.content,
      row.source ?? 'auto',
      row.conversationId ?? null,
      row.fingerprint
    );
  return Number(info.lastInsertRowid);
}

/**
 * Ledger 关闭：只 UPDATE valid_to，不改 content、不 DELETE。
 * 幂等闸（B2 裁定 1）：附加 `valid_to IS NULL`——已关闭行再次 close 不命中，
 * 避免重复关闭覆盖原始关闭时间。
 * 返回是否命中（id 属于该 user_id 且当前仍 active）。
 */
export function closeMemory(
  db: BetterSqlite3Database,
  userId: string,
  id: number,
  validTo: string
): boolean {
  const info = db
    .prepare(
      'UPDATE agent_memory SET valid_to = ? WHERE id = ? AND user_id = ? AND valid_to IS NULL'
    )
    .run(validTo, id, userId);
  return info.changes > 0;
}

/** C3 用户显式删除：物理 DELETE（req 裁定），必须带 user_id 条件。 */
export function deleteMemory(db: BetterSqlite3Database, userId: string, id: number): boolean {
  const info = db
    .prepare('DELETE FROM agent_memory WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// 读：全部带 user_id = ? 过滤
// ---------------------------------------------------------------------------

/** 当前有效记忆（valid_to IS NULL），按写入顺序 id ASC；kind 缺省不过滤。 */
export function listActiveMemories(
  db: BetterSqlite3Database,
  userId: string,
  kind?: AgentMemoryKind
): AgentMemoryRow[] {
  const sql = kind
    ? 'SELECT * FROM agent_memory WHERE user_id = ? AND kind = ? AND valid_to IS NULL ORDER BY id ASC'
    : 'SELECT * FROM agent_memory WHERE user_id = ? AND valid_to IS NULL ORDER BY id ASC';
  const rows = (
    kind ? db.prepare(sql).all(userId, kind) : db.prepare(sql).all(userId)
  ) as AgentMemoryDbRow[];
  return rows.map(mapRow);
}

/** 全量记忆（含已关闭，C3 列表用），按 id ASC；kind 缺省不过滤。 */
export function listMemories(
  db: BetterSqlite3Database,
  userId: string,
  kind?: AgentMemoryKind
): AgentMemoryRow[] {
  const sql = kind
    ? 'SELECT * FROM agent_memory WHERE user_id = ? AND kind = ? ORDER BY id ASC'
    : 'SELECT * FROM agent_memory WHERE user_id = ? ORDER BY id ASC';
  const rows = (
    kind ? db.prepare(sql).all(userId, kind) : db.prepare(sql).all(userId)
  ) as AgentMemoryDbRow[];
  return rows.map(mapRow);
}

/** 同 kind+subject 存在多条 active 时返回最新一条（id DESC）。 */
export function getActiveBySubject(
  db: BetterSqlite3Database,
  userId: string,
  kind: AgentMemoryKind,
  subject: string
): AgentMemoryRow | undefined {
  const row = db
    .prepare(
      `SELECT * FROM agent_memory
        WHERE user_id = ? AND kind = ? AND subject = ? AND valid_to IS NULL
        ORDER BY id DESC LIMIT 1`
    )
    .get(userId, kind, subject) as AgentMemoryDbRow | undefined;
  return row ? mapRow(row) : undefined;
}

/** 按 fingerprint 精确取 active 行（B2 语义去重 / C1 回读用）。 */
export function getActiveByFingerprint(
  db: BetterSqlite3Database,
  userId: string,
  fingerprint: string
): AgentMemoryRow | undefined {
  const row = db
    .prepare(
      `SELECT * FROM agent_memory
        WHERE user_id = ? AND fingerprint = ? AND valid_to IS NULL
        ORDER BY id DESC LIMIT 1`
    )
    .get(userId, fingerprint) as AgentMemoryDbRow | undefined;
  return row ? mapRow(row) : undefined;
}

// ---------------------------------------------------------------------------
// Views（B2）：三类记忆视图 —— 走 DAO 查询函数，不建 SQL VIEW（req 裁定 2/3）
// ---------------------------------------------------------------------------

/** 活跃话题聚合项。 */
export interface AgentMemoryTopic {
  subject: string;
  count: number;
  lastWrittenAt: string;
}

/**
 * 视图一：当前有效画像（kind='profile' 且 active）。
 */
export function getActiveProfile(db: BetterSqlite3Database, userId: string): AgentMemoryRow[] {
  return listActiveMemories(db, userId, 'profile');
}

/**
 * 视图二：近 N 天实体（kind='entity' 且 active）。
 * SQL 只用 `user_id = ?` / `kind = ?` / `valid_to IS NULL` 等值条件取候选行，
 * 「近 N 天」在 TS 侧过滤（记忆量级小，且保持 SQL 简单参数化）。
 * 窗口口径：`now - written_at <= days * 86400000`（含正好 N 天的边界）。
 * `now` 缺省取当前 UTC 秒级时间戳，显式传入便于测试锁定边界。
 */
export function getRecentEntities(
  db: BetterSqlite3Database,
  userId: string,
  days: number,
  now: string = memoryNowStamp()
): AgentMemoryRow[] {
  const nowMs = parseMemoryStamp(now);
  const windowMs = Math.max(0, days) * DAY_MS;
  return listActiveMemories(db, userId, 'entity').filter(
    (row) => nowMs - parseMemoryStamp(row.writtenAt) <= windowMs
  );
}

/**
 * 视图三：活跃话题聚合（active 行按 subject 分组）。
 * 排序：count 降序 → lastWrittenAt 新者优先 → subject 升序（最终稳定 tie-break）。
 * `limit` 非正数返回空数组。
 */
export function getActiveTopics(
  db: BetterSqlite3Database,
  userId: string,
  limit: number
): AgentMemoryTopic[] {
  const buckets = new Map<string, { count: number; lastWrittenAt: string }>();
  for (const row of listActiveMemories(db, userId)) {
    const cur = buckets.get(row.subject);
    if (!cur) {
      buckets.set(row.subject, { count: 1, lastWrittenAt: row.writtenAt });
    } else {
      cur.count += 1;
      if (row.writtenAt > cur.lastWrittenAt) cur.lastWrittenAt = row.writtenAt;
    }
  }

  const topics: AgentMemoryTopic[] = [];
  for (const [subject, bucket] of buckets) {
    topics.push({ subject, count: bucket.count, lastWrittenAt: bucket.lastWrittenAt });
  }
  topics.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.lastWrittenAt !== b.lastWrittenAt) return a.lastWrittenAt < b.lastWrittenAt ? 1 : -1;
    if (a.subject === b.subject) return 0;
    return a.subject < b.subject ? -1 : 1;
  });

  if (!Number.isFinite(limit) || limit <= 0) return [];
  return topics.slice(0, Math.floor(limit));
}

// ---------------------------------------------------------------------------
// 内部查询（upsert 用，不导出）
// ---------------------------------------------------------------------------

/** 同 user+kind+subject 的 active 行（upsert 的冲突判定基集）。 */
function listActiveByKindSubject(
  db: BetterSqlite3Database,
  userId: string,
  kind: AgentMemoryKind,
  subject: string
): AgentMemoryRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_memory
        WHERE user_id = ? AND kind = ? AND subject = ? AND valid_to IS NULL
        ORDER BY id ASC`
    )
    .all(userId, kind, subject) as AgentMemoryDbRow[];
  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// upsert（C1 memory_write）
// ---------------------------------------------------------------------------

/**
 * 记忆写入的 upsert 语义（req Q10 冲突清洗）：
 * 1. 同 user+kind+subject 存在 source='manual' 的 active 行 → **恒赢**，
 *    任何写入都不覆盖，直接返回该行 id 且不写库（manual 行的变更走 C3 物理删除后重写）；
 * 2. 否则同 kind+subject+fingerprint 的 active 行 → 关旧（closeMemory 置 valid_to）+ 插新；
 * 3. 无重复 → 直接插。
 * 注：同 subject 不同 fingerprint 的并存行不在本函数清洗（时间新者赢由 C2 memoryWriter 负责）。
 */
export function upsertMemory(db: BetterSqlite3Database, input: AgentMemoryUpsert): number {
  const source: AgentMemorySource = input.source ?? 'auto';
  const activeSiblings = listActiveByKindSubject(db, input.userId, input.kind, input.subject);

  const manual = activeSiblings.find((r) => r.source === 'manual');
  if (manual) return manual.id;

  const validTo = nowStamp();
  for (const dup of activeSiblings) {
    if (dup.fingerprint === input.fingerprint) {
      closeMemory(db, input.userId, dup.id, validTo);
    }
  }

  return insertMemory(db, {
    userId: input.userId,
    kind: input.kind,
    subject: input.subject,
    content: input.content,
    fingerprint: input.fingerprint,
    source,
    conversationId: input.conversationId ?? null,
  });
}
