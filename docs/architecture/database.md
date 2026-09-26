# 数据库架构

> 最后更新：2026-09-24
> 表清单以 `src/main/db/index.ts` 建表语句为准（**22 实表 + 3 虚拟表 = 25**）；本页只展开常用表的字段，其余见 §「其他表索引」。

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 引擎 | SQLite | better-sqlite3 ^11 |
| 全文检索 | FTS5 | jieba-wasm 分词 |
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

#### kb_documents

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 文档 UUID |
| user_id | TEXT FK | 所属用户 |
| title | TEXT | 文档标题 |
| source_path | TEXT | 来源路径 |
| status | TEXT | 状态（indexing/ready/error） |
| chunk_count | INTEGER | 分块数量 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### kb_chunks

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 分块 UUID |
| document_id | TEXT FK | 所属文档 |
| user_id | TEXT FK | 所属用户 |
| content | TEXT | 分块内容 |
| chunk_index | INTEGER | 分块序号 |
| created_at | TEXT | 创建时间 |

#### kb_chunks_fts（FTS5 虚拟表）

| 字段 | 说明 |
|------|------|
| content | 分块内容（jieba 分词） |

#### images_vec（vec0 虚拟表）

> KB 文本仅走 FTS5 关键词召回（embedding 已随 remote-only 移除）；本表只存**图片** embedding
> （`imageIndexer.ts` → `kb_images` + 本表），且仅在 sqlite-vec 扩展可用时创建（`index.ts` try/catch 静默跳过）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 图片 UUID（关联 `kb_images.id`） |
| vector | FLOAT[1024] | 向量（1024 维） |

## 其他表索引

以下表已建但**字段从简记录**，需要时查 `src/main/db/index.ts` 建表语句（或对应 DAO）：

| 表 | 类型 | DAO | 用途 |
|----|------|-----|------|
| `agent_sessions` | 实表 | `agentSessionDao.ts` | Agent 任务会话（90s 租约 + 20s 续约窗口，乐观并发） |
| `agent_task_queue` | 实表 | `agentTaskDao.ts` | 后台任务队列（`dequeueNext` 保证同 `conversation_id` 串行） |
| `agent_file_snapshots` | 实表 | `agentSnapshotDao.ts` | 写入前文件快照（回滚用） |
| `ai_model_configs` | 实表 | `modelConfigs.ts` | 多模型配置（`protocol` / `baseURL` / `apiKey`） |
| `history` | 实表 | `history.ts` | 文件历史版本 |
| `file_revisions` | 实表 | `files.ts` | 文件修订记录 |
| `settings` | 实表 | `settings.ts` | 用户设置 KV |
| `app_meta` | 实表 | `appMeta.ts` | 应用元数据（schema 版本等） |
| `mail_config` | 实表 | `mail.ts` | 反馈邮件配置（key 走 safeStorage） |
| `knowledge_cache` | 实表 | `index.ts` | 知识库查询/Embedding 缓存 |
| `parsed_attachments` | 实表 | `attachments.ts` | 附件解析产物（`content` 存正文；`parse_status` 三态 pending/processing/done/error、`parse_version` 回填重建依据 —— B3 D2 补列启用） |
| `kb_images` | 实表 | `kb.ts` | 知识库图片索引（`document_id` 级联删除） |
| `kb_documents_fts` | FTS5 虚拟表 | `index.ts` | 文档级全文索引 |
| `images_vec` | vec0 虚拟表 | `index.ts` | 图片向量（sqlite-vec 可用时） |

## 索引策略

- `files(user_id)` — 按用户查询
- `ai_messages(conversation_id, created_at)` — 会话消息时序
- `agent_run_events(session_id, seq)` / `(conversation_id, seq)` — 事件回放
- `kb_chunks(document_id, chunk_index)` — 文档分块
- `kb_images(document_id)` — 图片索引回查
- `kb_chunks_fts` / `kb_documents_fts` — FTS5 全文索引（jieba 分词，触发器同步）

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
| `attachments.ts` | `parsed_attachments` DAO（insert/get/updateStatus/updateContent/remove/listByConversation）+ 发送链路三态落库 |
| `modelConfigs.ts` | `ai_model_configs` 多模型配置 |
| `searchConfig.ts` | `ai_search_config` 搜索配置 CRUD |
| `embeddingConfig.ts` | `ai_embedding_config` 配置 CRUD |
| `kb.ts` | **知识库统一 DAO**：`kb_documents` / `kb_chunks` / `kb_images` |
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
