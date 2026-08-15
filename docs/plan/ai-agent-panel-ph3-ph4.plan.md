# AI 代理面板 — 实施计划（第 3 期知识库 + 第 4 期 Agent 能力）

> 模块：docs/modules/11-AI代理面板-Agent.md §7 分期 | 需求：KB-01~06 + AGT-10~16（见 docs/requirements/ai-agent-panel-ph3-ph4.req.md）
> 范围：**只交付第 3 期（知识库）+ 第 4 期（Agent 能力）**；第 5 期块级改写（editBlocks 写工具 / 选区改写 / diff 预览）**不做**，本轮不注册任何写工具。
> 铁律一（AI 无直接落盘）：本轮工具全部只读（listFiles/readFile/searchKB/runSkill），无写盘触发点；违反即 cut。
> 铁律二（联网/笔记外发知情同意）：agent 模式 KB 检索外发经扩展后的服务端 `needsConsent(...,'agent')` 用 `allowSend` 判定；同意前不发外发请求。
> 双路召回架构完整（内嵌 embeddingClient + FTS5/向量 0.5/0.5 融合）；nomic-embed-text 未装自动降级仅 FTS5。向量路径以单测覆盖，现场按模型可用性真验。
> 活体验证优先远程 DeepSeek（本地 qwen3.5:0.8b 已确认故障，见 status §阶段 3-5）。
> 上一里程碑：第 1/2 期（基建 + Chat 闭环）已交付，门禁全绿（docs/plan/ai-agent-panel.status.md）。

---

## 0. 技术调研结论（已验证）

| 项 | 结论 | 来源/依据 |
|----|------|-----------|
| DeepSeek 函数调用 | OpenAI 兼容 `tools`/`tool_calls`：`choices[0].message.tool_calls[{function:{name,arguments}}]`，执行后回填 `{role:'tool',tool_call_id,content}` 续轮，并行调用支持；thinking 模式下 `tool_choice` 必须 `"auto"`；流式时 `tool_calls` 以 `delta.tool_calls` 增量抵达需累积。现有 `llmClient.streamChatCompletion` 仅解析 `delta.content` 与 `delta.reasoning`，需扩展 `delta.tool_calls` 累积 | 需求 §已核实事实 + 现有 llmClient.ts:160-206 |
| local ollama /api/embed | `POST {host}/api/embed`，body `{model,input:string[]}` → `{embeddings:number[][]}`（批量）；或旧 `/api/embeddings` 单条 `{model,prompt}` → `{embedding:number[]}`；nomic-embed-text 768 维、~274MB、向量自动单位化。embedding 走 ollama 时无 Authorization 头，与 llmClient 后端解耦（独立 host 判定） | 需求 §已核实事实 |
| FTS5 可用 | better-sqlite3（Electron 运行时，SQLite 3.49.2）`CREATE VIRTUAL TABLE ... USING fts5` 实证可用，走表外索引或 triggers（status stage 0 已验证） | docs/plan/ai-agent-panel.status.md stage 0 |
| 测试隔离 | 主进程 DB：`vi.mock('better-sqlite3', FakeDatabase)`（tests/main/db/aiDao.test.ts 实证）；ipc：`vi.mock('electron')` + FakeDatabase + 受控 db/llm/consent mock（tests/main/ai/ipc.test.ts 实证）；渲染 mock `window.weaveMD.ai`（tests/setup.ts 已有完整 ai mock） | 现有测试实证 |
| 可复用渲染管线 | unified / remark-parse / remark-gfm / remark-rehype / rehype-stringify / prismjs / katex（src/render/services/markdown.ts）。但 `markdown.ts` 的 `renderMarkdownToHtml` 走 HAST 字符串化，输出 raw HTML，**不适合 React 直接注入**（无 dangerouslySetInnerHTML）。assistant 富文本需新建「markdown → React 元素」安全渲染器（rehype-react 或手写 HAST→React 遍历），不可复用现有 markdown.ts 的 HTML 输出 | src/render/services/markdown.ts:224-236 |
| 无重依赖原则 | package.json 无 openai/zod/mcp SDK。余弦相似度纯函数自建；向量 BLOB 存 float32；工具 JSON 解析轻量容错 | package.json |
| 打开文件基元 | `editorStore.openFile(file)` 设置 currentFile+content（src/render/stores/editorStore.ts:32），KB-04 出处「点击打开文档」可调用它；滚动到对应块按 `source_ref` 里的行号定位 | editorStore.ts |
| skills 目录 | userData 路径（`app.getPath('userData')/skills/`）读取用户扩展技能；内置技能随代码打包（src/main/ai/skills/core/） | index.ts / ipc-handlers.ts getPath 用法 |

---

## 1. 变更清单

> 类型标注：新增 / 修改 / 复用。每行 = 一个可 diff 核对点。按「可并行拆模块」分组。

### A. 知识库主进程

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/main/db/kb.ts（**新**） | kb_documents / kb_chunks DAO + FTS5 维护 | upsertKbDocument / deleteKbDocumentByFile / setDocStatus / deleteChunksByDoc / insertChunk(含 vector BLOB) / getChunksByDoc / listKbDocumentsByUser / deleteAllKbForUser。全部 user_id 参数化过滤；向量经 Buffer(float32 LE) 编解码 helper |
| src/main/db/index.ts（改） | 建 FTS5 虚拟表 + 触发器 | runMigrations 的 database.exec() 内追加 `CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(content, doc_id UNINDEXED, tokenize='unicode61 remove_diacritics 2')` + 两触发器（insert/delete 同步 kb_chunks ↔ kb_chunks_fts）。幂等（IF NOT EXISTS + DROP TRIGGER 前置） |
| src/main/ai/embeddingClient.ts（**新**） | 本地向量化（Ollama /api/embed） | `probeEmbedding(baseUrl): Promise<{ok,dims}>`（GET /api/tags 或带头探测）；`embedBatch(baseUrl, model, texts:string[]): Promise<number[][]>`（POST /api/embed 批量，容错降级单条 /api/embeddings）；纯函数可单测（mock fetch），不 import electron |
| src/main/ai/kbIndexer.ts（**新**） | 导入/分块/嵌入/增量重索引 | `splitNote(content, docId): Array<{seq,text,approxOffset}>`（纯函数：按 ~800 字符/块，强制标题断点优先，重叠 overlap≈80）；`indexFile(userId, file, opts:{vecEnabled})`；`reindexAfterSave(userId, file)`（防抖由 ipc 层做）；`indexImportedText(userId, title, text)`；`removeByFile(userId, fileId)`。内部写 kb.ts + embeddingClient |
| src/main/ai/kbSearch.ts（**新**） | 双路召回融合 + 拒答 + 出处 | `cosineSimilarity(a,b)` 纯函数；`searchKB(userId, query, opts:{topK,fuse,vectorEnabled,pinnedWeight}): Promise<KbSearchResult[]>`；FTS5 BM25（`bm25(kb_chunks_fts)`）取 top-K 候选 → join kb_documents/kb_chunks → 若有向量则余弦评分；score = 0.5*ftsNorm + 0.5*vecCosine；置顶文档 ×1.5；低于拒答阈值 0.6 → `{refused:true, threshold, best}`。出处含 `{fileName, chunkId, docId, seq, sourceRef}` |

### B. Agent 主进程

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/main/ai/toolRegistry.ts（**新**） | 内置只读工具定义 + 执行器 | `defineTools(opts): ToolDef[]`：`listFiles`/`readFile`/`searchKB`/`runSkill` 的 OpenAI JSON Schema（`type:'function',function:{name,description,parameters}`）；`executeTool(name,args,ctx): Promise<{content:string, status:'ok'\|'error'}>`。`searchKB`+`readFile` 都从 ctx.userId 拉数据、只读。失败返回结构化 error + 兜底提示 |
| src/main/ai/skillLoader.ts（**新**） | skills 体系（内置 + 用户扩展） | `loadSkills(userDataSkillsDir): CoreSkill[]` 扫描 userData/skills/ 下 SKILL.md 式目录；内置 3 个 core skill（见 §4.6）随代码注册；返回 `{name,description,prompt,argsSchema}`，供 runSkill 执行 |
| src/main/ai/intentRouter.ts（**新**） | 意图规则启发式 5 类 | `classifyIntent(input): {intent: 'create'\|'rewrite'\|'kbQa'\|'tech'\|'web'\|'chat', confidence, candidates?}`；规则（关键词/正则/结构启发），模糊 → `candidates` 数组 + `confidence<0.6`；升级点预留（后续可换 LLM 分类） |
| src/main/ai/contextManager.ts（**新**） | 上下文压缩 | `estimateTokens(text)`（无 tokenizer：`Math.ceil(chars/4)`，说明取舍见 §4.7）；`shouldCompress(tokens,total,{threshold})`；`buildCompressed(messages, summary, opts)` —— 将 summary 置顶 + 保留最近 N 轮原文；`summarizeViaLlm(...)` 复用 llmClient 一次调用，结果写 `ai_conversations.summary`（复用现有 AI_SUMMARY_UPDATE 通道语义） |
| src/main/ai/agentLoop.ts（**新**） | 函数调用循环（远程可靠） | `runAgentFlow(event, payload, config, apiKeyEnc, controller)`：consent(agent) → intent → 组装 messages(+summary/+工具) → 循环 ≤6 轮 → streamChatCompletion(with tools) → 解析 tool_calls（流式累积）→ executeTool → 回填 role:'tool' 落库+推送 → 续轮；无 tool_calls finish 后落 assistant；工具失败兜底直接作答 + 提示；rounds 到限收敛。ollama 后端 → 降级纯 chat（无 tools）并提示 |
| src/main/ai/llmClient.ts（改） | 扩展 tools 支持 | `StreamChatCompletionOptions` 增 `tools?: Array<ToolDefJson>` 与 `toolChoice?: 'auto'`；body 增 `tools`；SSE 解析增 `delta.tool_calls` 增量累积逐个完成态 emit `{delta,toolCalls?}`；`StreamChunk` 增 `toolCalls?: Array<{index,name,arguments}>` |
| src/main/ai/consent.ts（改） | needsConsent 扩展 'agent' + allowSend | `ConsentAction = 'chat'\|'agent'`；`agent`: remote 授权（allowNetwork）且 KB 检索外发（allowSend）→ 判定。保持纯函数可单测 |

### C. 渲染侧

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/render/components/AIAgent/AgentTab.tsx（改） | 骨架 → 全功能 Agent UI | 会话列表 + 消息列表（含 tool 轨迹）+ 意图提问卡片 +「依照知识库创作」开关 + 富文本渲染 + 压缩手动按钮。提取通用 `<ConversationList/>`（与 ChatTab 复用，可选） |
| src/render/components/AIAgent/ToolCallTrace.tsx（**新**） | 工具调用过程展示 | 渲染 tool 消息：工具名 + 参数摘要 + 执行状态（ok/error）+ 结果折叠；i18n 键 ai.tool.* |
| src/render/components/AIAgent/IntentCard.tsx（**新**） | 意图识别候选提问卡片 | 模糊意图时展示候选卡片列表，点击即发送；i18n 键 ai.intent.* |
| src/render/components/AIAgent/MarkdownMessage.tsx（**新**） | 安全 markdown→React 渲染 | unified/remark-parse/remark-gfm → HAST → 手写 HAST→React 遍历（**不用 dangerouslySetInnerHTML**）；代码块 prism 高亮；katex 行内/块级；纯文本兜底。复用 markdown.ts 的 strip/typography 辅助 |
| src/render/components/AIAgent/KnowledgeBaseSettings.tsx（**新**） | 知识库设置/导入 UI | 导入 md/txt（单文件 + 目录批量）、索引状态列表（pending/done/error）、删除/重建触发 |
| src/render/components/AIAgent/AIMessageBubble.tsx（改） | assistant/tool 富文本 + refs 出处 | assistant 用 `<MarkdownMessage/>`；tool 用 `<ToolCallTrace/>`；user 保持纯文本；refsJson 数组渲染「[来源: 文件名 · 块]」可点击（openFile） |
| src/render/services/aiMarkdown.tsx（**新**） | HAST→React 渲染器 | 与 MarkdownMessage 配套的纯渲染工具函数（无组件状态），便于单测 |
| src/render/stores/agentStore.ts（改） | 扩展现有 agent 状态机 | 复用 `mode='agent'` 会话（loadConversations/init 增 mode 参数）；增 `useKnowledgeBase` 开关、`toolCalls` 展示态、`intentCard` 候选、`agentBackendHint`（ollama 降级提示）、`sendAgentMessage`/`loadKbStatus`/`runManualCompress`；保留 needsConsent 闸升级到 agent |
| src/render/stores/kbSettingsStore.ts（**新**） | KB 设置 UI 状态 | importStatus / kbDocuments / importing / 触发 import/reindex/delete（可选与 agentStore 合一，见 §5.5） |
| src/render/components/Settings/SettingsModal.tsx（改） | 'ai' Tab 增 KB 阈值/融合/拒答设置 | 增 topK / fuse / threshold / 召回融合权重 / embedding host 与模型 id；对照 §沿用设计默认值 |

### D. 共享与 IPC

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/shared/ai.ts（改） | 共享类型增补 | `IAIMessage` 增 `refsJson` 语义文档；`AiChatResult` 不变；新增 `IIntent`, `IKbSearchResult`, `IKbDocumentStatus`, `IKbImportResult`, `AgentRunResult`, `IAgentToolCall`, `IAgentStreamEvent`（扩展 AIStreamEvent 增 type:'tool'） |
| src/shared/constants.ts（改） | 新增 kb:* 与 agent:* 白名单通道 | IPC_CHANNELS 增 KB_* 与 AGENT_*（见 §3）+ 新增流式事件常量 |
| src/main/preload.ts（改） | 暴露 new namespaces | `ai.*` 增 `runAgent`；新增 `kb.*` 命名空间（list/importFile/importDir/reindexByFile/deleteByFile/getStatus）；onStream 解析新增 tool 事件 |
| src/main/ai/ipc.ts（改） | 注册 kb:* + agent:* 处理器 | `runChatFlow` 保持 chat；新增 `runAgentFlow` 处理器（AGENT_RUN）；KB_* 处理器（KB_LIST / KB_IMPORT_FILE / KB_IMPORT_DIR / KB_REINDEX / KB_DELETE / KB_STATUS）。补充写入安全：kb 处理器全部校验 userId 归属 |

### E. 测试

| 文件 | 覆盖 |
|------|------|
| tests/main/ai/embeddingClient.test.ts（**新**） | embedBatch mock fetch 批量/降级单条/探针 |
| tests/main/ai/kbIndexer.test.ts（**新**） | splitNote 断点/overlap；indexFile 状态流转 |
| tests/main/ai/kbSearch.test.ts（**新**） | 余弦纯函数；双路融合数值；拒答阈值；置顶加权 |
| tests/main/ai/intentRouter.test.ts（**新**） | 5 类分类；模糊候选 |
| tests/main/ai/contextManager.test.ts（**新**） | 字数估算；阈值；压缩保留最近 N 轮 |
| tests/main/ai/toolRegistry.test.ts（**新**） | 4 工具执行；失败兜底；只读约束 |
| tests/main/ai/agentLoop.test.ts（**新**） | 函数调用循环 mock；死循环防护；tool 回填 |
| tests/main/ai/skillLoader.test.ts（**新**） | 内置+用户扩展读取 |
| tests/main/ai/consent.test.ts（改） | agent+allowSend 判定用例 |
| tests/main/ai/ipc.test.ts（改） | AGENT_RUN + KB_* 处理器注册；user_id 隔离 |
| tests/main/db/kbDao.test.ts（**新**） | kb DAO 参数化/归属过滤（FakeDatabase） |
| tests/main/db/utilsFloat.test.ts（**新**） | float32 BLOB 编解码 roundtrip |
| tests/render/services/aiMarkdown.test.tsx（**新**） | HAST→React 安全渲染（无 dangerouslySetInnerHTML） |
| tests/render/components/AIAgent/AgentTab.test.tsx（改） | Agent 全功能 UI |
| tests/render/components/AIAgent/MarkdownMessage.test.tsx（**新**） | 富文本渲染 |
| tests/render/components/AIAgent/ToolCallTrace.test.tsx（**新**） | 工具轨迹展示 |
| tests/render/components/AIAgent/IntentCard.test.tsx（**新**） | 提问卡片点击发送 |
| tests/render/stores/agentStore.test.ts（改） | agent mode 会话 + 无死循环 + 降级提示 |
| e2e/ai-agent-panel.spec.ts（改） | Agent tab 全功能 mock 流式 |

---

## 2. 数据模型与迁移

### 现状 → 模型

现状：`kb_documents`/`kb_chunks` 两表 DDL 已预建（vector BLOB / source_ref 字段齐备，零数据），`ai_messages.role` 已含 `'tool'`，`ai_conversations.mode` 已含 `'agent'`，`ai_config.allowSend` 已存在。**无新增列**。本轮仅新增一张 FTS5 虚拟表（表外索引，不改 kb_chunks 结构）。

### 最终模型（新增部分）

```sql
-- 表外 FTS5 关键词索引：内容来自 kb_chunks，经触发器同步。
-- 不修改 kb_chunks 既有列。联合该表 + kb_documents 关联 + kb_chunks.content 供 BM25。
CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
  content,
  doc_id UNINDEXED,          -- 冗余 kb_chunks.id，供回查
  tokenize = 'unicode61 remove_diacritics 2'   -- 中文按 unicode 分块 + 拉丁去变音
);
```

同步触发器（幂等，迁移每跑一次即重建）：

```sql
-- DROP TRIGGER IF EXISTS 前置，保证幂等
CREATE TRIGGER IF NOT EXISTS kb_chunks_fts_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(rowid, content, doc_id) VALUES (new.id, new.content, new.id);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_fts_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content, doc_id)
  VALUES ('delete', old.id, old.content, old.id);
END;
```

> FTS5 `rowid` 用 kb_chunks.id 的 TEXT 主键（默认 rowid 是整数；用内容主键时需在 aux 表映射）。若默认 rowid=整数存在映射复杂度，**备选**：将 FTS5 表建为 `content UNINDEXED` + 用 kb_chunks 内部整数 rowid（better-sqlite3 默认 INTEGER PRIMARY KEY 不设时自动 rowid）。实施期以「FTS5 触发同步 + BM25 回查 kb_chunks」实测为准，两条都已有实证基础。

### kb_chunks 与文档关联 & source_ref

- `kb_chunks.id`（TEXT uuid）为 chunk 主键，`document_id` → `kb_documents.id`。
- `kb_documents.file_id` 关联 `files.id`（db 来源）；`source_type ∈ {db|disk|import}`。
- `source_ref` 存 `{ fileId?, fileName, line?, chunkDocId, seq }` JSON 字符串——供 KB-04 出处点击（openFile + 按行滚动）。纯文本存储，不解析为列。
- **置顶权重实现点**：`kb_documents.pinned`（INTEGER 0/1）。在 kbSearch 融合评分阶段对命中该文档的 chunk score `×1.5`（§沿用设计默认值，可在设置改）。不建新索引列。

### `kb_documents.status` 流转

`pending → done → error`（索引排队→成功→失败），另 `importing` 作为瞬态。删除时整文档级联删 chunks（`kb_chunks.document_id ON DELETE CASCADE` 已建）。

### 注入点（映射现有 IPC/DAO）

| 数据动作 | 触发 |
|---------|------|
| 文件保存后重嵌入（KB-06 防抖） | 主进程在现有 `FILE_SAVE` handler / `updateFileContent` 之后挂防抖（~1200ms）调用 `kbIndexer.reindexAfterSave`（只重索引该 fileId 的 kb_documents：删 chunks 重建）。不增加渲染负担 |
| 删除文件清理（KB-06） | 在现有 `FILE_DELETE` handler 同步 `kbIndexer.removeByFile` |
| 手动/导入 | 新 KB_IMPORT_FILE / KB_IMPORT_DIR 处理器 |

### 迁移与回滚

- **做**：本次迁移仅追加 FTS5 虚拟表 + 触发器（全部 `IF NOT EXISTS` / `DROP TRIGGER IF EXISTS` 幂等）。已存在 kb 表不动，零数据升级无损。
- **回滚**：DROP TABLE kb_chunks_fts + DROP TRIGGER 即可完全还原（kb_* 表本身还在，双 SQL 只重跑一遍迁移）。不影响 ai_config/ai_*。
- **明确写入安全**：kb 数据严格 user_id 过滤（参数化，绝无拼接），IPC 校验归属。

---

## 3. IPC 通道清单

沿用 `IpcResponse<T> {success,data?,message?,error?}` 信封 + 流式推送（main→render，webContents.send）。

### 新增 `kb:*`（主推 invoke）

| 通道（IPC_CHANNELS） | 方向 | 请求 | 响应 data |
|----------------------|------|------|-----------|
| KB_LIST:`kb:list` | invoke | {userId} | IKbDocumentStatus[]（文档 + 状态 + pinned） |
| KB_IMPORT_FILE:`kb:import:file` | invoke | {userId, title, content} | IKbImportResult（imported chunks，status） |
| KB_IMPORT_DIR:`kb:import:dir` | invoke | {userId, files:[{title,content}]}（目录批量，渲染侧经 folder 读取后整批传入） | IKbImportResult[] |
| KB_REINDEX:`kb:reindex` | invoke | {userId, fileId} | IKbImportResult（强制重建单文档） |
| KB_DELETE:`kb:delete` | invoke | {userId, fileId} | {deleted} |
| KB_STATUS:`kb:status` | invoke | {userId} | {documents, embedding:{available,dims}} |

### 新增 `agent:*`（主推 invoke + 流式）

| 通道 | 方向 | 请求 | 响应 data |
|------|------|------|-----------|
| AGENT_RUN:`agent:run` | invoke + stream | {userId, conversationId?, message, mode:'agent', useKnowledgeBase} | 流结束后 resolve {conversationId, assistantId, roundsUsed, intent, refused?, usage}；流式见下 |
| AGENT_ABORT:`agent:abort` | invoke | {conversationId} | {aborted}（复用 activeStreams 机制） |

### 流式推送事件（main→render，扩展 `ai:stream:*` 模式）

```text
'ai:stream:chunk'  -> { conversationId, delta }                       // 沿用
'ai:stream:done'   -> { conversationId, usage?, roundsUsed, intent } // 沿用 + 扩展
'ai:stream:error'  -> { conversationId, code, message }              // 沿用
'ai:stream:tool'   -> { conversationId, toolCallId, name, args, status, result? }  // 新增：工具调用过程推送，供 ToolCallTrace 回显
```

> AGENT_RUN 与 AI_CHAT 共用同一组流推送通道（前端 onStream 已订阅 chunk/done/error；增解析 tool 事件）。

---

## 4. 主进程设计

### 4.1 embeddingClient.ts

```text
async function probeEmbedding(baseUrl): Promise<{ ok: boolean; dims: number | null }>
  // GET {host}/api/tags 取 model 列表判 nomic-embed-text；失败 ok:false

async function embedBatch(baseUrl, model, texts: string[]): Promise<number[][]>
  // POST {host}/api/embed { model, input: texts }
  // 失败降级：逐条 POST /api/embeddings { model, prompt } 收集 { embedding }
  // throw 结构化 { code:'embedding_unavailable' } 由调用方降级仅 FTS5
```

- 不 import electron，纯 fetch，可单测（mock global fetch）。
- 模型可用性缓存：模块级 `{ available: boolean, dims }` 防止重复探针。
- 未装 nomic-embed-text 或 ollama 离线 → `embeddingEnabled=false`，kbSearch 走仅 FTS5。

### 4.2 kbIndexer.ts

- `splitNote(content, docId)`：纯函数，~800 字符/块，优先 `\n## `/`\n# `/`\n---` 断点，块间 overlap≈80 字防切断语义。返回 `{seq, text}`。
- `indexFile(userId, file, {vec})`：
  1. `upsertKbDocument`(source_type='db', pinned=现有文件级开关) → status='importing'
  2. `deleteChunksByDoc`（重建式：先清旧块再插新）
  3. `splitNote` → 每条 `insertChunk`(vector = vec? embedBatch 该块向量 Buffer : null)
  4. status→'done'；任何 throw → status='error' 并结构化 err
- `reindexAfterSave(userId, file)`：内部 `deleteKbDocumentByFile` + `indexFile`（重表轻）。
- `indexImportedText(userId, title, text)`：source_type='import'，file_id 置 NULL（导入文档不入 files 表；出处只定位文件名+行号）。

### 4.3 kbSearch.ts

```text
export function cosineSimilarity(a: Float32Array, b: Float32Array): number
  // 纯函数：dot/(||a||*||b||+eps)；自建，零依赖

export async function searchKB(userId, query, opts): Promise<KbSearchResult[] | { refused:true, best }>
```

双路融合：
1. **FTS5 路**：`SELECT kb_chunks_fts.rowid, bm25(kb_chunks_fts) AS bm FROM kb_chunks_fts JOIN kb_documents d ON d.id=(SELECT document_id FROM kb_chunks WHERE id=kb_chunks_fts.doc_id) WHERE kb_chunks_fts MATCH ? AND d.user_id=? ORDER BY bm LIMIT topK`（参数化；`MATCH ?` 占位）。取 top-k 候选（k=query topK×2 以留融合池）。
2. **向量路**（`embeddingEnabled`）：对 query embedBatch 单向量，与命中 chunk 的 BLOB 解 float32 余弦。未命中向量 → 跳过该 chunk 向量分（该 chunk 只保留 FTS 分）。
3. **融合**：`score = 0.5*ftsNorm + 0.5*vecCosine`；ftsNorm 对 BM25 做 min-max 归一（并行候选极值为界）。置顶文档（d.pinned=1）score ×1.5。
4. 取 top-k（默认 5），最低分 < 拒答阈值 0.6 → `refused:true`（返回 `best` 供提示「未找到足够相关来源」，不生成答案，可选给来源）。默认值来自设置。

> `MATCH ?` 用户 query 可能含 FTS5 语法特殊字符 → 实施期做「用户查询净化」（剥离 `"()*:^` 等，转纯 token 匹配）防语法注入/误导。纯函数可单测。

### 4.4 toolRegistry.ts

```text
type ToolDef = { type:'function'; function:{ name; description; parameters: JSONSchema; } };
type ToolCtx = { userId; runner: { listFilesList... } };  // 全部主进程只读数据源

defineCoreTools(): ToolDef[]
  // listFiles   { user_id }               -> [{name,fileId,modifiedAt}]
  // readFile    { user_id, file_id }      -> {name, content, modifiedAt}（只读，不存在报 error）
  // searchKB    { user_id, query, topK? } -> [{fileName, chunkId, content, seq, sourceRef, pinned}]（调 kbSearch，走向量/降级）
  // runSkill    { skill, input, params? } -> 调 skillLoader 执行，返回文本结果
executeTool(name, args, ctx): Promise<{ content:string; status:'ok'|'error'; errorDesc? }>
```

- 全部只读；本轮无 `editBlocks` 写工具。
- 参数从 args 字符串 `JSON.parse` 容错（轻量；失败给默认/报错兜底）。
- 执行失败：status='error' + errorDesc，agentLoop 收到后走兜底（降级直接作答 + 提示），不抛断循环。

### 4.5 agentLoop.ts（函数调用循环）

```text
async function runAgentFlow(event, payload, config, apiKeyEnc, controller) {
  1. needsConsent(config, consent, 'agent') -> 未授权返回 consent_required（不发外发请求）
  2. intent = classifyIntent(message); 若 intent 命中 'kbQa' 且 useKnowledgeBase 则后续带 searchKB 工具候选
  3. messages ← getMessagesByConversation(mode='agent') filtered(user|assistant|tool)
     + contextManager 组装（有 summary 则置顶 + 保留最近 N 轮）
  4. 工具 = intent 决定子集（kbQa→searchKB；tech/write→listFiles/readFile/runSkill；均包含基础）
  5. loop for round in 1..MAX_ROUNDS(=6):
       chunks = streamChatCompletion({..., tools, toolChoice:'auto'})  // 远程才带 tools
       累积 delta.tool_calls 完整 tool_calls 数组
       if 无 tool_calls → assistantContent 完成, break
       else: 对每个 tool_call: executeTool → 推送 'ai:stream:tool'
             appendMessage(role:'tool', content:result)（写入 ai_messages 供回显/续上下文）
             tool_results 回填后续轮（role:'tool',tool_call_id）
  6. 落 assistant 消息 + updateSummary/usage
  7. ollama 后端：config.backend==='ollama' → 不传 tools，纯 chat 走 llmClient，返回降级提示字段 agentBackendHint
  8. 死循环防护：MAX_ROUNDS 到限即收敛为「已在 N 轮内达到工具能力上限」提示；工具失败兜底作答
}
```

- `tool_calls` 流式累积：`streamChatCompletion` 的 `StreamChunk` 增 `toolCalls`，agentLoop 按 index 聚合 `arguments` 片段（JSON 增量直至 finish）。
- activeStreams 注册/清理与 runChatFlow 一致（finally 释放，abort 复用）。

### 4.6 skillLoader.ts + 内置 skills

- 内置 3 个 core skill（编译进 src/main/ai/skills/core/*.skill.ts，名称/描述/prompt/argsSchema 结构化，非磁盘文件）：**「润色/缩写/扩写」** / **「技术资料整理」** / **「知识库问答引导」**。SKILL.md 式 = 每技能含统一的 `{name, description, instructions, argsSchema}`。
- 用户扩展：扫描 `app.getPath('userData')/skills/` 下 `<name>/SKILL.md`（front-matter 解析 name/description + 正文作 instructions + 可选 args JSON）。render 不进磁盘，全主进程，密钥不落渲染。
- `runSkill` 执行：把 skill.instructions 注入 role:'system' 片段 + 用户 input，走一次 llmClient 纯生成（嵌套一次非循环，防递归）。GitHub 自取 `writing-shape` 不做。

### 4.7 contextManager.ts（上下文压缩）

- **token 估算（无 tokenizer 依赖）**：`estimateTokens(text) = Math.ceil(text.length / 4)`（英文 ~4 chars/token 近似；中文 ~1 char/词偏保守）。取舍说明：非准确计分器，仅作**相对阈值**触发用（80% 判断），低估/高估 ≤2x 不影响「是否该压缩」的判定边界（压缩本身是幂等安全动作）。如配置了 model 的典型 context（remote v4 flash 常规 64k），`shouldCompress` 用 `estimateTokens(∑messages) >= 0.8 * contextWindow` 判定。
- 自动（round 间实时检查）+ 手动（渲染侧按钮触发 `runManualCompress`）。
- 压缩动作：调 `summarizeViaLlm`（llmClient 一次非流式/流式皆可，得摘要）→ `updateConversationSummary(summary)`（复用现有 AI_SUMMARY_UPDATE 通道语义）→ 后续 round messages = `[{role:'system',content:'以下为历史摘要：'+summary}]` + 最近 N 轮原文（默认 N=6）。
- 不做：token 精确计数、逐 token 裁剪（超范围，保守起 fit）。

### 4.8 llmClient.ts 改动点

在 `streamChatCompletion` 维持单函数（不拆双客户端）：
- `StreamChatCompletionOptions` 增可选 `tools?: ToolDef[]`、`toolChoice?: 'auto'`。
- body 组装：`...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {})`（thinking 模式必 auto，remote DeepSeek 支持）。
- `StreamChunk` 增 `toolCalls?: Array<{ index:number; name:string; arguments:string }>`。
- SSE 解析（:`163-206` 附近）：非空 `delta.tool_calls` 逐个累积到**调用级缓冲**（`{index,function.name?,function.arguments?}` 增量拼接arguments 直至该 delta `{finish_reason:'tool_calls'}` 或流尾），完成态 append 到 result.toolCalls 随当次 yield 返回。已在 yield `{delta:content}` 处原样保留 content 路径，thinking 空 content 跳过逻辑不变。
- 复用现有 timeout 贯穿「连接+流式」设计与 abort 语义（status 已修复的 llmClient bug 不改）。

### 4.9 consent.ts 扩展签名

```text
export type ConsentAction = 'chat' | 'agent';
export function needsConsent(config, consent, action: ConsentAction = 'chat'): boolean
  // chat:  (现状) remote && !allowNetwork
  // agent: (remote ? allowNetwork : true)   // remote 需允许联网
  //        且 KB 检索外发需 allowSend；ollama 本地 agent（降级纯生成，无外发）不要求 allowSend
```

保持纯函数、可单测。渲染侧 `agentStore.needsConsent` 同步升级定义（与主进程一致，双源真值注释）。

---

## 5. 渲染侧设计

### 5.1 AgentTab 全功能

复用 ChatTab 的「会话列表/消息流/Composer」骨架（抽取 `MessageBoard` 或直接扩 Chats），叠加：

- **意图提问卡片**：发信后若 `runAgentFlow` 返回/推送 `intentCard`（模糊置信度），悬浮候选卡片（`<IntentCard/>`），点击即改名重发。
- **工具调用轨迹**：消息流中 tool 消息渲染 `<ToolCallTrace/>`（流式 `ai:stream:tool` 增量 push 到 store → 组件列表更新），展示每个工具 name + args 摘要 + 结果折叠（ok/error 色标）。
- **富文本**：assistant 消息用 `<MarkdownMessage/>`（安全渲染，无 dangerouslySetInnerHTML）；tool 消息纯文本兜底。
- **「依照知识库创作」开关**：顶部 toggle，入 `agentStore.useKnowledgeBase`，随 AGENT_RUN 载荷传主进程。
- **手动压缩按钮**：`runManualCompress()`。
- **降级提示**：`agentBackendHint` 非空时展示「Agent 能力需远程后端，当前为纯生成模式」（ollama 后端）。

### 5.2 知识库设置/导入 UI（KB 面板子区）

`<KnowledgeBaseSettings/>` 挂在 AI 面板内（e.g. AgentTab 顶部切出，或独立小抽屉）：
- 导入按钮（`kb:import:file`）单文件 + （文件夹批量 `dialog.openFolder` + `folder:readFolder` → 交 `kb:import:dir`）。
- 索引状态列表（`kb:list`）：每文档 title/status/pinned，操作删/重建。
- `kb:status` 显示 `embedding.available`：未装 nomic 时标注「当前仅关键词召回」。

> 目录批量读取权宜：复用既有 `FOLDER_READ`（只返回 .md 元信息）——但内容在主进程 `folder:readFolder` 只给 name/path。**改法**：`kb:import:dir` 处理器内部 `fs.readFile` 各路径（主进程读盘），渲染只传 folderPath。保持密钥/磁盘访问全在主进程。

### 5.3 富文本安全渲染（MarkdownMessage + aiMarkdown.tsx）

- **不**复用 `markdown.ts.renderMarkdownToHtml`（产出 raw HTML，需 dangerouslySetInnerHTML 注入 → 违反 SECURITY）。
- 新建 `aiMarkdown.tsx`：`unified().use(remarkParse).use(remarkGfm).use(remarkRehype)` 得 HAST tree → 手写 `hastToReact(node)` 递归转 `<React.ReactElement>`（映射 h1-h6/p/ul/ol/li/blockquote/code/pre/a/img/table/strong/em 等白名单），`:code` 用 prism 高亮（复用 prismjs 已装），行内/块级 `$..$`/`$$..$$` 用 katex（已装）。未知节点降级纯文本。**断言测试钩子**：`renderResult` 不含 `dangerouslySetInnerHTML`、不允许 `<script>`。
- 兜底：markdown 解析失败 → `content` 原样纯文本。

### 5.4 出处 Kb-04 点击打开文档

- `AIMessageBubble` 收到 assistant `refsJson`（IKbSearchResult 数组）→ 渲染「[来源: 文件名 · 块]」链接。
- 点击：`getFile(fileId, userId)` → `editorStore.openFile(file)`；滚动到块 = 按 `source_ref.line` 定位，经 `editorInstance` 光标/滚动 API（当前主区滚动基元，实施期接线；若行定位超范围只做 openFile 不滚动，不阻塞）。

### 5.5 agentStore 扩展（扩展现有，不新建独立 store 的会话部分）

保留单一 `agentStore`，新增子状态：
- `useKnowledgeBase: boolean`、`toolCalls: Array<IAgentToolCall>`、`intentCard: IIntent|null`、`agentBackendHint: string|null`、`activeMode: 'chat'|'agent'`（tab 联动）、`kbStatus`。
- `sendAgentMessage(text)`：needsConsent(config,consent,'agent') → 复用 mode='agent' 会话链路（createConversation('agent')）→ `runAgent` → onStream 工具/文本订阅。
- `init`：切换 tab 时 `listConversations(userId, activeMode)`；`loadConversations`/`loadConversation` 增 mode 参数（chat 与 agent 会话域分离）。
- `runManualCompress()` 与 `loadKbStatus()`/`triggerKbImport`/`triggerKbDelete` 走 kb.* preload。
- `kbSettingsStore` **不建**（避免会话与设置双 store 竞态）；KB 设置 UI 直接读 agentStore.kbStatus + 动作，保持单一 store。

> 决策：**扩展现有 agentStore**（原因：会话/consent/stream 状态本共享；拆新 store 会复制半套状态机导致双源真值漂移，status 刚收敛过 WeaveAIApi 垫片问题）。

### 5.6 SettingsModal 'ai' Tab 增补

增：召回 `topK`(默认5) / 融合权重 `fuse`(默认0.5) / 拒答阈值 `threshold`(默认0.6) / 置顶权重 `pinnedWeight`(默认1.5) / embedding host + model id。i18n 键 `ai.settings.kb.*`。文案标注「仅 Agent KB 问答生效」。

---

## 6. 测试计划（TDD strict）

> 遵循：主进程 DB `vi.mock('better-sqlite3', FakeDatabase)`；主进程 ipc `vi.mock('electron')`+FakeDatabase+受控 mock（沿用 ipc.test 模式）；渲染 mock `window.weaveMD.ai`。真实 SQLite/FTS5 语义走 Electron 运行时手动 + E2E。

| 测试文件 | 关键用例 |
|----------|---------|
| embeddingClient.test.ts | embedBatch 批量成功；批量失败降级逐条 /api/embeddings；ollama 离线 → embedding_unavailable；probeEmbedding 探针 |
| kbIndexer.test.ts | splitNote 段落断点优先 + overlap 拼接；indexFile 状态 pending→done / error；reindexAfterSave 删旧插新（FakeDatabase 断言删除+插入 SQL 顺序） |
| kbDao.test.ts | upsert/delete/insertChunk/deleteAllByUser 参数化 + user_id 过滤；float32 BLOB 编解码（utilsFloat.test.ts roundtrip） |
| kbSearch.test.ts | 余弦纯函数数值；融合评分 0.5/0.5；拒答阈值 below→refused；置顶×1.5 排序前移；向量缺省仅 FTS 分 |
| intentRouter.test.ts | 创作/改写、目录问答、技术资料、网页抓取、闲聊 5 类正确归类；模糊→candidates+低置信 |
| contextManager.test.ts | 字数估算（/4）；80% 阈值 shouldCompress 边界；压缩后 summary 置顶+保留最近 N 轮原文 |
| toolRegistry.test.ts | listFiles/readFile/searchKB/runSkill 定义 Schema 合法；执行 ok/error；失败 status='error' 兜底；**无 editBlocks/write 工具**（断言 defineCoreTools 不含**任何改盘**工具） |
| skillLoader.test.ts | 内置 3 skill 加载；userData 目录读取（mock 文件系统）；SKILL.md front-matter 解析 |
| agentLoop.test.ts | mock streamChatCompletion 返回 tool_calls → executeTool → role:'tool' 回填续轮 → 收敛无死循环；rounds>6 兜底提示；tool 失败降级直接作答；ollama 后端降级纯 chat；consent agent 拒绝不发外发 |
| consent.test.ts（改） | agent+remote 未 allowNetwork→true；agent 是 KB 外发未 allowSend→true；allowSend 授权→false；ollama agent（无外发）→false |
| ipc.test.ts（改） | AGENT_RUN/KB_* handler 注册；user_id 隔离；流式 tool 事件推送 |
| aiMarkdown.test.tsx | HAST→React 安全渲染 h1/code/prism；**断言无 dangerouslySetInnerHTML**、无 script 逃逸；解析失败纯文本兜底 |
| MarkdownMessage/AgentTab/ToolCallTrace/IntentCard.test.tsx | 富文本/轨迹/卡片渲染与交互 |
| agentStore.test.ts（改） | mode='agent' 会话隔离创建；sendAgentMessage tool 事件累积；无死循环；agentBackendHint 提示；needsConsent(agent) 闸 |
| e2e/ai-agent-panel.spec.ts（改） | mock weaveMD.ai 完整流（含 tool 事件）：Agent tab 发信→意图→工具轨迹→富文本落显；不加真实外发网络 |

---

## 7. 验收标准（可逐条勾选）

> 映射 §1 需求清单 KB-01~06 + AGT-10~16。

**知识库（第 3 期）**
- [ ] KB-01：账号内全部未删笔记（files 表 user_id 过滤 + deleted_at 排除）可索引；导入 md/txt 单文件 + 目录批量落地 kb 表；置顶=文件级开关
- [ ] KB-02：导入/索引→分块写 kb_documents/kb_chunks→FTS5 触发器同步→embedding 向量（nomic 可用）；未装降级仅关键词，无崩溃
- [ ] KB-03：FTS5(BM25)+向量余弦 0.5/0.5 融合，top-k 默认5；低于拒答阈值 0.6 拒答不生成答案（返回提示+可选来源）；置顶文档召回加权
- [ ] KB-04：答案附「[来源: 文件名 · 块]」，点击 openFile 打开文档（尽力滚动到行）
- [ ] KB-05：agent KB 问答外发触发 allowSend 同意闸；同意前不发外发请求（服务端 needsConsent('agent') 拦截 + 单测）
- [ ] KB-06：文件保存后防抖异步重嵌入；删除文件同步清理 kb；索引状态 pending/done/error 可见

**Agent 能力（第 4 期）**
- [ ] AGT-10：工具注册表含 listFiles/readFile/searchKB/runSkill，只读自动执行；**无 editBlocks 写工具**（断言覆盖）
- [ ] AGT-11：主进程函数调用循环 ≤6 轮、tool_calls 回填 role:'tool' 续轮、无死循环；工具失败兜底降级直接作答并提示
- [ ] AGT-12：内置 2-3 个 SKILL.md 式技能 + userData/skills/ 用户扩展读取；runSkill 执行；GitHub 自取不做
- [ ] AGT-13：规则启发式 5 类正确归类；模糊输入给出候选提问卡片；工具失败自动兜底
- [ ] AGT-14：上下文超 80% 自动压缩 + 手动压缩；压缩后保留最近 N 轮原文；summary 复用 ai_conversations.summary + 现有通道
- [ ] AGT-15：ollama 后端 Agent 降级无工具纯生成并提示切换远程；函数调用仅 remote（DeepSeek 实证支持 tools）；远程活验循环正常
- [ ] AGT-16：assistant/tool 消息经安全 markdown（unified→HAST→React，无 dangerouslySetInnerHTML）渲染；纯文本兜底

**质量门禁**
- [ ] npm run typecheck（tsc --noEmit）0 error
- [ ] npm run test（vitest run）全绿，覆盖 §6 测试项
- [ ] npm run lint（eslint src/）0 error
- [ ] npm run build（vite build）pass
- [ ] Playwright E2E ai-agent-panel.spec 通过 + 原有回归全绿
- [ ] en/zh-CN/zh-TW 三文件 ai.* 与 kb.* 键键名一致无缺漏

---

## 8. 风险与依赖

| 风险/依赖 | 影响 | 缓解 |
|-----------|------|------|
| 本地 qwen3.5:0.8b 故障 | 本地 Agent/KB 无法活验 | 活验走远程 DeepSeek（需 key）；ollama 后端降级无工具（AGT-15）；AgentTab 明确提示 |
| nomic-embed-text 未装 | 双路真验受阻 | 架构+单测覆盖向量路径；未装降级仅 FTS5（KB-03 验收降级为关键词）；现场按需 pull 后真验 |
| DeepSeek key 缺失 | 远程函数调用无法活验 | 设 DEEPSEEK_API_KEY 或设置面板录入（safeStorage 加密）；E2E 全 mock weaveMD.ai 不上网 |
| FTS5 rowid/content 主键映射 | 触发器同步或 MATCH 回查偏差 | 实施期先做个最小 FTS5 冒烟（建虚拟表+触发+BM25 查询）锁定方案；已知两条备选（§2） |
| tool_calls 流式累积时序 | 工具参数截断/卡死 | llmClient 按 index 聚合至 finish；agentLoop 对残缺 tool_call 做失败兜底（不续轮） |
| 意图规则召回率 | 意图分错 | 规则可迭代；模糊给候选提问卡片；升级点预留 |
| 工具循环 token 成本 | 长 Agent 会话费 token/超时 | 轮数上限 6 + 上下文压缩（80% 自动）；llmClient timeout 贯穿流式 |
| 富文本注入 | XSS | 白名单 HAST→React 映射；无 dangerouslySetInnerHTML；单测断言无 script 逃逸 |
| 上下文估算近似 | 压缩触发偏差 | /4 相对阈值判定的指数安全；压缩幂等；不追求 token 精确 |
| 导入目录批量主进程读盘 | 路径安全 | kb:import:dir 只收 folderPath，主进程 fs.readFile；不把任意内容当脚本 |

---

## 附：依赖顺序（实现批次，可并行拆模块）

**起跑线（互不阻塞，先建测试基线，TDD）**
- 批次 1（shared/迁移，地基）：
  1. shared/ai.ts 增类型 + constants 增 IPC_CHANNELS（KB_*/AGENT_* + tool 流事件）
  2. db/index.ts FTS5 虚拟表+触发器迁移；tests/main/db/utilsFloat 编解码 + e2e 存活冒烟
- 批次 2（**A 知识库可独立并跑**）：
  3. embeddingClient + 测试
  4. kbIndexer/debounce reindex + kbSearch（余弦/融合/拒答/置顶）+ kbDao + splitNote 测试
  5. preload kb.* + ipc KB_* 处理器 + ipc.test
- 批次 3（**B Agent 可独立并跑，依赖批次 1 常量/类型**）：
  6. llmClient tools 支持 + agentLoop 循环 + toolRegistry + skillLoader + intentRouter + contextManager + 各测试
  7. consent.ts 扩展 agent+allowSend + consent.test 改；preload/ipc AGENT_RUN + tool 流事件
- 批次 4（**C 渲染侧，依赖批次 2/3 的 preload 契约**）：
  8. aiMarkdown 安全渲染器 + MarkdownMessage + 测试
  9. AgentTab 全功能 + ToolCallTrace + IntentCard + 知识库设置 UI + agentStore 扩展 + 组件测试 + i18n 三文件
- 批次 5（**D 收尾**）：
  10. SettingsModal 'ai' KB 设置项 + 出处 openFile 接线
  11. e2e/ai-agent-panel.spec 扩展 + 全量质量门禁（§7）+ 文档同步（模块 §4/§7、SUMMARY、CLAUDE.md 更新为第 3+4 期交付）

> **并行核心**：批次 2（A KB）与批次 3（B Agent）在批次 1 常量/类型就绪后可双智能体并行（零交叉依赖，仅共享 shared 类型与 db 迁移已锁定）。批次 4 需批次 2/3 的 preload 契约落定。批次 1 必须先于所有。
