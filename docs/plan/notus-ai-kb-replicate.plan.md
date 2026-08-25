# Notus AI+KB 全功能复刻 — 实施计划

## 一、项目总览

将 Notus 项目的 AI 和知识库全部功能复刻到 WeaveMD。涵盖 42 项功能（P1 15 项 + P2 27 项），分 6 个阶段实施。WeaveMD 保持 Vite + Electron + React 18 + Zustand + Tailwind 架构不变，编辑器 v2 内核不动，所有后端逻辑在 Electron 主进程通过 IPC 通信。

## 二、现有架构确认

### 核心模块分布

| 层次 | 路径 | 职责 |
|------|------|------|
| 共享类型 | `src/shared/ai.ts`, `src/shared/constants.ts` | IPC 载荷/响应类型、IPC 通道常量 |
| 主进程 AI | `src/main/ai/*.ts` | agentLoop / toolRegistry / kbSearch / kbIndexer / searchClient / llmClient / contextManager / skillLoader / agentTaskWorker / agentCheckpoint / agentSnapshot / agentEventStore / agentLoopGuard |
| IPC Handler | `src/main/ai/ipc/*.ts` | configConsent / chat / kb / agent / rewrite / model / embedding / search / modelConfig / embeddingConfig / searchConfig |
| DB DAO | `src/main/db/*.ts` | ai.ts / kb.ts / agentTaskDao / agentSessionDao / agentSnapshotDao / agentEventDao / modelConfigs / embeddingConfig / searchConfig |
| DB Schema | `src/main/db/index.ts` | 建表 + 迁移（含 FTS5 / agent 四表 / 多模型配置 / embedding / search config） |
| 渲染 Store | `src/render/stores/agentStore.ts` | Zustand store -- 对话/消息/工具轨迹/KB/设置 |
| UI 组件 | `src/render/components/AIAgent/*.tsx` | AIAgentPanel / AIPanelComposer / AgentTab / CompletionMenu / ToolCallTrace / QuestionCard / ContextRing 等 |
| Preload | `src/main/preload.ts` | contextBridge API（ai / kb / file / dialog 等） |

### 已有能力清单

- Agent Loop（函数调用循环，remote-only，max 12 轮）
- Tool Registry（listFiles / readFile / searchKB / runSkill / editBlocks / createFile / createFolder / ask_question_card / preview_patch_files / web_search / analyze_folder / check_links / get_task_activity）
- Skill Loader（3 内置 + SKILL.md 扩展）
- Intent Router（6 类意图）
- Context Manager（/4 估算 + 80% 压缩）
- Agent Task Worker（后台队列 + AbortController + 交互暂停恢复）
- LLM Client（远程 OpenAI 兼容 API 流式调用）
- KB DAO + FTS5 虚拟表 + 触发器同步
- KB Indexer（splitNote 分块 + 防抖重嵌入）
- KB Search（FTS5 BM25 召回 + 拒答 0.6 + 出处可跳转）
- Embedding Client（OpenAI 兼容 /embeddings）
- Search Client（Firecrawl / 智谱 / Tavily / Exa 四引擎）
- 多模型配置 CRUD + 激活
- 对话搜索 / 导出 / 消息编辑
- Agent 会话/任务/事件/快照持久化
- 写控制（auto/manual + preview + rollback）

## 三、新增依赖包

| 包名 | 版本 | 用途 | 阶段 |
|------|------|------|------|
| `sqlite-vec` | ^0.1.9 | SQLite 向量搜索扩展 | P1 |
| `@llamaindex/liteparse` | latest | PDF/DOCX 解析 | P1 |
| `mammoth` | latest | DOCX 解析（备用） | P1 |
| `@mozilla/readability` | latest | 网页内容提取 | P2 |
| `cheerio` | latest | HTML 解析 | P2 |
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP 客户端 | P2 |
| `sharp` 或 `jimp` | latest | 图片处理/缩略图 | P2 |

注意：`@tavily/core`、`exa-js`、`firecrawl` 等搜索 SDK 已有 `searchClient.ts` 直接 fetch 实现，不需要额外引入 SDK 包。

## 四、分阶段实施计划

---

### 阶段 1：数据库迁移 + 向量搜索恢复 + 文档解析基建

**目标**：为所有后续功能打下数据层基础。

**交付物**：
1. 新增 sqlite-vec 向量搜索能力
2. PDF/DOCX 文档解析能力
3. 数据库新表/列迁移

**变更清单**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `sqlite-vec`, `@llamaindex/liteparse`, `mammoth` |
| `src/main/db/index.ts` | 修改 | 加载 sqlite-vec 扩展；新增迁移函数 |
| `src/main/db/kb.ts` | 修改 | kb_chunks 表新增 `embedding` BLOB 列（替代已有 `vector` 列）；新增 `embedding_model` 列 |
| `src/main/ai/embeddingClient.ts` | 已有 | 确认可用（批量 embedding 调用） |
| `src/main/ai/kbSearch.ts` | 修改 | 恢复向量搜索路径：FTS5 BM25 + sqlite-vec cosine 余弦 + 标题/路径匹配 + 段聚合 + 条件重排 |
| `src/main/ai/kbIndexer.ts` | 修改 | 分块后调 embeddingClient 生成向量，存入 kb_chunks.embedding |
| `src/main/ai/documentParser.ts` | 新增 | PDF 解析（`@llamaindex/liteparse`）、DOCX 解析（`mammoth`）统一接口 |
| `src/shared/ai.ts` | 修改 | 新增 `IDocumentParseResult` 类型 |
| `src/shared/constants.ts` | 修改 | 新增 `KB_PARSE_DOCUMENT` IPC 通道 |
| `src/main/ai/ipc/kbHandlers.ts` | 修改 | 新增 `KB_PARSE_DOCUMENT` handler |
| `src/main/preload.ts` | 修改 | 新增 `kb.parseDocument` API |

**新增数据库迁移**：
```sql
-- kb_documents 新增 file_path 列（供标题/路径匹配检索）
ALTER TABLE kb_documents ADD COLUMN file_path TEXT DEFAULT NULL;
-- kb_chunks 新增 embedding_model 列（记录向量化模型）
ALTER TABLE kb_chunks ADD COLUMN embedding_model TEXT DEFAULT NULL;
```

**验收标准**：
- sqlite-vec 扩展在 Electron 主进程加载成功
- 索引文档时自动生成 embedding 向量并存入 kb_chunks
- searchKB 实现混合检索：FTS5 BM25 + 向量余弦 + 标题匹配，三路融合排序
- PDF/DOCX 文件可解析为纯文本
- 现有 FTS5 检索功能不受影响
- `tsc --noEmit` 零错误

---

### 阶段 2：P1 核心功能 — Agent 增强 + 文件操作 + 全局 Agent 文件

**目标**：实现 P1 中 Agent 核心增强（A1/A2/A6）、文件操作扩展（F3/F5）、对话管理（C1/C3/C4）。

**交付物**：
1. @ mention 系统扩展：文件/目录引用（A2）
2. Agent 输入源多样化：图片/附件/URL（A6）
3. Agent 完整文件操作：rename/move/delete（F3）
4. 全局 Agent 文件：soul.md / memory.md / style.md（F5）
5. 对话搜索 UI（C1）
6. 对话图片/附件支持（C3/C4）

**变更清单**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/shared/ai.ts` | 修改 | 新增 `IMentionItem`、`IAttachmentPayload`、`IImagePayload`、`IAgentFileOp` 类型 |
| `src/shared/constants.ts` | 修改 | 新增 IPC 通道：`AGENT_FILE_RENAME`、`AGENT_FILE_MOVE`、`AGENT_FILE_DELETE`、`AGENT_GLOBAL_FILES`、`AGENT_UPLOAD_ATTACHMENT`、`AGENT_UPLOAD_IMAGE` |
| `src/main/ai/tools/fileOperations.ts` | 新增 | renameFile / moveFile / deleteFile 工具实现（proposal 模式） |
| `src/main/ai/tools/attachmentParser.ts` | 新增 | 附件解析：调用 documentParser 解析 PDF/DOCX/MD/TXT 为文本 |
| `src/main/ai/tools/imageHandler.ts` | 新增 | 图片处理：base64 编码 + 视觉分析（多模态 LLM） |
| `src/main/ai/tools/urlFetcher.ts` | 新增 | URL 内容抓取：fetch URL + Readability 提取正文 |
| `src/main/ai/toolRegistry.ts` | 修改 | 注册新工具：renameFile / moveFile / deleteFile / attachFile / attachImage / fetchUrl |
| `src/main/ai/agentLoop.ts` | 修改 | toolsForIntent 扩展 |
| `src/main/ai/globalAgentFiles.ts` | 新增 | soul.md / memory.md / style.md 管理 |
| `src/main/ai/ipc/agentHandlers.ts` | 修改 | 新增文件操作/全局文件/附件上传 IPC handlers |
| `src/main/preload.ts` | 修改 | 新增 preload API |
| `src/render/stores/agentStore.ts` | 修改 | 新增 mentionItems / attachments / images 状态 |
| `src/render/components/AIAgent/MentionList.tsx` | 新增 | @ mention 列表组件 |
| `src/render/components/AIAgent/MentionItem.tsx` | 新增 | 单条 mention 项展示 |
| `src/render/components/AIAgent/MentionPreviewDialog.tsx` | 新增 | mention 预览弹窗 |
| `src/render/components/AIAgent/AttachmentPreview.tsx` | 新增 | 附件预览卡片 |
| `src/render/components/AIAgent/ImagePreview.tsx` | 新增 | 图片预览卡片 |
| `src/render/components/AIAgent/AIPanelComposer.tsx` | 修改 | @ 补全迁移到 MentionList；支持粘贴图片/拖拽附件 |
| `src/render/components/AIAgent/AIPanelHome.tsx` | 修改 | 新增对话搜索输入框 |
| `src/render/components/AIAgent/ConversationDrawer.tsx` | 新增 | 对话列表抽屉 |
| `src/render/components/AIAgent/FileOpProposalCard.tsx` | 新增 | 文件操作提案卡片 |
| `src/main/ai/ipc/chatHandlers.ts` | 修改 | 新增对话搜索 handler |

**验收标准**：
- 输入 `@` 弹出文件/目录/技能三维补全列表
- 粘贴图片可发送到 AI 进行视觉分析
- 拖拽/选择 PDF/DOCX 附件可解析并作为上下文发送
- AI 调用 renameFile/moveFile/deleteFile 时弹出确认卡片
- 全局文件（soul.md/memory.md/style.md）可读写
- 对话列表支持按标题/内容搜索
- `tsc --noEmit` 零错误，现有测试全绿

---

### 阶段 3：P1 搜索 + 设置 UI + 知识库混合检索完善

**目标**：实现 P1 搜索相关（S1/S3）、设置 UI、完善混合检索（K1）。

**交付物**：
1. 多搜索提供商配置管理 UI（S3）
2. 搜索提供商在 Agent 中可切换使用（S1）
3. 混合检索完善：标题/路径匹配 + 段聚合 + 条件重排（K1）

**变更清单**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/ai/kbSearch.ts` | 修改 | 新增标题/路径匹配分数；段聚合；条件重排 |
| `src/render/components/AIAgent/settings/SearchSettings.tsx` | 已有 | 增强 UI：提供商切换、API Key 配置、测试连接 |
| `src/render/components/AIAgent/settings/KnowledgeBaseSettings.tsx` | 已有 | 增强：向量索引状态、混合检索参数调节 |
| `src/render/components/AIAgent/AIPanelComposer.tsx` | 修改 | 联网搜索 toggle 增强为提供商下拉选择 |

**验收标准**：
- 搜索设置面板可配置 Firecrawl/Tavily/Exa/智谱 API Key
- 切换搜索提供商后 Agent web_search 工具自动使用新提供商
- KB 混合检索质量提升
- `tsc --noEmit` 零错误

---

### 阶段 4：P2 Agent 增强 — 研究模式 + 执行可视化 + 变更集 + 工具策略

**交付物**：
1. Agent 研究模式（多搜索查询自动规划）（A3）
2. Agent 执行段可视化（A4）
3. Agent 任务变更集（A5）
4. Agent 工具策略（A7）
5. Agent 资源上下文增强（A10）
6. Agent 媒体处理（A11）
7. Agent 控制面板 UI（A12）

**变更清单**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/ai/queryPlanner.ts` | 新增 | 研究模式：将用户查询拆分为多个子查询 |
| `src/main/ai/agentResearch.ts` | 新增 | 研究模式执行器 |
| `src/main/ai/agentExecutionSegments.ts` | 新增 | 执行段跟踪 |
| `src/main/ai/agentChangeSets.ts` | 新增 | 变更集跟踪 |
| `src/main/ai/agentToolPolicy.ts` | 新增 | 工具策略 |
| `src/main/ai/agentResourceContext.ts` | 新增 | 资源上下文 |
| `src/main/ai/agentMedia.ts` | 新增 | 媒体处理 |
| `src/main/ai/agentLoop.ts` | 修改 | 集成研究模式 + 执行段跟踪 |
| `src/main/ai/toolRegistry.ts` | 修改 | 新增 research_search 工具 |
| `src/render/components/AIAgent/ExecutionSegments.tsx` | 新增 | 执行段可视化 |
| `src/render/components/AIAgent/ChangeSets.tsx` | 新增 | 变更集展示 |
| `src/render/components/AIAgent/AgentControlPanel.tsx` | 新增 | Agent 控制面板 |
| `src/render/components/AIAgent/AgentWorkspace.tsx` | 新增 | Agent 工作区视图 |

---

### 阶段 5：P2 知识库增强 + 对话管理 + 文件操作 + MCP/Skills

**交付物**：
1. 知识澄清 + 查询规划器 + 辅助缓存 + 增量索引 + 运行时
2. 对话导出 JSON + URL 抓取 + 图片资产持久化
3. 文件修订历史 + diff 查看 + 文件系统补丁 + 工作区文档管理
4. MCP 管理 + Skills 安装增强 + Skills 管理 UI

**变更清单**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/ai/knowledgeClarify.ts` | 新增 | 检索结果不足时的澄清提问 |
| `src/main/ai/knowledgeHelperCache.ts` | 新增 | 研究结果缓存 |
| `src/main/ai/knowledgeRuntime.ts` | 新增 | 知识库运行时上下文 |
| `src/main/ai/fileRevisions.ts` | 新增 | 文件修订历史 |
| `src/main/ai/fileRevisionDiff.ts` | 新增 | 文件修订差异 |
| `src/main/ai/fileSystemPatches.ts` | 新增 | 批量文件操作补丁 |
| `src/main/ai/workspaceDocuments.ts` | 新增 | 工作区文档上下文 |
| `src/main/ai/mcpClient.ts` | 新增 | MCP 客户端 |
| `src/main/ai/skillInstaller.ts` | 新增 | Skills 安装器 |
| `src/main/ai/skillManager.ts` | 新增 | Skills 管理器 |
| `src/main/db/fileRevisions.ts` | 新增 | file_revisions 表 DAO |
| `src/main/db/knowledgeCache.ts` | 新增 | knowledge_cache 表 DAO |
| `src/render/components/AIAgent/ClarifyDrawer.tsx` | 新增 | 知识澄清抽屉 |
| `src/render/components/AIAgent/FileRevisionDiffDialog.tsx` | 新增 | 文件修订 diff 弹窗 |
| `src/render/components/AIAgent/RetryPreviewCard.tsx` | 新增 | 重试预览卡片 |
| `src/render/components/AIAgent/BatchOperationCard.tsx` | 新增 | 批量操作卡片 |
| `src/render/components/AIAgent/settings/McpPanel.tsx` | 已有 | 增强 MCP 管理 UI |
| `src/render/components/AIAgent/settings/SkillsPanel.tsx` | 已有 | 增强 Skills 管理 UI |

**新增数据库迁移**：
```sql
CREATE TABLE IF NOT EXISTS file_revisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS knowledge_cache (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  results_json TEXT NOT NULL,
  hit_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE TABLE IF NOT EXISTS parsed_attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

### 阶段 6：P2 LLM 管理 + 对象存储 + UI 完善 + 收尾

**交付物**：
1. 模型发现/目录/预算/配置管理/Anthropic 兼容
2. 图片存储配置 + 图片识别（仅本地存储）
3. UI 组件完善

**变更清单**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/ai/modelDiscovery.ts` | 新增 | 模型自动发现 |
| `src/main/ai/modelCatalog.ts` | 新增 | 模型目录管理 |
| `src/main/ai/llmBudget.ts` | 新增 | Token 用量预算控制 |
| `src/main/ai/llmConfigs.ts` | 新增 | LLM 配置管理 |
| `src/main/ai/anthropicCompat.ts` | 新增 | Anthropic API 适配层 |
| `src/main/ai/imageStorage.ts` | 新增 | 本地图片存储管理 |
| `src/main/ai/imageRecognition.ts` | 新增 | 图片识别 |
| `src/main/db/llmBudget.ts` | 新增 | llm_budget 表 DAO |
| `src/main/ai/ipc/llmHandlers.ts` | 新增 | LLM 管理 IPC handlers |
| `src/render/components/AIAgent/AgentLoopLogList.tsx` | 新增 | Agent 循环日志列表 |
| `src/render/components/AIAgent/settings/ModelForm.tsx` | 已有 | 增强：模型发现、目录选择、预算显示 |
| `src/render/components/AIAgent/settings/LlmBudgetPanel.tsx` | 新增 | Token 用量预算设置面板 |

---

## 五、IPC 通道新增汇总

| 通道名 | 类型 | 阶段 |
|--------|------|------|
| `kb:parse-document` | invoke | 1 |
| `agent:file:rename` | invoke | 2 |
| `agent:file:move` | invoke | 2 |
| `agent:file:delete` | invoke | 2 |
| `agent:global-files:get` | invoke | 2 |
| `agent:global-files:set` | invoke | 2 |
| `agent:upload:attachment` | invoke | 2 |
| `agent:upload:image` | invoke | 2 |
| `agent:research:run` | invoke | 4 |
| `agent:execution-segments` | invoke | 4 |
| `agent:change-sets` | invoke | 4 |
| `agent:tool-policy:get` | invoke | 4 |
| `agent:tool-policy:set` | invoke | 4 |
| `kb:clarify` | invoke | 5 |
| `file:revisions:list` | invoke | 5 |
| `file:revisions:diff` | invoke | 5 |
| `mcp:list` | invoke | 5 |
| `mcp:connect` | invoke | 5 |
| `mcp:disconnect` | invoke | 5 |
| `skills:install` | invoke | 5 |
| `skills:toggle` | invoke | 5 |
| `skills:update` | invoke | 5 |
| `llm:budget:get` | invoke | 6 |
| `llm:budget:set` | invoke | 6 |
| `llm:catalog` | invoke | 6 |
| `llm:discover` | invoke | 6 |
| `image:store` | invoke | 6 |
| `image:recognize` | invoke | 6 |

---

## 六、依赖关系和实施顺序

```
阶段 1 (DB + 向量 + 解析)
    |
    v
阶段 2 (P1 Agent 增强 + 文件操作)
    |
    +---> 阶段 3 (P1 搜索 + 设置 UI + 混合检索)
    |
    v
阶段 4 (P2 Agent 高级功能)
    |
    +---> 阶段 5 (P2 KB + 对话 + MCP/Skills)
    |
    v
阶段 6 (P2 LLM + 存储 + UI 收尾)
```

## 七、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| sqlite-vec 在 Electron 原生模块加载失败 | 高 | 提前验证兼容性；备选：纯 JS 向量计算 |
| 向量 embedding 模型不可用 | 中 | 优雅降级：无 embedding 时纯 FTS5 |
| 多模态 LLM 不支持图片输入 | 中 | 降级：图片仅存储不识别 |
| MCP SDK 与 Electron 兼容性 | 中 | Node.js 兼容；stdio 需测试子进程 |
| 数据库迁移失败 | 中 | 幂等设计（IF NOT EXISTS） |
| 42 项功能工期过长 | 中 | P1 优先交付，P2 渐进交付 |

## 八、测试策略

每个阶段交付时需满足：
1. `tsc --noEmit` 零错误
2. `vitest run` 全绿（含新增测试）
3. `eslint` 零警告
4. 手动冒烟测试关键路径

新增测试覆盖：
- `src/main/ai/__tests__/documentParser.test.ts`
- `src/main/ai/__tests__/kbSearch.hybrid.test.ts`
- `src/main/ai/__tests__/queryPlanner.test.ts`
- `src/main/ai/__tests__/agentToolPolicy.test.ts`
- `src/main/ai/__tests__/mcpClient.test.ts`
- `src/main/ai/__tests__/anthropicCompat.test.ts`
- `src/render/components/AIAgent/__tests__/MentionList.test.tsx`
