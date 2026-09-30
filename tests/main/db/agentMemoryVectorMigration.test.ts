// ============================================
// WeaveMD — agent-memory-optimize-3 D6：agent_memory 向量列幂等补列 迁移三断言
// ============================================
// 覆盖（req §二 D6 / Q8 裁定 A）：
//   态1 空库首建 —— 11 列起步按 runMigrations 顺序连跑 D2 → D5 → D6 → 16 列，
//                   且 `vector` / `embedding_model` 齐备；
//   态2 旧库升级 —— D5 终态（14 列）+ 1 条旧行 → 补列后 16 列，
//                   **旧行 vector IS NULL / embedding_model IS NULL**，既有字段逐字不动；
//   态3 重复执行 —— 幂等 no-op（零 ALTER），数据不变；
//   红线：既有 4 个迁移函数本体不含 `vector`（D6 不塞进既有迁移）+ 无 DROP/DELETE/UPDATE；
//   接线：runMigrations 在 addAgentMemoryFts 之后调用 addAgentMemoryVectorColumns。
//
// 注：列数演进实为 11（B3）→ 13（D2）→ 14（D5 merge_skip）→ **16（D6）**，
//     任务书验收写的「11→13→15」未计入 D5 的 merge_skip 列，以本文件实测为准。
// 真库语义由 scripts/agent-memory-migration-smoke.cjs 的「态7」在 Electron 运行时真验；
// 本文件用记录 exec 的 FakeDb 驱动真实迁移函数（vitest 内无法加载 better-sqlite3 ABI）。
// 无 any、无 dangerouslySetInnerHTML。

import { readFileSync } from 'node:fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

// --- 隔离 Electron app 依赖（index.ts 顶层 import electron；此处不需其 runtime） ---
vi.mock('electron', () => ({
  app: { getPath: () => ':memory:' },
}));

import {
  addAgentMemoryAccessColumns,
  addAgentMemoryMergeSkipColumn,
  addAgentMemoryTables,
  addAgentMemoryVectorColumns,
} from '@main/db/index';

const INDEX_TS = path.resolve(process.cwd(), 'src', 'main', 'db', 'index.ts');

/** B3 基表 11 列（第二批规格，本任务一行不改）。 */
const BASE_COLUMNS = [
  'id',
  'user_id',
  'kind',
  'subject',
  'content',
  'source',
  'conversation_id',
  'fingerprint',
  'valid_from',
  'valid_to',
  'written_at',
];

/** D2 追加 2 列。 */
const ACCESS_COLUMNS = ['access_count', 'last_read_at'];

/** D5 追加 1 列。 */
const MERGE_SKIP_COLUMN = 'merge_skip';

/** D6 追加 2 列。 */
const VECTOR_COLUMNS = ['vector', 'embedding_model'];

interface VectorFakeDb {
  columns: Map<string, string[]>;
  rows: Map<string, Record<string, unknown>[]>;
  indexes: Set<string>;
  alters: string[];
  execs: string[];
  prepare: (sql: string) => { get: (name: string) => { c: number } | undefined };
  exec: (sql: string) => void;
}

/** 从列定义里解析常量 DEFAULT（无 DEFAULT → null，与 SQLite 补列回填同口径）。 */
function parseColumnDefault(ddl: string): unknown {
  const m = /\bDEFAULT\s+('(?:[^']*)'|-?\d+(?:\.\d+)?|NULL)/i.exec(ddl);
  if (!m) return null;
  const raw = m[1];
  if (/^'[\s\S]*'$/.test(raw)) return raw.slice(1, -1);
  if (/^NULL$/i.test(raw)) return null;
  return Number(raw);
}

/** CREATE TABLE 体内的列名（逐行取 `<name> <TYPE>` 形态，注释已剥离）。 */
function parseCreateColumns(body: string): string[] {
  const out: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/--.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z_]\w*)\s+(INTEGER|TEXT|BLOB|REAL|NUMERIC)\b/i.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** 按顶层分号拆多语句（列定义里的分号不计入 —— 本 DDL 无嵌套分号）。 */
function splitStatements(raw: string): string[] {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 可探测列 / 可建表建索引 / 可模拟 DEFAULT 回填的 FakeDb：
 * - 出现 DROP|DELETE|UPDATE 直接抛错（迁移红线）；
 * - 重复 CREATE TABLE IF NOT EXISTS 为 no-op；重复 ALTER 抛「重复列」（真库同样报错）；
 * - ALTER 补列会按 DEFAULT 给既有行回填，用于断言「旧行取 DEFAULT」。
 */
function makeVectorFakeDb(seed?: Record<string, string[]>): VectorFakeDb {
  const columns = new Map<string, string[]>(
    Object.entries(seed ?? {}).map(([t, cols]) => [t, [...cols]])
  );
  const rows = new Map<string, Record<string, unknown>[]>(
    Object.keys(seed ?? {}).map((t) => [t, [] as Record<string, unknown>[]])
  );
  const indexes = new Set<string>();
  const alters: string[] = [];
  const execs: string[] = [];

  const exec = (raw: string): void => {
    execs.push(raw);
    if (/DROP|DELETE|UPDATE/i.test(raw)) {
      throw new Error(`迁移禁止破坏性语句: ${raw.slice(0, 60)}`);
    }
    for (const stmt of splitStatements(raw)) {
      const t = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/i.exec(stmt);
      if (t) {
        if (!columns.has(t[1])) {
          const body = /\(([\s\S]*)\)\s*$/i.exec(stmt)?.[1] ?? '';
          columns.set(t[1], parseCreateColumns(body));
          rows.set(t[1], []);
        }
        continue;
      }
      const i = /CREATE INDEX IF NOT EXISTS (\w+)/i.exec(stmt);
      if (i) {
        indexes.add(i[1]);
        continue;
      }
      const a = /^ALTER TABLE (\w+) ADD COLUMN ([\s\S]+)$/i.exec(stmt.trim());
      if (a) {
        const table = a[1];
        const colName = a[2].trim().split(/\s+/)[0];
        const cols = columns.get(table);
        if (!cols) throw new Error(`表不存在: ${table}`);
        if (cols.includes(colName)) throw new Error(`重复列: ${table}.${colName}`);
        columns.set(table, [...cols, colName]);
        const value = parseColumnDefault(a[2]);
        for (const row of rows.get(table) ?? []) row[colName] = value;
        alters.push(stmt.trim());
        continue;
      }
      throw new Error(`未识别的迁移语句: ${stmt.slice(0, 60)}`);
    }
  };

  return {
    columns,
    rows,
    indexes,
    alters,
    execs,
    exec,
    prepare: (sql: string) => ({
      get: (name: string) => {
        const m = /pragma_table_info\('([^']+)'\)/.exec(sql);
        if (!m) throw new Error(`unexpected pragma sql: ${sql}`);
        return (columns.get(m[1]) ?? []).includes(name) ? { c: 1 } : undefined;
      },
    }),
  } as VectorFakeDb;
}

/** B3 基表建表（与 runMigrations 首段同源）。 */
function createBaseAgentMemory(db: VectorFakeDb): void {
  addAgentMemoryTables(db as never);
}

/** D5 终态（14 列）：11 + D2 两列 + merge_skip。 */
function preD6AgentMemoryDb(row?: Record<string, unknown>): VectorFakeDb {
  const db = makeVectorFakeDb({ agent_memory: [...BASE_COLUMNS] });
  createBaseAgentMemory(db);
  addAgentMemoryAccessColumns(db as never);
  addAgentMemoryMergeSkipColumn(db as never);
  if (row) db.rows.get('agent_memory')?.push(row);
  return db;
}

/** D5 终态的一条历史数据行（向量列尚不存在时的形态）。 */
function preD6Row(): Record<string, unknown> {
  return {
    id: 1,
    user_id: 'u1',
    kind: 'fact',
    subject: 'city',
    content: '上海',
    source: 'auto',
    conversation_id: null,
    fingerprint: 'fp1',
    valid_from: '2026-01-01 00:00:00',
    valid_to: null,
    written_at: '2026-01-01 00:00:00',
    access_count: 3,
    last_read_at: '2026-06-01 00:00:00',
    merge_skip: null,
  };
}

describe('D6 — addAgentMemoryVectorColumns 补列迁移三断言（FakeDb 驱动真实迁移函数）', () => {
  it('态1 空库首建：11 列起步按 runMigrations 顺序连跑 D2 → D5 → D6 → 16 列，向量两列齐备', () => {
    const db = makeVectorFakeDb();
    createBaseAgentMemory(db);
    expect(db.columns.get('agent_memory')).toEqual([...BASE_COLUMNS]);

    // addAgentMemoryFts 只建 FTS 虚拟表与触发器、不加基表列，此处按 runMigrations 顺序跳过其 exec
    //（其 DROP TRIGGER / DELETE 语句会被本 FakeDb 的红线守卫拦截），列演进不受影响。
    addAgentMemoryAccessColumns(db as never);
    addAgentMemoryMergeSkipColumn(db as never);
    addAgentMemoryVectorColumns(db as never);

    expect(db.columns.get('agent_memory')).toEqual([
      ...BASE_COLUMNS,
      ...ACCESS_COLUMNS,
      MERGE_SKIP_COLUMN,
      ...VECTOR_COLUMNS,
    ]);
    expect(db.columns.get('agent_memory')).toHaveLength(16);
  });

  it('态2 旧库升级：14 列 + 旧行 → 补列后 16 列，旧行 vector / embedding_model 取 NULL 且既有字段不动', () => {
    const before = preD6AgentMemoryDb(preD6Row());
    expect(before.columns.get('agent_memory')).toHaveLength(14);
    expect(before.columns.get('agent_memory')).not.toContain('vector');

    addAgentMemoryVectorColumns(before as never);

    const cols = before.columns.get('agent_memory') ?? [];
    expect(cols).toHaveLength(16);
    expect(cols.slice(-2)).toEqual([...VECTOR_COLUMNS]);
    expect(before.alters.slice(-2)).toEqual([
      'ALTER TABLE agent_memory ADD COLUMN vector BLOB DEFAULT NULL',
      'ALTER TABLE agent_memory ADD COLUMN embedding_model TEXT',
    ]);
    expect(before.alters).toHaveLength(5); // D2 两列 + D5 merge_skip + D6 两列

    const row = before.rows.get('agent_memory')?.[0];
    expect(row).toBeDefined();
    expect(row?.vector).toBeNull();
    expect(row?.embedding_model).toBeNull();
    expect(row?.content).toBe('上海');
    expect(row?.access_count).toBe(3);
    expect(row?.last_read_at).toBe('2026-06-01 00:00:00');
    expect(row?.valid_to).toBeNull();
  });

  it('态3 重复执行：第二遍零 ALTER（幂等 no-op），列集合与数据不变', () => {
    const db = preD6AgentMemoryDb(preD6Row());
    addAgentMemoryVectorColumns(db as never);
    const colsAfterFirst = [...(db.columns.get('agent_memory') ?? [])];
    const altersAfterFirst = db.alters.length;
    const rowsAfterFirst = JSON.stringify(db.rows.get('agent_memory'));

    addAgentMemoryVectorColumns(db as never); // 第二遍

    expect(db.alters).toHaveLength(altersAfterFirst);
    expect(db.columns.get('agent_memory')).toEqual(colsAfterFirst);
    expect(db.columns.get('agent_memory')).toHaveLength(16);
    expect(JSON.stringify(db.rows.get('agent_memory'))).toBe(rowsAfterFirst);
  });

  it('红线：本函数体不含 DROP/DELETE/UPDATE，且既有 4 个 agent_memory 迁移函数本体均不含 vector', () => {
    const src = readFileSync(INDEX_TS, 'utf8');
    const mine = /export function addAgentMemoryVectorColumns[\s\S]*?\n}/.exec(src)?.[0] ?? '';
    expect(mine).not.toBe('');
    expect(mine).not.toMatch(/DROP|DELETE|UPDATE/i);
    // 独立函数：两条 addColumnIfMissing，不建索引（见函数头注：vec_distance_cosine 全表扫用不上）
    expect(mine.match(/addColumnIfMissing\(/g)).toHaveLength(2);

    for (const fn of [
      'addAgentMemoryTables',
      'addAgentMemoryAccessColumns',
      'addAgentMemoryFts',
      'addAgentMemoryMergeSkipColumn',
    ]) {
      const body = new RegExp(`export function ${fn}[\\s\\S]*?\\n}`).exec(src)?.[0] ?? '';
      expect(body, `${fn} 本体不应含 vector 列定义`).not.toMatch(/\bvector\b|\bembedding_model\b/);
    }
  });

  it('接线：runMigrations 在 addAgentMemoryFts 之后调用 addAgentMemoryVectorColumns', () => {
    const src = readFileSync(INDEX_TS, 'utf8');
    const rm = /function runMigrations\([\s\S]*?\n}/.exec(src)?.[0] ?? '';
    expect(rm).not.toBe('');
    expect(rm).toMatch(/addAgentMemoryVectorColumns\(database\);/);
    expect(rm.indexOf('addAgentMemoryVectorColumns(database);')).toBeGreaterThan(
      rm.indexOf('addAgentMemoryFts(database);')
    );
    expect(rm.indexOf('addAgentMemoryVectorColumns(database);')).toBeGreaterThan(
      rm.indexOf('addAgentMemoryAccessColumns(database);')
    );
  });
});
