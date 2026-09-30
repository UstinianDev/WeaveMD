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

/**
 * agent_memory 业务行（11 列，camel 映射）。
 * D2 补列的 `access_count` / `last_read_at` 不进本类型 —— 需要它们时走
 * `listActiveMemoryAccess` 窄投影（容量上限排序用），避免污染全部读路径的返回体。
 */
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
  /** D2 补列：读取计数（读取即访问）。旧库升级前为 DEFAULT 0。 */
  access_count: number;
  /** D2 补列：最近一次读取时刻，NULL = 从未被读。 */
  last_read_at: string | null;
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

/** active 行的原始查询（不写库）。策略层扫描走本函数，避免把扫描算成「访问」。 */
function selectActiveRows(
  db: BetterSqlite3Database,
  userId: string,
  kind?: AgentMemoryKind
): AgentMemoryDbRow[] {
  const sql = kind
    ? 'SELECT * FROM agent_memory WHERE user_id = ? AND kind = ? AND valid_to IS NULL ORDER BY id ASC'
    : 'SELECT * FROM agent_memory WHERE user_id = ? AND valid_to IS NULL ORDER BY id ASC';
  return (kind ? db.prepare(sql).all(userId, kind) : db.prepare(sql).all(userId)) as AgentMemoryDbRow[];
}

/**
 * 读取即访问：给本次实际返回的行 `access_count + 1`、`last_read_at` 置当前时刻。
 * - 用「读出的值 + 1」绝对值写回（而非 `access_count = access_count + 1`），避免在 SET 里
 *   混入表达式；单进程同步 better-sqlite3 不存在并发丢更新。
 * - `user_id = ?` 与读取同一归属过滤，跨用户不可能误改。
 * - 策略层（evictStale / mergeConflicts / 容量排序）走 queryActiveMemories，不经过本函数。
 */
function markAccessed(db: BetterSqlite3Database, userId: string, rows: AgentMemoryDbRow[]): void {
  if (rows.length === 0) return;
  const now = nowStamp();
  const stmt = db.prepare(
    'UPDATE agent_memory SET access_count = ?, last_read_at = ? WHERE id = ? AND user_id = ?'
  );
  for (const row of rows) {
    const current = Number.isFinite(row.access_count) ? row.access_count : 0;
    stmt.run(current + 1, now, row.id, userId);
  }
}

/**
 * 当前有效记忆（valid_to IS NULL），按写入顺序 id ASC；kind 缺省不过滤。
 * **读取即访问**：返回的每一行都会 `access_count + 1`。
 */
export function listActiveMemories(
  db: BetterSqlite3Database,
  userId: string,
  kind?: AgentMemoryKind
): AgentMemoryRow[] {
  const rows = selectActiveRows(db, userId, kind);
  markAccessed(db, userId, rows);
  return rows.map(mapRow);
}

/**
 * 当前有效记忆的**不计数**读取（策略层专用）。
 * 与 listActiveMemories 的唯一差别是不写 access_count / last_read_at。
 */
export function queryActiveMemories(
  db: BetterSqlite3Database,
  userId: string,
  kind?: AgentMemoryKind
): AgentMemoryRow[] {
  return selectActiveRows(db, userId, kind).map(mapRow);
}

/** 容量上限排序用的窄投影（只取 id / source / access_count / written_at，不计访问）。 */
export interface AgentMemoryAccessRow {
  id: number;
  userId: string;
  source: AgentMemorySource;
  accessCount: number;
  writtenAt: string;
}

/**
 * 当前有效行的访问计数投影（容量上限排序键），**不计入访问**。
 * 旧库尚未补列时 access_count 读出为 undefined → 归一为 0（保持排序稳定）。
 */
export function listActiveMemoryAccess(
  db: BetterSqlite3Database,
  userId: string
): AgentMemoryAccessRow[] {
  return selectActiveRows(db, userId).map((row) => ({
    id: row.id,
    userId: row.user_id,
    source: row.source as AgentMemorySource,
    accessCount: Number.isFinite(row.access_count) ? row.access_count : 0,
    writtenAt: row.written_at,
  }));
}

/**
 * 有记忆的用户 id 列表（去重）。应用启动触发 runMemoryPolicy 的取数入口 ——
 * 只跑「确实有 agent_memory 行」的用户，空库零开销。
 * `user_id IS NOT NULL` 为显式归属条件（列本身 NOT NULL，保留以符合「读接口必带归属过滤」口径）。
 */
export function listMemoryOwners(db: BetterSqlite3Database): string[] {
  const rows = db
    .prepare('SELECT DISTINCT user_id FROM agent_memory WHERE user_id IS NOT NULL')
    .all() as Array<{ user_id: string }>;
  return [...new Set(rows.map((row) => row.user_id))];
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
  // 只有真正返回的行才计入访问（窗口外的实体被过滤掉，不算读过）
  const fresh = selectActiveRows(db, userId, 'entity').filter(
    (row) => nowMs - parseMemoryStamp(row.written_at) <= windowMs
  );
  markAccessed(db, userId, fresh);
  return fresh.map(mapRow);
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
 * 记忆写入的 upsert 语义（req Q10 冲突清洗 + C2 裁定 6）：
 * 1. 同 user+kind+subject 存在 source='manual' 的 active 行 → **恒赢**，
 *    任何写入都不覆盖，直接返回该行 id 且不写库（manual 行的变更走 C3 物理删除后重写）；
 * 2. 否则 source='auto' 且存在同 user+kind+subject+fingerprint 的 active 行 → **零写入**，
 *    直接返回既有行 id（裁定 6：C1 工具写入与 C2 后台提取两条路径会重复写同一事实，
 *    「关旧插新」对相同内容只会制造垃圾行，故必须真去重）；优先级在 manual 恒赢闸之后；
 * 3. source='manual' 的首次写入仍走「关同指纹 auto 行 + 插 manual 行」——manual 必须落成
 *    可见的手写行，不能被第 2 条的短路吞掉（Q10 manual 恒赢的落库前提）；
 * 4. 无重复 → 直接插。
 * 注：同 subject 不同 fingerprint 的并存行不在本函数清洗（时间新者赢由 C2 memoryWriter 调
 *     runMemoryPolicy 负责）。
 */
export function upsertMemory(db: BetterSqlite3Database, input: AgentMemoryUpsert): number {
  const source: AgentMemorySource = input.source ?? 'auto';
  const activeSiblings = listActiveByKindSubject(db, input.userId, input.kind, input.subject);

  const manual = activeSiblings.find((r) => r.source === 'manual');
  if (manual) return manual.id;

  const sameFingerprint = activeSiblings.filter((r) => r.fingerprint === input.fingerprint);

  if (source === 'auto') {
    // 裁定 6：同指纹零写入（取 id 最大的一条，兼容本规则上线前遗留的重复行）
    if (sameFingerprint.length > 0) {
      return sameFingerprint.reduce((max, r) => (r.id > max.id ? r : max)).id;
    }
  } else {
    // manual 首次写入：关掉同指纹 auto 行（Ledger 不删行），manual 行照常插入
    const validTo = nowStamp();
    for (const dup of sameFingerprint) {
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

// ---------------------------------------------------------------------------
// D5（六.3 防线一 / 防线二）：FTS5 关键词索引查询 + 相似合并驳回标记
// ---------------------------------------------------------------------------

/** trigram 窗口长度（SQLite `tokenize = 'trigram'` 的最小索引单位）。 */
const TRIGRAM_LEN = 3;

/**
 * 单次候选检索最多提交的查询词数。
 * 取值依据：**无实测数据、待校准** —— 48 个词已能覆盖中等长度记忆的大部分窗口，
 * 且避免超长 OR 词表拖慢 MATCH；建议按生产库 `subject+content` 长度分布的 P95 重设。
 */
export const MEMORY_MATCH_MAX_TERMS = 48;

/** 原样切 3 字窗口（不做任何归一，保证与 trigram 索引的切分逐字一致）。 */
function rawTrigrams(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + TRIGRAM_LEN <= text.length; i += 1) {
    out.push(text.slice(i, i + TRIGRAM_LEN));
  }
  return out;
}

/**
 * 记忆文本的 trigram 集合（**小写归一**）。
 * 与策略层的相似度打分共用本函数，保证「索引侧查询词」与「打分侧集合」同一口径，
 * 不会出现两处分词漂移。小写归一是因为 trigram 分词**大小写敏感**
 * （unicode61 才有 case folding，trigram 没有）。
 */
export function memoryTextTrigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const gram of rawTrigrams((text ?? '').toLowerCase())) out.add(gram);
  return out;
}

/**
 * 生成 FTS5 MATCH 查询词：原文 trigram + 小写 trigram（去重），
 * 超上限时**均匀采样**（保证长文本覆盖全文而不是只取开头）。
 * 返回 null 表示文本过短（不足 3 字）无任何可索引单位。
 */
function buildMemoryMatchQuery(
  text: string,
  maxTerms: number = MEMORY_MATCH_MAX_TERMS
): string | null {
  const source = text ?? '';
  const lower = source.toLowerCase();
  const terms = new Set<string>();
  for (const gram of rawTrigrams(source)) terms.add(gram);
  if (lower !== source) {
    for (const gram of rawTrigrams(lower)) terms.add(gram);
  }

  const all = [...terms];
  if (all.length === 0) return null;
  const cap = Math.max(1, Math.floor(maxTerms));
  if (all.length <= cap) return all.map(quoteTrigram).join(' OR ');

  const step = all.length / cap;
  const picked: string[] = [];
  for (let i = 0; i < cap; i += 1) picked.push(all[Math.floor(i * step)]);
  return picked.map(quoteTrigram).join(' OR ');
}

/** FTS5 查询词加引号并转义内部双引号（trigram 查询串必须整体加引号）。 */
function quoteTrigram(gram: string): string {
  return `"${gram.replace(/"/g, '""')}"`;
}

/**
 * 跨 subject 相似合并的**候选检索**（防线一）：FTS5 命中 → 回查基表 → 按归属过滤。
 *
 * - `user_id` / `kind` **不进 FTS**，在这里以普通条件过滤（总指挥裁定 2）；
 * - `valid_to IS NULL` 只取 active（已关闭行不再参与合并）；
 * - 由调用方（策略层）再算精确重合度并排除同 subject 行，本函数只负责**召回**；
 * - **降级口径**：FTS 虚拟表缺失（库未迁移 / 构建不含 FTS5）或引擎不支持 MATCH
 *   时返回空数组 —— 防线一退化为「不合并」，**绝不阻断**防线二（人工审核）
 *   与防线三（过期复核）；不打日志以免每次策略扫描刷屏。
 * 不计访问（策略扫描不算读取，红线同 queryActiveMemories）。
 */
export function querySimilarMemoryCandidates(
  db: BetterSqlite3Database,
  userId: string,
  kind: AgentMemoryKind,
  text: string,
  limit: number
): AgentMemoryRow[] {
  const match = buildMemoryMatchQuery(text);
  if (!match) return [];
  try {
    const rows = db
      .prepare(
        `SELECT m.*
           FROM agent_memory_fts
           JOIN agent_memory m ON m.rowid = agent_memory_fts.rowid
          WHERE agent_memory_fts MATCH ?
            AND m.user_id = ? AND m.kind = ? AND m.valid_to IS NULL
          LIMIT ?`
      )
      .all(match, userId, kind, limit) as AgentMemoryDbRow[];
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

/**
 * 相似合并**驳回**标记（防线二）：`id → merge_skip`。
 * 只读不写、不计访问；返回值只含真正打过标记的行（未打标记的行不进 Map）。
 * 归属过滤 `user_id = ?` 必带（SECURITY.md）。
 */
export function listMergeSkipFlags(db: BetterSqlite3Database, userId: string): Map<number, string> {
  const rows = db
    .prepare('SELECT id, merge_skip FROM agent_memory WHERE user_id = ?')
    .all(userId) as Array<{ id: number; merge_skip?: string | null }>;
  const out = new Map<number, string>();
  for (const row of rows) {
    if (typeof row.merge_skip === 'string' && row.merge_skip.length > 0) {
      out.set(Number(row.id), row.merge_skip);
    }
  }
  return out;
}

/**
 * 给一组行打上合并驳回标记（只 UPDATE 标记列，不碰 content、不置 valid_to、不 DELETE）。
 * 返回实际命中的行数；id 属于他人时因 `user_id = ?` 条件天然不命中。
 */
export function markMergeSkipped(
  db: BetterSqlite3Database,
  userId: string,
  ids: readonly number[],
  stamp: string
): number {
  const stmt = db.prepare(
    'UPDATE agent_memory SET merge_skip = ? WHERE id = ? AND user_id = ?'
  );
  let changed = 0;
  for (const id of ids) {
    if (stmt.run(stamp, id, userId).changes > 0) changed += 1;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// D6（三.3 向量化经验库，Q8 裁定 A）：向量列写入 + FTS5 / 向量混合召回
// ---------------------------------------------------------------------------

/**
 * 混合召回缺省返回条数（与 memory_read 的 DEFAULT_LIMIT 同口径）。
 * 取值依据：**无实测数据、待校准** —— 20 与 C1 工具既有上限一致，建议按
 * 「单次注入记忆条数 / 提示词预算」实测分布重设。
 */
export const MEMORY_SEARCH_DEFAULT_LIMIT = 20;

/** 单次返回条数上限。**无实测数据、待校准**（与 memory_read 的 MAX_LIMIT 同口径）。 */
export const MEMORY_SEARCH_MAX_LIMIT = 100;

/**
 * 每通道候选倍数（FTS 与向量各取 `limit × N` 条参与融合）。
 * 取值依据：**无实测数据、待校准** —— 4 沿用笔记侧 `DEFAULT_CANDIDATE_MULTIPLIER`，
 * 让融合阶段有足够回旋余地；记忆表量级小（D2 容量上限 500），再大只是白耗。
 */
export const MEMORY_SEARCH_CANDIDATE_MULTIPLIER = 4;

/** RRF 常数 k。沿用笔记侧 `kbSearchFts.DEFAULT_RRF_K = 60`（成熟取值，非新造）。 */
export const MEMORY_SEARCH_RRF_K = 60;

/**
 * FTS5 通道权重。**无实测数据、待校准**。
 * 选 RRF 而非加权分数融合的理由：trigram 命中数与余弦相似度**量纲不可比**
 * （一个是窗口计数、一个是 [-1,1] 的几何夹角），RRF 只用名次、无需跨量纲标定，
 * 与笔记侧 `rrfFusion` 同一套思路。权重导出为常量便于后续按标注集实测重设。
 */
export const MEMORY_SEARCH_FTS_WEIGHT = 1;

/** 向量通道权重。**无实测数据、待校准**（与 FTS 等权 = 标准 RRF，不引入未经标定的偏置）。 */
export const MEMORY_SEARCH_VEC_WEIGHT = 1;

/**
 * 向量通道入池阈值（余弦相似度下限）。**无实测数据、待校准**。
 * 低于该值视为噪声、不进向量通道（该行仍可被 FTS 召回）；
 * 0.2 的直觉依据：正交即 0，留一点余量挡住明显无关项，同时不误杀弱相关记忆。
 */
export const MEMORY_SEARCH_VEC_SCORE_THRESHOLD = 0.2;

/** searchMemories 入参（全部可选：都不给 → 返回空数组，调用方回退既有过滤路径）。 */
export interface SearchMemoriesOptions {
  /** 检索文本（走 trigram FTS5 召回）。 */
  query?: string;
  /** 查询向量（走 vec_distance_cosine 召回）。缺失即 FTS-only。 */
  queryVector?: readonly number[];
  /** 分类过滤，两通道都生效。 */
  kind?: AgentMemoryKind;
  /** 返回条数（缺省 {@link MEMORY_SEARCH_DEFAULT_LIMIT}，≤0 → 空数组）。 */
  limit?: number;
}

/** 混合召回命中项。 */
export interface MemorySearchHit {
  row: AgentMemoryRow;
  /** 融合分（加权 RRF 之和，越大越相关）。 */
  score: number;
  /** FTS5 通道名次（1 起），未进该通道时字段缺省。 */
  ftsRank?: number;
  /** 向量通道名次（1 起），未进该通道时字段缺省。 */
  vecRank?: number;
  /** 向量余弦相似度（0~1），未进向量通道时为 null。 */
  vecScore: number | null;
}

/**
 * 向量列写入（参数化 UPDATE，带 `user_id` 归属条件）。
 * 返回是否命中（id 属于该 user_id）。**不写 valid_to、不碰 content**（Ledger 红线）。
 * `vector` 以 Float32 BLOB 落库，与 `kb_chunks.vector` 同构（sqlite-vec 可直接算余弦）。
 */
export function upsertMemoryVector(
  db: BetterSqlite3Database,
  userId: string,
  id: number,
  vector: readonly number[],
  embeddingModel: string
): boolean {
  const info = db
    .prepare(
      'UPDATE agent_memory SET vector = ?, embedding_model = ? WHERE id = ? AND user_id = ?'
    )
    .run(Buffer.from(new Float32Array(vector).buffer), embeddingModel, id, userId);
  return info.changes > 0;
}

/**
 * 该行是否已有向量（写入前置短路用：同指纹去重返回的既有行不必重复调 embedding API）。
 * 归属过滤 `user_id = ?` 必带（SECURITY.md）。
 */
export function hasMemoryVector(db: BetterSqlite3Database, userId: string, id: number): boolean {
  const row = db
    .prepare('SELECT 1 AS c FROM agent_memory WHERE id = ? AND user_id = ? AND vector IS NOT NULL')
    .get(id, userId) as { c: number } | undefined;
  return !!row;
}

/**
 * FTS5 关键词召回通道：trigram MATCH → 回查基表 → 按归属/分类/有效性过滤。
 * - `ORDER BY rank` 不可省：`LIMIT` 只有按相关度截断才有意义，按 rowid（插入序）截断
 *   会把新写入的排在后面，候选质量随表增长劣化；
 * - **降级口径**：虚拟表缺失 / MATCH 不可用时返回空数组（向量通道仍在则纯向量），
 *   不打日志以免每次检索刷屏；不计访问（与 queryActiveMemories 同口径，检索不算读取）。
 */
function queryMemoryFtsChannel(
  db: BetterSqlite3Database,
  userId: string,
  kind: AgentMemoryKind | undefined,
  text: string,
  limit: number
): AgentMemoryRow[] {
  const match = buildMemoryMatchQuery(text);
  if (!match) return [];
  try {
    const rows = (
      kind
        ? db
            .prepare(
              `SELECT m.*
                 FROM agent_memory_fts
                 JOIN agent_memory m ON m.rowid = agent_memory_fts.rowid
                WHERE agent_memory_fts MATCH ?
                  AND m.user_id = ? AND m.kind = ? AND m.valid_to IS NULL
                ORDER BY rank
                LIMIT ?`
            )
            .all(match, userId, kind, limit)
        : db
            .prepare(
              `SELECT m.*
                 FROM agent_memory_fts
                 JOIN agent_memory m ON m.rowid = agent_memory_fts.rowid
                WHERE agent_memory_fts MATCH ?
                  AND m.user_id = ? AND m.valid_to IS NULL
                ORDER BY rank
                LIMIT ?`
            )
            .all(match, userId, limit)
    ) as AgentMemoryDbRow[];
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

/**
 * 向量召回通道：`vec_distance_cosine` 升序取 top-N。
 * - 距离 → 余弦相似度用 `1 - distance`（sqlite-vec 的 vec_distance_cosine = 1 - cos），
 *   与笔记侧 `kbSearchFts.vectorSearch` 的 `1 - distance/2` **口径不同**：后者把正交
 *   映射成 0.5，只保序不保阈值语义；记忆侧是新写的通道，按真实余弦取值（笔记侧不动）；
 * - **不做 embedding_model 过滤**（与 chunks 不同）：记忆向量由本模块单模型写入，
 *   切换模型由回填按 `embedding_model IS NOT ?` 重算，查询侧过滤会让切换瞬间召回归零；
 * - sqlite-vec 扩展缺失 / 向量列未迁移 → prepare 抛错，静默返回空 Map，检索退化 FTS-only；
 * - 返回按相似度降序的 `id → 余弦相似度`，已套用 {@link MEMORY_SEARCH_VEC_SCORE_THRESHOLD}。
 */
function queryMemoryVectorChannel(
  db: BetterSqlite3Database,
  userId: string,
  kind: AgentMemoryKind | undefined,
  queryVector: readonly number[],
  limit: number
): Map<number, { row: AgentMemoryRow; similarity: number }> {
  const out = new Map<number, { row: AgentMemoryRow; similarity: number }>();
  try {
    const rows = (
      kind
        ? db
            .prepare(
              `SELECT m.*, vec_distance_cosine(m.vector, ?) AS distance
                 FROM agent_memory m
                WHERE m.user_id = ? AND m.valid_to IS NULL AND m.vector IS NOT NULL
                  AND m.kind = ?
                ORDER BY distance ASC
                LIMIT ?`
            )
            .all(Buffer.from(new Float32Array(queryVector).buffer), userId, kind, limit)
        : db
            .prepare(
              `SELECT m.*, vec_distance_cosine(m.vector, ?) AS distance
                 FROM agent_memory m
                WHERE m.user_id = ? AND m.valid_to IS NULL AND m.vector IS NOT NULL
                ORDER BY distance ASC
                LIMIT ?`
            )
            .all(Buffer.from(new Float32Array(queryVector).buffer), userId, limit)
    ) as Array<AgentMemoryDbRow & { distance: number }>;

    for (const raw of rows) {
      const similarity = Math.max(0, Math.min(1, 1 - Number(raw.distance)));
      if (similarity >= MEMORY_SEARCH_VEC_SCORE_THRESHOLD) {
        out.set(raw.id, { row: mapRow(raw), similarity });
      }
    }
  } catch {
    // sqlite-vec 不可用 → 静默降级（调用方只看到 FTS 通道）
  }
  return out;
}

/** 返回条数归一：缺省/非有限数 → 默认值；≤0 → 0（调用方直接返回空）。 */
function normalizeSearchLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return MEMORY_SEARCH_DEFAULT_LIMIT;
  if (raw <= 0) return 0;
  return Math.min(MEMORY_SEARCH_MAX_LIMIT, Math.floor(raw));
}

/**
 * 记忆混合检索（D6 独立入口，**不复用笔记的 0.6 拒答阈值与出处跳转**）。
 *
 * 分流口径（req §二 D6 范围 4）：
 * - 有 `queryVector` → FTS5 + 向量双通道加权 RRF 融合；
 * - 无 `queryVector` / sqlite-vec 缺失 / embedding 未配置（向量列全 NULL）→ **只走 trigram FTS5**，
 *   不报错、不抛异常；
 * - `query` 与 `queryVector` 都缺 → 空数组（调用方回退 kind/subject/keyword 既有过滤路径）。
 *
 * 两条通道**都带 `user_id = ?` 与 `valid_to IS NULL`**；`merge_skip` 驳回标记**不参与过滤** ——
 * 该标记只禁「自动相似合并与合并建议」，被用户否掉的是合并动作而不是记忆本身，
 * 把它过滤掉会让有效记忆从召回里消失（误伤）。
 */
export function searchMemories(
  db: BetterSqlite3Database,
  userId: string,
  opts: SearchMemoriesOptions = {}
): MemorySearchHit[] {
  const query = typeof opts.query === 'string' ? opts.query.trim() : '';
  const rawVector: unknown = opts.queryVector;
  const queryVector: readonly number[] | null =
    Array.isArray(rawVector) && rawVector.length > 0 ? (rawVector as readonly number[]) : null;
  if (!query && !queryVector) return [];

  const limit = normalizeSearchLimit(opts.limit);
  if (limit <= 0) return [];
  const candidateLimit = limit * MEMORY_SEARCH_CANDIDATE_MULTIPLIER;

  const ftsRows = query
    ? queryMemoryFtsChannel(db, userId, opts.kind, query, candidateLimit)
    : [];
  const vecChannel = queryVector
    ? queryMemoryVectorChannel(db, userId, opts.kind, queryVector, candidateLimit)
    : new Map<number, { row: AgentMemoryRow; similarity: number }>();

  const ftsRank = new Map<number, number>();
  ftsRows.forEach((row, i) => ftsRank.set(row.id, i + 1));
  const vecRank = new Map<number, number>();
  [...vecChannel.keys()].forEach((id, i) => vecRank.set(id, i + 1));

  // 两通道都已带 user_id + valid_to 条件，这里只做按 id 合并（同一行两侧数据一致）
  const rowsById = new Map<number, AgentMemoryRow>();
  for (const row of ftsRows) rowsById.set(row.id, row);
  for (const [id, entry] of vecChannel) {
    if (!rowsById.has(id)) rowsById.set(id, entry.row);
  }

  const hits: MemorySearchHit[] = [];
  for (const [id, row] of rowsById) {
    const fr = ftsRank.get(id);
    const vr = vecRank.get(id);
    let score = 0;
    if (fr !== undefined) score += MEMORY_SEARCH_FTS_WEIGHT / (MEMORY_SEARCH_RRF_K + fr);
    if (vr !== undefined) score += MEMORY_SEARCH_VEC_WEIGHT / (MEMORY_SEARCH_RRF_K + vr);

    const vecEntry = vr !== undefined ? vecChannel.get(id) : undefined;
    const hit: MemorySearchHit = { row, score, vecScore: vecEntry ? vecEntry.similarity : null };
    if (fr !== undefined) hit.ftsRank = fr;
    if (vr !== undefined) hit.vecRank = vr;
    hits.push(hit);
  }

  hits.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.row.id - b.row.id));
  return hits.slice(0, limit);
}
