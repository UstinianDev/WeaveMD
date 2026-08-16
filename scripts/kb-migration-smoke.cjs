// ============================================
// WeaveMD — KB 迁移冒烟验证脚本（临时，运行时真验）
// ============================================
// 目的：在 **Electron 运行时**（能加载 better-sqlite3 ABI）用真库验证第 6 期 KB 参数
//   迁移三态语义 + 真实读写闭环：
//     1. 新库：建 ai_config（无 KB 列，结构对齐 src/main/db/index.ts）-> 执行迁移 -> 断言 6 KB 列 + DEFAULT
//     2. 既有库：建含既有数据的 ai_config（插 1 行无 KB 列值的行）-> 执行迁移 -> 断言列补齐 + 既有行留存且 KB 列取 DEFAULT
//     3. 重复执行：同一 in-memory 库再跑一遍迁移 -> 不抛错、列不重复
//     4. 真实读写闭环：迁移后 INSERT/UPDATE KB 列 + SELECT 读回值一致（模拟 upsertAiConfig 语义）
//
// 说明：项目锁定的 better-sqlite3（自带 sqlite 3.49.2）对 `ALTER TABLE ... ADD COLUMN
// IF NOT EXISTS` 报 `near "EXISTS": syntax error`（该子句未编译进其 ALTER 语法），故幂等
// 由「PRAGMA table_info 探测缺失列 + 逐列 ADD」实现，与 src/main/db/index.ts 的
// addAiConfigKbColumns 完全一致。
//
// 系统 Node 无法加载 Electron ABI 的 better-sqlite3，需用 `electron` 运行：
//   npx electron scripts/kb-migration-smoke.cjs   （或项目 dev 依赖的 electron）
// 退出码 0 = 成功；非 0 = 失败。
//
// 本脚本为 dev 验证工具，保留工作区不提交（与 scripts/fts5-smoke.cjs 惯例一致）。

'use strict';

// KB_CONFIG_ALTER_SQL —— 与 src/main/db/index.ts 导出的 KB_CONFIG_ALTER_SQL 保持一致
// （6 个 KB 列的 ADD COLUMN 列定义，无 IF NOT EXISTS；幂等由运行期探测保证）。
// 改动任一处时必须同步这里。
const KB_CONFIG_ALTER_SQL = [
  { name: 'kb_top_k', ddl: 'kb_top_k INTEGER DEFAULT 5' },
  { name: 'kb_fuse', ddl: 'kb_fuse REAL DEFAULT 0.5' },
  { name: 'kb_threshold', ddl: 'kb_threshold REAL DEFAULT 0.6' },
  { name: 'kb_pinned_weight', ddl: 'kb_pinned_weight REAL DEFAULT 1.5' },
  { name: 'kb_embedding_host', ddl: "kb_embedding_host TEXT DEFAULT 'http://localhost:11434'" },
  { name: 'kb_embedding_model', ddl: "kb_embedding_model TEXT DEFAULT 'nomic-embed-text'" },
];

// ai_config 建表 DDL —— 与 src/main/db/index.ts:121-134 的 CREATE TABLE ai_config 一致（无 KB 列）。
const AI_CONFIG_DDL = `
  CREATE TABLE ai_config (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT UNIQUE NOT NULL,
    backend            TEXT NOT NULL DEFAULT 'ollama',
    ollama_base_url    TEXT DEFAULT 'http://localhost:11434',
    remote_base_url    TEXT DEFAULT 'https://api.deepseek.com',
    model              TEXT DEFAULT '',
    api_key_enc        TEXT DEFAULT NULL,
    allow_network      INTEGER DEFAULT 0,
    allow_send         INTEGER DEFAULT 0,
    consent_updated_at TEXT DEFAULT NULL,
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now'))
  );
`;

// 预期 6 个 KB 列 + DEFAULT 值。
const KB_EXPECT = {
  kb_top_k: '5',
  kb_fuse: '0.5',
  kb_threshold: '0.6',
  kb_pinned_weight: '1.5',
  kb_embedding_host: 'http://localhost:11434',
  kb_embedding_model: 'nomic-embed-text',
};

/** 与 src/main/db/index.ts addAiConfigKbColumns 一致的幂等迁移（探测缺失列 + 逐列 ADD）。 */
function addAiConfigKbColumns(db) {
  for (const { name, ddl } of KB_CONFIG_ALTER_SQL) {
    const existing = db
      .prepare("SELECT 1 AS c FROM pragma_table_info('ai_config') WHERE name = ?")
      .get(name);
    if (existing) continue;
    db.exec(`ALTER TABLE ai_config ADD COLUMN ${ddl}`);
  }
}

/** 断言 PRAGMA table_info 中 6 个 KB 列存在且 DEFAULT 正确（better-sqlite3 返回字符串，去引号比对）。 */
function assertKbColumns(db, label) {
  const cols = db.prepare('PRAGMA table_info(ai_config)').all();
  const byName = new Map(cols.map((c) => [c.name, c]));
  for (const name of Object.keys(KB_EXPECT)) {
    const col = byName.get(name);
    if (!col) throw new Error(`[${label}] 缺少 KB 列: ${name}`);
    const normalized = String(col.dflt_value).replace(/^'|'$/g, '');
    if (normalized !== KB_EXPECT[name]) {
      throw new Error(`[${label}] ${name} 默认值应为 '${KB_EXPECT[name]}'，实际 '${col.dflt_value}'`);
    }
  }
  const kbCols = cols.filter((c) => c.name.startsWith('kb_'));
  if (kbCols.length !== 6) throw new Error(`[${label}] 应有 6 个 KB 列，实际 ${kbCols.length}`);
  return kbCols;
}

function newDb(ddl, insertRow) {
  const db = new (require('better-sqlite3'))(':memory:');
  db.exec(ddl);
  if (insertRow) db.prepare(insertRow.sql).run(...insertRow.args);
  return db;
}

function main() {
  // --- 态1：新库（无 KB 列、无既有行）---
  {
    const db = newDb(AI_CONFIG_DDL);
    addAiConfigKbColumns(db);
    assertKbColumns(db, '新库');
    db.close();
    // eslint-disable-next-line no-console
    console.log('[kb-migration-smoke] 态1 新库 OK: 6 KB 列补齐且 DEFAULT 正确');
  }

  // --- 态2：既有库（含既有数据行，且其 INSERT 列列表不含 KB 列 -> 补齐后 KB 列取 DEFAULT）---
  {
    const db = newDb(AI_CONFIG_DDL, {
      sql: 'INSERT INTO ai_config (id, user_id, backend) VALUES (?, ?, ?)',
      args: ['c1', 'u1', 'ollama'],
    });
    addAiConfigKbColumns(db);
    assertKbColumns(db, '既有库');

    const row = db
      .prepare(
        'SELECT id, user_id, backend, kb_top_k, kb_fuse, kb_embedding_host, kb_embedding_model FROM ai_config WHERE id = ?'
      )
      .get('c1');
    if (!row) throw new Error('[既有库] 既有行 c1 丢失');
    if (row.backend !== 'ollama') throw new Error(`[既有库] 既有非 KB 字段流失: backend=${row.backend}`);
    if (row.kb_top_k !== 5 || row.kb_embedding_host !== 'http://localhost:11434') {
      throw new Error(
        `[既有库] 既有行 KB 列应取 DEFAULT，实际 top_k=${row.kb_top_k} host=${row.kb_embedding_host}`
      );
    }
    db.close();
    // eslint-disable-next-line no-console
    console.log(`[kb-migration-smoke] 态2 既有库 OK: 既有行留存，KB 列回读默认值 top_k=${row.kb_top_k} host=${row.kb_embedding_host}`);
  }

  // --- 态3：重复执行（同一 in-memory 库再跑一遍迁移 -> no-op）---
  {
    const db = newDb(AI_CONFIG_DDL);
    addAiConfigKbColumns(db);
    addAiConfigKbColumns(db); // 第二遍
    const kbCols = assertKbColumns(db, '重复执行');
    if (kbCols.length !== 6) throw new Error(`[重复执行] KB 列重复，实际 ${kbCols.length}`);
    db.close();
    // eslint-disable-next-line no-console
    console.log('[kb-migration-smoke] 态3 重复执行 OK: 幂等，不抛错、6 列不重复');
  }

  // --- 态4：真实读写闭环（迁移后 INSERT/UPDATE KB 列 + SELECT 读回一致，模拟 upsertAiConfig）---
  {
    const db = newDb(AI_CONFIG_DDL);
    addAiConfigKbColumns(db);

    // 先有一条既有行（无 KB 列），模拟既有数据升级后写入 KB 设置
    db.prepare('INSERT INTO ai_config (id, user_id, backend) VALUES (?, ?, ?)').run('c2', 'u2', 'ollama');

    // UPDATE（upsert 语义：写 KB 列）
    db.prepare(
      `UPDATE ai_config
          SET kb_top_k = ?, kb_fuse = ?, kb_threshold = ?, kb_pinned_weight = ?,
              kb_embedding_host = ?, kb_embedding_model = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(7, 0.45, 0.62, 2.0, 'http://192.168.1.10:11434', 'custom-embed', 'c2');

    // INSERT 一条带全 KB 列的新行
    db.prepare(
      `INSERT INTO ai_config (id, user_id, backend, kb_top_k, kb_fuse, kb_threshold, kb_pinned_weight, kb_embedding_host, kb_embedding_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('c3', 'u3', 'remote', 3, 0.7, 0.55, 1.8, 'http://localhost:9999', 'other-embed');

    const updated = db
      .prepare(
        'SELECT kb_top_k, kb_fuse, kb_threshold, kb_pinned_weight, kb_embedding_host, kb_embedding_model FROM ai_config WHERE id = ?'
      )
      .get('c2');
    const inserted = db
      .prepare(
        'SELECT kb_top_k, kb_fuse, kb_threshold, kb_pinned_weight, kb_embedding_host, kb_embedding_model FROM ai_config WHERE id = ?'
      )
      .get('c3');

    if (
      updated.kb_top_k !== 7 ||
      updated.kb_fuse !== 0.45 ||
      updated.kb_embedding_host !== 'http://192.168.1.10:11434'
    ) {
      throw new Error(`[读写闭环] UPDATE 读回不一致: ${JSON.stringify(updated)}`);
    }
    if (
      inserted.kb_top_k !== 3 ||
      inserted.kb_embedding_model !== 'other-embed' ||
      inserted.kb_pinned_weight !== 1.8
    ) {
      throw new Error(`[读写闭环] INSERT 读回不一致: ${JSON.stringify(inserted)}`);
    }

    const total = db.prepare('SELECT count(*) AS n FROM ai_config').get().n;
    if (total !== 2) throw new Error(`[读写闭环] 行列数异常，实际 ${total}`);
    db.close();
    // eslint-disable-next-line no-console
    console.log('[kb-migration-smoke] 态4 读写闭环 OK: UPDATE/INSERT KB 列 + SELECT 读回值一致（upsertAiConfig 语义）');
  }
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log('[kb-migration-smoke] OK: KB_CONFIG_ALTER_SQL 真库三态 + 读写闭环全部通过');
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[kb-migration-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
