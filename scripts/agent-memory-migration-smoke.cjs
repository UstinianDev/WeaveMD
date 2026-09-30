// ============================================
// WeaveMD — agent-memory-optimize 第二批 B3 + 第三批 D2/D5 迁移冒烟（真库六态）
// ============================================
// 目的：在 Electron 运行时（可加载 better-sqlite3 ABI）用真 SQLite 验证
//   src/main/db/index.ts 的 addAgentMemoryTables（Q6=B 单表 + 双时间）与
//   addAgentMemoryAccessColumns（D2 访问计数补列 + written_at 索引）：
//     1. 空库首建：新库 → 迁移 → agent_memory 表 + 3 索引 + 精确 11 列
//     2. 旧库升级：pre-B3 既有库（含数据行）→ 迁移 → 新表出现、旧行留存
//     3. 重复执行：再跑一遍 → 零新增表/索引/列、不抛错、数据不变
//     4. 读写闭环：插入 user_id 隔离行 → 读回校验 → 置 valid_to 后当前有效查询不再返回
//     5.（D2 新增）11 列旧库 → 补列后 13 列 + 旧行 access_count=0 / last_read_at=NULL
//        + idx_agent_memory_user_written 索引 + 重复执行仍为 13 列
//     6.（D5 新增）agent_memory FTS5 虚拟表 + ai/ad/au 3 触发器 + 存量回填
//        + user_id 隔离 + merge_skip 驳回标记列（旧行 NULL、重复执行幂等、跨用户不命中）
//     7.（D6 新增）agent_memory 向量列补列 14 → 16 + 旧行 vector/embedding_model 为 NULL
//        + 幂等 + 接线顺序（addAgentMemoryFts 之后）+ 真库混合检索 SQL
//        （ORDER BY rank 相关度序 + vec_distance_cosine 距离序 + 回填缺口条件）
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

// ---------------------------------------------------------------------------
// D2（第三批）：addAgentMemoryAccessColumns 的补列与索引 DDL（源码抽取，不硬编码）
// ---------------------------------------------------------------------------

/** 源码抽取 addAgentMemoryAccessColumns 函数体（含 2 条 addColumnIfMissing + 1 条索引）。 */
function extractAgentMemoryAccessFn() {
  const fn = /export function addAgentMemoryAccessColumns[\s\S]*?\n}/.exec(src);
  if (!fn) throw new Error('addAgentMemoryAccessColumns 未在 src/main/db/index.ts 中找到');
  if (/DROP|DELETE|UPDATE/i.test(fn[0])) {
    throw new Error('addAgentMemoryAccessColumns 含 DROP/DELETE/UPDATE（迁移红线违规）');
  }
  return fn[0];
}

/** 源码抽取 addAgentMemoryAccessColumns 内的 2 条补列定义。 */
function extractAgentMemoryAccessColumns() {
  const body = extractAgentMemoryAccessFn();
  const re =
    /addColumnIfMissing\(\s*database,\s*'agent_memory',\s*'([^']+)',\s*(?:"([^"]*)"|'([^']*)')\s*\);/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({ column: m[1], ddl: m[2] !== undefined ? m[2] : m[3] });
  }
  if (out.length !== 2) {
    throw new Error(`addAgentMemoryAccessColumns 应含 2 条补列，实际抽取到 ${out.length} 条`);
  }
  return out;
}

/** 源码抽取 written_at 时间索引 DDL。 */
function extractAgentMemoryAccessIndex() {
  const body = extractAgentMemoryAccessFn();
  const m = /'(CREATE INDEX IF NOT EXISTS [^']+ ON agent_memory\(user_id, written_at\))'/.exec(body);
  if (!m) throw new Error('addAgentMemoryAccessColumns 内未抽到 written_at 索引 DDL');
  return m[1];
}

const AGENT_MEMORY_ACCESS_COLUMNS = extractAgentMemoryAccessColumns();
const AGENT_MEMORY_ACCESS_INDEX_DDL = extractAgentMemoryAccessIndex();

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

  // --- 态5（D2 新增）：11 列旧库 → 补列后 13 列，旧行取 DEFAULT 0 / NULL ---
  {
    const db = newPreB3Db();
    addAgentMemoryTables(db); // 既有迁移终态 = 11 列
    seedIdentity(db);
    const inserted = db
      .prepare(
        "INSERT INTO agent_memory (user_id, kind, subject, content, fingerprint) " +
          "VALUES ('u1', 'fact', 'city', '上海', 'fp-city')"
      )
      .run();

    const before = columnNames(db, 'agent_memory');
    if (before.length !== 11) {
      throw new Error(`[态5] 补列前应为 11 列，实际 ${before.length}`);
    }
    if (before.includes('access_count') || before.includes('last_read_at')) {
      throw new Error('[态5] pre-D2 形态不应已含 access_count / last_read_at');
    }

    // 补列（与 runMigrations 内 addAgentMemoryAccessColumns 同源 DDL）
    for (const { column, ddl } of AGENT_MEMORY_ACCESS_COLUMNS) {
      addColumnIfMissing(db, 'agent_memory', column, ddl);
    }
    db.exec(AGENT_MEMORY_ACCESS_INDEX_DDL);

    const after = columnNames(db, 'agent_memory');
    if (after.length !== 13) {
      throw new Error(`[态5] 补列后应为 13 列，实际 ${after.length} → ${after.join(',')}`);
    }
    if (after[11] !== 'access_count' || after[12] !== 'last_read_at') {
      throw new Error(`[态5] 新列应追加在末尾，实际 ${after.slice(11).join(',')}`);
    }

    const row = db.prepare('SELECT * FROM agent_memory WHERE id = ?').get(inserted.lastInsertRowid);
    if (!row) throw new Error('[态5] 补列后既有行丢失');
    if (row.access_count !== 0) throw new Error(`[态5] 旧行 access_count 应取 DEFAULT 0，实际 ${row.access_count}`);
    if (row.last_read_at !== null) throw new Error(`[态5] 旧行 last_read_at 应为 NULL，实际 ${row.last_read_at}`);
    if (row.content !== '上海' || row.written_at === null || row.valid_to !== null) {
      throw new Error(`[态5] 补列改写了既有字段: ${JSON.stringify(row)}`);
    }

    const idx = indexNames(db, 'agent_memory');
    if (!idx.includes('idx_agent_memory_user_written')) {
      throw new Error(`[态5] written_at 索引缺失（实际 ${idx.join(',')}）`);
    }

    // 重复执行：仍是 13 列、索引不重复、数据不变
    for (const { column, ddl } of AGENT_MEMORY_ACCESS_COLUMNS) {
      addColumnIfMissing(db, 'agent_memory', column, ddl);
    }
    db.exec(AGENT_MEMORY_ACCESS_INDEX_DDL);
    if (columnNames(db, 'agent_memory').length !== 13) {
      throw new Error('[态5] 重复执行产生了重复列');
    }
    if (indexNames(db, 'agent_memory').filter((n) => n === 'idx_agent_memory_user_written').length !== 1) {
      throw new Error('[态5] 重复执行产生了重复索引');
    }
    const rows = db.prepare('SELECT count(*) AS c FROM agent_memory').get().c;
    if (rows !== 1) throw new Error(`[态5] 重复执行改变了数据，行数=${rows}`);

    // 接线防漂移：runMigrations 必须调用 addAgentMemoryAccessColumns
    if (!/function runMigrations\([\s\S]*?\n}/.test(src) ||
        !/addAgentMemoryAccessColumns\(database\);/.test(/function runMigrations\([\s\S]*?\n}/.exec(src)[0])) {
      throw new Error('[态5] runMigrations 未接线 addAgentMemoryAccessColumns');
    }

    db.close();
    // eslint-disable-next-line no-console
    console.log(
      '[agent-memory-smoke] 态5 D2 补列 OK: 11 → 13 列 + 旧行 access_count=0 / last_read_at=NULL + written_at 索引，重复执行幂等'
    );
  }

  // --- 态6（D5 新增）：agent_memory FTS5 索引 + merge_skip 驳回标记列 ---
  {
    const ftsFn = /export function addAgentMemoryFts[\s\S]*?\n}/.exec(src);
    if (!ftsFn) throw new Error('[态6] addAgentMemoryFts 未在 src/main/db/index.ts 中找到');
    if (/DROP\s+TABLE|DELETE\s+FROM\s+agent_memory\b|ALTER\s+TABLE/i.test(ftsFn[0])) {
      throw new Error('[态6] addAgentMemoryFts 含 DROP TABLE / 删基表 / ALTER TABLE（迁移红线违规）');
    }
    const ftsDdl = /database\.exec\(`([\s\S]*?)`\)/.exec(ftsFn[0]);
    if (!ftsDdl) throw new Error('[态6] addAgentMemoryFts 内未找到 database.exec DDL');

    const skipFn = /export function addAgentMemoryMergeSkipColumn[\s\S]*?\n}/.exec(src);
    if (!skipFn) throw new Error('[态6] addAgentMemoryMergeSkipColumn 未在 src/main/db/index.ts 中找到');
    const skipCol = /addColumnIfMissing\(\s*database,\s*'agent_memory',\s*'merge_skip',\s*(?:"([^"]*)"|'([^']*)')\s*\);/.exec(
      skipFn[0]
    );
    if (!skipCol) throw new Error('[态6] addAgentMemoryMergeSkipColumn 内未抽到 merge_skip 补列定义');
    const skipDdl = skipCol[1] !== undefined ? skipCol[1] : skipCol[2];
    if (skipDdl !== 'merge_skip TEXT') {
      throw new Error('[态6] merge_skip 列定义应为 "merge_skip TEXT"，实际 ' + skipDdl);
    }

    const rm = /function runMigrations\([\s\S]*?\n}/.exec(src);
    if (!rm || !/addAgentMemoryFts\(database\);/.test(rm[0])) {
      throw new Error('[态6] runMigrations 未接线 addAgentMemoryFts');
    }
    if (!/addAgentMemoryMergeSkipColumn\(database\);/.test(rm[0])) {
      throw new Error('[态6] runMigrations 未接线 addAgentMemoryMergeSkipColumn');
    }
    if (rm[0].indexOf('addAgentMemoryFts(database);') < rm[0].indexOf('addAgentMemoryAccessColumns(database);')) {
      throw new Error('[态6] addAgentMemoryFts 必须排在 addAgentMemoryAccessColumns 之后');
    }

    const db = newPreB3Db();
    addAgentMemoryTables(db);
    addColumnIfMissing(db, 'agent_memory', 'access_count', 'access_count INTEGER DEFAULT 0');
    addColumnIfMissing(db, 'agent_memory', 'last_read_at', 'last_read_at TEXT');
    addColumnIfMissing(db, 'agent_memory', 'merge_skip', skipDdl);
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_memory_user_written ON agent_memory(user_id, written_at)');

    // 旧行先落库（回填态）：迁移前已有 3 行 → addAgentMemoryFts 必须把它们导进索引
    const insert = db.prepare(
      "INSERT INTO agent_memory (id, user_id, kind, subject, content, fingerprint) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insert.run(1, 'u1', 'profile', '主题偏好', '用户偏好深色主题，界面使用暗色背景', 'fp1');
    insert.run(2, 'u1', 'profile', '外观设置', '用户偏好深色主题，界面使用暗色背景', 'fp2');
    insert.run(3, 'u2', 'profile', '主题偏好', '用户偏好深色主题，界面使用暗色背景', 'fp3');

    // 迁移（含 3 触发器 + 存量回填），重复执行幂等
    db.exec(ftsDdl[1]);
    db.exec(ftsDdl[1]);

    const master = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_fts'")
      .get();
    if (!master) throw new Error('[态6] agent_memory_fts 虚拟表未创建');

    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'agent_memory_fts_%'")
      .all()
      .map((r) => r.name)
      .sort();
    const expectTriggers = ['agent_memory_fts_ad', 'agent_memory_fts_ai', 'agent_memory_fts_au'];
    if (JSON.stringify(triggers) !== JSON.stringify(expectTriggers)) {
      throw new Error('[态6] 触发器应为 ' + expectTriggers.join(',') + '，实际 ' + triggers.join(','));
    }

    // FTS 查询口径与 DAO querySimilarMemoryCandidates 完全一致
    const candSql =
      'SELECT m.id FROM agent_memory_fts ' +
      'JOIN agent_memory m ON m.rowid = agent_memory_fts.rowid ' +
      'WHERE agent_memory_fts MATCH ? AND m.user_id = ? AND m.kind = ? AND m.valid_to IS NULL LIMIT ?';
    const find = (term, userId) =>
      db.prepare(candSql).all(term, userId, 'profile', 32).map((r) => r.id);

    // 回填：存量行已被索引
    const backfilled = find('"用户偏"', 'u1');
    if (JSON.stringify(backfilled) !== JSON.stringify([1, 2])) {
      throw new Error('[态6] 回填失败（期望 u1 的 1/2 行），实际 ' + JSON.stringify(backfilled));
    }
    // user_id 隔离：同样内容的 u2 行对 u1 查询不可见
    if (JSON.stringify(find('"用户偏"', 'u2')) !== JSON.stringify([3])) {
      throw new Error('[态6] user_id 隔离失效（u1/u2 相似组互相可见）');
    }

    // ai 触发器：新增行立即进索引
    insert.run(4, 'u1', 'profile', '新条目', '用户偏好浅色主题，界面使用明亮背景', 'fp4');
    if (!find('"浅色主"', 'u1').includes(4)) throw new Error('[态6] INSERT 触发器未同步进索引');

    // au 触发器：改写内容后旧词不再命中、新词命中
    db.prepare('UPDATE agent_memory SET content = ? WHERE id = ?').run('上海今天下雨', 4);
    if (find('"浅色主"', 'u1').includes(4)) throw new Error('[态6] UPDATE 后旧 trigram 仍在索引中');
    if (!find('"今天下"', 'u1').includes(4)) throw new Error('[态6] UPDATE 未同步新内容进索引');

    // ad 触发器：删行后索引同步移除
    db.prepare('DELETE FROM agent_memory WHERE id = ?').run(4);
    if (find('"今天下"', 'u1').includes(4)) throw new Error('[态6] DELETE 后索引未同步移除');
    if (db.prepare('SELECT count(*) AS c FROM agent_memory WHERE id = ?').get(4).c !== 0) {
      throw new Error('[态6] 删除未生效');
    }

    // merge_skip 补列：旧行取 NULL，重复执行零 ALTER
    const beforeCols = columnNames(db, 'agent_memory');
    if (beforeCols[beforeCols.length - 1] !== 'merge_skip') {
      throw new Error('[态6] merge_skip 应追加在末尾，实际 ' + beforeCols.join(','));
    }
    const oldRow = db.prepare('SELECT merge_skip FROM agent_memory WHERE id = ?').get(1);
    if (oldRow.merge_skip !== null) {
      throw new Error('[态6] 旧行 merge_skip 应为 NULL，实际 ' + String(oldRow.merge_skip));
    }
    const colsBefore = beforeCols.length;
    addColumnIfMissing(db, 'agent_memory', 'merge_skip', skipDdl);
    if (columnNames(db, 'agent_memory').length !== colsBefore) {
      throw new Error('[态6] merge_skip 重复执行产生了重复列');
    }

    // 驳回标记只 UPDATE 标记列，不碰 content / valid_to（Ledger 与红线）
    db.prepare('UPDATE agent_memory SET merge_skip = ? WHERE id = ? AND user_id = ?').run(
      '2026-09-30 12:00:00',
      1,
      'u1'
    );
    const flagged = db
      .prepare('SELECT content, valid_to, merge_skip FROM agent_memory WHERE id = ?')
      .get(1);
    if (flagged.merge_skip !== '2026-09-30 12:00:00') throw new Error('[态6] merge_skip 未写入');
    if (flagged.valid_to !== null) throw new Error('[态6] 打驳回标记不得置 valid_to');
    if (flagged.content !== '用户偏好深色主题，界面使用暗色背景') {
      throw new Error('[态6] 打驳回标记改写了 content');
    }
    // 跨用户打标不命中（user_id 条件）
    const cross = db
      .prepare('UPDATE agent_memory SET merge_skip = ? WHERE id = ? AND user_id = ?')
      .run('x', 3, 'u1');
    if (cross.changes !== 0) throw new Error('[态6] 跨用户打 merge_skip 标记未被 user_id 条件拦下');

    db.close();
    // eslint-disable-next-line no-console
    console.log(
      '[agent-memory-smoke] 态6 D5 FTS/驳回列 OK: 虚拟表 + 3 触发器 + 存量回填 + user_id 隔离 + ai/au/ad 同步 + merge_skip 幂等'
    );
  }

  // --- 态7（D6 新增）：agent_memory 向量列补列 + 真库混合检索 SQL ---
  {
    const vecFn = /export function addAgentMemoryVectorColumns[\s\S]*?\n}/.exec(src);
    if (!vecFn) throw new Error('[态7] addAgentMemoryVectorColumns 未在 src/main/db/index.ts 中找到');
    if (/DROP|DELETE|UPDATE/i.test(vecFn[0])) {
      throw new Error('[态7] addAgentMemoryVectorColumns 含 DROP/DELETE/UPDATE（迁移红线违规）');
    }
    const colRe =
      /addColumnIfMissing\(\s*database,\s*'agent_memory',\s*'([^']+)',\s*(?:"([^"]*)"|'([^']*)')\s*\);/g;
    const vecCols = [];
    let cm;
    while ((cm = colRe.exec(vecFn[0])) !== null) {
      vecCols.push({ column: cm[1], ddl: cm[2] !== undefined ? cm[2] : cm[3] });
    }
    if (vecCols.length !== 2) {
      throw new Error(`[态7] addAgentMemoryVectorColumns 应含 2 条补列，实际 ${vecCols.length} 条`);
    }
    if (vecCols[0].column !== 'vector' || vecCols[1].column !== 'embedding_model') {
      throw new Error('[态7] 补列顺序应为 vector, embedding_model，实际 ' + vecCols.map((c) => c.column).join(','));
    }
    if (vecCols[0].ddl !== 'vector BLOB DEFAULT NULL') {
      throw new Error('[态7] vector 列定义应为 "vector BLOB DEFAULT NULL"，实际 ' + vecCols[0].ddl);
    }
    if (vecCols[1].ddl !== 'embedding_model TEXT') {
      throw new Error('[态7] embedding_model 列定义应为 "embedding_model TEXT"，实际 ' + vecCols[1].ddl);
    }

    const rm = /function runMigrations\([\s\S]*?\n}/.exec(src);
    if (!rm || !/addAgentMemoryVectorColumns\(database\);/.test(rm[0])) {
      throw new Error('[态7] runMigrations 未接线 addAgentMemoryVectorColumns');
    }
    if (rm[0].indexOf('addAgentMemoryVectorColumns(database);') < rm[0].indexOf('addAgentMemoryFts(database);')) {
      throw new Error('[态7] addAgentMemoryVectorColumns 必须排在 addAgentMemoryFts 之后');
    }

    // 红线：D6 不塞进既有迁移（4 个本体均不得出现向量列定义）
    for (const name of [
      'addAgentMemoryTables',
      'addAgentMemoryAccessColumns',
      'addAgentMemoryFts',
      'addAgentMemoryMergeSkipColumn',
    ]) {
      const body = new RegExp(`export function ${name}[\\s\\S]*?\\n}`).exec(src);
      if (!body) throw new Error(`[态7] ${name} 未在 src/main/db/index.ts 中找到`);
      if (/\bvector\b|\bembedding_model\b/.test(body[0])) {
        throw new Error(`[态7] ${name} 本体含向量列定义（红线违规：历史迁移不得擅改）`);
      }
    }

    const skipFn = /export function addAgentMemoryMergeSkipColumn[\s\S]*?\n}/.exec(src);
    const skipCol = skipFn
      ? /addColumnIfMissing\(\s*database,\s*'agent_memory',\s*'merge_skip',\s*(?:"([^"]*)"|'([^']*)')\s*\);/.exec(skipFn[0])
      : null;
    if (!skipCol) throw new Error('[态7] 未抽到 merge_skip 补列定义');
    const skipDdl = skipCol[1] !== undefined ? skipCol[1] : skipCol[2];
    const ftsFn = /export function addAgentMemoryFts[\s\S]*?\n}/.exec(src);
    const ftsDdl = ftsFn ? /database\.exec\(`([\s\S]*?)`\)/.exec(ftsFn[0]) : null;
    if (!ftsDdl) throw new Error('[态7] 未抽到 addAgentMemoryFts 的 DDL');

    // 真库：11（B3）→ 13（D2）→ 14（D5 merge_skip）→ 16（D6 向量两列）
    const db = newPreB3Db();
    addAgentMemoryTables(db);
    addColumnIfMissing(db, 'agent_memory', 'access_count', 'access_count INTEGER DEFAULT 0');
    addColumnIfMissing(db, 'agent_memory', 'last_read_at', 'last_read_at TEXT');
    addColumnIfMissing(db, 'agent_memory', 'merge_skip', skipDdl);
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_memory_user_written ON agent_memory(user_id, written_at)');

    // 存量旧行（向量列尚不存在时写入）
    const insert = db.prepare(
      'INSERT INTO agent_memory (id, user_id, kind, subject, content, fingerprint) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insert.run(1, 'u1', 'profile', '外观偏好', '用户偏好深色的界面主题', 'fp1');
    insert.run(2, 'u1', 'profile', '项目进度', '深色界面主题的配色', 'fp2');
    insert.run(3, 'u2', 'profile', '外观偏好', '用户偏好深色的界面主题', 'fp3');

    const beforeCols = columnNames(db, 'agent_memory');
    if (beforeCols.length !== 14) {
      throw new Error(`[态7] 补列前应为 14 列（B3 11 + D2 2 + D5 1），实际 ${beforeCols.length}`);
    }
    if (beforeCols.includes('vector') || beforeCols.includes('embedding_model')) {
      throw new Error('[态7] pre-D6 形态不应已含向量列');
    }

    for (const { column, ddl } of vecCols) addColumnIfMissing(db, 'agent_memory', column, ddl);

    const afterCols = columnNames(db, 'agent_memory');
    if (afterCols.length !== 16) {
      throw new Error(`[态7] 补列后应为 16 列，实际 ${afterCols.length} → ${afterCols.join(',')}`);
    }
    if (afterCols.slice(14).join(',') !== 'vector,embedding_model') {
      throw new Error('[态7] 向量两列应追加在末尾，实际 ' + afterCols.slice(14).join(','));
    }

    const oldRow = db
      .prepare('SELECT vector, embedding_model, content, valid_to FROM agent_memory WHERE id = ?')
      .get(1);
    if (oldRow.vector !== null) throw new Error('[态7] 旧行 vector 应为 NULL，实际 ' + String(oldRow.vector));
    if (oldRow.embedding_model !== null) {
      throw new Error('[态7] 旧行 embedding_model 应为 NULL，实际 ' + String(oldRow.embedding_model));
    }
    if (oldRow.content !== '用户偏好深色的界面主题' || oldRow.valid_to !== null) {
      throw new Error('[态7] 补列改写了既有字段: ' + JSON.stringify(oldRow));
    }

    // 重复执行幂等
    for (const { column, ddl } of vecCols) addColumnIfMissing(db, 'agent_memory', column, ddl);
    if (columnNames(db, 'agent_memory').length !== 16) throw new Error('[态7] 重复执行产生了重复列');
    if (db.prepare('SELECT count(*) AS c FROM agent_memory').get().c !== 3) {
      throw new Error('[态7] 重复执行改变了数据');
    }

    // --- 真库混合检索 SQL（与 DAO searchMemories 的两条通道同文） ---
    db.exec(ftsDdl[1]); // FTS 虚拟表 + 3 触发器 + 存量回填

    /** 与 db/agentMemory.buildMemoryMatchQuery 同口径：原文 trigram 加引号 OR 连接。 */
    const matchQuery = (text) => {
      const grams = [];
      for (let i = 0; i + 3 <= text.length; i += 1) grams.push(text.slice(i, i + 3));
      return grams.map((g) => `"${g.replace(/"/g, '""')}"`).join(' OR ');
    };

    // --- 探针：用「全量命中 vs 单 trigram 命中 + 10 条无关文档」判 BM25 排序方向 ---
    {
      const probe = newPreB3Db();
      addAgentMemoryTables(probe);
      probe.exec(ftsDdl[1]);
      const pin = probe.prepare('INSERT INTO agent_memory (id, user_id, kind, subject, content, fingerprint) VALUES (?, ?, ?, ?, ?, ?)');
      for (let i = 0; i < 10; i += 1) {
        pin.run(100 + i, 'u1', 'fact', 'filler' + i, '甲乙丙丁戊己庚辛壬癸子丑寅卯', 'fpf' + i);
      }
      pin.run(1, 'u1', 'fact', '全量', '用户偏好深色界面主题', 'fpa');
      pin.run(2, 'u1', 'fact', '单点', '用户偏香蕉橙子葡萄', 'fpb');
      const order = (ord) =>
        probe
          .prepare(
            'SELECT m.id FROM agent_memory_fts JOIN agent_memory m ON m.rowid = agent_memory_fts.rowid ' +
              'WHERE agent_memory_fts MATCH ? AND m.user_id = ? AND m.valid_to IS NULL ORDER BY ' +
              ord +
              ' LIMIT ?'
          )
          .all(matchQuery('用户偏好深色界面主题'), 'u1', 10)
          .map((r) => r.id);
      const asc = order('rank');
      const desc = order('rank DESC');
      // eslint-disable-next-line no-console
      console.log('[probe] rank ASC = ' + JSON.stringify(asc) + '  rank DESC = ' + JSON.stringify(desc));
      if (!asc.includes(1) || !asc.includes(2)) {
        throw new Error('[态7] 探针未同时召回全量/单点两行: ' + JSON.stringify(asc));
      }
      // 结论：`ORDER BY rank` 升序 = 相关度从高到低（全量命中行 1 排前），
      // 这正是 DAO queryMemoryFtsChannel 用的形态；DESC 必然反向。
      if (asc.indexOf(1) > asc.indexOf(2)) {
        throw new Error('[态7] ORDER BY rank 升序未把全量命中行排前: ' + JSON.stringify(asc));
      }
      if (desc.indexOf(1) < desc.indexOf(2)) {
        throw new Error('[态7] ORDER BY rank DESC 未反向: ' + JSON.stringify(desc));
      }
      probe.close();
    }
    const ftsSql =
      'SELECT m.id FROM agent_memory_fts ' +
      'JOIN agent_memory m ON m.rowid = agent_memory_fts.rowid ' +
      'WHERE agent_memory_fts MATCH ? AND m.user_id = ? AND m.valid_to IS NULL ' +
      'ORDER BY rank LIMIT ?';
    const ftsHits = db
      .prepare(ftsSql)
      .all(matchQuery('用户偏好深色界面主题'), 'u1', 10)
      .map((r) => r.id);
    // 召回口径（本库仅 3 行，bm25 的 IDF 为负 → 相关度方向不在本段断言，见上方独立探针）：
    // 两行都被召回 + user_id 隔离（u2 同文行 3 不出现）
    if (!ftsHits.includes(1) || !ftsHits.includes(2)) {
      throw new Error('[态7] FTS 未召回两行，实际 ' + JSON.stringify(ftsHits));
    }
    if (ftsHits.includes(3)) throw new Error('[态7] FTS user_id 隔离失效');

    // 回填缺口条件（与 backfillMemoryVectors 同文）
    const gapSql =
      'SELECT id FROM agent_memory WHERE user_id = ? AND valid_to IS NULL ' +
      'AND (vector IS NULL OR embedding_model IS NOT ?) ORDER BY id ASC LIMIT ?';
    const gaps = db.prepare(gapSql).all('u1', 'm1', 10).map((r) => r.id);
    if (JSON.stringify(gaps) !== JSON.stringify([1, 2])) {
      throw new Error('[态7] 回填缺口扫描不符，实际 ' + JSON.stringify(gaps));
    }

    // 关闭一行 → 两通道都不再返回
    db.prepare('UPDATE agent_memory SET valid_to = datetime(\'now\') WHERE id = ?').run(2);
    const ftsAfterClose = db
      .prepare(ftsSql)
      .all(matchQuery('用户偏好深色界面主题'), 'u1', 10)
      .map((r) => r.id);
    if (JSON.stringify(ftsAfterClose) !== JSON.stringify([1])) {
      throw new Error('[态7] 关闭行仍被 FTS 召回，实际 ' + JSON.stringify(ftsAfterClose));
    }
    const gapsAfterClose = db.prepare(gapSql).all('u1', 'm1', 10).map((r) => r.id);
    if (JSON.stringify(gapsAfterClose) !== JSON.stringify([1])) {
      throw new Error('[态7] 关闭行仍被回填扫描，实际 ' + JSON.stringify(gapsAfterClose));
    }
    db.prepare('UPDATE agent_memory SET valid_to = NULL WHERE id = ?').run(2);

    // --- sqlite-vec（可选原生扩展，缺失即降级 FTS-only，与生产一致） ---
    let vecLoaded = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vec = require('sqlite-vec');
      vec.load(db);
      vecLoaded = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[agent-memory-smoke] 态7 sqlite-vec 加载失败 → 向量通道降级（生产同样降级）: ' +
          (err instanceof Error ? err.message : String(err))
      );
    }

    const vecSql =
      'SELECT m.id, vec_distance_cosine(m.vector, ?) AS distance FROM agent_memory m ' +
      'WHERE m.user_id = ? AND m.valid_to IS NULL AND m.vector IS NOT NULL ' +
      'ORDER BY distance ASC LIMIT ?';
    const f32 = (values) => Buffer.from(new Float32Array(values).buffer);

    if (vecLoaded) {
      // vec_distance_cosine = 1 - cos：同向 0、正交 1（记忆侧 similarity = 1 - distance）
      const same = db.prepare('SELECT vec_distance_cosine(?, ?) AS d').get(f32([1, 0]), f32([1, 0]));
      const orth = db.prepare('SELECT vec_distance_cosine(?, ?) AS d').get(f32([1, 0]), f32([0, 1]));
      if (Math.abs(same.d) > 1e-6) throw new Error('[态7] 同向 vec_distance_cosine 应为 0，实际 ' + same.d);
      if (Math.abs(orth.d - 1) > 1e-6) throw new Error('[态7] 正交 vec_distance_cosine 应为 1，实际 ' + orth.d);

      db.prepare('UPDATE agent_memory SET vector = ?, embedding_model = ? WHERE id = ? AND user_id = ?').run(
        f32([1, 0]),
        'm1',
        1,
        'u1'
      );
      db.prepare('UPDATE agent_memory SET vector = ?, embedding_model = ? WHERE id = ? AND user_id = ?').run(
        f32([0, 1]),
        'm1',
        2,
        'u1'
      );
      db.prepare('UPDATE agent_memory SET vector = ?, embedding_model = ? WHERE id = ? AND user_id = ?').run(
        f32([1, 0]),
        'm1',
        3,
        'u2'
      );
      // id2（[0,1]）与查询 [1,0] 正交 → 不该被召回；id1 同向距离 0；u2 的同向行被 user_id 挡住
      const vecHits = db.prepare(vecSql).all(f32([1, 0]), 'u1', 10);
      // SQL 层只按距离排序与 user_id 隔离；相似度阈值在 DAO 侧（MEMORY_SEARCH_VEC_SCORE_THRESHOLD）套
      if (vecHits.length !== 2 || vecHits[0].id !== 1 || vecHits[1].id !== 2) {
        throw new Error('[态7] 向量通道距离序不符，实际 ' + JSON.stringify(vecHits));
      }
      if (Math.abs(vecHits[0].distance) > 1e-6) {
        throw new Error('[态7] 同向行 distance 应为 0，实际 ' + vecHits[0].distance);
      }
      if (Math.abs(vecHits[1].distance - 1) > 1e-6) {
        throw new Error('[态7] 正交行 distance 应为 1，实际 ' + vecHits[1].distance);
      }
      if (1 - vecHits[1].distance >= 0.2) {
        throw new Error('[态7] 正交行相似度应被 0.2 阈值挡在向量通道外');
      }
      // u2 的同向行（id=3）不得出现
      if (vecHits.some((h) => h.id === 3)) throw new Error('[态7] 向量通道 user_id 隔离失效');

      // 写回后缺口消失（模型一致）
      const gapsAfterVec = db.prepare(gapSql).all('u1', 'm1', 10).map((r) => r.id);
      if (JSON.stringify(gapsAfterVec) !== JSON.stringify([])) {
        throw new Error('[态7] 向量写回后仍有缺口，实际 ' + JSON.stringify(gapsAfterVec));
      }
      // 模型切换 → 旧模型向量重新计入缺口
      const gapsAfterModelChange = db.prepare(gapSql).all('u1', 'm2', 10).map((r) => r.id);
      if (JSON.stringify(gapsAfterModelChange) !== JSON.stringify([1, 2])) {
        throw new Error('[态7] 切换模型后应重新计入缺口，实际 ' + JSON.stringify(gapsAfterModelChange));
      }
      // eslint-disable-next-line no-console
      console.log('[agent-memory-smoke] 态7 sqlite-vec 向量通道 OK: 距离序 + user_id 隔离 + 缺口扫描 + 模型切换');
    } else {
      let threw = false;
      try {
        db.prepare(vecSql).all(f32([1, 0]), 'u1', 10);
      } catch {
        threw = true; // 扩展缺失 → prepare 抛错 → DAO 侧 try/catch 降级 FTS-only
      }
      if (!threw) throw new Error('[态7] sqlite-vec 缺失时向量 SQL 应抛错（供 DAO 降级捕获）');
      // eslint-disable-next-line no-console
      console.log('[agent-memory-smoke] 态7 向量通道降级路径 OK: 扩展缺失 → SQL 抛错 → FTS-only');
    }

    db.close();
    // eslint-disable-next-line no-console
    console.log(
      '[agent-memory-smoke] 态7 D6 向量列 OK: 14 → 16 列 + 旧行 vector/embedding_model NULL + 幂等 + 接线顺序 + 真库混合检索 SQL'
    );
  }
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log('[agent-memory-smoke] OK: B3/D2/D5/D6 迁移真库七态全部通过');
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[agent-memory-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
