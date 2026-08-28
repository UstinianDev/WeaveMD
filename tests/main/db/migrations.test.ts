import { describe, expect, it, vi } from 'vitest';

// --- 隔离 Electron app 依赖（index.ts 顶层 import electron；此处不需其 runtime） ---
vi.mock('electron', () => ({
  app: { getPath: () => ':memory:' },
}));

import { KB_CONFIG_ALTER_SQL } from '@main/db/index';

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
