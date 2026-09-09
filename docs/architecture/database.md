# 数据库架构

> 最后更新：2026-09-09

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 引擎 | SQLite | better-sqlite3 ^11 |
| 全文检索 | FTS5 | jieba-wasm 分词 |
| 向量存储 | 自定义 | embeddings_vec 表 |

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
| created_at | TEXT | 创建时间 |

#### ai_agent_events

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 事件 UUID |
| session_id | TEXT | Agent 会话 ID |
| conversation_id | TEXT FK | 所属会话 |
| user_id | TEXT FK | 所属用户 |
| seq | INTEGER | 序列号（递增） |
| event_type | TEXT | 事件类型（chunk/tool/done/error/interaction） |
| payload | TEXT | JSON 载荷 |
| created_at | TEXT | 创建时间 |

### AI 配置

#### ai_config

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 配置 UUID |
| user_id | TEXT FK UNIQUE | 所属用户 |
| remote_base_url | TEXT | API 基础 URL |
| model | TEXT | 模型名称 |
| api_key_enc | TEXT | 加密的 API key |
| write_mode | TEXT | 写模式（auto/manual） |
| max_rounds | INTEGER | 最大轮次 |
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

#### embeddings_vec

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 向量 UUID |
| chunk_id | TEXT FK | 关联分块 |
| user_id | TEXT FK | 所属用户 |
| embedding | BLOB | 向量数据（Float32Array） |
| created_at | TEXT | 创建时间 |

## 索引策略

- `files(user_id)` — 按用户查询
- `ai_messages(conversation_id, created_at)` — 会话消息时序
- `ai_agent_events(session_id, seq)` — 事件回放
- `kb_chunks(document_id, chunk_index)` — 文档分块
- `kb_chunks_fts` — FTS5 全文索引（jieba 分词）

## DAO 层

所有数据库操作通过 `src/main/db/` 下的 DAO 模块：

| 模块 | 职责 |
|------|------|
| `index.ts` | 数据库初始化 + 连接管理 |
| `files.ts` | 文件 CRUD |
| `ai.ts` | 会话/消息/事件 CRUD |
| `searchConfig.ts` | 搜索配置 CRUD |
| `embeddingConfig.ts` | Embedding 配置 CRUD |
| `kbDocuments.ts` | 知识库文档 CRUD |
| `kbChunks.ts` | 知识库分块 CRUD |

## 安全规则

- 所有 SQL 使用参数化查询（`?` 占位符）
- 用户数据严格按 `user_id` 过滤
- API key 使用 `safeStorage` 加密存储
- 禁止字符串拼接 SQL
