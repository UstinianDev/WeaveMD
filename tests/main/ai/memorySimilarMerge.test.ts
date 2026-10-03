// ============================================
// WeaveMD — agent-memory-optimize-3 D5 防线一/三：跨 subject 语义合并 + 过期复核链路测试
// ============================================
// 覆盖（req §二 D5 验收 1/2/3/5/6）：
//   1. 跨 subject 相似合并：新者留 active、旧者 valid_to 非空**且仍在 listMemories**（Ledger 不删行）、
//      `manual` 恒不因相似合并被关；
//   2. 阈值闸（含非法阈值抛错）+ 大小写归一的 trigram 重合度；
//   3. user_id 隔离：A 用户的相似组对 B 不可见；
//   4. 注入 50 条相似经验 → 三防线跑完 active 条数有上界；
//   5. 复核淘汰后的行不再被 `getActiveProfile` / `listActiveMemories` 返回（→ 提示词侧不再出现，
//      提示词侧断言在 tests/main/ai/agentContext.test.ts）；
//   6. 三态审核的策略侧：采纳执行合并 / 驳回后不再合并；
//   7. 既有 D2 的 runMemoryPolicy 返回形状 `{ evicted, merged }` 零改动。
//
// fake 引擎本文件自持（与 memoryPolicy.test.ts 同口径），额外支持：
//   - `agent_memory_fts MATCH ?` 候选检索（按 trigram 子串语义模拟 FTS5 索引，
//     即触发器同步后的索引内容；触发器与真库语义由
//     scripts/agent-memory-migration-smoke.cjs 态6 验证）；
//   - `merge_skip` 驳回标记列的读写。
// 占位符个数 !== 参数个数即抛错 → DAO 一旦拼接用户值立刻变红。
// 无 any、无 dangerouslySetInnerHTML。

import { beforeEach, describe, expect, it } from 'vitest';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

type Cell = string | number | null;

interface FakeRow {
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
  access_count: number;
  last_read_at: string | null;
  /** D5 补列：相似合并驳回标记（NULL = 未驳回）。 */
  merge_skip: string | null;
}

let store: FakeRow[] = [];
let nextId = 1;
/** 模拟 FTS 索引不可用（未迁移 / 引擎不支持 MATCH）的开关。 */
let ftsBroken = false;

function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function placeholderCount(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

function assertBound(sql: string, args: unknown[]): void {
  const expected = placeholderCount(sql);
  if (expected !== args.length) {
    throw new Error(`fakeDb: 占位符 ${expected} 个与参数 ${args.length} 个不匹配 → SQL 疑似字符串拼接`);
  }
}

/** 与 memoryTextTrigrams 同口径的 trigram 抽取（小写归一）。 */
function trigrams(text: string): Set<string> {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + 3 <= lower.length; i += 1) out.add(lower.slice(i, i + 3));
  return out;
}

/** 解析 `buildMemoryMatchQuery` 产出的 `"aaa" OR "bbb" ...`。 */
function parseMatchTerms(match: string): string[] {
  return (match.match(/"((?:[^"]|"")*)"/g) ?? []).map((t) => t.slice(1, -1).replace(/""/g, '"'));
}

function matchesWhere(row: FakeRow, conds: Array<{ col: keyof FakeRow; val: unknown }>): boolean {
  return conds.every((c) => row[c.col] === c.val);
}

function activeBySql(args: unknown[]): FakeRow[] {
  const [userId, kind] = args;
  return store
    .filter((r) => r.user_id === userId && r.valid_to === null && (kind === undefined || r.kind === kind))
    .sort((a, b) => a.id - b.id);
}

/** FTS 候选：任一命中词是 `subject+content` 的子串（trigram 索引语义）。 */
function ftsCandidates(sql: string, args: unknown[]): FakeRow[] {
  if (ftsBroken) throw new Error('fakeDb: no such table: agent_memory_fts');
  const m = /WHERE\s+agent_memory_fts\s+MATCH\s+\?\s+AND\s+m\.user_id\s*=\s*\?\s+AND\s+m\.kind\s*=\s*\?\s+AND\s+m\.valid_to\s+IS\s+NULL\s+LIMIT\s+\?/i.exec(
    sql
  );
  if (!m) throw new Error(`fakeDb: 无法解析 FTS 候选 SQL → ${sql}`);
  const [match, userId, kind, limit] = args as [string, string, string, number];
  const terms = parseMatchTerms(match);
  if (terms.length === 0) throw new Error('fakeDb: MATCH 串为空');
  return store
    .filter(
      (r) =>
        r.user_id === userId &&
        r.kind === kind &&
        r.valid_to === null &&
        terms.some((t) => `${r.subject}\n${r.content}`.includes(t))
    )
    .sort((a, b) => a.id - b.id)
    .slice(0, limit);
}

function prepare(sql: string) {
  const run = (...args: unknown[]): { changes: number; lastInsertRowid: number } => {
    assertBound(sql, args);
    let m = /^\s*INSERT\s+INTO\s+agent_memory\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(
      sql
    );
    if (m) {
      const cols = m[1].split(',').map((c) => c.trim());
      const tokens = m[2].split(',').map((t) => t.trim());
      const row: FakeRow = {
        id: nextId++,
        user_id: '',
        kind: '',
        subject: '',
        content: '',
        source: 'auto',
        conversation_id: null,
        fingerprint: '',
        valid_from: nowStamp(),
        valid_to: null,
        written_at: nowStamp(),
        access_count: 0,
        last_read_at: null,
        merge_skip: null,
      };
      let cursor = 0;
      cols.forEach((col, i) => {
        const token = tokens[i];
        let value: Cell;
        if (token === '?') {
          value = args[cursor] as Cell;
          cursor += 1;
        } else if (/^datetime\('now'\)$/i.test(token)) {
          value = nowStamp();
        } else {
          throw new Error(`fakeDb: VALUES 出现非占位符字面量 → ${token}`);
        }
        (row as unknown as Record<string, Cell>)[col] = value;
      });
      if (cursor !== args.length) throw new Error('fakeDb: VALUES 占位符个数不匹配');
      store.push(row);
      return { changes: 1, lastInsertRowid: row.id };
    }

    m = /^\s*UPDATE\s+agent_memory\s+SET\s+valid_to\s*=\s*\?\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?\s+AND\s+valid_to\s+IS\s+NULL/i.exec(
      sql
    );
    if (m) {
      const [validTo, id, userId] = args as [string, number, string];
      let changes = 0;
      for (const row of store) {
        if (row.id === id && row.user_id === userId && row.valid_to === null) {
          row.valid_to = validTo;
          changes += 1;
        }
      }
      return { changes, lastInsertRowid: 0 };
    }

    m = /^\s*UPDATE\s+agent_memory\s+SET\s+merge_skip\s*=\s*\?\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i.exec(
      sql
    );
    if (m) {
      const [flag, id, userId] = args as [string, number, string];
      let changes = 0;
      for (const row of store) {
        if (row.id === id && row.user_id === userId) {
          row.merge_skip = flag;
          changes += 1;
        }
      }
      return { changes, lastInsertRowid: 0 };
    }

    m = /^\s*UPDATE\s+agent_memory\s+SET\s+access_count\s*=\s*\?\s*,\s*last_read_at\s*=\s*\?\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i.exec(
      sql
    );
    if (m) {
      const [count, lastReadAt, id, userId] = args as [number, string, number, string];
      let changes = 0;
      for (const row of store) {
        if (row.id === id && row.user_id === userId) {
          row.access_count = count;
          row.last_read_at = lastReadAt;
          changes += 1;
        }
      }
      return { changes, lastInsertRowid: 0 };
    }

    throw new Error(`fakeDb: 不支持的写语句 → ${sql}`);
  };

  /**
   * agent_memory 基表扫描的显式投影（ai-core-perf MEM-4）：DAO 由 `SELECT *` 改为
   * 逐列列出，**刻意排除 `vector` BLOB**（1536 维 float32 ≈ 6 KB/行，策略层单次
   * 调用要扫 4 遍）。此处把新列清单逐字写进正则 —— 未来再改投影仍会立刻变红。
   */
  const ACTIVE_COLS =
    'id\\s*,\\s*user_id\\s*,\\s*kind\\s*,\\s*subject\\s*,\\s*content\\s*,\\s*source\\s*,' +
    '\\s*conversation_id\\s*,\\s*fingerprint\\s*,\\s*valid_from\\s*,\\s*valid_to\\s*,' +
    '\\s*written_at\\s*,\\s*access_count';

  const all = (...args: unknown[]): FakeRow[] => {
    assertBound(sql, args);
    if (/agent_memory_fts\s+MATCH/i.test(sql)) return ftsCandidates(sql, args);
    if (
      new RegExp(
        `^\\s*SELECT\\s+id\\s*,\\s*merge_skip\\s+FROM\\s+agent_memory\\s+WHERE\\s+user_id\\s*=\\s*\\?\\s+AND\\s+merge_skip\\s+IS\\s+NOT\\s+NULL\\s*$`,
        'i'
      ).test(sql)
    ) {
      const userId = args[0];
      return store
        .filter((r) => r.user_id === userId)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({ ...r }));
    }
    let m = new RegExp(
      `^\\s*SELECT\\s+${ACTIVE_COLS}\\s+FROM\\s+agent_memory\\s+WHERE\\s+user_id\\s*=\\s*\\?\\s+AND\\s+kind\\s*=\\s*\\?\\s+AND\\s+valid_to\\s+IS\\s+NULL\\s+ORDER\\s+BY\\s+id\\s+ASC\\s*$`,
      'i'
    ).exec(sql);
    if (m) return activeBySql(args);
    m = new RegExp(
      `^\\s*SELECT\\s+${ACTIVE_COLS}\\s+FROM\\s+agent_memory\\s+WHERE\\s+user_id\\s*=\\s*\\?\\s+AND\\s+valid_to\\s+IS\\s+NULL\\s+ORDER\\s+BY\\s+id\\s+ASC\\s*$`,
      'i'
    ).exec(sql);
    if (m) return activeBySql(args);
    m = new RegExp(
      `^\\s*SELECT\\s+${ACTIVE_COLS}\\s+FROM\\s+agent_memory\\s+WHERE\\s+user_id\\s*=\\s*\\?\\s+ORDER\\s+BY\\s+id\\s+ASC\\s*$`,
      'i'
    ).exec(sql);
    if (m) {
      const userId = args[0];
      return store.filter((r) => r.user_id === userId).sort((a, b) => a.id - b.id);
    }
    throw new Error(`fakeDb: 不支持的读语句 → ${sql}`);
  };

  return {
    all,
    get: (...args: unknown[]): FakeRow | undefined => all(...args)[0],
    run,
  };
}

const fakeDb = { prepare } as unknown as BetterSqlite3Database;

import {
  getActiveProfile,
  listActiveMemories,
  listMemories,
  insertMemory,
  type AgentMemoryKind,
  type AgentMemoryRow,
  type AgentMemorySource,
} from '@main/db/agentMemory';
import {
  MEMORY_MERGE_SIMILAR_THRESHOLD,
  findSimilarMergeGroups,
  mergeMemoryGroup,
  mergeSimilarMemories,
  memorySimilarityScore,
  rejectMemoryGroup,
  runMemoryPolicy,
} from '@main/ai/agent/memoryPolicy';

const NOW = '2026-09-30 12:00:00';

interface SeedRow {
  userId?: string;
  kind?: AgentMemoryKind;
  subject?: string;
  content?: string;
  source?: AgentMemorySource;
  writtenAt?: string;
}

function seed(row: SeedRow): number {
  const id = insertMemory(fakeDb, {
    userId: row.userId ?? 'u1',
    kind: row.kind ?? 'profile',
    subject: row.subject ?? 'topic',
    content: row.content ?? 'Shanghai is a city',
    source: row.source,
    fingerprint: `fp-${nextId}`,
  });
  if (row.writtenAt) {
    const target = store.find((r) => r.id === id);
    if (!target) throw new Error(`seed: 不存在的 id → ${id}`);
    target.written_at = row.writtenAt;
  }
  return id;
}

/** 相似经验对：subject 不同、content 近重复（跨 subject 合并的目标形态）。 */
const SIMILAR_A = { subject: '主题偏好', content: '用户偏好深色主题，界面使用暗色背景' };
const SIMILAR_B = { subject: '外观设置', content: '用户偏好深色主题，界面使用暗色背景' };
const SIMILAR_C = { subject: '显示风格', content: '用户偏好深色主题，界面使用暗色背景' };
const UNRELATED = { subject: '城市', content: '上海今天下雨，出门记得带伞' };

/** 相似度打分用的最小行夹具（打分只消费 subject / content）。 */
function mem(subject: string, content: string): AgentMemoryRow {
  return {
    id: 1,
    userId: 'u1',
    kind: 'profile',
    subject,
    content,
    source: 'auto',
    conversationId: null,
    fingerprint: 'fp',
    validFrom: NOW,
    validTo: null,
    writtenAt: NOW,
  };
}

beforeEach(() => {
  store = [];
  nextId = 1;
  ftsBroken = false;
});

// ---------------------------------------------------------------------------
// 相似度（trigram 重合度）
// ---------------------------------------------------------------------------

describe('D5 — memorySimilarityScore（FTS 同口径 trigram 重合度）', () => {
  it('近重复跨 subject 的重合度 ≥ 阈值', () => {
    expect(memorySimilarityScore(mem(SIMILAR_A.subject, SIMILAR_A.content), mem(SIMILAR_B.subject, SIMILAR_B.content))).toBeGreaterThanOrEqual(
      MEMORY_MERGE_SIMILAR_THRESHOLD
    );
  });

  it('无关文本重合度低于阈值（且不为 NaN）', () => {
    const score = memorySimilarityScore(
      mem(SIMILAR_A.subject, SIMILAR_A.content),
      mem(UNRELATED.subject, UNRELATED.content)
    );
    expect(score).toBeLessThan(MEMORY_MERGE_SIMILAR_THRESHOLD);
    expect(Number.isNaN(score)).toBe(false);
  });

  it('大小写不敏感（打分归一小写，与索引侧 lowercase 查询词配套）', () => {
    expect(
      memorySimilarityScore(
        mem('city', 'Shanghai is big'),
        mem('place', 'shanghai is big')
      )
    ).toBeGreaterThanOrEqual(MEMORY_MERGE_SIMILAR_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// 防线一：跨 subject 合并
// ---------------------------------------------------------------------------

describe('D5 防线一 — mergeSimilarMemories 跨 subject 合并', () => {
  it('新者留 active、旧者 valid_to 非空且仍在 listMemories（Ledger 不删行）', () => {
    const oldId = seed({ ...SIMILAR_A, writtenAt: '2026-01-01 00:00:00' });
    const newId = seed({ ...SIMILAR_B, writtenAt: '2026-09-01 00:00:00' });

    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(1);

    const all = listMemories(fakeDb, 'u1');
    expect(all).toHaveLength(2); // 不删行
    const oldRow = all.find((r) => r.id === oldId);
    const newRow = all.find((r) => r.id === newId);
    expect(oldRow?.validTo).toBe(NOW);
    expect(newRow?.validTo).toBeNull();
    const active = listActiveMemories(fakeDb, 'u1');
    expect(active.map((r) => r.id)).toEqual([newId]);
  });

  it('manual 恒不因相似合并被关（auto 败者关、manual 败者留）', () => {
    const manualId = seed({ ...SIMILAR_A, source: 'manual', writtenAt: '2026-01-01 00:00:00' });
    const autoId = seed({ ...SIMILAR_B, source: 'auto', writtenAt: '2026-09-01 00:00:00' });

    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(1);

    const all = listMemories(fakeDb, 'u1');
    // manual 优先当胜者（即便更旧），auto 败者被关
    expect(all.find((r) => r.id === manualId)?.validTo).toBeNull();
    expect(all.find((r) => r.id === autoId)?.validTo).toBe(NOW);
  });

  it('两条 manual 相似行并存，谁都不关（留给 C3 显式删除）', () => {
    seed({ ...SIMILAR_A, source: 'manual' });
    seed({ ...SIMILAR_B, source: 'manual' });
    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(0);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(2);
  });

  it('低于阈值不合并；阈值非法（≤0 / >1 / NaN）直接抛错', () => {
    seed({ subject: '主题', content: '用户偏好深色主题' });
    seed({ subject: '城市', content: '上海今天下雨' });
    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(0);

    seed({ subject: 'a', content: 'x' });
    expect(() => mergeSimilarMemories(fakeDb, 'u1', { threshold: 0 })).toThrow();
    expect(() => mergeSimilarMemories(fakeDb, 'u1', { threshold: 1.5 })).toThrow();
    expect(() => mergeSimilarMemories(fakeDb, 'u1', { threshold: Number.NaN })).toThrow();
  });

  it('同 kind 才合并（跨 kind 不合并），且只在同 user_id 内', () => {
    seed({ kind: 'profile', subject: '主题偏好', content: '用户偏好深色主题' });
    seed({ kind: 'entity', subject: '外观设置', content: '用户偏好深色主题' });
    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(0);
  });

  it('user_id 隔离：A 的相似组对 B 不可见（B 跑策略不关 A 的行）', () => {
    const a1 = seed({ userId: 'u1', ...SIMILAR_A, writtenAt: '2026-01-01 00:00:00' });
    const a2 = seed({ userId: 'u1', ...SIMILAR_B, writtenAt: '2026-09-01 00:00:00' });
    const b1 = seed({ userId: 'u2', ...SIMILAR_A, writtenAt: '2026-01-01 00:00:00' });

    expect(mergeSimilarMemories(fakeDb, 'u2', { now: NOW })).toBe(0);
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === a1)?.validTo).toBeNull();
    expect(listMemories(fakeDb, 'u1').find((r) => r.id === a2)?.validTo).toBeNull();
    expect(listMemories(fakeDb, 'u2').find((r) => r.id === b1)?.validTo).toBeNull();

    // u1 自己跑则按预期合并
    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(1);
  });

  it('FTS 索引不可用时降级为「不合并」，不抛错、不阻断其它防线', () => {
    seed({ ...SIMILAR_A });
    seed({ ...SIMILAR_B });
    ftsBroken = true;
    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(0);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(2);
    // 同 subject 的既有合并（mergeConflicts）不受影响
    expect(runMemoryPolicy(fakeDb, 'u1', { now: NOW }).merged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 三态审核（策略侧）
// ---------------------------------------------------------------------------

describe('D5 防线二（策略侧）— 采纳 / 驳回', () => {
  it('findSimilarMergeGroups 返回同 kind 跨 subject 组，含胜者与成员', () => {
    seed({ ...SIMILAR_A, writtenAt: '2026-01-01 00:00:00' });
    seed({ ...SIMILAR_B, writtenAt: '2026-09-01 00:00:00' });
    seed({ ...UNRELATED });

    const groups = findSimilarMergeGroups(fakeDb, 'u1', { now: NOW });
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('profile');
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].score).toBeGreaterThanOrEqual(MEMORY_MERGE_SIMILAR_THRESHOLD);
    // 胜者 = written_at 新者
    expect(groups[0].winnerId).toBe(2);
  });

  it('采纳：按给定 id 执行合并（新者留 active、旧者关）', () => {
    seed({ ...SIMILAR_A, writtenAt: '2026-01-01 00:00:00' });
    seed({ ...SIMILAR_B, writtenAt: '2026-09-01 00:00:00' });

    const res = mergeMemoryGroup(fakeDb, 'u1', [1, 2], { now: NOW });
    expect(res).not.toBeNull();
    expect(res?.winnerId).toBe(2);
    expect(res?.merged).toBe(1);
    expect(listMemories(fakeDb, 'u1')).toHaveLength(2);
    expect(listActiveMemories(fakeDb, 'u1').map((r) => r.id)).toEqual([2]);
  });

  it('采纳：id 不构成相似组 → null（且零副作用）', () => {
    seed({ ...SIMILAR_A });
    seed({ ...UNRELATED });
    expect(mergeMemoryGroup(fakeDb, 'u1', [1, 2], { now: NOW })).toBeNull();
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(2);
  });

  it('驳回：给组内全部行打 merge_skip，此后自动合并与建议都不再出现', () => {
    seed({ ...SIMILAR_A });
    seed({ ...SIMILAR_B });
    seed({ ...SIMILAR_C });

    expect(rejectMemoryGroup(fakeDb, 'u1', [1, 2], { now: NOW })).toBe(2);
    // 第三条与被驳回行相似，但组内含已驳回行 → 不再建议、不再合并
    const groups = findSimilarMergeGroups(fakeDb, 'u1', { now: NOW });
    expect(groups.flatMap((g) => g.members.map((m) => m.id))).not.toContain(1);
    expect(groups.flatMap((g) => g.members.map((m) => m.id))).not.toContain(2);
    expect(mergeSimilarMemories(fakeDb, 'u1', { now: NOW })).toBe(0);
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(3);
  });

  it('驳回：单个 id / 不相似组 → null（不做标记）', () => {
    seed({ ...SIMILAR_A });
    seed({ ...UNRELATED });
    expect(rejectMemoryGroup(fakeDb, 'u1', [1], { now: NOW })).toBeNull();
    expect(rejectMemoryGroup(fakeDb, 'u1', [1, 2], { now: NOW })).toBeNull();
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(2);
  });

  it('驳回只作用于本 user_id（跨用户 id 不被标记）', () => {
    seed({ userId: 'u1', ...SIMILAR_A });
    seed({ userId: 'u2', ...SIMILAR_B });
    // u1 传了 u2 的行 → 组不成（行取不到）→ null，u2 的行未被标记
    expect(rejectMemoryGroup(fakeDb, 'u1', [1, 2], { now: NOW })).toBeNull();
    expect(store.find((r) => r.id === 2)?.merge_skip).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 验收 1：50 条相似经验 + 三防线
// ---------------------------------------------------------------------------

describe('D5 验收 — 注入 50 条相似经验后三防线生效、注入条数有上界', () => {
  it('跑一次 runMemoryPolicy 后 active 条数收敛到 1，返回形状仍是 { evicted, merged }', () => {
    const baseMs = Date.parse('2026-09-01T00:00:00Z');
    for (let i = 1; i <= 50; i += 1) {
      seed({
        subject: `偏好-${i}`,
        content: `用户偏好深色主题，界面使用暗色背景，编号 ${i}`,
        writtenAt: new Date(baseMs + i * 1000).toISOString().slice(0, 19).replace('T', ' '),
      });
    }
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(50);

    const res = runMemoryPolicy(fakeDb, 'u1', { now: NOW });
    // 返回形状零改动（既有 3 例 toEqual 锁定），跨 subject 合并数并进 merged
    expect(Object.keys(res).sort()).toEqual(['evicted', 'merged']);
    expect(res.evicted).toBe(0);
    expect(res.merged).toBe(49);

    const active = listActiveMemories(fakeDb, 'u1');
    expect(active).toHaveLength(1);
    // Ledger 不删行：50 行全部仍在
    expect(listMemories(fakeDb, 'u1')).toHaveLength(50);
    expect(active[0].id).toBe(50); // 同刻按 id 大者赢
    // 画像视图同样只回 1 条（→ 画像块条数有上界）
    expect(getActiveProfile(fakeDb, 'u1')).toHaveLength(1);
  });

  it('重复跑策略幂等：第二次 merged = 0、active 仍为 1', () => {
    for (let i = 1; i <= 50; i += 1) {
      seed({ subject: `偏好-${i}`, content: '用户偏好深色主题，界面使用暗色背景' });
    }
    expect(runMemoryPolicy(fakeDb, 'u1', { now: NOW }).merged).toBe(49);
    expect(runMemoryPolicy(fakeDb, 'u1', { now: NOW })).toEqual({ evicted: 0, merged: 0 });
    expect(listActiveMemories(fakeDb, 'u1')).toHaveLength(1);
  });

  it('三处触发时机与 runMemoryPolicy 形状的静态护栏（D2 零改动）', async () => {
    const { readFileSync } = await import('node:fs');
    const path = (await import('path')).default;
    const cwd = process.cwd();
    const policySrc = readFileSync(path.resolve(cwd, 'src/main/ai/agent/memoryPolicy.ts'), 'utf8');
    // 编排顺序：merge（同 subject）→ merge（跨 subject）→ evict → capacity
    const order = [
      policySrc.indexOf('mergeConflicts(db, userId, now)'),
      policySrc.indexOf('mergeSimilarMemories(db, userId'),
      policySrc.indexOf('evictStale(db, userId,'),
      policySrc.indexOf('enforceMemoryCapacity(db, userId,'),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
      expect(order[i]).toBeGreaterThan(-1);
    }
    // D2 三处触发仍在
    const handlers = readFileSync(path.resolve(cwd, 'src/main/ai/ipc/agentHandlers.ts'), 'utf8');
    expect(handlers).toMatch(/runMemoryPolicyForAllUsers\(db\)/);
    const write = readFileSync(path.resolve(cwd, 'src/main/ai/tools/memoryWrite.ts'), 'utf8');
    expect(write).toMatch(/runMemoryPolicy\(ctx\.db, ctx\.userId\)/);
    const writer = readFileSync(path.resolve(cwd, 'src/main/ai/agent/memoryWriter.ts'), 'utf8');
    expect(writer).toMatch(/runMemoryPolicy\(deps\.db, ctx\.userId\)/);
    // 不新建定时器 / 不新建队列任务类型
    expect(policySrc).not.toContain('setInterval');
  });
});
