// ============================================
// WeaveMD — agent-memory-optimize-3 D7：知识库 FTS 删除/更新触发器失效修复 断言
// ============================================
// 覆盖（req §二 D7 / 总指挥裁定 1~3）：
//   静态层（本文件，vitest 内无法加载 better-sqlite3 ABI，故断言迁移 SQL 文本）：
//     - kb_chunks_fts_ad / kb_documents_fts_ad / kb_documents_fts_au 三条触发器
//       用**普通 fts5 表可用的标准 DELETE**（`DELETE FROM <fts> WHERE rowid = old.rowid`），
//       且**不再出现仅限 contentless 表的 `'delete'` 特殊命令**；
//     - ai（AFTER INSERT）触发器不改动（`VALUES (new.rowid, ...)` 标准写法）；
//     - 红线：不 DROP 表 / 不 DROP 索引 / 不改列结构 / 不改 CREATE VIRTUAL TABLE 定义；
//     - scripts/fts5-smoke.cjs 的 FTS5_MIGRATION_SQL 副本与 src 常量逐字一致（文件头「须保持一致」）；
//     - smoke 脚本必须含删除/更新态（既有断言零改动的前提下追加）。
//   真库层（Electron 运行时，真 SQLite 3.49.2）：scripts/fts5-smoke.cjs 的删除/更新态。
//
// 无 any、无 dangerouslySetInnerHTML。

import { readFileSync } from 'node:fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

// --- 隔离 Electron app 依赖（index.ts 顶层 import electron；此处不需其 runtime） ---
vi.mock('electron', () => ({
  app: { getPath: () => ':memory:' },
}));

import { addKbDocumentsFtsIndex, FTS5_MIGRATION_SQL } from '@main/db/index';

const INDEX_TS = path.resolve(process.cwd(), 'src', 'main', 'db', 'index.ts');
const SMOKE_CJS = path.resolve(process.cwd(), 'scripts', 'fts5-smoke.cjs');

const src = readFileSync(INDEX_TS, 'utf8');
const smoke = readFileSync(SMOKE_CJS, 'utf8');

/** 抽取 `CREATE TRIGGER <name> ... END;` 整段（触发器体内无嵌套 END）。 */
function triggerBody(name: string): string {
  const m = new RegExp(`CREATE TRIGGER ${name}[\\s\\S]*?END;`).exec(src);
  return m?.[0] ?? '';
}

/** 抽取 `addKbDocumentsFtsIndex` 函数体（收尾 `}` 在行首，D5 测试同款正则）。 */
const docsFtsFn = /function addKbDocumentsFtsIndex[\s\S]*?\n}/.exec(src)?.[0] ?? '';

/** `'delete'` 特殊命令（contentless 表专用）——普通 fts5 表执行必报 SQL logic error。 */
const DELETE_SPECIAL_CMD = /VALUES\s*\(\s*'delete'/;

const STANDARD_AD_CHUNKS = 'DELETE FROM kb_chunks_fts WHERE rowid = old.rowid';
const STANDARD_AD_DOCS = 'DELETE FROM kb_documents_fts WHERE rowid = old.rowid';

describe('D7 kb_chunks_fts 删除触发器（FTS5_MIGRATION_SQL）', () => {
  it('ad 触发器改用标准 DELETE，且不含 contentless 专用的 delete 特殊命令', () => {
    const body = triggerBody('kb_chunks_fts_ad');
    expect(body).not.toBe('');
    expect(body).toContain(STANDARD_AD_CHUNKS);
    expect(body).not.toMatch(DELETE_SPECIAL_CMD);
  });

  it('ai 触发器不改动（insert 路径回归）', () => {
    const body = triggerBody('kb_chunks_fts_ai');
    expect(body).toContain('AFTER INSERT ON kb_chunks');
    expect(body).toContain('VALUES (new.rowid, new.content, new.id)');
    expect(body).not.toContain('DELETE FROM kb_chunks_fts');
  });

  it('红线：不 DROP 表/索引、不改列结构、不改虚拟表定义', () => {
    expect(FTS5_MIGRATION_SQL).toContain(
      'CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5'
    );
    expect(FTS5_MIGRATION_SQL).not.toMatch(/DROP\s+TABLE/i);
    expect(FTS5_MIGRATION_SQL).not.toMatch(/DROP\s+INDEX/i);
    expect(FTS5_MIGRATION_SQL).not.toMatch(/ALTER\s+TABLE/i);
    // 三个触发器仍全部 DROP TRIGGER IF EXISTS 幂等重放（旧库下次启动自动重建修复）
    for (const name of ['kb_chunks_fts_ai', 'kb_chunks_fts_ad']) {
      expect(FTS5_MIGRATION_SQL).toContain(`DROP TRIGGER IF EXISTS ${name}`);
    }
  });
});

describe('D7 kb_documents_fts 删除/更新触发器（addKbDocumentsFtsIndex）', () => {
  it('能抽取到 addKbDocumentsFtsIndex 函数体（前置守卫）', () => {
    expect(docsFtsFn).not.toBe('');
    expect(docsFtsFn).toContain('kb_documents_fts');
  });

  it('执行产物（FakeDb 捕获实际 exec 的 SQL）：ad/au 各一次标准 DELETE，无 delete 特殊命令', () => {
    const execs: string[] = [];
    addKbDocumentsFtsIndex({
      exec: (sql: string) => {
        execs.push(sql);
      },
    } as never);
    const sql = execs.join('\n');
    expect(execs.length).toBeGreaterThanOrEqual(4);
    // ad + au 各一条标准 DELETE
    expect(
      (sql.match(/DELETE FROM kb_documents_fts WHERE rowid = old\.rowid;/g) ?? []).length
    ).toBe(2);
    expect(sql).not.toMatch(DELETE_SPECIAL_CMD);
    expect(sql).toContain('VALUES (new.rowid, new.title, new.file_path, new.user_id)');
    expect(sql).toContain('WHERE rowid NOT IN (SELECT rowid FROM kb_documents_fts)');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
  });

  it('ad 触发器改用标准 DELETE，且不含 delete 特殊命令', () => {
    const body = triggerBody('kb_documents_fts_ad');
    expect(body).not.toBe('');
    expect(body).toContain('AFTER DELETE ON kb_documents');
    expect(body).toContain(STANDARD_AD_DOCS);
    expect(body).not.toMatch(DELETE_SPECIAL_CMD);
  });

  it('au 触发器先删旧行再插新行（更新同步，且不含 delete 特殊命令）', () => {
    const body = triggerBody('kb_documents_fts_au');
    expect(body).not.toBe('');
    expect(body).toContain('AFTER UPDATE ON kb_documents');
    expect(body).toContain(STANDARD_AD_DOCS);
    expect(body).toContain('VALUES (new.rowid, new.title, new.file_path, new.user_id)');
    // 顺序必须是先删后插，否则同 rowid 重复
    expect(body.indexOf(STANDARD_AD_DOCS)).toBeLessThan(
      body.indexOf('VALUES (new.rowid, new.title, new.file_path, new.user_id)')
    );
    expect(body).not.toMatch(DELETE_SPECIAL_CMD);
  });

  it('ai 触发器不改动（insert 路径回归）', () => {
    const body = triggerBody('kb_documents_fts_ai');
    expect(body).toContain('AFTER INSERT ON kb_documents');
    expect(body).toContain('VALUES (new.rowid, new.title, new.file_path, new.user_id)');
    expect(body).not.toContain('DELETE FROM kb_documents_fts');
  });

  it('红线：函数体内不 DROP 表/索引、不 ALTER、不改虚拟表定义', () => {
    expect(docsFtsFn).toContain(
      'CREATE VIRTUAL TABLE IF NOT EXISTS kb_documents_fts USING fts5'
    );
    expect(docsFtsFn).not.toMatch(/DROP\s+TABLE/i);
    expect(docsFtsFn).not.toMatch(/DROP\s+INDEX/i);
    expect(docsFtsFn).not.toMatch(/ALTER\s+TABLE/i);
    for (const name of [
      'kb_documents_fts_ai',
      'kb_documents_fts_ad',
      'kb_documents_fts_au',
    ]) {
      expect(docsFtsFn).toContain(`DROP TRIGGER IF EXISTS ${name}`);
    }
    // 存量回填守卫仍在（旧库修复依赖幂等重放 + 回填）
    expect(docsFtsFn).toContain('WHERE rowid NOT IN (SELECT rowid FROM kb_documents_fts)');
  });
});

describe('D7 scripts/fts5-smoke.cjs 同步与覆盖', () => {
  it('FTS5_MIGRATION_SQL 副本与 src 常量逐字一致（空白折叠后）', () => {
    const m = /const FTS5_MIGRATION_SQL = `([\s\S]*?)`;/.exec(smoke);
    expect(m).not.toBeNull();
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
    expect(norm(m?.[1] ?? '')).toBe(norm(FTS5_MIGRATION_SQL));
  });

  it('脚本含删除态与更新态（既有态断言零改动的前提下追加）', () => {
    expect(smoke).toContain('runDeleteUpdateState');
    expect(smoke).toContain('kb_documents_fts');
  });

  it('脚本不再复制 contentless 专用的 delete 特殊命令', () => {
    expect(smoke).not.toMatch(DELETE_SPECIAL_CMD);
  });
});
