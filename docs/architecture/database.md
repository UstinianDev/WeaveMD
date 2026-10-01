# 数据库架构

> 最后更新：2026-10-01
> 表清单以 `src/main/db/index.ts` 建表语句为准（**23 实表 + 4 虚拟表 = 27**）；本页只展开常用表的字段，其余见 §「其他表索引」。

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 引擎 | SQLite | better-sqlite3 ^11 |
| 全文检索 | FTS5 | 知识库 `kb_chunks_fts` / `kb_documents_fts` 用 jieba-wasm 分词；记忆 `agent_memory_fts` 用 **`tokenize='trigram'`**（unicode61 对中文整段并成 1 词，不可用；trigram 大小写敏感，查询侧同时提交原文与小写） |
| 向量存储 | sqlite-vec（可选扩展） | `images_vec` 虚拟表（仅图片 embedding；扩展缺失时静默跳过） |

## 数据库文件

数据库文件位于用户数据目录：`{userData}/weavemd.db`

## 表结构

### 用户与认证

#### users

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 用户 UUID |
| username | TEXT UNIQUE | 用户名（`^[a-zA-Z][a-zA-Z0-9_]{4,14}$`） |
| password_hash | TEXT | bcryptjs 哈希 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 文件管理

#### files

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 文件 UUID 或磁盘路径 |
| user_id | TEXT FK | 所属用户 |
| name | TEXT | 文件名 |
| content | TEXT | 文件内容 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### AI 会话

#### ai_conversations

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 会话 UUID |
| user_id | TEXT FK | 所属用户 |
| title | TEXT | 会话标题（首条消息） |
| mode | TEXT | 模式（agent） |
| summary | TEXT | 上下文压缩摘要 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### ai_messages

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 消息 UUID |
| conversation_id | TEXT FK | 所属会话 |
| user_id | TEXT FK | 所属用户 |
| role | TEXT | 角色（user/assistant/tool） |
| content | TEXT | 消息内容 |
| tool_call_id | TEXT | 工具调用 ID（tool 角色） |
| attachments_json | TEXT | 附件轻量元数据 JSON `[{id,type,name,path,size,parseStatus,error}]`（可空；B3 D1 迁移，解析正文存 `parsed_attachments.content`，一物两表。**B6：图片 `path` 存相对路径 `attachments/{userId}/{convId}/{id}.{ext}`，读取时重建绝对路径；`error` 为失败可读原因**） |
| created_at | TEXT | 创建时间 |

#### agent_run_events

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 事件 UUID |
| session_id | TEXT FK | Agent 会话 ID（`agent_sessions.id`，级联删除） |
| conversation_id | TEXT | 所属会话 |
| seq | INTEGER | 序列号（同会话递增，回放用） |
| event_type | TEXT | 事件类型（chunk/tool/done/error/interaction） |
| payload_json | TEXT | JSON 载荷 |
| created_at | TEXT | 创建时间（`datetime('now')`） |

### AI 配置

#### ai_config

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 配置 UUID |
| user_id | TEXT FK UNIQUE | 所属用户 |
| protocol | TEXT | 协议分流：`openai` / `anthropic`，默认 `openai`（幂等补列，`addColumnIfMissing`） |
| remote_base_url | TEXT | API 基础 URL |
| ollama_base_url | TEXT | 保留列（Ollama 已移除，仅存历史值） |
| model | TEXT | 模型名称 |
| api_key_enc | TEXT | 加密的 API key |
| write_mode | TEXT | 写模式（auto/manual） |
| max_rounds | INTEGER | 最大轮次 |
| active_model_config_id | TEXT | 当前激活的模型配置 ID |
| allow_network | INTEGER | 联网同意（**判定已停用**，`needsConsent` 恒 false，列保留作历史兼容） |
| allow_send | INTEGER | 笔记外发同意（KB 外发闸 `needsKbSendConsent` 仍生效） |
| consent_updated_at | TEXT | 同意时间戳 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### ai_search_config

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 配置 UUID |
| user_id | TEXT FK UNIQUE | 所属用户 |
| enabled | INTEGER | 是否启用 |
| provider | TEXT | 搜索引擎（firecrawl/zhipu/tavily/exa） |
| call_mode | TEXT | 调用模式 |
| max_results | INTEGER | 最大结果数 |
| firecrawl_key_enc | TEXT | Firecrawl API key（加密） |
| zhipu_key_enc | TEXT | 智谱 API key（加密） |
| tavily_key_enc | TEXT | Tavily API key（加密） |
| exa_key_enc | TEXT | Exa API key（加密） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### ai_embedding_config

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 配置 UUID |
| user_id | TEXT FK UNIQUE | 所属用户 |
| base_url | TEXT | Embedding API URL |
| model | TEXT | Embedding 模型 |
| api_key_enc | TEXT | API key（加密） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 知识库

#### kb_documents（与 `src/main/db/index.ts` 实际 DDL 对齐，B11 八-3② 同步）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 文档 UUID |
| user_id | TEXT FK | 所属用户 |
| file_id | TEXT | 关联 `files.id`（索引笔记时写入，导入/附件为 NULL） |
| source_type | TEXT | 来源：`db` / `import` / `attachment`（B4 TEXT 取值扩展） |
| title | TEXT | 文档标题 |
| pinned | INTEGER | 置顶（检索加权 ×1.5） |
| status | TEXT | 状态（pending/importing/done/error） |
| attachment_id | TEXT | 关联 `parsed_attachments.id`（B4 D3；附件删除→清理 KB） |
| consent_granted | INTEGER | B11 D5b：勾选授权标记（1=该文档显式外发授权，外发过滤键；默认 0） |
| file_path | TEXT | 文件路径（可空） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间（R3 时效加权） |

#### kb_chunks（与实际 DDL 对齐，B11 八-3② 同步）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 分块 UUID |
| document_id | TEXT FK | 所属文档（ON DELETE CASCADE） |
| seq | INTEGER | 分块序号 |
| content | TEXT | 分块内容（FTS5 原文） |
| vector | BLOB | 向量（Float32 BLOB，配置 embedding 时写入） |
| source_ref | TEXT | 出处（fileId / 真实页码 / attachmentId，citation 回链） |
| heading_path | TEXT | 标题路径（R5/B5 写入，段聚合；NULL 降级） |
| embedding_model | TEXT | 向量模型（切换模型按此过滤旧向量） |
| created_at | TEXT | 创建时间 |

#### kb_chunks_fts（FTS5 虚拟表）

| 字段 | 说明 |
|------|------|
| content | 分块内容（jieba 分词） |

### AI 记忆

#### agent_memory（agent-memory-optimize 三批，2026-09-28 ~ 10-01）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTOINCREMENT | 记忆 ID（同时作 `agent_memory_fts` 的 rowid） |
| user_id | TEXT NOT NULL | 所属用户（读写隔离） |
| kind | TEXT NOT NULL | `profile` / `fact` / `entity` |
| subject | TEXT NOT NULL | 主题（与 `kind` 共同构成分组键，合并去重的键） |
| content | TEXT NOT NULL | 记忆内容 |
| source | TEXT | `auto`（Agent 写）/ `manual`（用户手写）；**C1 `memory_write` 恒写 `auto`** |
| conversation_id | TEXT | 写入来源会话 |
| fingerprint | TEXT NOT NULL | 归一化 content 的 sha256（精确相等去重） |
| valid_from | TEXT | 生效时间（默认 `datetime('now')`） |
| valid_to | TEXT | NULL=当前有效；置值 = **Ledger 关闭**（不删行） |
| written_at | TEXT | 写入时间（`Y-m-d H:M:S` UTC，驱逐与容量排序键） |
| access_count | INTEGER DEFAULT 0 | 读取计数（D2 补列，容量淘汰按其升序） |
| last_read_at | TEXT | 最近被读时刻（D2 补列，当前只写不读） |
| vector | BLOB DEFAULT NULL | Float32 向量（D6 补列，配置 embedding 时异步回填） |
| embedding_model | TEXT | 生成该向量的模型（D6 补列，切模型按 `IS NOT ?` 重算） |
| merge_skip | TEXT | NULL=未驳回；非空=该行所在相似组已被用户驳回（D5 补列，只禁自动合并、不过滤召回） |

> **演进**：11 列（B3）→ 13（D2 补 `access_count`/`last_read_at`）→ 14（D5 补 `merge_skip`）→
> **16 列**（D6 补 `vector`/`embedding_model`）。全部经 `addColumnIfMissing` 追加式补列，旧行按常量默认值回填。
> **普通索引 4 个**：`(user_id, kind, valid_to)` / `(user_id, subject)` / `(user_id, fingerprint)` / `(user_id, written_at)`。
> **不建向量索引**：排序键是 `vec_distance_cosine` 标量结果，B-Tree 用不上，且 `user_id` 前缀已有 4 索引收敛。

#### agent_memory_fts（FTS5 虚拟表）

| 字段 | 说明 |
|------|------|
| subject / content | 只索引这两列（`tokenize='trigram'`）；`user_id`/`kind` 不进 FTS，靠普通条件过滤后取候选 |

- 触发器 `agent_memory_fts_ai` / `_ad` / `_au`：`ai` 标准 `INSERT VALUES(new.rowid,...)`；
  `_ad` 走 **`DELETE FROM agent_memory_fts WHERE rowid = old.rowid`**（不用 fts5 特殊 `'delete'` 命令）；
  `_au` 限定 `AFTER UPDATE OF subject, content`（`closeMemory`/`markAccessed`/`markMergeSkipped` 这类 UPDATE 不重建索引）。
- 存量回填带 `WHERE rowid NOT IN (SELECT rowid FROM agent_memory_fts)` 守卫。

#### images_vec（vec0 虚拟表）

> 本表只存**图片** embedding（`imageIndexer.ts` → `kb_images` + 本表），仅在 sqlite-vec 扩展可用时创建
> （`index.ts` try/catch 静默跳过）。文本向量自 B5 存 `kb_chunks.vector`（Float32 BLOB）；
> **打包形态 sqlite-vec 加载失败时**（B11 核查结论）：向量检索经 `kbSearchFts.vectorSearch` prepare 失败
> 静默降级空候选 → 检索走纯 FTS5+标题，回填仅写 BLOB 不依赖扩展，全链路不报错（旧包即存在的降级路径，非本批次引入）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 图片 UUID（关联 `kb_images.id`） |
| vector | FLOAT[1024] | 向量（1024 维） |

## 其他表索引

以下表已建但**字段从简记录**，需要时查 `src/main/db/index.ts` 建表语句（或对应 DAO）：

| 表 | 类型 | DAO | 用途 |
|----|------|-----|------|
| `agent_sessions` | 实表 | `agentSessionDao.ts` | Agent 任务会话（90s 租约 + 20s 续约窗口，乐观并发）。**`intent_json` 列**存子任务全链路追踪（agent-multi-intent 任务 6 起写入：`saveIntentJson` 每次全量覆盖一列 UPDATE / `getIntentJson` 容错读坏 JSON 降级 null）——形状 v1 = `{ v, runId, primaryIntent, plan{subtasks,omittedCount}, deps, subtasks[{id,status,startedAt,endedAt,rounds,summary,error}], outcome?, report? }`，类型与 `buildDepsMap` 见 `src/shared/ai/intentRecord.ts`（形状规范：`docs/plan/agent-multi-intent-p1.plan.md` §1.1；**零加列零迁移**，重试计数/文件快照不入此列，Q18） |
| `agent_task_queue` | 实表 | `agentTaskDao.ts` | 后台任务队列（`dequeueNext` 保证同 `conversation_id` 串行） |
| `agent_file_snapshots` | 实表 | `agentSnapshotDao.ts` | 写入前文件快照（回滚用） |
| `ai_model_configs` | 实表 | `modelConfigs.ts` | 多模型配置（`protocol` / `baseURL` / `apiKey`） |
| `history` | 实表 | `history.ts` | 文件历史版本 |
| `file_revisions` | 实表 | `files.ts` | 文件修订记录 |
| `settings` | 实表 | `settings.ts` | 用户设置 KV |
| `app_meta` | 实表 | `appMeta.ts` | 应用元数据（schema 版本等） |
| `mail_config` | 实表 | `mail.ts` | 反馈邮件配置（key 走 safeStorage） |
| `knowledge_cache` | 实表 | `index.ts` | 知识库查询/Embedding 缓存 |
| `parsed_attachments` | 实表 | `attachments.ts` | 附件解析产物（`content` 存正文；`parse_status` 三态 pending/processing/done/error、`parse_version` 回填重建依据 —— B3 D2 补列启用；**B7 D7 补列 `structure_json`**：解析结构 JSON（页码偏移/章节/表格序号/页眉页脚，`source_ref` 真实页码的落库前提）） |
| `kb_images` | 实表 | `kb.ts` | 知识库图片索引（`document_id` 级联删除） |
| `kb_documents_fts` | FTS5 虚拟表 | `index.ts` | 文档级全文索引 |
| `images_vec` | vec0 虚拟表 | `index.ts` | 图片向量（sqlite-vec 可用时） |

## 索引策略

- `files(user_id)` — 按用户查询
- `ai_messages(conversation_id, created_at)` — 会话消息时序
- `agent_run_events(session_id, seq)` / `(conversation_id, seq)` — 事件回放
- `kb_chunks(document_id, chunk_index)` — 文档分块
- `kb_images(document_id)` — 图片索引回查
- `kb_chunks_fts` / `kb_documents_fts` — FTS5 全文索引（jieba 分词，触发器同步；**插入用 `INSERT INTO ... VALUES(new.rowid,...)`，删除/更新走标准 `DELETE FROM <fts> WHERE rowid = old.rowid`** —— 普通（非 contentless）fts5 表不接受仅限 contentless 的 `'delete'` 特殊命令，2026-09-30 D7 修复，见 `agent-memory-optimize-3` req §二 D7）
- `agent_memory` — 4 个普通索引：`(user_id, kind, valid_to)` / `(user_id, subject)` / `(user_id, fingerprint)` / `(user_id, written_at)`
- `agent_memory_fts` — trigram FTS5，ai/ad/au 三触发器；`_ad` 与 `_au` 同样走标准 `DELETE ... WHERE rowid = old.rowid`，`_au` 限定 `AFTER UPDATE OF subject, content`

## 迁移清单（追加式）

本项目**无独立迁移目录**，全部内联在 `src/main/db/index.ts` 的 `runMigrations` 内，按序调用、
一律 `IF NOT EXISTS` / `addColumnIfMissing` 幂等，**禁止 DROP / DELETE / UPDATE 既有结构**；
断言由 `tests/main/db/migrations.test.ts`（三态）+ `scripts/agent-memory-migration-smoke.cjs`（真库七态）承担。

agent-memory 相关的追加式迁移函数（顺序即调用顺序）：

| 函数 | 批次 | 产物 |
|------|------|------|
| `addAgentMemoryTables` | 第二批 B3 | `agent_memory` 11 列 + 3 索引 |
| `addAgentMemoryAccessColumns` | 第三批 D2 | 补 `access_count` / `last_read_at` + `idx_agent_memory_user_written` |
| `addAgentMemoryFts` | 第三批 D5 | `agent_memory_fts` 虚拟表 + 3 触发器 + 存量回填 |
| `addAgentMemoryVectorColumns` | 第三批 D6 | 补 `vector` / `embedding_model`（**不建向量索引**） |
| `addAgentMemoryMergeSkipColumn` | 第三批 D5 | 补 `merge_skip` |

同一函数族另修 `kb_chunks_fts_ad` / `kb_documents_fts_ad` / `kb_documents_fts_au` 三处触发器正文
（改标准 DELETE，D7），`_ai` 未动；`addKbDocumentsFtsIndex` 随之 `export`（供 vitest 覆盖）。

## DAO 层

所有数据库操作通过 `src/main/db/` 下的 DAO 模块：

| 模块 | 职责 |
|------|------|
| `index.ts` | 建表/迁移/连接管理 + 全部虚拟表与缓存表 |
| `users.ts` | 用户 CRUD + 级联清理（files/history/settings） |
| `files.ts` | 文件 CRUD + `file_revisions` |
| `history.ts` | 文件历史版本 |
| `settings.ts` | 用户设置 KV |
| `appMeta.ts` | 应用元数据 |
| `ai.ts` | `ai_config` / `ai_conversations` / `ai_messages` CRUD（`appendMessage` 写 `attachments_json` 白名单元数据） |
| `attachments.ts` | `parsed_attachments` DAO（insert/get/updateStatus/updateContent/updateStructure/remove/listByConversation）+ 发送链路三态落库 + 结构（structure_json）读写与 IPC 白名单校验（`sanitizeStructure`） |
| `modelConfigs.ts` | `ai_model_configs` 多模型配置 |
| `searchConfig.ts` | `ai_search_config` 搜索配置 CRUD |
| `embeddingConfig.ts` | `ai_embedding_config` 配置 CRUD |
| `kb.ts` | **知识库统一 DAO**：`kb_documents` / `kb_chunks` / `kb_images` |
| `agentMemory.ts` | **记忆 DAO**：`agent_memory` 读写 / Ledger 关闭（`closeMemory`）/ Views 查询 / 相似候选（走 `agent_memory_fts`）/ 向量读写（`upsertMemoryVector` / `searchMemories`） |
| `agentSessionDao.ts` | `agent_sessions`（租约并发控制） |
| `agentTaskDao.ts` | `agent_task_queue`（同会话串行出队） |
| `agentEventDao.ts` | `agent_run_events`（事件回放） |
| `agentSnapshotDao.ts` | `agent_file_snapshots`（写入前快照） |
| `mail.ts` | `mail_config` 反馈邮件配置 |

## 安全规则

- 所有 SQL 使用参数化查询（`?` 占位符）
- 用户数据严格按 `user_id` 过滤
- API key 使用 `safeStorage` 加密存储
- 禁止字符串拼接 SQL
