// ============================================
// WeaveMD — Database Initialization
// ============================================

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { MAIL_CONFIG_SCHEMA } from './mail';
import { APP_META_SCHEMA } from './appMeta';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'weaveMD.db');
}

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 加载 sqlite-vec 向量搜索扩展
  try {
    const vec = require('sqlite-vec');
    vec.load(db);
  } catch {
    // sqlite-vec 加载失败时降级到纯 FTS5（非致命）
    console.warn('[db] sqlite-vec load failed, falling back to FTS5-only');
  }

  runMigrations(db);

  return db;
}

/**
 * FTS5 关键词索引迁移：表外虚拟表 + 触发器同步 kb_chunks → kb_chunks_fts。
 * - 不改 kb_chunks 既有列结构；触发器用 kb_chunks 内部整数 rowid（`new.rowid`/`old.rowid`）
 *   作 FTS5 rowid，`doc_id` 冗余存 TEXT uuid（new.id）供回查 join kb_chunks。
 * - 幂等：CREATE VIRTUAL TABLE IF NOT EXISTS + DROP TRIGGER IF EXISTS 前置。
 * - BM25 查询通过 `kb_chunks_fts JOIN kb_chunks ON kb_chunks.rowid = kb_chunks_fts.rowid` 回查。
 * 此常量亦被 scripts/fts5-smoke.cjs 引用（Electron 运行时真验），须保持一致。 */
export const FTS5_MIGRATION_SQL = `
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

/**
 * AI 知识库参数持久化列迁移（第 6 期批次 2）：给 ai_config 幂等补 6 个 KB 设置列。
 * SQLite `ALTER TABLE ... ADD COLUMN` 一次只加一列，故逐列一条。每条列定义带 DEFAULT，
 * 使既有 INSERT（col 列表不含 KB 列）不回写时旧行回读取到默认值；mapConfigRow 对 NULL 也做
 * 默认兜底（见 db/ai.ts）。
 *
 * 注意：项目锁定的 better-sqlite3 (11.x, 自带 sqlite 3.49.2) 对 `ADD COLUMN IF NOT EXISTS`
 * 报 `near "EXISTS": syntax error`（该子句未被其编译进 ALTER 语法）。因此幂等由运行期
 * `PRAGMA table_info` 前置探测 + 逐列 ADD 实现（见 runMigrations 的 addAiConfigKbColumns）：
 * 已含该列则跳过，缺失则 ADD。新库 / 既有库 / 重复执行三种语义均由该守卫保证。
 *
 * 此常量仅声明每列定义（不含 IF NOT EXISTS），两条消费路径保持一致：
 *   - runMigrations 对每一列做存在性探测后执行对应 ADD；
 *   - tests/main/db/migrations.test.ts 与 scripts/kb-migration-smoke.cjs 做结构/真库断言。 */
export const KB_CONFIG_ALTER_SQL = [
  { name: 'kb_top_k', ddl: 'kb_top_k INTEGER DEFAULT 5' },
  { name: 'kb_fuse', ddl: 'kb_fuse REAL DEFAULT 0.5' },
  { name: 'kb_threshold', ddl: 'kb_threshold REAL DEFAULT 0.6' },
  { name: 'kb_pinned_weight', ddl: 'kb_pinned_weight REAL DEFAULT 1.5' },
  { name: 'kb_embedding_host', ddl: "kb_embedding_host TEXT DEFAULT 'http://localhost:11434'" },
  { name: 'kb_embedding_model', ddl: "kb_embedding_model TEXT DEFAULT 'nomic-embed-text'" },
];

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      modified_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      diff TEXT,
      saved_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      theme TEXT DEFAULT 'dark',
      language TEXT DEFAULT 'zh-CN',
      custom_colors TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_files_user_modified ON files(user_id, modified_at);
    CREATE INDEX IF NOT EXISTS idx_history_file_saved ON history(file_id, saved_at);
    CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);

    CREATE TABLE IF NOT EXISTS ai_config (
      id                TEXT PRIMARY KEY,
      user_id           TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      backend           TEXT NOT NULL DEFAULT 'remote',   -- 恒 remote（遗留 ollama 值读时收敛 remote，不再写）
      ollama_base_url   TEXT DEFAULT 'http://localhost:11434',
      remote_base_url   TEXT DEFAULT 'https://api.deepseek.com',
      model             TEXT DEFAULT '',
      api_key_enc       TEXT DEFAULT NULL,                -- safeStorage 加密密文(base64)
      allow_network     INTEGER DEFAULT 0,                -- 允许联网（远程后端/工具/MCP）
      allow_send        INTEGER DEFAULT 0,                -- 允许笔记外发（知识库检索，第3期启用）
      consent_updated_at TEXT DEFAULT NULL,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_config_user ON ai_config(user_id);

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode        TEXT NOT NULL DEFAULT 'chat',      -- chat | agent
      summary     TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conv_user_updated ON ai_conversations(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS ai_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,                  -- user|assistant|tool
      content         TEXT DEFAULT '',
      refs_json       TEXT DEFAULT NULL,
      tool_call_id    TEXT DEFAULT NULL,              -- tool 消息关联的 tool_call_id
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv_created ON ai_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_user ON ai_messages(user_id);

    CREATE TABLE IF NOT EXISTS kb_documents (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_id     TEXT,
      source_type TEXT NOT NULL,
      title       TEXT NOT NULL,
      pinned      INTEGER DEFAULT 0,
      status      TEXT DEFAULT 'pending',
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_doc_user ON kb_documents(user_id);

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id           TEXT PRIMARY KEY,
      document_id  TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
      seq          INTEGER NOT NULL,
      content      TEXT NOT NULL,
      vector       BLOB DEFAULT NULL,
      source_ref   TEXT DEFAULT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunk_doc ON kb_chunks(document_id, seq);
  `);

  // 第 6 期批次 2：ai_config 幂等补 KB 参数列（新库建表已含旧列，对新增列按需 ADD）
  addAiConfigKbColumns(database);

  // 第 3 期：FTS5 关键词索引（表外虚拟表 + 触发器同步），幂等
  database.exec(FTS5_MIGRATION_SQL);

  // 问题反馈邮件授权码表（user_id 唯一，每用户一条密文），幂等
  database.exec(MAIL_CONFIG_SCHEMA);

  // app_meta 表（激活状态 / 跳过版本等 app 级元数据），幂等
  database.exec(APP_META_SCHEMA);

  // ai-settings-redesign：多模型配置表 + Embedding 配置表 + 搜索配置表
  addModelConfigsTable(database);
  addEmbeddingConfigTable(database);
  addSearchConfigTable(database);
  addActiveModelConfigId(database);

  // ai_messages 表幂等补 tool_call_id 列（修复 Agent 工具调用后第二条消息 400 错误）
  addColumnIfMissing(database, 'ai_messages', 'tool_call_id', 'tool_call_id TEXT DEFAULT NULL');

  // ai_messages 表幂等补 tool_calls 列（JSON 快照，重启后恢复工具调用轨迹）
  addColumnIfMissing(database, 'ai_messages', 'tool_calls', 'tool_calls TEXT DEFAULT NULL');

  // 写模式（auto/manual）：ai_config 幂等补 write_mode 列，默认 'manual'
  addColumnIfMissing(database, 'ai_config', 'write_mode', "write_mode TEXT NOT NULL DEFAULT 'manual'");

  // Agent 任务队列 / 会话 / 运行事件 / 文件快照
  addAgentTables(database);

  // 阶段 1：向量搜索 + 文档解析基建
  addKbVectorColumns(database);
  addFileRevisionsTable(database);
  addKnowledgeCacheTable(database);
  addParsedAttachmentsTable(database);
}

/**
 * 给 ai_config 幂等补 6 个 KB 设置列。运行期用 PRAGMA table_info 前置探测缺失列，
 * 缺失才执行 `ALTER TABLE ai_config ADD COLUMN <ddl>`。逐列 ADD，重复执行 no-op。
 * 兼容项目锁定的 better-sqlite3（其 `ADD COLUMN IF NOT EXISTS` 语法报错）。 */
function addAiConfigKbColumns(database: Database.Database): void {
  for (const { name, ddl } of KB_CONFIG_ALTER_SQL) {
    const existing = database
      .prepare("SELECT 1 AS c FROM pragma_table_info('ai_config') WHERE name = ?")
      .get(name);
    if (existing) continue;
    database.exec(`ALTER TABLE ai_config ADD COLUMN ${ddl}`);
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** 检查表是否有某列（PRAGMA table_info 幂等探测）。 */
function hasColumn(database: Database.Database, table: string, column: string): boolean {
  const row = database
    .prepare(`SELECT 1 AS c FROM pragma_table_info('${table}') WHERE name = ?`)
    .get(column);
  return !!row;
}

/** 给表幂等补一列（ALTER TABLE ADD COLUMN）。 */
function addColumnIfMissing(database: Database.Database, table: string, column: string, ddl: string): void {
  if (!hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/** ai_model_configs 表：用户可创建多个模型配置，一个激活。 */
function addModelConfigsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_model_configs (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL DEFAULT '',
      protocol        TEXT NOT NULL DEFAULT 'openai',
      provider        TEXT NOT NULL DEFAULT '',
      base_url        TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
      model           TEXT NOT NULL DEFAULT '',
      api_key_enc     TEXT DEFAULT NULL,
      hint            TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_model_configs_user ON ai_model_configs(user_id);
  `);
  // 幂等补列（旧表可能缺少新增列）
  addColumnIfMissing(database, 'ai_model_configs', 'name', "name TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'ai_model_configs', 'protocol', "protocol TEXT NOT NULL DEFAULT 'openai'");
  addColumnIfMissing(database, 'ai_model_configs', 'provider', "provider TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'ai_model_configs', 'base_url', "base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1'");
  addColumnIfMissing(database, 'ai_model_configs', 'model', "model TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'ai_model_configs', 'api_key_enc', 'api_key_enc TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'ai_model_configs', 'hint', "hint TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_model_configs', 'created_at', "created_at TEXT DEFAULT (datetime('now'))");
  addColumnIfMissing(database, 'ai_model_configs', 'updated_at', "updated_at TEXT DEFAULT (datetime('now'))");
}

/** ai_embedding_config 表：每用户一条独立 Embedding 配置。 */
function addEmbeddingConfigTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_embedding_config (
      id              TEXT PRIMARY KEY,
      user_id         TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      base_url        TEXT NOT NULL DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model           TEXT NOT NULL DEFAULT 'text-embedding-v3',
      api_key_enc     TEXT DEFAULT NULL,
      multimodal      INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
  `);
  addColumnIfMissing(database, 'ai_embedding_config', 'base_url', "base_url TEXT NOT NULL DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1'");
  addColumnIfMissing(database, 'ai_embedding_config', 'model', "model TEXT NOT NULL DEFAULT 'text-embedding-v3'");
  addColumnIfMissing(database, 'ai_embedding_config', 'api_key_enc', 'api_key_enc TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'ai_embedding_config', 'multimodal', 'multimodal INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'ai_embedding_config', 'created_at', "created_at TEXT DEFAULT (datetime('now'))");
  addColumnIfMissing(database, 'ai_embedding_config', 'updated_at', "updated_at TEXT DEFAULT (datetime('now'))");
}

/** ai_search_config 表：每用户一条搜索配置。 */
function addSearchConfigTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_search_config (
      id              TEXT PRIMARY KEY,
      user_id         TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enabled         INTEGER DEFAULT 0,
      provider        TEXT NOT NULL DEFAULT 'firecrawl',
      call_mode       TEXT NOT NULL DEFAULT 'scrape_and_search',
      max_results     INTEGER DEFAULT 10,
      firecrawl_key_enc  TEXT DEFAULT NULL,
      zhipu_key_enc      TEXT DEFAULT NULL,
      tavily_key_enc     TEXT DEFAULT NULL,
      exa_key_enc        TEXT DEFAULT NULL,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
  `);
  addColumnIfMissing(database, 'ai_search_config', 'enabled', 'enabled INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'ai_search_config', 'provider', "provider TEXT NOT NULL DEFAULT 'firecrawl'");
  addColumnIfMissing(database, 'ai_search_config', 'call_mode', "call_mode TEXT NOT NULL DEFAULT 'scrape_and_search'");
  addColumnIfMissing(database, 'ai_search_config', 'max_results', 'max_results INTEGER DEFAULT 10');
  addColumnIfMissing(database, 'ai_search_config', 'firecrawl_key_enc', 'firecrawl_key_enc TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'ai_search_config', 'zhipu_key_enc', 'zhipu_key_enc TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'ai_search_config', 'tavily_key_enc', 'tavily_key_enc TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'ai_search_config', 'exa_key_enc', 'exa_key_enc TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'ai_search_config', 'created_at', "created_at TEXT DEFAULT (datetime('now'))");
  addColumnIfMissing(database, 'ai_search_config', 'updated_at', "updated_at TEXT DEFAULT (datetime('now'))");
}

/** ai_config 新增 active_model_config_id 列（指向当前激活的模型配置）。 */
function addActiveModelConfigId(database: Database.Database): void {
  const existing = database
    .prepare("SELECT 1 AS c FROM pragma_table_info('ai_config') WHERE name = 'active_model_config_id'")
    .get();
  if (existing) return;
  database.exec("ALTER TABLE ai_config ADD COLUMN active_model_config_id TEXT DEFAULT NULL");
}

/** Agent 任务队列 / 会话 / 运行事件 / 文件快照四张表，幂等。 */
function addAgentTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_task_queue (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      priority        INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      started_at      TEXT,
      completed_at    TEXT,
      error_code      TEXT,
      error_message   TEXT,
      payload_json    TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_agent_task_queue_status ON agent_task_queue(status);
    CREATE INDEX IF NOT EXISTS idx_agent_task_queue_conv ON agent_task_queue(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_task_queue_user ON agent_task_queue(user_id);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      task_id         TEXT REFERENCES agent_task_queue(id) ON DELETE SET NULL,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'created',
      rounds_used     INTEGER DEFAULT 0,
      max_rounds      INTEGER DEFAULT 20,
      intent_json     TEXT,
      checkpoint_json TEXT,
      snapshot_json   TEXT,
      lease_owner     TEXT,
      lease_expires_at TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_conv ON agent_sessions(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL,
      seq             INTEGER NOT NULL,
      event_type      TEXT NOT NULL,
      payload_json    TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_events_session ON agent_run_events(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_agent_run_events_conv ON agent_run_events(conversation_id, seq);

    CREATE TABLE IF NOT EXISTS agent_file_snapshots (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL,
      file_id         TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_file_snapshots_session ON agent_file_snapshots(session_id);
  `);
}

/** kb_documents 幂等补 file_path 列（供标题/路径匹配检索）。 */
function addKbVectorColumns(database: Database.Database): void {
  addColumnIfMissing(database, 'kb_documents', 'file_path', 'file_path TEXT DEFAULT NULL');
  addColumnIfMissing(database, 'kb_chunks', 'embedding_model', 'embedding_model TEXT DEFAULT NULL');
}

/** file_revisions 表：Agent 文件操作修订历史。 */
function addFileRevisionsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS file_revisions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_file_revisions_user_file ON file_revisions(user_id, file_id);
  `);
}

/** knowledge_cache 表：研究结果缓存。 */
function addKnowledgeCacheTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_cache (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      query_hash TEXT NOT NULL,
      results_json TEXT NOT NULL,
      hit_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_cache_user_hash ON knowledge_cache(user_id, query_hash);
  `);
}

/** parsed_attachments 表：对话附件解析缓存。 */
function addParsedAttachmentsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS parsed_attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_parsed_attachments_user ON parsed_attachments(user_id);
  `);
}
