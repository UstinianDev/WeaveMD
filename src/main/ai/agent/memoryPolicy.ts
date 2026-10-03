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
// D2 追加（五.4 遗忘/过期机制）：
//   4. 容量上限同样**永不关闭 manual**（与 1/2 同口径的第三处豁免）；
//   5. 策略扫描一律走 DAO 的 queryActiveMemories / listActiveMemoryAccess
//      （**不计访问**），只有真正返回给调用方的读接口才累加 access_count。
// D5 追加（六.3 防膨胀三防线）：
//   6. **跨 subject 语义合并**走 FTS5 关键词重合度（同 kind、同 user_id、active），
//      胜者规则与 2 完全一致（manual 优先 → written_at 新者 → id 大者），
//      败者同样只 closeMemory 不删行；**打过 merge_skip 驳回标记的行一律不参与**；
//      阈值无实测数据、待校准；不引入 embedding（向量归 Gate F 三.3）。
// 时间过滤与分组聚合都在 TS 侧做（记忆量级小，且保持 SQL 简单参数化）。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

import {
  closeMemory,
  listActiveMemoryAccess,
  listMergeSkipFlags,
  listMemoryOwners,
  markMergeSkipped,
  memoryNowStamp,
  memoryTextTrigrams,
  parseMemoryStamp,
  queryActiveMemories,
  querySimilarMemoryCandidates,
  type AgentMemoryAccessRow,
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

/**
 * 单用户 active 记忆条数上限（容量上限驱逐）。
 * 取值依据：**无实测数据、待校准** —— 保守取 500（远大于画像/实体的合理量级，
 * 保证本批只建立闸门、不造成实际误关）。
 * 待实测校准：建议按生产库 `valid_to IS NULL` 行数分布的 **P95** 重设；
 * 在拿到分布前不得凭感觉下调（下调即批量关闭用户可见记忆）。
 */
export const MAX_ACTIVE_MEMORIES = 500;

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
  for (const row of queryActiveMemories(db, userId)) {
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
  for (const row of queryActiveMemories(db, userId)) {
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
// 跨 subject 语义合并（第三批 D5 / 六.3 防线一）
// ---------------------------------------------------------------------------

/**
 * 跨 subject 相似合并阈值（trigram 重合度，0~1）。
 * 取值依据：**无实测数据、待校准** —— 0.5 相当于「两段文本的 3 字窗口有一半重合」，
 * 对「措辞略不同、语义同一条」的记忆（本批构造的近重复样本）能召回，
 * 对无关文本不会误伤。待实测校准：建议按生产库人工判定的相似对标注集
 * 调 ROC 取 F1 最优点；**下调前必须先评估误合并风险**（合并会关闭败者行）。
 */
export const MEMORY_MERGE_SIMILAR_THRESHOLD = 0.5;

/**
 * 单行候选召回上限（FTS5 MATCH 的 LIMIT）。
 * 取值依据：**无实测数据、待校准** —— 32 足以让 50 条近重复样本经
 * 双向配对收敛成一组，同时避免单次策略扫描退化成全表比对。
 */
export const MEMORY_MERGE_CANDIDATE_LIMIT = 32;

export interface MemoryMergeOptions {
  /** 相似度阈值（0,1]，缺省 {@link MEMORY_MERGE_SIMILAR_THRESHOLD} */
  threshold?: number;
  /** 判定与关闭时刻（UTC `YYYY-MM-DD HH:MM:SS`），缺省取当前时刻 */
  now?: string;
  /** 单行候选召回上限，缺省 {@link MEMORY_MERGE_CANDIDATE_LIMIT} */
  candidateLimit?: number;
}

export interface MemoryMergeGroup {
  /** 组内成员所属 kind（合并只在同 kind 内发生） */
  kind: AgentMemoryRow['kind'];
  /** 组内两两相似度的最大值（展示用，0~1） */
  score: number;
  /** 胜者 id（manual 优先 → written_at 新者 → id 大者） */
  winnerId: number;
  /** 组内成员，按 id 升序 */
  members: AgentMemoryRow[];
}

/** 阈值校验：必须落在 (0,1]，否则直接抛错（宁可红也不静默按错阈值合并）。 */
function resolveThreshold(threshold: number | undefined): number {
  const value = threshold ?? MEMORY_MERGE_SIMILAR_THRESHOLD;
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`memoryPolicy: 相似合并阈值必须落在 (0,1] → ${String(threshold)}`);
  }
  return value;
}

/**
 * 两条记忆的相似度：`subject + '\n' + content` 的 trigram **交集 / 并集**（Jaccard）。
 * 分词口径与索引侧完全一致（都走 DAO 的 `memoryTextTrigrams`，小写归一）。
 * 任一侧无 trigram（文本不足 3 字）返回 0，绝不返回 NaN。
 */
export function memorySimilarityScore(a: AgentMemoryRow, b: AgentMemoryRow): number {
  return scoreWithTrigrams(newTrigramMemo(), a, b);
}

// ---------------------------------------------------------------------------
// trigram 记忆化（性能：MEM-2）
// ---------------------------------------------------------------------------
// 打分口径与 `memoryTextTrigrams` 逐字一致，只是把「同一段文本的 Set」在**单次扫描内**
// 缓存一次。原实现对每对 (a,b) 都重建双方 Set：`findSimilarMergeGroups` 每行对
// 至多 32 个候选打分（N×32 次重建），组内 `maxPairScore` 又是 O(n²) 次，
// `isSimilarGroup` 再 O(n²) 次 —— 同一段文本被重建数十次。
// 缓存生命周期严格限定在一次调用内（Map 是局部变量），不存在跨调用失效问题。
//
// **键取文本本身，不取行 id**：id 不是打分函数的输入 —— 同一行内容在不同批次/夹具里
// 可能共用 id（测试夹具常见），按 id 缓存会把不同文本误判成同一段。按文本缓存既无碰撞，
// 又能让「近重复记忆」（本功能的主场景）直接命中同一条。

/** 单次扫描的 trigram 记忆表（key = `subject + '\n' + content`）。 */
type TrigramMemo = Map<string, Set<string>>;

function newTrigramMemo(): TrigramMemo {
  return new Map();
}

/** 打分输入文本（与 `memoryTextTrigrams` 的入参同口径，单一口径不漂移）。 */
function similarityText(row: AgentMemoryRow): string {
  return `${row.subject}\n${row.content}`;
}

/** 取该文本的 trigram Set（同一次扫描内只算一次）。 */
function trigramsOf(memo: TrigramMemo, row: AgentMemoryRow): Set<string> {
  const key = similarityText(row);
  let set = memo.get(key);
  if (set === undefined) {
    set = memoryTextTrigrams(key);
    memo.set(key, set);
  }
  return set;
}

/** 记忆化版本的相似度打分（口径与 {@link memorySimilarityScore} 逐字一致）。 */
function scoreWithTrigrams(
  memo: TrigramMemo,
  a: AgentMemoryRow,
  b: AgentMemoryRow
): number {
  const setA = trigramsOf(memo, a);
  const setB = trigramsOf(memo, b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const gram of setA) {
    if (setB.has(gram)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 组内两两相似度的最大值（展示口径）。 */
function maxPairScore(members: AgentMemoryRow[], memo: TrigramMemo): number {
  let max = 0;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const score = scoreWithTrigrams(memo, members[i], members[j]);
      if (score > max) max = score;
    }
  }
  return max;
}

/** 判断给定行集合是否构成**连通**的相似组（显式采纳/驳回的入参合法性校验）。 */
function isSimilarGroup(
  rows: AgentMemoryRow[],
  threshold: number,
  memo: TrigramMemo = newTrigramMemo()
): boolean {
  if (rows.length < 2) return false;
  const n = rows.length;
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let visited = 1;
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    for (let i = 0; i < n; i += 1) {
      if (seen[i]) continue;
      if (scoreWithTrigrams(memo, rows[cur], rows[i]) < threshold) continue;
      seen[i] = true;
      visited += 1;
      stack.push(i);
    }
  }
  return visited === n;
}

/**
 * 取出给定 id 对应的 active 行（归属 + active + 同 kind + 去重 + ≥2 条）。
 * 任一条件不满足返回 null —— 调用方据此回 `not a similar group`。
 */
function resolveGroupRows(
  db: BetterSqlite3Database,
  userId: string,
  ids: readonly number[]
): AgentMemoryRow[] | null {
  if (ids.length < 2 || new Set(ids).size !== ids.length) return null;
  const active = new Map<number, AgentMemoryRow>();
  for (const row of queryActiveMemories(db, userId)) active.set(row.id, row);
  const rows: AgentMemoryRow[] = [];
  for (const id of ids) {
    const row = active.get(id);
    if (!row) return null;
    rows.push(row);
  }
  if (rows.some((row) => row.kind !== rows[0].kind)) return null;
  return rows;
}

/**
 * 扫描跨 subject 相似组（防线一 + 防线二建议列表的唯一口径）。
 *
 * 流程：
 * 1. 取 active 行 → 剔除**打过 merge_skip 驳回标记**的行（用户已否掉的组不再出现）；
 * 2. 每行用 FTS5 召回候选（`querySimilarMemoryCandidates`，同 kind / 同 user_id / active）；
 * 3. 只比对**不同 subject** 的候选对（同 subject 归 `mergeConflicts` 管），
 *    精确重合度 ≥ 阈值则并入同一组（并查集，允许传递合并）；
 * 4. 每组 ≥2 条才输出，按 id 升序，胜者按 `compareWinner`。
 *
 * FTS 召回失败（虚拟表缺失 / 引擎不支持）→ 视为无候选，返回空数组（降级不抛）。
 * 不计访问（策略扫描不算读取）。
 */
export function findSimilarMergeGroups(
  db: BetterSqlite3Database,
  userId: string,
  opts: MemoryMergeOptions = {}
): MemoryMergeGroup[] {
  const threshold = resolveThreshold(opts.threshold);
  const limit = Math.max(1, Math.floor(opts.candidateLimit ?? MEMORY_MERGE_CANDIDATE_LIMIT));

  const active = queryActiveMemories(db, userId);
  if (active.length < 2) return [];
  const flags = listMergeSkipFlags(db, userId);
  const eligible = active.filter((row) => !flags.has(row.id));
  if (eligible.length < 2) return [];

  const parent = new Map<number, number>();
  for (const row of eligible) parent.set(row.id, row.id);
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as number;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const eligibleById = new Map<number, AgentMemoryRow>();
  for (const row of eligible) eligibleById.set(row.id, row);

  // MEM-2：单次扫描内每行的 trigram Set 只算一次（原实现每对比较都重建双方）
  const memo = newTrigramMemo();

  for (const row of eligible) {
    const candidates = querySimilarMemoryCandidates(
      db,
      userId,
      row.kind,
      `${row.subject}\n${row.content}`,
      limit
    );
    for (const candidate of candidates) {
      if (candidate.id === row.id) continue;
      if (candidate.kind !== row.kind) continue;
      if (candidate.subject === row.subject) continue; // 同 subject 归 mergeConflicts
      const target = eligibleById.get(candidate.id);
      if (!target) continue; // 不在 eligible（被驳回 / 已关闭）
      if (scoreWithTrigrams(memo, row, target) < threshold) continue;
      union(row.id, target.id);
    }
  }

  const buckets = new Map<number, AgentMemoryRow[]>();
  for (const row of eligible) {
    const root = find(row.id);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(row);
    else buckets.set(root, [row]);
  }

  const groups: MemoryMergeGroup[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.id - b.id);
    const winner = [...members].sort(compareWinner)[0];
    groups.push({
      kind: members[0].kind,
      score: maxPairScore(members, memo),
      winnerId: winner.id,
      members,
    });
  }
  groups.sort((a, b) => a.members[0].id - b.members[0].id);
  return groups;
}

/**
 * 跨 subject 相似合并：把每组收敛为胜者一条，**败者只 closeMemory 置 valid_to**
 * （Ledger 不删行），`source='manual'` 恒不因相似合并被关（红线）。
 * 返回本次关闭条数；调用方（runMemoryPolicy）把它并进 `merged` 计数。
 */
export function mergeSimilarMemories(
  db: BetterSqlite3Database,
  userId: string,
  opts: MemoryMergeOptions = {}
): number {
  const now = opts.now ?? memoryNowStamp();
  let closed = 0;
  for (const group of findSimilarMergeGroups(db, userId, opts)) {
    for (const row of group.members) {
      if (row.id === group.winnerId) continue;
      if (row.source === 'manual') continue; // 红线：manual 恒不被相似合并关
      if (closeMemory(db, userId, row.id, now)) closed += 1;
    }
  }
  return closed;
}

/**
 * 三态审核 · **确认采纳**：按用户给定的 id 执行一次合并。
 * 入参在服务端重算（不信任渲染层传来的组）：归属 + active + 同 kind +
 * 连通相似组三条都过了才动手；不构成相似组返回 null。
 */
export function mergeMemoryGroup(
  db: BetterSqlite3Database,
  userId: string,
  ids: readonly number[],
  opts: MemoryMergeOptions = {}
): { merged: number; winnerId: number } | null {
  const threshold = resolveThreshold(opts.threshold);
  const rows = resolveGroupRows(db, userId, ids);
  if (!rows || !isSimilarGroup(rows, threshold)) return null;

  const now = opts.now ?? memoryNowStamp();
  const winner = [...rows].sort(compareWinner)[0];
  let merged = 0;
  for (const row of rows) {
    if (row.id === winner.id) continue;
    if (row.source === 'manual') continue;
    if (closeMemory(db, userId, row.id, now)) merged += 1;
  }
  return { merged, winnerId: winner.id };
}
/**
 * 三态审核 · **驳回**：给组内全部行打 `merge_skip` 标记，
 * 此后这些行不再参与自动相似合并、也不再出现在建议列表。
 * 返回实际标记条数；不构成相似组返回 null（零副作用）。
 */
export function rejectMemoryGroup(
  db: BetterSqlite3Database,
  userId: string,
  ids: readonly number[],
  opts: MemoryMergeOptions = {}
): number | null {
  const threshold = resolveThreshold(opts.threshold);
  const rows = resolveGroupRows(db, userId, ids);
  if (!rows || !isSimilarGroup(rows, threshold)) return null;
  const now = opts.now ?? memoryNowStamp();
  return markMergeSkipped(db, userId, ids, now);
}

// ---------------------------------------------------------------------------
// 容量上限（第三批 D2 / 五.4）
// ---------------------------------------------------------------------------

export interface MemoryCapacityOptions {
  /** active 条数上限，缺省 MAX_ACTIVE_MEMORIES */
  limit?: number;
  /** 判定基准时刻（UTC `YYYY-MM-DD HH:MM:SS`），缺省取当前时刻 */
  now?: string;
}

/**
 * 容量淘汰顺序：`access_count` 升序 → `written_at` 降序（同为 0 次访问时新者先关）→ `id` 升序。
 * 第二键取降序是裁定口径：同一批「从未被读过」的记忆里，先关新写入的，
 * 让沉淀更久的旧知识留到最后。
 */
function compareEvictionOrder(a: AgentMemoryAccessRow, b: AgentMemoryAccessRow): number {
  if (a.accessCount !== b.accessCount) return a.accessCount - b.accessCount;
  if (a.writtenAt !== b.writtenAt) return a.writtenAt < b.writtenAt ? 1 : -1;
  return a.id - b.id;
}

/**
 * 容量上限驱逐：active 条数超过 limit 时，按淘汰顺序把**非 manual** 的行 closeMemory，
 * 直到 active ≤ limit 或无可关行为止。
 * - 红线：`source='manual'` 永不因容量上限被关闭（与 evictStale / mergeConflicts 同口径）；
 *   因此 manual 行数本身超过 limit 时返回 0（宁可超限也不动用户手写值）；
 * - 只置 valid_to，不 DELETE、不改 content（Ledger 不删行）；
 * - 走 listActiveMemoryAccess（不计访问），容量扫描本身不算读取。
 * 返回本次关闭条数。
 */
export function enforceMemoryCapacity(
  db: BetterSqlite3Database,
  userId: string,
  opts: MemoryCapacityOptions = {}
): number {
  const limit = Math.max(0, opts.limit ?? MAX_ACTIVE_MEMORIES);
  const now = opts.now ?? memoryNowStamp();

  const active = listActiveMemoryAccess(db, userId);
  if (active.length <= limit) return 0;

  const closable = active.filter((row) => row.source !== 'manual');
  const overflow = Math.min(active.length - limit, closable.length);
  if (overflow <= 0) return 0;

  const ordered = [...closable].sort(compareEvictionOrder);
  let closed = 0;
  for (const row of ordered) {
    if (closed >= overflow) break;
    if (closeMemory(db, userId, row.id, now)) closed += 1;
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
  /** 覆盖默认容量上限（active 条数），缺省 MAX_ACTIVE_MEMORIES */
  maxActiveMemories?: number;
  /** 覆盖跨 subject 相似合并阈值（0,1]），缺省 MEMORY_MERGE_SIMILAR_THRESHOLD */
  mergeSimilarThreshold?: number;
}

/**
 * 一次性跑完整策略，返回两类计数。
 * 顺序：**先 merge 后 evict，最后跑容量上限** ——
 *   1) merge（同 subject）随即关闭败者退出 active，evict 不会再看到它们，计数口径不重叠；
 *   2) 若先 evict，超龄败者会被算进 evicted，且冲突组里被年龄筛剩的幸存者
 *      可能不是「最新」那条，胜者判定会被驱逐顺序干扰；
 *   3) **D5 追加**：同 subject 合并之后紧接着跑**跨 subject 相似合并**
 *      （`mergeSimilarMemories`）—— 先清掉精确重复，再按关键词重合度收敛近重复，
 *      两步的败者互不重叠（第二步只处理第一步之后仍 active 的行）；
 *   4) 容量上限放在最后：先按时间清掉超龄的，再按 access_count 补关到上限，
 *      避免「容量先关了本该因超龄被关的行」导致两类计数重复归因。
 * 返回形状保持第二批的 `{ evicted, merged }` 不变（既有 3 例 toEqual 断言零改动）：
 *   - 容量关闭与时间衰减同属「策略性关闭」，统一计入 `evicted`；
 *   - **跨 subject 相似合并关闭的条数并入 `merged`**（与同 subject 合并同属「合并」）。
 */
export function runMemoryPolicy(
  db: BetterSqlite3Database,
  userId: string,
  opts: MemoryPolicyOptions = {}
): { evicted: number; merged: number } {
  const now = opts.now ?? memoryNowStamp();
  const merged =
    mergeConflicts(db, userId, now) +
    mergeSimilarMemories(db, userId, { now, threshold: opts.mergeSimilarThreshold });
  const evicted = evictStale(db, userId, {
    maxAgeDays: opts.maxAgeDays ?? MEMORY_EVICT_MAX_AGE_DAYS,
    now,
  });
  const overflowClosed = enforceMemoryCapacity(db, userId, {
    limit: opts.maxActiveMemories,
    now,
  });
  return { evicted: evicted + overflowClosed, merged };
}

/**
 * 应用启动触发点（D2 三处触发之一）：对**每个有记忆的用户**各跑一次完整策略。
 * - 只取 `agent_memory` 里出现过的 user_id（空库零开销），不去碰 users 表；
 * - 取数失败或单个用户执行失败都被 try/catch 吞掉并 console.warn，
 *   **绝不抛给调用方、绝不阻塞启动**（调用点在 initAgentQueue 内仍再包一层）。
 * 返回成功执行策略的用户数。
 */
export function runMemoryPolicyForAllUsers(db: BetterSqlite3Database): number {
  let owners: string[];
  try {
    owners = listMemoryOwners(db);
  } catch (error) {
    console.warn('[memoryPolicy] 启动期读取记忆用户列表失败（跳过本次策略执行）', {
      message: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }

  let handled = 0;
  for (const userId of owners) {
    try {
      runMemoryPolicy(db, userId);
      handled += 1;
    } catch (error) {
      console.warn('[memoryPolicy] 启动期单用户策略执行失败（跳过该用户，不影响启动）', {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return handled;
}
