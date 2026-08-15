// ============================================
// WeaveMD — FTS5 冒烟验证脚本（临时，运行时真验）
// ============================================
// 目的：在 **Electron 运行时**（能加载 better-sqlite3 ABI）验证第 3 期的 FTS5 迁移语义：
//   1. 与 src/main/db/index.ts 完全一致的 FTS5 DDL + 触发器 SQL
//   2. 建 kb_chunks 表（结构与既有 DDL 一致），insert 2 条中文 chunk
//   3. 验证触发器已同步到 kb_chunks_fts
//   4. 跑一条 FTS5 BM25 查询（MATCH ?）并打印结果
//
// 系统 Node 无法加载 Electron ABI 的 better-sqlite3，需用 `electron` 运行：
//   npx electron scripts/fts5-smoke.cjs   （或项目 dev 依赖的 electron）
// 退出码 0 = 成功；非 0 = 失败。

'use strict';

// FTS5 DDL + 触发器 SQL —— 与 src/main/db/index.ts 的 FTS5_MIGRATION_SQL 保持一致。
// 改动任一处时必须同步这里（验证脚本复制自迁移）。
const FTS5_MIGRATION_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
    content,
    doc_id UNINDEXED,                -- 冗余 kb_chunks.id（TEXT uuid），供回查
    tokenize = 'unicode61 remove_diacritics 2'
  );

  DROP TRIGGER IF EXISTS kb_chunks_fts_ai;
  CREATE TRIGGER kb_chunks_fts_ai AFTER INSERT ON kb_chunks BEGIN
    INSERT INTO kb_chunks_fts(rowid, content, doc_id)
    VALUES (new.rowid, new.content, new.id);
  END;

  DROP TRIGGER IF EXISTS kb_chunks_fts_ad;
  CREATE TRIGGER kb_chunks_fts_ad AFTER DELETE ON kb_chunks BEGIN
    INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content, doc_id)
    VALUES ('delete', old.rowid, old.content, old.id);
  END;
`;

// kb_chunks 建表 DDL —— 与既有迁移 DDL 一致（结构含 id TEXT PK/document_id/seq/content/vector/source_ref）。
const KB_CHUNKS_DDL = `
  CREATE TABLE kb_chunks (
    id           TEXT PRIMARY KEY,
    document_id  TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    content      TEXT NOT NULL,
    vector       BLOB DEFAULT NULL,
    source_ref   TEXT DEFAULT NULL,
    created_at   TEXT DEFAULT (datetime('now'))
  );
`;

// kb_documents 建表 DDL —— kb_chunks 的外键引用目标。
const KB_DOCUMENTS_DDL = `
  CREATE TABLE kb_documents (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    file_id     TEXT,
    source_type TEXT NOT NULL,
    title       TEXT NOT NULL,
    pinned      INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'pending',
    created_at  TEXT DEFAULT (datetime('now'))
  );
`;

function main() {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');

  // 开外键（与 initDatabase 一致），先建 kb_documents 再 kb_chunks
  db.pragma('foreign_keys = ON');
  db.exec(KB_DOCUMENTS_DDL);
  db.exec(KB_CHUNKS_DDL);

  // 执行与迁移完全一致的 FTS5 DDL + 触发器
  db.exec(FTS5_MIGRATION_SQL);

  // 先建一条 kb_documents 以满足 kb_chunks.document_id 外键
  db.prepare(
    'INSERT INTO kb_documents (id, user_id, source_type, title, status) VALUES (?, ?, ?, ?, ?)'
  ).run('doc-1', 'u1', 'db', 'note.md', 'done');

  // 插入 2 条中文 chunk（含关键词「知识库」），触发器应同步进 kb_chunks_fts
  const insertChunk = db.prepare(
    'INSERT INTO kb_chunks (id, document_id, seq, content, source_ref) VALUES (?, ?, ?, ?, ?)'
  );
  insertChunk.run('chunk-1', 'doc-1', 0, 'WeaveMD 知识库支持笔记全文检索与向量融合召回。', '{"line":1}');
  insertChunk.run('chunk-2', 'doc-1', 1, 'FTS5 使用 unicode61 分词，可索引中文内容。', '{"line":2}');

  // 验证触发器已同步到 FTS5 虚拟表
  const synced = db.prepare('SELECT count(*) AS n FROM kb_chunks_fts').get().n;
  if (synced !== 2) {
    throw new Error(`触发器未同步：kb_chunks_fts 应有 2 行，实际 ${synced}`);
  }

  // 跑一条 FTS5 BM25 查询，回查 kb_chunks。
  // 说明：unicode61 对连续 CJK 视为一个 token，故中文用前缀查询（知识*）以命中同一 CJK run；
  // ASCII 全 token（FTS5）可直接 MATCH。两例都验证「触发同步 + BM25 回查 kb_chunks」语义。
  const matchQuery = '知识*';
  const rows = db
    .prepare(
      `SELECT k.id AS chunk_id, k.seq, k.content, bm25(kb_chunks_fts) AS score
         FROM kb_chunks_fts
         JOIN kb_chunks k ON k.rowid = kb_chunks_fts.rowid
        WHERE kb_chunks_fts MATCH ?
        ORDER BY score`
    )
    .all(matchQuery);

  if (rows.length < 1) {
    throw new Error(`BM25 查询 MATCH '${matchQuery}' 未命中任何 chunk`);
  }

  const asciiHit = db.prepare('SELECT count(*) n FROM kb_chunks_fts WHERE kb_chunks_fts MATCH ?').get('FTS5').n;
  if (asciiHit < 1) {
    throw new Error('BM25 查询 MATCH FTS5 未命中 ASCII token');
  }

  // eslint-disable-next-line no-console
  console.log(`[fts5-smoke] 同步行数: ${synced}, MATCH '${matchQuery}' (CJK prefix) 命中 ${rows.length} 行, MATCH 'FTS5' (ASCII) 命中 ${asciiHit} 行:`);
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(`  - chunk ${r.chunk_id} seq=${r.seq} bm25=${r.score.toFixed(4)}: ${r.content}`);
  }

  db.close();
  // eslint-disable-next-line no-console
  console.log('[fts5-smoke] OK: FTS5 触发器同步 + BM25 回查验证通过');
}

try {
  main();
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[fts5-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
