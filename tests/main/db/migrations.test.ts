import { describe, expect, it, vi } from 'vitest';

// --- 隔离 Electron app 依赖（index.ts 顶层 import electron；此处不需其 runtime） ---
vi.mock('electron', () => ({
  app: { getPath: () => ':memory:' },
}));

import {
  addAttachmentColumns,
  addB7AttachmentStructureColumn,
  addKbAttachmentColumns,
  KB_CONFIG_ALTER_SQL,
} from '@main/db/index';

// ---------------------------------------------------------------------------
// 第 6 期批次 2：KB 参数列迁移（KB_CONFIG_ALTER_SQL）验证。
//
// 验证方式（两层，如实描述）：
//   1. 静态 SQL 语义断言（本文件）：KB_CONFIG_ALTER_SQL 为「6 条逐列 ADD COLUMN 列定义」，
//      断言列名齐全、类型/DEFAULT 正确、幂等语义由运行期探测保证（含 IF NOT EXISTS 结构不再适用——
//      见下注）。
//   2. 真实 SQLite 三态：由 scripts/kb-migration-smoke.cjs 在 **Electron 运行时**用真库
//      （better-sqlite3 in-memory）执行 addAiConfigKbColumns，验证新库/既有库/重复执行/
//      读写闭环四处语义，退出码 0。
//      系统 Node 无法加载 Electron ABI 的 better-sqlite3（NODE_MODULE_VERSION 不匹配），
//      vitest 内无法真库执行，故真库验证走 scripts/*.cjs（fts5-smoke.cjs 同惯例）。
//
// 注：项目锁定的 better-sqlite3（自带 sqlite 3.49.2）对 `ADD COLUMN IF NOT EXISTS` 报
// `near "EXISTS": syntax error`。故迁移改为「PRAGMA table_info 探测缺失列 + 逐列 ADD」，
// 幂等由运行期守卫保证（跑通真库 smoke 实证）。本测试因此断言列定义的结构与默认值，
// 而非正则解析 `IF NOT EXISTS`。
// ---------------------------------------------------------------------------

// 预期 KB 列（6 原始 + R2~R12 扩展），及每条列定义应包含的类型与 DEFAULT 值。
const KB_EXPECT: Record<string, string> = {
  kb_top_k: 'INTEGER DEFAULT 5',
  kb_fuse: 'REAL DEFAULT 0.5',
  kb_threshold: 'REAL DEFAULT 0.6',
  kb_pinned_weight: 'REAL DEFAULT 1.5',
  kb_embedding_host: "TEXT DEFAULT 'http://localhost:11434'",
  kb_embedding_model: "TEXT DEFAULT 'nomic-embed-text'",
  // R2: RRF 融合参数
  kb_rrf_k: 'INTEGER DEFAULT 60',
  kb_candidate_multiplier: 'INTEGER DEFAULT 4',
  kb_vec_score_threshold: 'REAL DEFAULT 0.5',
  // R3: 加权参数
  kb_current_file_boost: 'REAL DEFAULT 0.08',
  kb_recency_boost: 'REAL DEFAULT 0.05',
  kb_heading_boost: 'REAL DEFAULT 0.1',
  // R4: 段聚合参数
  kb_max_chunks_per_file: 'INTEGER DEFAULT 3',
  kb_context_expand: 'INTEGER DEFAULT 1',
  // R5~R9: 高级功能开关
  kb_enable_query_understanding: 'INTEGER DEFAULT 1',
  kb_enable_conditional_rerank: 'INTEGER DEFAULT 1',
  kb_enable_clarify: 'INTEGER DEFAULT 1',
  kb_enable_evidence_grading: 'INTEGER DEFAULT 1',
  kb_enable_research_loop: 'INTEGER DEFAULT 1',
  // R10: 文档上下文
  kb_enable_document_context: 'INTEGER DEFAULT 1',
  kb_document_context_budget: 'INTEGER DEFAULT 50000',
  // R1: Embedding 提供商
  kb_embedding_provider: "TEXT DEFAULT 'openai'",
  kb_embedding_dimension: 'INTEGER DEFAULT 1536',
};

describe('KB_CONFIG_ALTER_SQL — 静态结构断言（真实 SQLite 三态由 scripts/kb-migration-smoke.cjs 真验）', () => {
  it('KB 列定义数量与预期一致', () => {
    expect(KB_CONFIG_ALTER_SQL).toHaveLength(Object.keys(KB_EXPECT).length);
    const names = KB_CONFIG_ALTER_SQL.map((c) => c.name);
    expect(names).toEqual(Object.keys(KB_EXPECT));
  });

  it('每条列定义含对应列名 + 类型 + DEFAULT，且类型与默认值正确', () => {
    for (const { name, ddl } of KB_CONFIG_ALTER_SQL) {
      // 列定义等于 `<name> <TYPE> DEFAULT <default>`（不含 IF NOT EXISTS，避免 better-sqlite3 语法报错）
      expect(ddl).toBe(`${name} ${KB_EXPECT[name]}`);
      // 显式带 DEFAULT（使既有行不回写时回读到默认值）
      expect(ddl).toMatch(/DEFAULT /);
    }
  });

  it('DEFAULT 逐个收敛到目标值', () => {
    const byName = Object.fromEntries(KB_CONFIG_ALTER_SQL.map((c) => [c.name, c.ddl]));
    // 原始 6 列
    expect(byName.kb_top_k).toContain('DEFAULT 5');
    expect(byName.kb_fuse).toContain('DEFAULT 0.5');
    expect(byName.kb_threshold).toContain('DEFAULT 0.6');
    expect(byName.kb_pinned_weight).toContain('DEFAULT 1.5');
    expect(byName.kb_embedding_host).toContain("DEFAULT 'http://localhost:11434'");
    expect(byName.kb_embedding_model).toContain("DEFAULT 'nomic-embed-text'");
    // R2~R12 扩展列
    expect(byName.kb_rrf_k).toContain('DEFAULT 60');
    expect(byName.kb_candidate_multiplier).toContain('DEFAULT 4');
    expect(byName.kb_vec_score_threshold).toContain('DEFAULT 0.5');
    expect(byName.kb_current_file_boost).toContain('DEFAULT 0.08');
    expect(byName.kb_recency_boost).toContain('DEFAULT 0.05');
    expect(byName.kb_heading_boost).toContain('DEFAULT 0.1');
    expect(byName.kb_max_chunks_per_file).toContain('DEFAULT 3');
    expect(byName.kb_context_expand).toContain('DEFAULT 1');
    expect(byName.kb_embedding_provider).toContain("DEFAULT 'openai'");
    expect(byName.kb_embedding_dimension).toContain('DEFAULT 1536');
  });

  it('类型正确：数值列 INTEGER/REAL，端点列 TEXT', () => {
    const byName = Object.fromEntries(KB_CONFIG_ALTER_SQL.map((c) => [c.name, c.ddl]));
    expect(byName.kb_top_k).toMatch(/INTEGER/);
    expect(byName.kb_fuse).toMatch(/REAL/);
    expect(byName.kb_threshold).toMatch(/REAL/);
    expect(byName.kb_pinned_weight).toMatch(/REAL/);
    expect(byName.kb_embedding_host).toMatch(/TEXT/);
    expect(byName.kb_embedding_model).toMatch(/TEXT/);
    // R2~R12 扩展列类型
    expect(byName.kb_rrf_k).toMatch(/INTEGER/);
    expect(byName.kb_vec_score_threshold).toMatch(/REAL/);
    expect(byName.kb_embedding_provider).toMatch(/TEXT/);
  });
});

// ---------------------------------------------------------------------------
// doc-pipeline B3 D1/D2：附件列迁移三断言（空库首建 / 旧库升级 / 重复执行）。
// 真库语义由 scripts/attachments-migration-smoke.cjs（Electron 运行时真 SQLite）验证；
// 本文件用可探测列的 FakeDb 驱动真实的 addAttachmentColumns，断言 DDL 内容、
// 幂等（重复执行 ALTER 不重发）与「只增不改」（无 DROP/DELETE/UPDATE）。
// ---------------------------------------------------------------------------

interface FakeMigrationDb {
  columns: Map<string, string[]>;
  alters: string[];
  execs: string[];
  prepare: (sql: string) => { get: (name: string) => { c: number } | undefined };
  exec: (sql: string) => void;
}

function makeMigrationDb(seed: Record<string, string[]>): FakeMigrationDb {
  const columns = new Map<string, string[]>(
    Object.entries(seed).map(([t, cols]) => [t, [...cols]])
  );
  const alters: string[] = [];
  const execs: string[] = [];
  return {
    columns,
    alters,
    execs,
    prepare: (sql: string) => ({
      get: (name: string) => {
        const m = /pragma_table_info\('([^']+)'\)/.exec(sql);
        if (!m) throw new Error(`unexpected pragma sql: ${sql}`);
        const cols = columns.get(m[1]) ?? [];
        return cols.includes(name) ? { c: 1 } : undefined;
      },
    }),
    exec: (sql: string) => {
      execs.push(sql);
      const m = /^ALTER TABLE (\w+) ADD COLUMN (.+)$/s.exec(sql.trim());
      if (m) {
        const colName = m[2].trim().split(/\s+/)[0];
        const cols = columns.get(m[1]) ?? [];
        if (cols.includes(colName)) {
          throw new Error(`duplicate column: ${m[1]}.${colName}`);
        }
        columns.set(m[1], [...cols, colName]);
        alters.push(sql.trim());
        return;
      }
      if (/^DROP/i.test(sql.trim())) throw new Error('DROP is forbidden in migrations');
    },
  } as unknown as FakeMigrationDb;
}

// 附件迁移的前序终态（B3 之前 runMigrations 已保证的列）
const AI_MESSAGES_PRE_B3 = [
  'id', 'conversation_id', 'user_id', 'role', 'content',
  'refs_json', 'tool_call_id', 'tool_calls', 'created_at',
];
const PARSED_ATTACHMENTS_PRE_B3 = [
  'id', 'user_id', 'conversation_id', 'file_name', 'file_type', 'content', 'created_at',
];

function preB3Db(): FakeMigrationDb {
  return makeMigrationDb({
    ai_messages: AI_MESSAGES_PRE_B3,
    parsed_attachments: PARSED_ATTACHMENTS_PRE_B3,
  });
}

describe('addAttachmentColumns — B3 D1/D2 迁移三断言（FakeDb 驱动真实迁移函数）', () => {
  it('态1 空库首建：pre-B3 终态 + 本迁移 → 三列齐备且 DDL/DEFAULT 与计划一致', () => {
    const db = preB3Db();
    addAttachmentColumns(db as never);
    expect(db.columns.get('ai_messages')).toContain('attachments_json');
    expect(db.columns.get('parsed_attachments')).toContain('parse_status');
    expect(db.columns.get('parsed_attachments')).toContain('parse_version');
    // DDL 精确断言（D1: TEXT DEFAULT NULL；D2: TEXT DEFAULT 'done' / INTEGER DEFAULT 1）
    expect(db.alters).toEqual(
      expect.arrayContaining([
        'ALTER TABLE ai_messages ADD COLUMN attachments_json TEXT DEFAULT NULL',
        "ALTER TABLE parsed_attachments ADD COLUMN parse_status TEXT DEFAULT 'done'",
        'ALTER TABLE parsed_attachments ADD COLUMN parse_version INTEGER DEFAULT 1',
      ])
    );
    expect(db.alters).toHaveLength(3);
  });

  it('态2 旧库升级：既有数据行保留，仅追加列（无 DROP/DELETE/UPDATE）', () => {
    const db = preB3Db();
    addAttachmentColumns(db as never);
    expect(db.execs.every((sql) => /^ALTER TABLE/.test(sql.trim()))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    // 旧版本 SELECT 明确列名不读新列 → 升级后旧行 attachments_json 取 DEFAULT NULL
    expect(db.columns.get('ai_messages')?.indexOf('attachments_json')).toBeGreaterThan(
      AI_MESSAGES_PRE_B3.length - 1
    );
  });

  it('态3 重复执行：第二遍零 ALTER（幂等 no-op，不抛错）', () => {
    const db = preB3Db();
    addAttachmentColumns(db as never);
    expect(db.alters).toHaveLength(3);
    addAttachmentColumns(db as never); // 第二遍
    expect(db.alters).toHaveLength(3); // 无重复 ADD
    expect(db.alters).toHaveLength(db.execs.length);
  });
});

// ---------------------------------------------------------------------------
// doc-pipeline B4 D3：kb_documents 附件关联迁移三断言
// （空库首建 / 旧库升级 / 重复执行；真库语义由 scripts/kb-attachment-migration-smoke.cjs 真验）
// ---------------------------------------------------------------------------

const KB_DOCUMENTS_PRE_B4 = [
  'id', 'user_id', 'file_id', 'source_type', 'title', 'pinned', 'status', 'created_at',
];

const D3_INDEX_DDL =
  'CREATE INDEX IF NOT EXISTS idx_kb_doc_user_attachment ON kb_documents(user_id, attachment_id)';

function preB4KbDb(): FakeMigrationDb {
  return makeMigrationDb({ kb_documents: [...KB_DOCUMENTS_PRE_B4] });
}

describe('addKbAttachmentColumns — B4 D3 迁移三断言（FakeDb 驱动真实迁移函数）', () => {
  it('态1 空库首建：补 attachment_id 列 + 建 user/attachment 索引', () => {
    const db = preB4KbDb();
    addKbAttachmentColumns(db as never);

    expect(db.columns.get('kb_documents')).toContain('attachment_id');
    expect(db.alters).toEqual([
      'ALTER TABLE kb_documents ADD COLUMN attachment_id TEXT DEFAULT NULL',
    ]);
    expect(db.execs).toHaveLength(2); // ALTER + CREATE INDEX
    expect(db.execs).toContain(D3_INDEX_DDL);
  });

  it('态2 旧库升级：仅追加列与索引（无 DROP/DELETE/UPDATE），既有行保留', () => {
    const db = preB4KbDb();
    addKbAttachmentColumns(db as never);

    expect(db.execs.every((sql) => /^ALTER TABLE|^CREATE INDEX/.test(sql.trim()))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    // 旧版本 SELECT 明确列名不读新列 → 升级后旧行 attachment_id 取 DEFAULT NULL
    expect(db.columns.get('kb_documents')?.indexOf('attachment_id')).toBeGreaterThan(
      KB_DOCUMENTS_PRE_B4.length - 1
    );
    // source_type 为 TEXT 取值扩展（'attachment'），零 DDL
    expect(db.alters.join(' ')).not.toContain('source_type');
  });

  it('态3 重复执行：第二遍零 ALTER（幂等 no-op，不抛错）', () => {
    const db = preB4KbDb();
    addKbAttachmentColumns(db as never);
    expect(db.alters).toHaveLength(1);
    expect(db.execs).toHaveLength(2); // ALTER + CREATE INDEX

    addKbAttachmentColumns(db as never); // 第二遍（真库下 CREATE INDEX IF NOT EXISTS 为 no-op）
    expect(db.alters).toHaveLength(1); // 无重复 ADD
    expect(db.columns.get('kb_documents')?.filter((c) => c === 'attachment_id')).toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
// doc-pipeline B7 D7：parsed_attachments 解析结构列迁移三断言
// （structure_json 存页码/章节/表格序号 —— 二-6② source_ref 真实页码的落库前提）
// ---------------------------------------------------------------------------

const PARSED_ATTACHMENTS_PRE_B7 = [
  'id', 'user_id', 'conversation_id', 'file_name', 'file_type', 'content',
  'created_at', 'parse_status', 'parse_version',
];

function preB7Db(): FakeMigrationDb {
  return makeMigrationDb({ parsed_attachments: PARSED_ATTACHMENTS_PRE_B7 });
}

describe('addB7AttachmentStructureColumn — B7 D7 迁移三断言', () => {
  it('态1 空库首建：pre-B7 终态 + 本迁移 → structure_json 齐备', () => {
    const db = preB7Db();
    addB7AttachmentStructureColumn(db as never);
    expect(db.columns.get('parsed_attachments')).toContain('structure_json');
    expect(db.alters).toEqual([
      'ALTER TABLE parsed_attachments ADD COLUMN structure_json TEXT DEFAULT NULL',
    ]);
  });

  it('态2 旧库升级：仅追加列（无 DROP/DELETE/UPDATE），旧行经 DEFAULT NULL 收敛', () => {
    const db = preB7Db();
    addB7AttachmentStructureColumn(db as never);
    expect(db.execs.every((sql) => /^ALTER TABLE/.test(sql.trim()))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    expect(db.columns.get('parsed_attachments')?.indexOf('structure_json')).toBeGreaterThan(
      PARSED_ATTACHMENTS_PRE_B7.length - 1
    );
  });

  it('态3 重复执行：第二遍零 ALTER（幂等 no-op，不抛错）', () => {
    const db = preB7Db();
    addB7AttachmentStructureColumn(db as never);
    expect(db.alters).toHaveLength(1);
    addB7AttachmentStructureColumn(db as never);
    expect(db.alters).toHaveLength(1);
  });
});
