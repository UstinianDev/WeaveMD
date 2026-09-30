// ============================================
// WeaveMD — agent-memory-optimize 第二批 B3 迁移冒烟（真库四态）
// ============================================
// 目的：在 Electron 运行时（可加载 better-sqlite3 ABI）用真 SQLite 验证
//   src/main/db/index.ts 的 addAgentMemoryTables（Q6=B 单表 + 双时间）：
//     1. 空库首建：新库 → 迁移 → agent_memory 表 + 3 索引 + 精确 11 列
//     2. 旧库升级：pre-B3 既有库（含数据行）→ 迁移 → 新表出现、旧行留存
//     3. 重复执行：再跑一遍 → 零新增表/索引/列、不抛错、数据不变
//     4. 读写闭环：插入 user_id 隔离行 → 读回校验 → 置 valid_to 后当前有效查询不再返回
//
// 防漂移：迁移 DDL 与既有表 CREATE / 补列定义在运行时从
//         src/main/db/index.ts 源码正则抽取（不在此硬编码，改动自动跟随）；
//         并断言抽取到的 DDL 内无 DROP/DELETE/UPDATE（历史迁移零改动红线）。
//
// 运行：npx electron scripts/agent-memory-migration-smoke.cjs   （退出码 0 = 通过）
// 对齐 scripts/attachments-migration-smoke.cjs 惯例（Electron 运行时真库验证）。
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'db', 'index.ts');
const src = fs.readFileSync(SRC, 'utf8');

// --- 期望列清单（req §二 B1 裁定：11 列，无 created_at / 无未使用预留列） ---
const EXPECT_COLUMNS = [
  'id', 'user_id', 'kind', 'subject', 'content', 'source',
  'conversation_id', 'fingerprint', 'valid_from', 'valid_to', 'written_at',
];
const EXPECT_INDEXES = [
  'idx_agent_memory_user_kind',
  'idx_agent_memory_user_subject',
  'idx_agent_memory_user_fp',
];

/** 源码抽取 addAgentMemoryTables 内的 DDL（anti-drift 唯一来源）。 */
function extractAgentMemoryDdl() {
  const fn = /export function addAgentMemoryTables[\s\S]*?\n}/.exec(src);
  if (!fn) throw new Error('addAgentMemoryTables 未在 src/main/db/index.ts 中找到');
  const ddl = /database\.exec\(`([\s\S]*?)`\)/.exec(fn[0]);
  if (!ddl) throw new Error('addAgentMemoryTables 内未找到 database.exec DDL');
  if (/DROP|DELETE|UPDATE/i.test(ddl[1])) {
    throw new Error('agent_memory DDL 含 DROP/DELETE/UPDATE（迁移红线违规）');
  }
  return ddl[1];
}

/** 源码抽取既有表 CREATE TABLE 语句（pre-B3 既有库形态）。 */
function extractCreate(table) {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\);`);
  const m = re.exec(src);
  if (!m) throw new Error(`CREATE TABLE ${table} 未在源码中找到`);
  return `CREATE TABLE IF NOT EXISTS ${table} (${m[1]});`;
}

/** 源码抽取某表全部 addColumnIfMissing 列定义（既有幂等补列）。 */
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

const AGENT_MEMORY_DDL = extractAgentMemoryDdl();
const AI_MESSAGES_PRE_COLUMNS = extractAddColumns('ai_messages');

/** 与 index.ts addColumnIfMissing 一致的幂等补列（PRAGMA 探测 + 逐列 ADD）。 */
function addColumnIfMissing(db, table, column, ddl) {
  const row = db
    .prepare(`SELECT 1 AS c FROM pragma_table_info('${table}') WHERE name = ?`)
    .get(column);
  if (row) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** B3 迁移入口（与 runMigrations 内 addAgentMemoryTables(database) 同一段 DDL）。 */
function addAgentMemoryTables(db) {
  db.exec(AGENT_MEMORY_DDL);
}

/** pre-B3 既有库：源码抽取的既有表 + 既有补列，不含 agent_memory。 */
function newPreB3Db() {
  const db = new (require('better-sqlite3'))(':memory:');
  db.exec(extractCreate('users'));
  db.exec(extractCreate('ai_conversations'));
  db.exec(extractCreate('ai_messages'));
  for (const { column, ddl } of AI_MESSAGES_PRE_COLUMNS) {
    addColumnIfMissing(db, 'ai_messages', column, ddl);
  }
  return db;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function indexNames(db, table) {
  return db
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map((i) => i.name)
    .filter((n) => !n.startsWith('sqlite_autoindex'));
}

function seedIdentity(db) {
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES ('u1', 'tester', 'x')").run();
  db.prepare(
    "INSERT INTO ai_conversations (id, user_id, mode, summary) VALUES ('c1', 'u1', 'agent', 's')"
  ).run();
}

function main() {
  // --- 态1：空库首建 ---
  {
    const db = newPreB3Db();
    addAgentMemoryTables(db);
    const cols = columnNames(db, 'agent_memory');
    if (JSON.stringify(cols) !== JSON.stringify(EXPECT_COLUMNS)) {
      throw new Error(`[态1] agent_memory 列应为 ${EXPECT_COLUMNS.join(',')}，实际 ${cols.join(',')}`);
    }
    if (cols.includes('created_at')) throw new Error('[态1] 不得包含 created_at（req 明令）');
    const idx = indexNames(db, 'agent_memory');
    for (const name of EXPECT_INDEXES) {
      if (!idx.includes(name)) throw new Error(`[态1] 索引缺失: ${name}（实际 ${idx.join(',')}）`);
    }
    if (idx.length !== EXPECT_INDEXES.length) {
      throw new Error(`[态1] agent_memory 索引数应为 ${EXPECT_INDEXES.length}，实际 ${idx.length}`);
    }
    db.close();
    // eslint-disable-next-line no-console
    console.log(`[agent-memory-smoke] 态1 空库首建 OK: 11 列 + ${idx.length} 索引齐备，无 created_at`);
  }

  // --- 态2：旧库升级（既有数据行留存）---
  {
    const db = newPreB3Db();
    seedIdentity(db);
    db.prepare(
      "INSERT INTO ai_messages (id, conversation_id, user_id, role, content) VALUES ('m1', 'c1', 'u1', 'user', '旧消息')"
    ).run();
    if (columnNames(db, 'agent_memory').length > 0) throw new Error('[态2] pre-B3 库不应已有 agent_memory');

    addAgentMemoryTables(db);

    if (columnNames(db, 'agent_memory').length !== 11) {
      throw new Error(`[态2] 迁移后 agent_memory 列数应为 11，实际 ${columnNames(db, 'agent_memory').length}`);
    }
    const msg = db.prepare('SELECT content, role FROM ai_messages WHERE id = ?').get('m1');
    if (!msg || msg.content !== '旧消息' || msg.role !== 'user') {
      throw new Error(`[态2] 既有消息行流失: ${JSON.stringify(msg)}`);
    }
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get('u1');
    if (!user || user.username !== 'tester') throw new Error('[态2] 既有用户行流失');
    db.close();
    // eslint-disable-next-line no-console
    console.log('[agent-memory-smoke] 态2 旧库升级 OK: agent_memory 出现，既有 users/ai_messages 数据行留存');
  }

  // --- 态3：重复执行（幂等 no-op）---
  {
    const db = newPreB3Db();
    addAgentMemoryTables(db);
    const before = {
      cols: columnNames(db, 'agent_memory').length,
      idx: indexNames(db, 'agent_memory').length,
      tables: db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'").get().c,
    };
    db.prepare(
      "INSERT INTO agent_memory (user_id, kind, subject, content, fingerprint) VALUES ('u1', 'fact', 'city', '上海', 'fp1')"
    ).run();

    addAgentMemoryTables(db); // 第二遍

    const after = {
      cols: columnNames(db, 'agent_memory').length,
      idx: indexNames(db, 'agent_memory').length,
      tables: db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'").get().c,
    };
    if (before.cols !== after.cols || before.idx !== after.idx || before.tables !== after.tables) {
      throw new Error(
        `[态3] 重复执行产生了重复结构: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
      );
    }
    const rows = db.prepare('SELECT count(*) AS c FROM agent_memory').get().c;
    if (rows !== 1) throw new Error(`[态3] 重复执行改变了数据，行数=${rows}`);
    db.close();
    // eslint-disable-next-line no-console
    console.log('[agent-memory-smoke] 态3 重复执行 OK: 零新增表/索引/列，不抛错，数据不变');
  }

  // --- 态4：真实读写闭环（user_id 隔离 + Ledger 关闭后当前有效查询不再返回）---
  {
    const db = newPreB3Db();
    addAgentMemoryTables(db);
    seedIdentity(db);
    db.prepare(
      "INSERT INTO agent_memory (user_id, kind, subject, content, source, conversation_id, fingerprint) " +
        "VALUES ('u1', 'fact', 'city', '上海', 'auto', 'c1', 'fp-city')"
    ).run();

    const readBack = db
      .prepare("SELECT * FROM agent_memory WHERE user_id = 'u1' AND subject = 'city'")
      .get();
    if (!readBack || readBack.content !== '上海' || readBack.source !== 'auto') {
      throw new Error(`[态4] 写读不一致: ${JSON.stringify(readBack)}`);
    }
    if (readBack.valid_to !== null) throw new Error('[态4] 新写入行 valid_to 应为 NULL（当前有效）');
    if (!readBack.valid_from || !readBack.written_at) throw new Error('[态4] 双时间默认值未生效');

    // user_id 隔离：他人查询不得命中
    const cross = db
      .prepare("SELECT 1 AS c FROM agent_memory WHERE user_id = 'u2' AND subject = 'city'")
      .get();
    if (cross) throw new Error('[态4] user_id 隔离失效');

    // 当前有效查询（DAO 口径：valid_to IS NULL）
    const activeSql = "SELECT * FROM agent_memory WHERE user_id = 'u1' AND valid_to IS NULL";
    if (db.prepare(activeSql).all().length !== 1) throw new Error('[态4] 当前有效查询应命中 1 行');

    // Ledger 关闭：置 valid_to（不删行）→ 当前有效查询不再返回，历史行仍在
    db.prepare("UPDATE agent_memory SET valid_to = datetime('now') WHERE id = ?").run(readBack.id);
    if (db.prepare(activeSql).all().length !== 0) {
      throw new Error('[态4] 置 valid_to 后当前有效查询仍返回该行');
    }
    const kept = db.prepare('SELECT count(*) AS c FROM agent_memory WHERE id = ?').get(readBack.id);
    if (kept.c !== 1) throw new Error('[态4] Ledger 关闭不应删除行');
    db.close();
    // eslint-disable-next-line no-console
    console.log(
      '[agent-memory-smoke] 态4 读写闭环 OK: 写读一致 + user_id 隔离 + valid_to 置值后当前有效查询不返回且行留存'
    );
  }
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log('[agent-memory-smoke] OK: B3 迁移真库四态全部通过');
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[agent-memory-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
