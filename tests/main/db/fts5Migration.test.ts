import { describe, expect, it } from 'vitest';
import { FTS5_MIGRATION_SQL } from '@main/db/index';

/**
 * 第 3 期 FTS5 迁移幂等性断言。
 *
 * runMigrations 在既有 build table DDL 之后执行 `database.exec(FTS5_MIGRATION_SQL)`，
 * FTS5_MIGRATION_SQL 是迁移 SQL 的唯一事实源（scripts/fts5-smoke.cjs 亦复制同一份）。
 * 因此断言该常量即断言迁移内容：
 *   - 含 FTS5 虚拟表 DDL 且带 IF NOT EXISTS（幂等）
 *   - 两个同步触发器均以 DROP TRIGGER IF EXISTS 前置（幂等重跑）
 *   - 不修改 kb_chunks 既有列结构（无 ALTER）
 */
describe('FTS5 迁移（批次 0：kb_chunks_fts 虚拟表 + 触发器）', () => {
  it('DDL 含 FTS5 虚拟表且带 IF NOT EXISTS（幂等）', () => {
    expect(FTS5_MIGRATION_SQL).toContain(
      "CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5"
    );
    expect(FTS5_MIGRATION_SQL).toContain('tokenize = \'unicode61 remove_diacritics 2\'');
    // doc_id 冗余列供 BM25 回查 join kb_chunks
    expect(FTS5_MIGRATION_SQL).toContain('doc_id UNINDEXED');
  });

  it('insert 触发器以 DROP TRIGGER IF EXISTS 前置（幂等）', () => {
    expect(FTS5_MIGRATION_SQL).toContain('DROP TRIGGER IF EXISTS kb_chunks_fts_ai');
    expect(FTS5_MIGRATION_SQL).toContain('CREATE TRIGGER kb_chunks_fts_ai AFTER INSERT ON kb_chunks');
    // 触发器用 kb_chunks 内部整数 rowid 作 FTS5 rowid，doc_id 存 TEXT uuid
    expect(FTS5_MIGRATION_SQL).toContain('VALUES (new.rowid, new.content, new.id)');
  });

  it('delete 触发器以 DROP TRIGGER IF EXISTS 前置（幂等）', () => {
    expect(FTS5_MIGRATION_SQL).toContain('DROP TRIGGER IF EXISTS kb_chunks_fts_ad');
    expect(FTS5_MIGRATION_SQL).toContain('CREATE TRIGGER kb_chunks_fts_ad AFTER DELETE ON kb_chunks');
    expect(FTS5_MIGRATION_SQL).toContain('old.rowid');
  });

  it('不改 kb_chunks 既有列结构（无 ALTER TABLE）', () => {
    expect(FTS5_MIGRATION_SQL).not.toMatch(/ALTER TABLE/i);
  });
});
