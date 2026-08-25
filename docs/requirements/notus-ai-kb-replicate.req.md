# Notus AI+KB 全功能复刻 — 需求文档

## 1. 项目背景

将 Notus（https://github.com/dnwwdwd/Notus）的 AI 和知识库相关全部功能复刻到 WeaveMD。
Notus 是 Next.js + Electron 架构，WeaveMD 是 Vite + Electron 架构，前端渲染层完全不同，
但核心业务逻辑可借鉴。目标：**体验完美复刻**。

## 2. 技术栈差异

| 维度 | Notus | WeaveMD |
|------|-------|---------|
| 前端框架 | Next.js 15 + React 19 | Vite + React 18 |
| 编辑器 | TipTap (ProseMirror) | 自研 v2 内核 (marktext/muya) |
| 状态管理 | React Context | Zustand v4 |
| 数据库 | better-sqlite3 (Next.js API Routes) | better-sqlite3 (Electron 主进程) |
| AI 后端 | Next.js API Routes (前后端一体) | Electron 主进程 IPC handlers |
| UI 组件库 | Radix UI + cmdk | Tailwind 自研 |
| 向量搜索 | sqlite-vec | 已移除（仅 FTS5） |
| 构建 | Next.js standalone | Vite + electron-builder |

## 3. WeaveMD 已有能力（可复用）

### 3.1 AI 核心（已交付 1~7 期）
- ✅ Agent Loop（≤6 轮函数调用循环，remote-only）
- ✅ Tool Registry（listFiles / readFile / searchKB / runSkill / editBlocks）
- ✅ Skill Loader（3 内置 + 用户扩展 SKILL.md）
- ✅ Intent Router（6 类 + 候选提问卡片）
- ✅ Context Manager（/4 估算 + 80% 压缩）
- ✅ Agent Task Worker（后台任务执行）
- ✅ LLM Client（远程 API 调用）

### 3.2 知识库（已交付）
- ✅ KB DAO + FTS5 虚拟表 `kb_chunks_fts`
- ✅ KB Indexer（保存防抖重嵌入/删除清理）
- ✅ KB Search（FTS5 BM25 召回 + 拒答 0.6 + 出处可跳转）
- ✅ KB Settings（topK/fuse/threshold/置顶权重持久化）

### 3.3 改写功能（已交付）
- ✅ 选区改写（FloatingToolbar → 面板 composer）
- ✅ 块级编辑协议（EditBlockOp[]）
- ✅ 红删绿增预览（rewriteDiff 行级 LCS）
- ✅ Stale 校验（MD5 哈希检测）

### 3.4 写控制与任务安全（已交付 R1~R7）
- ✅ 写模式切换（auto/manual）
- ✅ 写预览版本对比
- ✅ Agent 交互暂停/恢复（ask_question_card）
- ✅ QuestionCard 组件
- ✅ 事件持久化（persistAndSend + replayFromSeq）
- ✅ IndexedDB 草稿恢复（draftStore.ts）
- ✅ DeadLoopDetector + checkpoint + snapshot + 回滚 UI

### 3.5 AI 面板 UI（已交付）
- ✅ AIAgentPanel 三视图外壳（home / session / settings）
- ✅ AIPanelComposer（模式下拉 + ModelDropdown + handleSendAgent）
- ✅ AgentTab 消息流展示
- ✅ ConsentOverlay / ToolCallTrace / IntentCard / MarkdownMessage
- ✅ KB Settings / ModelForm / SkillsPanel
- ✅ 消息操作栏（hover 复制/编辑/重试 + 响应时间）
- ✅ AI 处理流程状态展示（AIProcessStatus 8 种状态）
- ✅ 底栏上下文指示器（圆环形进度条 + token 估算）

## 4. Notus 功能清单 — 差距分析

### 4.1 Agent 核心 — 需新增/增强

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| A1 | Agent 任务持久化队列（SSE 推送、可恢复 checkpoint） | agentTaskWorker 已有基础，但无 SSE 推送 | 需增加 SSE 事件推送 + 任务队列持久化 | P1 |
| A2 | @ mention 文件/目录/技能系统 | 仅有 @ + 技能补全（B1） | 需扩展 @ 支持文件和目录引用 | P1 |
| A3 | Agent 研究模式（多搜索查询自动规划） | 无 | 需新增 queryPlanner + research 模式 | P2 |
| A4 | Agent 执行段可视化（agentExecutionSegments） | 仅有 ToolCallTrace | 需增强执行过程分段展示 | P2 |
| A5 | Agent 任务变更集（agentTaskChangeSets） | 无 | 需新增文件变更跟踪 | P2 |
| A6 | Agent 输入源多样化（附件/图片/URL/文档） | 仅文本输入 | 需新增附件解析、图片识别、URL 抓取 | P1 |
| A7 | Agent 工具策略（agentToolPolicy） | 无策略控制 | 需新增工具权限策略系统 | P2 |
| A8 | Agent 路径规则（agentPathRules） | 无路径级权限 | 需新增文件路径访问规则 | P3 |
| A9 | Agent 会话清理器（agentSessionCleaner） | 无自动清理 | 需新增过期会话清理 | P3 |
| A10 | Agent 资源上下文（agentResourceContext） | contextManager 有基础 | 需增强资源上下文管理 | P2 |
| A11 | Agent 媒体处理（agentMedia） | 无 | 需新增对话中的媒体处理能力 | P2 |
| A12 | Agent 控制面板（agentControlPlane） | 无 | 需新增任务控制面板 UI | P2 |

### 4.2 知识库 — 需增强

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| K1 | 混合检索（向量 + FTS5 + 标题/路径匹配 + 段聚合 + 条件重排） | 仅 FTS5 | 需恢复向量搜索 + 增加标题/路径匹配 + 重排 | P1 |
| K2 | 知识澄清（knowledgeClarify） | 无 | 需新增检索结果不足时的澄清提问 | P2 |
| K3 | 查询规划器（queryPlanner） | 无 | 需新增多查询自动规划 | P2 |
| K4 | 知识辅助缓存（knowledgeHelperCache） | 无 | 需新增研究结果缓存 | P2 |
| K5 | 文件增量索引（fileIndexing） | kbIndexer 有基础 | 需增强增量索引策略 | P2 |
| K6 | 知识库运行时（knowledgeRuntime） | 无独立运行时 | 需新增知识库运行时上下文管理 | P2 |

### 4.3 对话管理 — 需新增/增强

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| C1 | 对话搜索（按标题/消息内容搜索） | 仅最近 3 条 + 历史列表 | 需新增搜索功能 | P1 |
| C2 | 对话导出 | 无 | 需新增导出为 Markdown/JSON | P2 |
| C3 | 对话中的图片支持（粘贴/上传 + 视觉分析） | 无 | 需新增图片输入能力 | P1 |
| C4 | 对话中的附件支持（PDF/DOCX/MD/TXT） | 无 | 需新增附件解析能力 | P1 |
| C5 | 对话中的 URL 内容抓取 | 仅联网搜索 toggle | 需新增显式 URL 抓取 | P2 |
| C6 | 对话图片资产持久化 | 无 | 需新增图片存储和引用 | P2 |
| C7 | 上下文压缩（contextCompaction） | contextManager 有 /4 估算 + 80% 压缩 | 已有，可复用 | - |

### 4.4 文件操作 — 需新增/增强

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| F1 | 文件修订历史（fileRevisions） | 无 | 需新增文件版本历史 | P2 |
| F2 | 文件修订差异查看（fileRevisionDiff） | 仅有改写 diff | 需新增通用文件 diff 查看 | P2 |
| F3 | Agent 文件操作（创建/修改/重命名/移动） | 仅有 createFile/createFolder proposal | 需扩展为完整文件操作 | P1 |
| F4 | 文件系统补丁（fileSystemPatches） | 无 | 需新增批量文件操作补丁系统 | P2 |
| F5 | 全局 Agent 文件（globalAgentFiles） | 无 | 需新增 soul.md/memory.md/style.md | P1 |
| F6 | 工作区文档管理（workspaceDocuments） | 无 | 需增强工作区文档上下文 | P2 |

### 4.5 搜索 — 需新增

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| S1 | 多搜索提供商（Firecrawl/Tavily/Exa/智谱） | 仅联网搜索 toggle | 需新增多提供商支持 | P1 |
| S2 | 搜索上下文存储（webSearchContextStore） | 无 | 需新增搜索结果缓存 | P2 |
| S3 | 搜索提供商配置管理 | 无 | 需新增搜索配置 UI | P1 |

### 4.6 MCP/Skills — 需新增/增强

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| M1 | MCP 管理（Streamable HTTP + stdio） | 仅占位 | 需新增 MCP 客户端管理 | P2 |
| M2 | MCP Server 模式（对外暴露笔记工具） | 无 | 需新增 MCP Server | P3 |
| M3 | 外部 MCP Token 管理 | 无 | 需新增 Token 安全管理 | P3 |
| M4 | Skills 安装（本地/Git/ZIP/Agent 草稿） | 仅 SKILL.md 扩展 | 需增强 Skills 安装方式 | P2 |
| M5 | Skills 启用/禁用/更新/重扫 | 无管理 UI | 需新增 Skills 管理界面 | P2 |

### 4.7 对象存储/图片 — 需新增

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| O1 | 多对象存储（阿里 OSS/腾讯 COS/Cloudflare R2/本地） | 仅本地 media:// | 需新增云存储支持 | P2 |
| O2 | 图片识别（imageRecognition） | 无 | 需新增图片视觉分析 | P2 |
| O3 | 图片存储配置（imageStorageProfiles） | 无 | 需新增存储配置管理 | P2 |

### 4.8 LLM 管理 — 需增强

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| L1 | 模型发现（modelDiscovery） | modelList 有基础 | 需增强自动发现能力 | P2 |
| L2 | 模型目录（modelCatalog） | 无 | 需新增模型目录管理 | P2 |
| L3 | LLM 预算控制（llmBudget） | 无 | 需新增 Token 用量预算 | P2 |
| L4 | LLM 配置管理（llmConfigs） | ModelForm 有基础 | 需增强多配置管理 | P2 |
| L5 | Anthropic 兼容层（anthropicCompat） | 无 | 需新增 Anthropic API 适配 | P2 |

### 4.9 文档解析 — 需新增

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| D1 | PDF 解析 | 无 | 需新增 PDF 内容提取 | P1 |
| D2 | DOCX 解析 | 无 | 需新增 Word 文档解析 | P1 |
| D3 | 网页内容提取（Readability） | 无 | 需新增网页解析 | P2 |
| D4 | 附件存储管理（parsedAttachmentStore） | 无 | 需新增附件存储 | P2 |

### 4.10 UI/UX — 需新增/增强

| # | Notus 功能 | WeaveMD 现状 | 差距 | 优先级 |
|---|-----------|-------------|------|--------|
| U1 | ClarifyDrawer（知识澄清抽屉） | 无 | 需新增 | P2 |
| U2 | ConversationDrawer（对话列表抽屉） | AIPanelHome 有基础 | 需增强搜索+导出 | P1 |
| U3 | FileOperationDiffDialog（文件操作 diff 弹窗） | 仅有改写预览 | 需新增通用 diff 弹窗 | P2 |
| U4 | RetryPreviewCard（重试预览卡片） | 无 | 需新增 | P2 |
| U5 | BatchOperationCard（批量操作卡片） | 无 | 需新增 | P2 |
| U6 | MentionList/MentionItem/MentionPreviewDialog | 仅有 CompletionMenu | 需全面重做 @ 系统 | P1 |
| U7 | AgentWorkspace（Agent 工作区视图） | 无 | 需新增工作区视图 | P2 |
| U8 | AgentLoopLogList（Agent 循环日志列表） | ToolCallTrace 有基础 | 需增强日志展示 | P2 |
| U9 | Canvas 视图（画布式 Agent 交互） | 无 | 需新增画布视图 | P3 |
| U10 | DocumentLabels（文档标签系统） | 无 | 需新增标签管理 | P3 |

## 5. 优先级排序

### P1（核心体验，必须复刻）
A1, A2, A6, K1, C1, C3, C4, F3, F5, S1, S3, D1, D2, U2, U6

### P2（增强体验，重要）
A3, A4, A5, A7, A10, A11, A12, K2, K3, K4, K5, K6, C2, C5, C6, F1, F2, F4, F6, S2, M1, M4, M5, O1, O2, O3, L1, L2, L3, L4, L5, D3, D4, U1, U3, U4, U5, U7, U8

### P3（高级功能，可延后）
A8, A9, M2, M3, U9, U10

## 6. 已对齐问题

### 6.1 架构差异处理
- Notus 用 Next.js API Routes 做后端，WeaveMD 用 Electron 主进程 IPC → **WeaveMD 保持现有架构，所有后端逻辑放主进程**
- Notus 用 TipTap 编辑器，WeaveMD 用自研 v2 内核 → **编辑器不复刻，仅复刻 AI/KB 功能**
- Notus 用 sqlite-vec 做向量搜索 → **WeaveMD 已移除向量搜索，评估是否恢复或用其他方案**

### 6.2 向量搜索决策
- Notus 使用 sqlite-vec 做混合检索（向量 + FTS5 + 标题/路径匹配 + 重排）
- WeaveMD 在后端收敛时移除了 embeddingClient.ts
- **决策**：恢复向量搜索能力，使用 sqlite-vec 或其他轻量方案

### 6.3 范围控制
- 编辑器功能（TipTap 特有的）不复刻
- 登录/认证系统不复刻（Notus 有 login/setup 页面）
- Electron 主进程的文件系统操作可直接复用 WeaveMD 现有的

## 7. 验收标准

1. 所有 P1 功能完整实现并可正常使用
2. AI 面板体验与 Notus 一致（交互流程、动画、布局）
3. 知识库检索质量不低于 Notus（混合检索 + 出处引用）
4. Agent 任务可后台运行、可恢复、可查看历史
5. @ 系统支持文件/目录/技能引用
6. 对话支持图片/附件/URL 输入
7. 多搜索提供商可配置可切换
8. 所有现有测试通过（tsc 0 | vitest 全绿 | lint 0）
9. 新增功能有对应测试覆盖
