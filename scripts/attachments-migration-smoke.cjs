// ============================================
// WeaveMD — doc-pipeline B3 附件迁移冒烟（真库三断言）
// ============================================
// 目的：在 Electron 运行时（可加载 better-sqlite3 ABI）用真 SQLite 验证
//   src/main/db/index.ts 的 addAttachmentColumns（D1/D2）：
//     1. 空库首建：pre-B3 建表形态 → 迁移 → 3 列齐备
//     2. 旧库升级：含既有数据行 → 迁移 → 补列 + 旧行留存且新列取 DEFAULT
//     3. 重复执行：再跑一遍 → 零 ALTER、不抛错
//     4. 读写闭环：attachments_json 写入/读回 + 附件状态机读写 + user_id 隔离
//
// 防漂移：pre-B3 CREATE 语句与全部 addColumnIfMissing 列定义在运行时从
//         src/main/db/index.ts 源码正则抽取（不在此硬编码，改动自动跟随）。
//
// 运行：npx electron scripts/attachments-migration-smoke.cjs   （退出码 0 = 通过）
// 对齐 scripts/kb-migration-smoke.cjs 惯例（Electron 运行时真库验证）。
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'db', 'index.ts');
const src = fs.readFileSync(SRC, 'utf8');

// --- 抽取 addAttachmentColumns 内的 B3 迁移列（3 条） ---
function extractMigrationColumns() {
  const fnMatch = /export function addAttachmentColumns[\s\S]*?\n}/.exec(src);
  if (!fnMatch) throw new Error('addAttachmentColumns 未在 src/main/db/index.ts 中找到');
  const re = /addColumnIfMissing\(\s*database,\s*'([^']+)',\s*'([^']+)',\s*("([^"]*)"|'([^']*)')\s*\)/g;
  const cols = [];
  let m;
  while ((m = re.exec(fnMatch[0])) !== null) {
    const ddl = m[4] !== undefined ? m[4] : m[5];
    cols.push({ table: m[1], column: m[2], ddl });
  }
  if (cols.length !== 3) {
    throw new Error(`期望 3 条附件列迁移，实际 ${cols.length} 条（源码结构变化需同步本脚本断言）`);
  }
  return cols;
}

// --- 抽取某表全部 addColumnIfMissing 列定义（pre-B3 既有补列，含 B3 自身） ---
function extractAddColumns(table) {
  const re = new RegExp(
    `addColumnIfMissing\\(\\s*database,\\s*'${table}',\\s*'([^']+)',\\s*(?:"([^"]*)"|'([^']*)')\\s*\\);`,
    'g'
  );
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ column: m[1], ddl: m[2] !== undefined ? m[2] : m[3] });
  }
  return out;
}

// --- 抽取 pre-B3 CREATE TABLE 语句 ---
function extractCreate(table) {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\);`);
  const m = re.exec(src);
  if (!m) throw new Error(`CREATE TABLE ${table} 未在源码中找到`);
  return `CREATE TABLE IF NOT EXISTS ${table} (${m[1]});`;
}

const MIGRATION_COLUMNS = extractMigrationColumns();
const b3Keys = new Set(MIGRATION_COLUMNS.map((c) => `${c.table}.${c.column}`));
const PRE_COLUMNS = {
  ai_messages: extractAddColumns('ai_messages').filter((c) => !b3Keys.has(`ai_messages.${c.column}`)),
  parsed_attachments: extractAddColumns('parsed_attachments').filter(
    (c) => !b3Keys.has(`parsed_attachments.${c.column}`)
  ),
};
const AI_MESSAGES_DDL = extractCreate('ai_messages');
const PARSED_ATTACHMENTS_DDL = extractCreate('parsed_attachments');

/** 与 index.ts addColumnIfMissing 一致的幂等补列（PRAGMA 探测 + 逐列 ADD）。 */
function addColumnIfMissing(db, table, column, ddl) {
  const row = db
    .prepare(`SELECT 1 AS c FROM pragma_table_info('${table}') WHERE name = ?`)
    .get(column);
  if (row) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** 与 runMigrations 调用顺序一致的附件迁移入口（B3 的 D1/D2）。 */
function addAttachmentColumns(db) {
  for (const { table, column, ddl } of MIGRATION_COLUMNS) {
    addColumnIfMissing(db, table, column, ddl);
  }
}

/**
 * 构造 pre-B3 终态库：CREATE（源码抽取）+ 既有补列（源码抽取，排除 B3 三列）。
 * 与真实空库跑完 runMigrations(pre-B3) 的列集合一致。
 * users / ai_conversations 一并建（FK 引用；better-sqlite3 默认开启外键）。
 */
function newPreB3Db() {
  const db = new (require('better-sqlite3'))(':memory:');
  db.exec(extractCreate('users'));
  db.exec(extractCreate('ai_conversations'));
  db.exec(AI_MESSAGES_DDL);
  db.exec(PARSED_ATTACHMENTS_DDL);
  for (const { column, ddl } of PRE_COLUMNS.ai_messages) {
    addColumnIfMissing(db, 'ai_messages', column, ddl);
  }
  for (const { column, ddl } of PRE_COLUMNS.parsed_attachments) {
    addColumnIfMissing(db, 'parsed_attachments', column, ddl);
  }
  return db;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/** FK 前置数据：users + ai_conversations（ai_messages 的外键引用）。 */
function seedIdentity(db) {
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES ('u1', 'tester', 'x')").run();
  db.prepare(
    "INSERT INTO ai_conversations (id, user_id, mode, summary) VALUES ('c1', 'u1', 'agent', 's')"
  ).run();
}

function columnDefault(db, table, column) {
  const col = db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === column);
  if (!col) throw new Error(`缺列: ${table}.${column}`);
  return col.dflt_value;
}

function main() {
  // --- 态1：空库首建（pre-B3 终态 → B3 迁移 → 同一终态）---
  {
    const db = newPreB3Db();
    addAttachmentColumns(db);
    const msgCols = columnNames(db, 'ai_messages');
    const attCols = columnNames(db, 'parsed_attachments');
    if (!msgCols.includes('attachments_json')) throw new Error('[态1] ai_messages.attachments_json 缺失');
    if (!attCols.includes('parse_status') || !attCols.includes('parse_version')) {
      throw new Error('[态1] parsed_attachments 补列缺失');
    }
    if (msgCols.length !== 10) throw new Error(`[态1] ai_messages 应为 10 列，实际 ${msgCols.length}: ${msgCols.join(',')}`);
    if (attCols.length !== 9) throw new Error(`[态1] parsed_attachments 应为 9 列，实际 ${attCols.length}: ${attCols.join(',')}`);
    const statusDefault = String(columnDefault(db, 'parsed_attachments', 'parse_status')).replace(/^'|'$/g, '');
    if (statusDefault !== 'done') throw new Error(`[态1] parse_status DEFAULT 应为 done，实际 ${statusDefault}`);
    const versionDefault = String(columnDefault(db, 'parsed_attachments', 'parse_version'));
    if (versionDefault !== '1') throw new Error(`[态1] parse_version DEFAULT 应为 1，实际 ${versionDefault}`);
    db.close();
    // eslint-disable-next-line no-console
    console.log('[attachments-smoke] 态1 空库首建 OK: 3 列齐备、DEFAULT 正确、10/9 列终态');
  }

  // --- 态2：旧库升级（含既有数据行，补列后旧行留存且新列取 DEFAULT）---
  {
    const db = newPreB3Db();
    seedIdentity(db);
    db.prepare(
      "INSERT INTO ai_messages (id, conversation_id, user_id, role, content) VALUES ('m1', 'c1', 'u1', 'user', '旧消息')"
    ).run();
    db.prepare(
      "INSERT INTO parsed_attachments (id, user_id, conversation_id, file_name, file_type, content) VALUES ('a1', 'u1', 'c1', 'old.pdf', 'file', '旧正文')"
    ).run();
    addAttachmentColumns(db);

    const msg = db.prepare('SELECT content, attachments_json FROM ai_messages WHERE id = ?').get('m1');
    if (msg.content !== '旧消息') throw new Error('[态2] 既有消息行内容流失');
    if (msg.attachments_json !== null) throw new Error('[态2] 旧消息 attachments_json 应取 DEFAULT NULL');
    const att = db
      .prepare('SELECT content, parse_status, parse_version FROM parsed_attachments WHERE id = ?')
      .get('a1');
    if (att.content !== '旧正文' || att.parse_status !== 'done' || att.parse_version !== 1) {
      throw new Error(`[态2] 旧附件行新列应回读 DEFAULT，实际 status=${att.parse_status} version=${att.parse_version}`);
    }
    db.close();
    // eslint-disable-next-line no-console
    console.log('[attachments-smoke] 态2 旧库升级 OK: 旧行留存，attachments_json=NULL / parse_status=done / parse_version=1');
  }

  // --- 态3：重复执行（幂等 no-op）---
  {
    const db = newPreB3Db();
    addAttachmentColumns(db);
    const before = {
      msg: columnNames(db, 'ai_messages').length,
      att: columnNames(db, 'parsed_attachments').length,
    };
    addAttachmentColumns(db); // 第二遍
    const after = {
      msg: columnNames(db, 'ai_messages').length,
      att: columnNames(db, 'parsed_attachments').length,
    };
    if (before.msg !== after.msg || before.att !== after.att) {
      throw new Error('[态3] 重复执行产生了重复列');
    }
    db.close();
    // eslint-disable-next-line no-console
    console.log('[attachments-smoke] 态3 重复执行 OK: 幂等，不抛错、列不重复');
  }

  // --- 态4：读写闭环（attachments_json 序列化写读 + 附件状态机更新 + 归属隔离）---
  {
    const db = newPreB3Db();
    addAttachmentColumns(db);
    seedIdentity(db);
    const meta = JSON.stringify([
      { id: 'a9', type: 'file', name: 'r.pdf', path: 'C:/docs/r.pdf', size: 12, parseStatus: 'done' },
    ]);
    db.prepare(
      "INSERT INTO ai_messages (id, conversation_id, user_id, role, content, attachments_json) VALUES ('m9', 'c1', 'u1', 'user', '[文件: r.pdf]', ?)"
    ).run(meta);
    const readBack = db.prepare('SELECT attachments_json FROM ai_messages WHERE id = ?').get('m9')
      .attachments_json;
    const parsed = JSON.parse(readBack);
    if (parsed[0].id !== 'a9' || parsed[0].parseStatus !== 'done' || 'thumb' in parsed[0]) {
      throw new Error(`[态4] attachments_json 读回不一致: ${readBack}`);
    }

    // 状态机：pending 插入 → processing → done + content（与 attachments.ts 同序）
    db.prepare(
      "INSERT OR REPLACE INTO parsed_attachments (id, user_id, conversation_id, file_name, file_type, content, parse_status, parse_version, created_at) VALUES ('a9', 'u1', 'c1', 'r.pdf', 'file', '', 'pending', 1, datetime('now'))"
    ).run();
    db.prepare(
      "UPDATE parsed_attachments SET parse_status = 'processing' WHERE id = 'a9' AND user_id = 'u1'"
    ).run();
    db.prepare(
      "UPDATE parsed_attachments SET content = ?, parse_status = 'done' WHERE id = 'a9' AND user_id = 'u1'"
    ).run('解析产物正文');
    const att = db.prepare("SELECT content, parse_status FROM parsed_attachments WHERE id = 'a9'").get();
    if (att.content !== '解析产物正文' || att.parse_status !== 'done') {
      throw new Error(`[态4] 状态机读写不一致: ${JSON.stringify(att)}`);
    }
    const cross = db.prepare("SELECT 1 AS c FROM parsed_attachments WHERE id = 'a9' AND user_id = 'u2'").get();
    if (cross) throw new Error('[态4] user_id 隔离失效');
    db.close();
    // eslint-disable-next-line no-console
    console.log('[attachments-smoke] 态4 读写闭环 OK: attachments_json 写读一致 + 状态机 pending→processing→done + user_id 隔离');
  }
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log('[attachments-smoke] OK: B3 D1/D2 迁移真库三断言 + 读写闭环全部通过');
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[attachments-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
