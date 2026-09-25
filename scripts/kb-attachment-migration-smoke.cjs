// ============================================
// WeaveMD — doc-pipeline B4 D3 附件关联迁移冒烟（真库三断言 + 读写闭环）
// ============================================
// 目的：在 Electron 运行时（可加载 better-sqlite3 ABI）用真 SQLite 验证
//   src/main/db/index.ts 的 addKbAttachmentColumns（D3）：
//     1. 空库首建：pre-B4 kb_documents CREATE → 迁移 → attachment_id 列 + idx_kb_doc_user_attachment 索引
//     2. 旧库升级：含既有数据行 → 迁移 → 旧行留存且 attachment_id 取 DEFAULT NULL、source_type 不变
//     3. 重复执行：再跑一遍 → 不抛错、列/索引不重复（CREATE INDEX IF NOT EXISTS no-op）
//     4. 读写闭环：按 (user_id, attachment_id) 写读 + 跨用户隔离 + 按关联删除
//
// 防漂移：pre-B4 CREATE 语句与迁移 DDL（ADD COLUMN / CREATE INDEX）在运行时从
//         src/main/db/index.ts 源码正则抽取（不在此硬编码，改动自动跟随）。
//
// 运行：npx electron scripts/kb-attachment-migration-smoke.cjs   （退出码 0 = 通过）
// 对齐 scripts/attachments-migration-smoke.cjs 惯例（Electron 运行时真库验证）。
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'db', 'index.ts');
const src = fs.readFileSync(SRC, 'utf8');

// --- 抽取 addKbAttachmentColumns 内的 D3 迁移（ADD COLUMN + CREATE INDEX） ---
function extractMigration() {
  const fnMatch = /export function addKbAttachmentColumns[\s\S]*?\n}/.exec(src);
  if (!fnMatch) throw new Error('addKbAttachmentColumns 未在 src/main/db/index.ts 中找到');
  const body = fnMatch[0];

  const colM = /addColumnIfMissing\(\s*database,\s*'([^']+)',\s*'([^']+)',\s*(?:"([^"]*)"|'([^']*)')\s*\)/.exec(body);
  if (!colM) throw new Error('addKbAttachmentColumns 内未找到 addColumnIfMissing 调用');
  const column = {
    table: colM[1],
    name: colM[2],
    ddl: colM[3] !== undefined ? colM[3] : colM[4],
  };

  const idxM = /'(CREATE INDEX[^']+)'/.exec(body);
  if (!idxM) throw new Error('addKbAttachmentColumns 内未找到 CREATE INDEX DDL');

  return { column, indexSql: idxM[1] };
}

// --- 抽取 pre-B4 CREATE TABLE kb_documents（源码 CREATE 段保持 pre-B4 形态） ---
function extractCreate(table) {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\);`);
  const m = re.exec(src);
  if (!m) throw new Error(`CREATE TABLE ${table} 未在源码中找到`);
  return `CREATE TABLE IF NOT EXISTS ${table} (${m[1]});`;
}

const MIGRATION = extractMigration();
const KB_DOCUMENTS_DDL = extractCreate('kb_documents');
const USERS_DDL = extractCreate('users');

/** 与 index.ts addColumnIfMissing 一致的幂等补列（PRAGMA 探测 + 逐列 ADD）。 */
function addColumnIfMissing(db, table, column, ddl) {
  const row = db
    .prepare(`SELECT 1 AS c FROM pragma_table_info('${table}') WHERE name = ?`)
    .get(column);
  if (row) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** 与 index.ts addKbAttachmentColumns 等价的迁移入口（DDL 均为源码抽取）。 */
function addKbAttachmentColumns(db) {
  addColumnIfMissing(db, MIGRATION.column.table, MIGRATION.column.name, MIGRATION.column.ddl);
  db.exec(MIGRATION.indexSql);
}

function newPreB4Db() {
  const db = new (require('better-sqlite3'))(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(USERS_DDL);
  db.exec(KB_DOCUMENTS_DDL);
  return db;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function indexCount(db) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name = 'idx_kb_doc_user_attachment'")
    .get().c;
}

function columnDefault(db, table, column) {
  const col = db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === column);
  if (!col) throw new Error(`缺列: ${table}.${column}`);
  return col.dflt_value;
}

function main() {
  // --- 态1：空库首建（pre-B4 终态 → D3 迁移 → 同一终态）---
  {
    const db = newPreB4Db();
    addKbAttachmentColumns(db);
    const cols = columnNames(db, 'kb_documents');
    if (cols.length !== 9) throw new Error(`[态1] kb_documents 应为 9 列，实际 ${cols.length}: ${cols.join(',')}`);
    if (!cols.includes('attachment_id')) throw new Error('[态1] attachment_id 列缺失');
    const dflt = columnDefault(db, 'kb_documents', 'attachment_id');
    if (dflt !== null && String(dflt).toUpperCase() !== 'NULL') {
      throw new Error(`[态1] attachment_id DEFAULT 应为 NULL，实际 ${dflt}`);
    }
    if (indexCount(db) !== 1) throw new Error('[态1] idx_kb_doc_user_attachment 未创建');
    db.close();
    // eslint-disable-next-line no-console
    console.log('[kb-attachment-smoke] 态1 空库首建 OK: 9 列终态 + attachment_id DEFAULT NULL + 索引 1 个');
  }

  // --- 态2：旧库升级（含既有数据行，补列后旧行留存且新列取 DEFAULT）---
  {
    const db = newPreB4Db();
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES ('u1', 'tester', 'x')").run();
    db.prepare(
      "INSERT INTO kb_documents (id, user_id, file_id, source_type, title, pinned, status) VALUES ('d1', 'u1', 'f1', 'db', '笔记', 1, 'done')"
    ).run();
    db.prepare(
      "INSERT INTO kb_documents (id, user_id, file_id, source_type, title, pinned, status) VALUES ('d2', 'u1', NULL, 'import', '导入文档', 0, 'done')"
    ).run();

    addKbAttachmentColumns(db);

    const rows = db.prepare('SELECT id, source_type, attachment_id FROM kb_documents ORDER BY id').all();
    if (rows.length !== 2) throw new Error('[态2] 既有行流失');
    if (rows[0].attachment_id !== null || rows[1].attachment_id !== null) {
      throw new Error('[态2] 旧行 attachment_id 应取 DEFAULT NULL');
    }
    if (rows[0].source_type !== 'db' || rows[1].source_type !== 'import') {
      throw new Error('[态2] source_type 取值不应被迁移改动');
    }
    db.close();
    // eslint-disable-next-line no-console
    console.log('[kb-attachment-smoke] 态2 旧库升级 OK: 2 旧行留存，attachment_id=NULL、source_type 不变');
  }

  // --- 态3：重复执行（幂等 no-op）---
  {
    const db = newPreB4Db();
    addKbAttachmentColumns(db);
    const before = { cols: columnNames(db, 'kb_documents').length, idx: indexCount(db) };
    addKbAttachmentColumns(db); // 第二遍
    const after = { cols: columnNames(db, 'kb_documents').length, idx: indexCount(db) };
    if (before.cols !== after.cols) throw new Error('[态3] 重复执行产生了重复列');
    if (before.idx !== after.idx) throw new Error('[态3] 重复执行产生了重复索引');
    db.close();
    // eslint-disable-next-line no-console
    console.log('[kb-attachment-smoke] 态3 重复执行 OK: 幂等，不抛错、列/索引不重复');
  }

  // --- 态4：读写闭环（按 (user_id, attachment_id) 写读 + 跨用户隔离 + 关联删除）---
  {
    const db = newPreB4Db();
    addKbAttachmentColumns(db);
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES ('u1', 'tester', 'x')").run();
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES ('u2', 'other', 'x')").run();

    db.prepare(
      `INSERT INTO kb_documents (id, user_id, file_id, source_type, title, pinned, status, attachment_id)
       VALUES ('da', 'u1', NULL, 'attachment', 'report', 0, 'done', 'att1')`
    ).run();

    const hit = db
      .prepare('SELECT * FROM kb_documents WHERE attachment_id = ? AND user_id = ?')
      .get('att1', 'u1');
    if (!hit || hit.title !== 'report' || hit.source_type !== 'attachment') {
      throw new Error('[态4] 按 (user_id, attachment_id) 查询未命中');
    }
    const cross = db
      .prepare('SELECT * FROM kb_documents WHERE attachment_id = ? AND user_id = ?')
      .get('att1', 'u2');
    if (cross) throw new Error('[态4] 跨用户可见（归属隔离失效）');

    const del = db
      .prepare('DELETE FROM kb_documents WHERE attachment_id = ? AND user_id = ?')
      .run('att1', 'u2');
    if (del.changes !== 0) throw new Error('[态4] 跨用户删除未被拦截');
    const delOwn = db
      .prepare('DELETE FROM kb_documents WHERE attachment_id = ? AND user_id = ?')
      .run('att1', 'u1');
    if (delOwn.changes !== 1) throw new Error('[态4] 本用户按关联删除失败');

    db.close();
    // eslint-disable-next-line no-console
    console.log('[kb-attachment-smoke] 态4 读写闭环 OK: 关联写读一致、跨用户隔离、按关联删除');
  }

  // eslint-disable-next-line no-console
  console.log('[kb-attachment-smoke] PASS（4 态全过）');
}

try {
  main();
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[kb-attachment-smoke] FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
}
