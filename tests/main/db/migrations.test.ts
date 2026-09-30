import { readFileSync } from 'node:fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

// --- 隔离 Electron app 依赖（index.ts 顶层 import electron；此处不需其 runtime） ---
vi.mock('electron', () => ({
  app: { getPath: () => ':memory:' },
}));

import {
  addAgentMemoryTables,
  addAttachmentColumns,
  addB7AttachmentStructureColumn,
  addKbAttachmentColumns,
  addKbConsentGrantedColumn,
  addUploadKbDefaultColumn,
  addVisionOverrideColumn,
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

// ---------------------------------------------------------------------------
// doc-pipeline B11 D5/D5b 迁移三断言
// - D5: ai_config.upload_kb_default INTEGER DEFAULT 1（Q2 默认勾选「加入知识库」）
// - D5b: kb_documents.consent_granted INTEGER DEFAULT 0（八-1 勾选=该文档显式授权的过滤键）
// ---------------------------------------------------------------------------

const AI_CONFIG_PRE_B11 = [
  'id', 'user_id', 'backend', 'ollama_base_url', 'remote_base_url', 'model',
  'api_key_enc', 'allow_network', 'allow_send', 'consent_updated_at',
  'created_at', 'updated_at', 'write_mode', 'protocol',
];

const KB_DOCUMENTS_PRE_B11 = [
  'id', 'user_id', 'file_id', 'source_type', 'title', 'pinned', 'status',
  'created_at', 'attachment_id',
];

function preB11AiConfigDb(): FakeMigrationDb {
  return makeMigrationDb({ ai_config: [...AI_CONFIG_PRE_B11] });
}

function preB11KbDb(): FakeMigrationDb {
  return makeMigrationDb({ kb_documents: [...KB_DOCUMENTS_PRE_B11] });
}

describe('addUploadKbDefaultColumn — B11 D5 迁移三断言', () => {
  it('态1 空库首建：upload_kb_default 齐备且 DEFAULT 1（Q2 默认勾选）', () => {
    const db = preB11AiConfigDb();
    addUploadKbDefaultColumn(db as never);
    expect(db.columns.get('ai_config')).toContain('upload_kb_default');
    expect(db.alters).toEqual([
      'ALTER TABLE ai_config ADD COLUMN upload_kb_default INTEGER DEFAULT 1',
    ]);
  });

  it('态2 旧库升级：仅追加列（无 DROP/DELETE/UPDATE），旧行经 DEFAULT 1 收敛', () => {
    const db = preB11AiConfigDb();
    addUploadKbDefaultColumn(db as never);
    expect(db.execs.every((sql) => /^ALTER TABLE/.test(sql.trim()))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    expect(db.columns.get('ai_config')?.indexOf('upload_kb_default')).toBeGreaterThan(
      AI_CONFIG_PRE_B11.length - 1
    );
  });

  it('态3 重复执行：第二遍零 ALTER（幂等 no-op，不抛错）', () => {
    const db = preB11AiConfigDb();
    addUploadKbDefaultColumn(db as never);
    expect(db.alters).toHaveLength(1);
    addUploadKbDefaultColumn(db as never);
    expect(db.alters).toHaveLength(1);
  });
});

describe('addKbConsentGrantedColumn — B11 D5b 迁移三断言', () => {
  it('态1 空库首建：consent_granted 齐备且 DEFAULT 0（未勾选默认不授权）', () => {
    const db = preB11KbDb();
    addKbConsentGrantedColumn(db as never);
    expect(db.columns.get('kb_documents')).toContain('consent_granted');
    expect(db.alters).toEqual([
      'ALTER TABLE kb_documents ADD COLUMN consent_granted INTEGER DEFAULT 0',
    ]);
  });

  it('态2 旧库升级：仅追加列（无 DROP/DELETE/UPDATE），历史笔记行 consent_granted=0', () => {
    const db = preB11KbDb();
    addKbConsentGrantedColumn(db as never);
    expect(db.execs.every((sql) => /^ALTER TABLE/.test(sql.trim()))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    expect(db.columns.get('kb_documents')?.indexOf('consent_granted')).toBeGreaterThan(
      KB_DOCUMENTS_PRE_B11.length - 1
    );
  });

  it('态3 重复执行：第二遍零 ALTER（幂等 no-op，不抛错）', () => {
    const db = preB11KbDb();
    addKbConsentGrantedColumn(db as never);
    expect(db.alters).toHaveLength(1);
    addKbConsentGrantedColumn(db as never);
    expect(db.alters).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// doc-pipeline remedial D8：ai_config.vision_override 幂等补列
// 三态语义：NULL=自动判定（能力表+未知乐观）/ 1=强制支持 / 0=强制不支持。
// ---------------------------------------------------------------------------

const AI_CONFIG_PRE_D8 = [
  'id', 'user_id', 'backend', 'ollama_base_url', 'remote_base_url', 'model',
  'api_key_enc', 'allow_network', 'allow_send', 'consent_updated_at',
  'created_at', 'updated_at', 'write_mode', 'protocol', 'upload_kb_default',
  'active_model_config_id',
];

function preD8AiConfigDb(): FakeMigrationDb {
  return makeMigrationDb({ ai_config: [...AI_CONFIG_PRE_D8] });
}

describe('addVisionOverrideColumn — remedial D8 迁移三断言', () => {
  it('态1 空库首建：vision_override 齐备且 DEFAULT NULL（NULL=自动三态）', () => {
    const db = preD8AiConfigDb();
    addVisionOverrideColumn(db as never);
    expect(db.columns.get('ai_config')).toContain('vision_override');
    expect(db.alters).toEqual([
      'ALTER TABLE ai_config ADD COLUMN vision_override INTEGER DEFAULT NULL',
    ]);
  });

  it('态2 旧库升级：仅追加列（无 DROP/DELETE/UPDATE），旧行经 DEFAULT NULL 收敛为自动判定', () => {
    const db = preD8AiConfigDb();
    addVisionOverrideColumn(db as never);
    expect(db.execs.every((sql) => /^ALTER TABLE/.test(sql.trim()))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    expect(db.columns.get('ai_config')?.indexOf('vision_override')).toBeGreaterThan(
      AI_CONFIG_PRE_D8.length - 1
    );
  });

  it('态3 重复执行：第二遍零 ALTER（幂等 no-op）', () => {
    const db = preD8AiConfigDb();
    addVisionOverrideColumn(db as never);
    expect(db.alters).toHaveLength(1);
    addVisionOverrideColumn(db as never);
    expect(db.alters).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// agent-memory-optimize-2 B3：agent_memory 单表 + 双时间迁移三断言
// （态1 空库首建 / 态2 旧库升级 / 态3 重复执行 + anti-drift 源码列清单比对）。
// 真库语义由 scripts/agent-memory-migration-smoke.cjs（Electron 运行时真 SQLite）验证；
// 本文件用可建表的 FakeDb 驱动真实的 addAgentMemoryTables，断言列/索引终态、
// 既有表数据行留存、幂等（重复执行零新增 DDL）与「只增不改」（无 DROP/DELETE/UPDATE）。
// ---------------------------------------------------------------------------

/** 规格列清单（Q6=B 单表 + 双时间，req §二 B1 裁定）：11 列，与源码 DDL 逐列比对。 */
const AGENT_MEMORY_COLUMNS = [
  'id', 'user_id', 'kind', 'subject', 'content', 'source',
  'conversation_id', 'fingerprint', 'valid_from', 'valid_to', 'written_at',
] as const;

const AGENT_MEMORY_INDEXES = [
  'idx_agent_memory_user_kind',
  'idx_agent_memory_user_subject',
  'idx_agent_memory_user_fp',
] as const;

interface AgentMemoryFakeTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

interface AgentMemoryFakeDb {
  tables: Map<string, AgentMemoryFakeTable>;
  indexes: Set<string>;
  execs: string[];
  exec: (sql: string) => void;
  seed: (table: string, columns: string[], rows: Record<string, unknown>[]) => void;
}

/** 从 CREATE TABLE 语句中截取括号体（先剥离行注释，再深度感知配对，DEFAULT (datetime('now')) 含嵌套括号）。 */
function extractCreateBody(block: string): string {
  const text = block.replace(/--[^\n]*/g, ' ');
  const m = /CREATE TABLE IF NOT EXISTS \w+\s*\(/.exec(text);
  if (!m) throw new Error(`CREATE TABLE 未找到: ${block.slice(0, 60)}`);
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i);
    }
  }
  throw new Error('CREATE TABLE 括号未闭合');
}

/** 拆 CREATE TABLE 括号体为列名（跳过 PRIMARY/UNIQUE/CONSTRAINT 等表级约束）。 */
function parseCreateColumns(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  const flush = (): void => {
    const seg = cur.trim();
    cur = '';
    if (!seg) return;
    const first = seg.split(/\s+/)[0];
    if (!/^(PRIMARY|UNIQUE|CONSTRAINT|CHECK|FOREIGN|KEY)$/i.test(first)) out.push(first);
  };
  for (const ch of body) {
    if (ch === '(') {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

/** 从 src/main/db/index.ts 源码正则抽取 addAgentMemoryTables 内的 DDL（anti-drift 唯一来源）。 */
function extractSourceAgentMemoryDdl(): string {
  const src = readFileSync(path.resolve(process.cwd(), 'src', 'main', 'db', 'index.ts'), 'utf8');
  const fn = /export function addAgentMemoryTables[\s\S]*?\n}/.exec(src);
  if (!fn) throw new Error('addAgentMemoryTables 未在 src/main/db/index.ts 中找到');
  const ddl = /database\.exec\(`([\s\S]*?)`\)/.exec(fn[0]);
  if (!ddl) throw new Error('addAgentMemoryTables 内未找到 database.exec DDL');
  return ddl[1];
}

/**
 * 可建表 / 可存行的 FakeDb：
 * - exec 按括号深度拆分多语句块，只接受 CREATE TABLE / CREATE INDEX / ALTER TABLE，
 *   出现 DROP|DELETE|UPDATE 直接抛错；
 * - 重复 CREATE TABLE IF NOT EXISTS 为 no-op（真库语义），既有表行不被触碰。
 */
function makeAgentMemoryDb(): AgentMemoryFakeDb {
  const tables = new Map<string, AgentMemoryFakeTable>();
  const indexes = new Set<string>();
  const execs: string[] = [];
  return {
    tables,
    indexes,
    execs,
    exec: (raw: string) => {
      const sql = raw.trim();
      execs.push(sql);
      if (/DROP|DELETE|UPDATE/i.test(sql)) {
        throw new Error(`迁移禁止破坏性语句: ${sql.slice(0, 60)}`);
      }
      for (const stmt of splitStatements(sql)) {
        const t = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/.exec(stmt);
        if (t) {
          if (!tables.has(t[1])) {
            tables.set(t[1], { columns: parseCreateColumns(extractCreateBody(stmt)), rows: [] });
          }
          continue;
        }
        const i = /CREATE INDEX IF NOT EXISTS (\w+)/.exec(stmt);
        if (i) {
          indexes.add(i[1]);
          continue;
        }
        const a = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(stmt);
        if (a) {
          const tb = tables.get(a[1]);
          if (tb && !tb.columns.includes(a[2])) tb.columns.push(a[2]);
          continue;
        }
        throw new Error(`未识别的迁移语句: ${stmt.slice(0, 60)}`);
      }
    },
    seed: (table: string, columns: string[], rows: Record<string, unknown>[]) => {
      if (tables.has(table)) throw new Error(`表已存在: ${table}`);
      tables.set(table, { columns: [...columns], rows: rows.map((r) => ({ ...r })) });
    },
  };
}

/** 按括号深度为 0 处的分号拆分 SQL 块（先剥离行注释）。 */
function splitStatements(block: string): string[] {
  const text = block.replace(/--[^\n]*/g, '');
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** pre-B3 形态的既有库：含既有表与数据行，但不含 agent_memory。 */
function preB3AgentMemoryDb(): AgentMemoryFakeDb {
  const db = makeAgentMemoryDb();
  db.seed('users', ['id', 'username', 'password_hash', 'created_at'], [
    { id: 'u1', username: 'tester', password_hash: 'x', created_at: '2026-01-01 00:00:00' },
  ]);
  db.seed(
    'ai_messages',
    ['id', 'conversation_id', 'user_id', 'role', 'content', 'refs_json', 'created_at'],
    [
      {
        id: 'm1', conversation_id: 'c1', user_id: 'u1',
        role: 'user', content: '旧消息', refs_json: null, created_at: '2026-01-01 00:00:00',
      },
    ]
  );
  return db;
}

describe('addAgentMemoryTables — agent-memory B3 迁移三断言（FakeDb 驱动真实迁移函数）', () => {
  it('态1 空库首建：agent_memory 表 + 3 索引齐备，列集合精确等于规格 11 列', () => {
    const db = makeAgentMemoryDb();
    addAgentMemoryTables(db as never);

    expect(db.tables.has('agent_memory')).toBe(true);
    expect(db.tables.get('agent_memory')?.columns).toEqual([...AGENT_MEMORY_COLUMNS]);
    expect([...db.indexes]).toEqual([...AGENT_MEMORY_INDEXES]);
    expect(db.execs).toHaveLength(1);
    expect(db.execs.every((sql) => /^CREATE TABLE|^CREATE INDEX|^ALTER TABLE/.test(sql))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    // 不建 FTS 虚拟表、不建 VIEW、不预留未使用列（req §二 B1 明令）
    expect([...db.tables.keys()]).toEqual(['agent_memory']);
    expect(db.tables.get('agent_memory')?.columns).not.toContain('created_at');
    expect(db.tables.get('agent_memory')?.columns).not.toContain('extra');
  });

  it('态2 旧库升级：agent_memory 出现，既有数据行留存（无 DROP/DELETE/UPDATE）', () => {
    const db = preB3AgentMemoryDb();
    const usersBefore = JSON.stringify(db.tables.get('users')?.rows);
    const msgBefore = JSON.stringify(db.tables.get('ai_messages')?.rows);
    expect(db.tables.has('agent_memory')).toBe(false);

    addAgentMemoryTables(db as never);

    expect(db.tables.has('agent_memory')).toBe(true);
    expect(db.tables.get('agent_memory')?.columns).toEqual([...AGENT_MEMORY_COLUMNS]);
    expect([...db.indexes]).toEqual([...AGENT_MEMORY_INDEXES]);
    // 既有数据行原样留存（迁移不触碰既有表）
    expect(JSON.stringify(db.tables.get('users')?.rows)).toBe(usersBefore);
    expect(JSON.stringify(db.tables.get('ai_messages')?.rows)).toBe(msgBefore);
    expect(db.tables.get('ai_messages')?.columns).toEqual([
      'id', 'conversation_id', 'user_id', 'role', 'content', 'refs_json', 'created_at',
    ]);
    expect(db.execs.every((sql) => /^CREATE TABLE|^CREATE INDEX|^ALTER TABLE/.test(sql))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
  });

  it('态3 重复执行：第二遍零新增 DDL（表/索引/列不重复），不抛错、数据不变', () => {
    const db = makeAgentMemoryDb();
    addAgentMemoryTables(db as never);
    const snapshot = {
      tables: db.tables.size,
      columns: [...(db.tables.get('agent_memory')?.columns ?? [])],
      indexes: [...db.indexes],
    };
    db.tables.get('agent_memory')?.rows.push({
      id: 1, user_id: 'u1', kind: 'fact', subject: 'city', content: '上海',
      source: 'auto', conversation_id: null, fingerprint: 'fp1',
      valid_from: '2026-09-29 00:00:00', valid_to: null, written_at: '2026-09-29 00:00:00',
    });

    addAgentMemoryTables(db as never); // 第二遍

    expect(db.tables.size).toBe(snapshot.tables);
    expect(db.tables.get('agent_memory')?.columns).toEqual(snapshot.columns);
    expect([...db.indexes]).toEqual(snapshot.indexes);
    expect(db.tables.get('agent_memory')?.rows).toHaveLength(1);
    expect(db.execs.every((sql) => /^CREATE TABLE|^CREATE INDEX|^ALTER TABLE/.test(sql))).toBe(true);
    expect(db.execs.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
  });

  it('anti-drift：测试列/索引清单与 src 源码 DDL 逐项一致，且实跑 SQL 逐字相同', () => {
    const ddl = extractSourceAgentMemoryDdl();
    expect(parseCreateColumns(extractCreateBody(ddl))).toEqual([...AGENT_MEMORY_COLUMNS]);

    const idx: string[] = [];
    const re = /CREATE INDEX IF NOT EXISTS (\w+)/g;
    let m: RegExpExecArray | null = re.exec(ddl);
    while (m !== null) {
      idx.push(m[1]);
      m = re.exec(ddl);
    }
    expect(idx).toEqual([...AGENT_MEMORY_INDEXES]);
    expect(/DROP|DELETE|UPDATE/i.test(ddl)).toBe(false);

    // 源码 DDL 与真实迁移函数实际执行的 SQL 逐字一致（源码 ↔ 行为闭环；统一 CRLF/LF 后比对）
    const db = makeAgentMemoryDb();
    addAgentMemoryTables(db as never);
    expect(db.execs).toHaveLength(1);
    const norm = (s: string): string => s.replace(/\r\n/g, '\n').trim();
    expect(norm(db.execs[0])).toBe(norm(ddl));

    // 接线防漂移：runMigrations 必须调用 addAgentMemoryTables（否则表永远不会被创建）
    const src = readFileSync(path.resolve(process.cwd(), 'src', 'main', 'db', 'index.ts'), 'utf8');
    const rm = /function runMigrations\([\s\S]*?\n}/.exec(src);
    expect(rm).not.toBeNull();
    expect(rm?.[0]).toMatch(/addAgentMemoryTables\(database\);/);
  });
});
