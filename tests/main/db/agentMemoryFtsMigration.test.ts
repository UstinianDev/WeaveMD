// ============================================
// WeaveMD — agent-memory-optimize-3 D5：agent_memory FTS5 索引 + 合并驳回标记列 迁移三断言
// ============================================
// 覆盖（req §二 D5 防线一 / 总指挥裁定 1）：
//   态1 空库首建 —— `addAgentMemoryFts` 建 FTS5 虚拟表（只索引 subject + content）
//                   + ai/ad/au 3 触发器（全部 DROP TRIGGER IF EXISTS 前置）；
//   态2 旧库升级 —— 存量行回填进 FTS，且不改既有表结构（无 ALTER/DROP/DELETE/UPDATE 主表）；
//   态3 重复执行 —— 幂等 no-op（IF NOT EXISTS / DROP TRIGGER IF EXISTS / 回填 NOT IN 守卫）；
//   附：`addAgentMemoryMergeSkipColumn` 三态（缺列才 ADD / 已有跳过 / 重复执行零 ALTER）
//       + runMigrations 接线顺序（必须在 addAgentMemoryAccessColumns 之后）。
//
// 真库语义由 scripts/agent-memory-migration-smoke.cjs 的态6（Electron 运行时真 SQLite）验证；
// 本文件用记录 exec 的 FakeDb 驱动真实迁移函数（vitest 内无法加载 better-sqlite3 ABI，
// 见 tests/main/db/migrations.test.ts 头注）。
// 无 any、无 dangerouslySetInnerHTML。

import { readFileSync } from 'node:fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

// --- 隔离 Electron app 依赖（index.ts 顶层 import electron；此处不需其 runtime） ---
vi.mock('electron', () => ({
  app: { getPath: () => ':memory:' },
}));

import { addAgentMemoryFts, addAgentMemoryMergeSkipColumn } from '@main/db/index';

const INDEX_TS = path.resolve(process.cwd(), 'src', 'main', 'db', 'index.ts');

interface FakeMigDb {
  execs: string[];
  columns: Set<string>;
  alters: string[];
  exec: (sql: string) => void;
  prepare: (sql: string) => { get: (name: string) => { c: number } | undefined };
}

/** 记录 exec / 维护列集合的最小 FakeDb（ALTER 真的把列加进集合，供 PRAGMA 探测）。 */
function makeDb(seedColumns: string[]): FakeMigDb {
  const columns = new Set(seedColumns);
  const execs: string[] = [];
  const alters: string[] = [];
  const db: FakeMigDb = {
    execs,
    columns,
    alters,
    exec(sql: string) {
      execs.push(sql);
      const m = /^ALTER TABLE (\w+) ADD COLUMN (.+)$/s.exec(sql.trim());
      if (m) {
        const colName = m[2].trim().split(/\s+/)[0];
        if (columns.has(colName)) throw new Error(`duplicate column: ${m[1]}.${colName}`);
        columns.add(colName);
        alters.push(sql.trim());
      }
    },
    prepare: () => ({
      get: (name: string) => (columns.has(name) ? { c: 1 } : undefined),
    }),
  };
  return db;
}

/** agent_memory 迁移终态（B3 11 列 + D2 补列 2 列）。 */
const AGENT_MEMORY_EXISTING = [
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
  'access_count',
  'last_read_at',
];

/** 抽取 `USING fts5(...)` 括号内的列声明（去掉 tokenize 等表选项行）。 */
function ftsColumns(sql: string): string[] {
  const m = /USING fts5\(([\s\S]*?)\);/.exec(sql);
  if (!m) throw new Error(`未找到 fts5 列声明 → ${sql}`);
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(tokenize|columnsize|prefix|detail|remove_diacritics)\b/i.test(s))
    .map((s) => s.split(/\s+/)[0]);
}

describe('D5 防线一 — addAgentMemoryFts 迁移三断言', () => {
  it('态1 空库首建：FTS5 虚拟表只索引 subject + content，tokenize = trigram', () => {
    const db = makeDb(AGENT_MEMORY_EXISTING);
    addAgentMemoryFts(db as never);
    const sql = db.execs.join('\n');
    expect(sql).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5');
    // 总指挥裁定 2：user_id / kind 不进 FTS，靠普通查询过滤后再取候选
    expect(ftsColumns(sql)).toEqual(['subject', 'content']);
    expect(sql).toContain("tokenize = 'trigram'");
    // 中文须按 3 字窗口切分：unicode61 会把整段汉字并成一个 token，中文相似度不可用
    expect(sql).not.toContain('unicode61');
  });

  it('态1 三个触发器齐备（ai/ad/au），全部 DROP TRIGGER IF EXISTS 前置', () => {
    const db = makeDb(AGENT_MEMORY_EXISTING);
    addAgentMemoryFts(db as never);
    const sql = db.execs.join('\n');
    for (const suffix of ['ai', 'ad', 'au']) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS agent_memory_fts_${suffix}`);
    }
    expect(sql).toContain('CREATE TRIGGER agent_memory_fts_ai AFTER INSERT ON agent_memory');
    expect(sql).toContain('CREATE TRIGGER agent_memory_fts_ad AFTER DELETE ON agent_memory');
    expect(sql).toContain('CREATE TRIGGER agent_memory_fts_au AFTER UPDATE OF subject, content ON agent_memory');
    // 用 agent_memory 内部 rowid（= id）作 FTS5 rowid，回查 join 不需要冗余列
    expect(sql).toContain('VALUES (new.rowid, new.subject, new.content)');
    // 同步删除用标准 DELETE（普通 fts5 表不接受 'delete' 特殊命令，实测 SQL logic error）
    expect(sql).toContain('DELETE FROM agent_memory_fts WHERE rowid = old.rowid');
    expect(sql).not.toContain("VALUES ('delete'");
  });

  it('态2 旧库升级：存量行回填（NOT IN 守卫），且不改既有表结构', () => {
    const db = makeDb(AGENT_MEMORY_EXISTING);
    addAgentMemoryFts(db as never);
    const sql = db.execs.join('\n');
    expect(sql).toMatch(/INSERT INTO agent_memory_fts\(rowid, subject, content\)/);
    expect(sql).toMatch(/SELECT rowid, subject, content FROM agent_memory/);
    expect(sql).toMatch(/WHERE rowid NOT IN \(SELECT rowid FROM agent_memory_fts\)/);
    // 红线：不 DROP 主表 / 不 DELETE FROM / 不 ALTER / 不 UPDATE 主表
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    // 只禁删基表：fts 虚拟表自身的同步 DELETE 是允许的
    expect(sql).not.toMatch(/DELETE\s+FROM\s+agent_memory\b/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/\bUPDATE\s+agent_memory\b/i);
    expect(db.alters).toHaveLength(0);
  });

  it('态3 重复执行：IF NOT EXISTS + DROP TRIGGER IF EXISTS + 回填守卫三处幂等齐备', () => {
    const db = makeDb(AGENT_MEMORY_EXISTING);
    addAgentMemoryFts(db as never);
    const first = db.execs.length;
    addAgentMemoryFts(db as never);
    expect(db.execs.length).toBe(first * 2);
    const sql = db.execs.join('\n');
    expect(sql).toContain('IF NOT EXISTS agent_memory_fts');
    expect((sql.match(/DROP TRIGGER IF EXISTS agent_memory_fts_ad/g) ?? []).length).toBe(2);
    expect(db.alters).toHaveLength(0);
  });

  it('接线与顺序：runMigrations 在 addAgentMemoryAccessColumns 之后调用 addAgentMemoryFts', () => {
    const src = readFileSync(INDEX_TS, 'utf8');
    const rm = /function runMigrations\([\s\S]*?\n}/.exec(src);
    expect(rm).not.toBeNull();
    const body = rm?.[0] ?? '';
    expect(body).toContain('addAgentMemoryFts(database);');
    expect(body).toContain('addAgentMemoryAccessColumns(database);');
    expect(body.indexOf('addAgentMemoryFts(database);')).toBeGreaterThan(
      body.indexOf('addAgentMemoryAccessColumns(database);')
    );
    // 第二批「不建 FTS」原注释必须保留，改判理由以追加说明呈现（不删原注释）
    expect(src).toContain('不建 FTS 虚拟表、不建 VIEW');
    expect(src).toMatch(/agent-memory-optimize-3 D5/);
  });

  it('红线：addAgentMemoryTables / addAgentMemoryAccessColumns 本体不含 FTS 或驳回列', () => {
    const src = readFileSync(INDEX_TS, 'utf8');
    const tables = /export function addAgentMemoryTables[\s\S]*?\n}/.exec(src)?.[0] ?? '';
    const access = /export function addAgentMemoryAccessColumns[\s\S]*?\n}/.exec(src)?.[0] ?? '';
    expect(tables).not.toContain('agent_memory_fts');
    expect(tables).not.toContain('merge_skip');
    expect(access).not.toContain('agent_memory_fts');
    expect(access).not.toContain('merge_skip');
    // D2 补列函数仍只补 2 列（既有真库 smoke 态5 的正则依赖该条数）
    expect((access.match(/addColumnIfMissing\(/g) ?? []).length).toBe(2);
  });
});

describe('D5 防线二 — addAgentMemoryMergeSkipColumn 迁移三断言', () => {
  it('态1 列缺失 → 追加 merge_skip TEXT（唯一一条 addColumnIfMissing）', () => {
    const db = makeDb(AGENT_MEMORY_EXISTING);
    addAgentMemoryMergeSkipColumn(db as never);
    expect(db.alters).toEqual(['ALTER TABLE agent_memory ADD COLUMN merge_skip TEXT']);
    expect(db.columns.has('merge_skip')).toBe(true);
  });

  it('态2 列已存在 → 零 ALTER（不重复加列）', () => {
    const db = makeDb([...AGENT_MEMORY_EXISTING, 'merge_skip']);
    addAgentMemoryMergeSkipColumn(db as never);
    expect(db.alters).toHaveLength(0);
    expect(db.execs).toHaveLength(0);
  });

  it('态3 重复执行 → 幂等 no-op，且无 DROP/DELETE/UPDATE', () => {
    const db = makeDb(AGENT_MEMORY_EXISTING);
    addAgentMemoryMergeSkipColumn(db as never);
    addAgentMemoryMergeSkipColumn(db as never);
    expect(db.alters).toHaveLength(1);
    expect(db.execs.filter((s) => /DROP|DELETE|UPDATE/i.test(s))).toHaveLength(0);
  });

  it('接线：runMigrations 已接线，且为独立函数（不塞进 D2 的补列函数）', () => {
    const src = readFileSync(INDEX_TS, 'utf8');
    const body = /function runMigrations\([\s\S]*?\n}/.exec(src)?.[0] ?? '';
    expect(body).toContain('addAgentMemoryMergeSkipColumn(database);');
    const access = /export function addAgentMemoryAccessColumns[\s\S]*?\n}/.exec(src)?.[0] ?? '';
    expect(access).not.toContain('merge_skip');
  });
});
