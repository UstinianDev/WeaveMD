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
    DELETE FROM kb_chunks_fts WHERE rowid = old.rowid;
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

// ---------------------------------------------------------------------------
// agent-memory-optimize-3 D7（追加态，既有态代码零改动）：删除 / 更新路径真库验证
// 背景：kb_chunks_fts / kb_documents_fts 是**普通（非 contentless）fts5 表**，但
//   ad/au 触发器曾用仅限 contentless 表的 `'delete'` 特殊命令 → AFTER DELETE 抛
//   `SQL logic error` → 整条 DELETE 回滚（基表行删不掉）+ FTS 索引残留。
// 断言：
//   A 删 kb_chunks 行 → 基表行消失 + FTS 行同步消失 + 按内容 MATCH 不再命中；
//   B 更新 kb_documents.title → FTS 同步更新（先删旧行再插新行，不产生重复行）；
//   C 删 kb_documents 行 → 基表/FTS 均清空，且级联的子表 chunk 同步清空；
//   D 插入路径回归（ai 触发器不受影响）。
// 文档侧触发器 SQL 从 src/main/db/index.ts 运行期抽取（该函数非导出），避免第三份副本漂移。
// ---------------------------------------------------------------------------

/** 读取生产迁移源码（触发器 SQL 的唯一事实源）。 */
function readSrcTs() {
  const fs = require('fs');
  const srcPath = require('path').resolve(__dirname, '..', 'src', 'main', 'db', 'index.ts');
  return fs.readFileSync(srcPath, 'utf8');
}

/** 从 src/main/db/index.ts 抽取导出的 FTS5_MIGRATION_SQL（kb_chunks_fts 全套 DDL + 触发器）。 */
function extractSrcFts5Sql() {
  const m = /export const FTS5_MIGRATION_SQL = `([\s\S]*?)`;/.exec(readSrcTs());
  if (!m) throw new Error('未在 src/main/db/index.ts 抽到 FTS5_MIGRATION_SQL');
  return m[1];
}

/** 从 src/main/db/index.ts 抽取 addKbDocumentsFtsIndex 的全部 database.exec SQL 块。 */
function extractKbDocumentsFtsSql() {
  const srcTs = readSrcTs();
  const fn = /function addKbDocumentsFtsIndex[\s\S]*?\n}/.exec(srcTs);
  if (!fn) throw new Error('未在 src/main/db/index.ts 抽到 addKbDocumentsFtsIndex');
  const blocks = Array.from(fn[0].matchAll(/database\.exec\(`([\s\S]*?)`\)/g), (m) => m[1]);
  const joined = blocks.join('\n');
  for (const must of [
    'CREATE VIRTUAL TABLE IF NOT EXISTS kb_documents_fts',
    'kb_documents_fts_ai',
    'kb_documents_fts_ad',
    'kb_documents_fts_au',
  ]) {
    if (!joined.includes(must)) throw new Error(`addKbDocumentsFtsIndex 抽取不完整：缺 ${must}`);
  }
  return blocks;
}

function runDeleteUpdateState() {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');

  // 与 initDatabase 一致：开外键；先 kb_documents 再 kb_chunks（外键引用）
  db.pragma('foreign_keys = ON');
  db.exec(KB_DOCUMENTS_DDL);
  db.exec(KB_CHUNKS_DDL);
  // 生产由 addColumnIfMissing 幂等补 file_path（见 src/main/db/index.ts addKbVectorColumns 一带）
  db.exec('ALTER TABLE kb_documents ADD COLUMN file_path TEXT DEFAULT NULL');
  // 本态直接执行生产源码里的 FTS5 常量（既有态用本文件副本，两者须一致，见下方漂移守卫）
  const srcFts5Sql = extractSrcFts5Sql();
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  if (norm(srcFts5Sql) !== norm(FTS5_MIGRATION_SQL)) {
    throw new Error(
      '[删除/更新态] scripts/fts5-smoke.cjs 的 FTS5_MIGRATION_SQL 副本与 src 常量不一致（文件头要求保持一致）'
    );
  }
  db.exec(srcFts5Sql);
  for (const sql of extractKbDocumentsFtsSql()) db.exec(sql);

  const chunkBase = () => db.prepare('SELECT count(*) AS n FROM kb_chunks').get().n;
  const chunkFts = () => db.prepare('SELECT count(*) AS n FROM kb_chunks_fts').get().n;
  const chunkHit = (q) =>
    db.prepare('SELECT count(*) AS n FROM kb_chunks_fts WHERE kb_chunks_fts MATCH ?').get(q).n;
  const docBase = () => db.prepare('SELECT count(*) AS n FROM kb_documents').get().n;
  const docFts = () => db.prepare('SELECT count(*) AS n FROM kb_documents_fts').get().n;
  const docHit = (q) =>
    db
      .prepare('SELECT count(*) AS n FROM kb_documents_fts WHERE kb_documents_fts MATCH ?')
      .get(q).n;
  const eq = (label, actual, expected) => {
    if (actual !== expected) {
      throw new Error(`[删除/更新态] ${label}：期望 ${expected}，实际 ${actual}`);
    }
  };
  // 写语句统一包一层：触发器报错会回滚整条语句（基表行删不掉），报错必须带上下文
  const exec = (label, fn) => {
    try {
      fn();
    } catch (err) {
      throw new Error(
        `[删除/更新态] ${label}失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  // --- A. 删 kb_chunks 行 → 基表 + FTS 同步 ---
  db.prepare(
    'INSERT INTO kb_documents (id, user_id, source_type, title, file_path, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('doc-1', 'u1', 'db', 'Alpha 报告', '/notes/alpha-unique.md', 'done');
  const insChunk = db.prepare(
    'INSERT INTO kb_chunks (id, document_id, seq, content, source_ref) VALUES (?, ?, ?, ?, ?)'
  );
  insChunk.run('chunk-1', 'doc-1', 0, 'WeaveMD 知识库支持笔记全文检索与向量融合召回。', '{"line":1}');
  insChunk.run('chunk-2', 'doc-1', 1, 'FTS5 使用 unicode61 分词，可索引中文内容。', '{"line":2}');
  eq('插入后 kb_chunks 基表行数', chunkBase(), 2);
  eq('插入后 kb_chunks_fts 行数', chunkFts(), 2);
  eq('删除前 MATCH WeaveMD 命中', chunkHit('WeaveMD'), 1);

  exec('删 kb_chunks 行（chunk-1）', () =>
    db.prepare('DELETE FROM kb_chunks WHERE id = ?').run('chunk-1')
  );
  eq('删除后 kb_chunks 基表行数', chunkBase(), 1);
  eq('删除后 kb_chunks_fts 行数', chunkFts(), 1);
  eq('删除后 MATCH WeaveMD 不再命中', chunkHit('WeaveMD'), 0);
  eq('未删 chunk 仍命中 MATCH FTS5', chunkHit('FTS5'), 1);

  db.prepare('DELETE FROM kb_chunks WHERE document_id = ?').run('doc-1');
  eq('清空后 kb_chunks 基表行数', chunkBase(), 0);
  eq('清空后 kb_chunks_fts 行数', chunkFts(), 0);

  // D. 插入路径回归：ai 触发器不受本次改动影响
  insChunk.run('chunk-3', 'doc-1', 0, '删除修复后重新索引 WeaveMD chunk。', '{"line":1}');
  eq('重插后 kb_chunks_fts 行数', chunkFts(), 1);
  eq('重插后 MATCH WeaveMD 命中', chunkHit('WeaveMD'), 1);

  // --- B. 更新 kb_documents.title → au 触发器同步（先删旧行再插新行） ---
  eq('插入后 kb_documents_fts 行数', docFts(), 1);
  eq('插入后 MATCH Alpha 命中', docHit('Alpha'), 1);
  eq('插入后 MATCH unique（file_path 已索引）', docHit('unique'), 1);

  exec('UPDATE title + file_path', () =>
    db.prepare('UPDATE kb_documents SET title = ?, file_path = ? WHERE id = ?').run(
      'Beta 报告',
      '/notes/beta.md',
      'doc-1'
    )
  );
  eq('改标题后 kb_documents_fts 行数（不得重复）', docFts(), 1);
  eq('改标题后 MATCH Alpha 不再命中', docHit('Alpha'), 0);
  eq('改路径后 MATCH unique 不再命中', docHit('unique'), 0);
  eq('改标题后 MATCH Beta 命中', docHit('Beta'), 1);

  // 非索引列（status）更新也走 au，同步语义须保持一致
  exec('UPDATE status（非索引列）', () =>
    db.prepare('UPDATE kb_documents SET status = ? WHERE id = ?').run('archived', 'doc-1')
  );
  eq('改 status 后 kb_documents_fts 行数', docFts(), 1);
  eq('改 status 后 MATCH Beta 仍命中', docHit('Beta'), 1);

  // --- C. 删 kb_documents 行 → 基表 + FTS + 级联子表 chunk 同步 ---
  exec('删 kb_documents 行（doc-1，含级联 chunk）', () =>
    db.prepare('DELETE FROM kb_documents WHERE id = ?').run('doc-1')
  );
  eq('删文档后 kb_documents 基表行数', docBase(), 0);
  eq('删文档后 kb_documents_fts 行数', docFts(), 0);
  eq('删文档后 MATCH Beta 不再命中', docHit('Beta'), 0);
  eq('级联后 kb_chunks 基表行数', chunkBase(), 0);
  eq('级联后 kb_chunks_fts 行数', chunkFts(), 0);
  eq('级联后 MATCH WeaveMD 不再命中', chunkHit('WeaveMD'), 0);

  db.close();
  // eslint-disable-next-line no-console
  console.log('[fts5-smoke] 删除/更新态 OK：chunks 删/插、documents 删/改/级联 基表与 FTS 全同步');
}

try {
  main();
  runDeleteUpdateState();
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[fts5-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
