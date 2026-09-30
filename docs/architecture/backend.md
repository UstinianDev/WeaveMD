# 主进程架构

> 最后更新：2026-10-01

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron | ^31 |
| 构建工具 | Vite | ^5 |
| 打包 | Electron Builder | - |
| 数据库 | better-sqlite3 | ^11 |
| AI 后端 | 远程 OpenAI 兼容 **或** Anthropic（按 `ai_config.protocol` 分流） | remote-only |
| 分词 | jieba-wasm | - |
| 全文检索 | SQLite FTS5 | - |

## 目录结构

```
src/main/
├── index.ts                   # Electron 入口
├── window.ts                  # 窗口创建与管理
├── preload.ts                 # contextBridge API 暴露
├── ipc-handlers.ts            # IPC 处理器注册入口
├── media-protocol.ts          # media:// 本地图协议
├── mediaMime.ts               # 项目唯一 MIME 映射表
├── db/                        # 数据访问层
│   ├── index.ts               # 数据库初始化 + 连接管理 + D1~D8 迁移 + agent_memory 5 个追加式迁移
│   ├── files.ts               # 文件 CRUD
│   ├── ai.ts                  # AI 会话/消息 DAO
│   ├── agentMemory.ts         # 记忆 DAO（agent_memory / agent_memory_fts 相似候选 / 向量读写）
│   ├── attachments.ts         # 附件解析产物 DAO
│   ├── searchConfig.ts        # 搜索配置 DAO
│   ├── embeddingConfig.ts     # Embedding 配置 DAO
│   └── ...
├── ai/                        # AI 服务层
│   ├── llm/                   # LLM 客户端（按 ai_config.protocol 分流）
│   │   ├── llmClient.ts       # OpenAI 兼容：SSE 流式调用 + tools 支持
│   │   ├── anthropicClient.ts # Anthropic：/v1/messages + cache_control 断点（无 tools）
│   │   ├── anthropicCompat.ts # Anthropic 响应 → OpenAI chunk 形状归一
│   │   ├── streamScaffold.ts  # 两条客户端共享的 abort/timeout/finalize
│   │   └── modelList.ts       # 模型列表
│   ├── agent/                 # Agent 核心
│   │   ├── agentLoop.ts       # 函数调用循环（按意图 6~12 轮）
│   │   ├── agentLoopGuard.ts  # 死循环检测
│   │   ├── agentSession.ts    # 会话管理
│   │   ├── agentTaskQueue.ts  # 任务队列
│   │   ├── agentTaskWorker.ts # 后台任务执行器
│   │   ├── agentContext.ts    # 上下文组装（附件清单 / vision 判定 / 外发闸 / 记忆画像·经验块）
│   │   ├── memoryWriter.ts    # 后台记忆提取（队列类型 memory_extract）
│   │   ├── memoryPolicy.ts    # 记忆策略（merge → evict → capacity，不写 SQL）
│   │   └── agentEventStore.ts # 事件持久化
│   ├── knowledge/             # 知识库
│   │   ├── kbIndexer.ts       # 导入/分块/增量重索引
│   │   ├── kbSearch.ts        # FTS5 关键词召回
│   │   └── embeddingClient.ts # Embedding 客户端
│   ├── files/                 # 文档解析与附件读取
│   │   ├── documentParser.ts  # 7 格式解析入口（PDF 走 @llamaindex/liteparse）
│   │   ├── multimodalParse.ts # 复杂版面远程多模态截图
│   │   ├── pdfLayout.ts       # PDF 坐标版面还原
│   │   └── mdImageResolver.ts # md 相对路径图片基准与越界拦截
│   ├── tools/                 # 工具处理器（30 个）
│   │   ├── webSearch.ts       # web_search 联网搜索
│   │   ├── webSearchHandler.ts
│   │   ├── searchKBHandler.ts
│   │   ├── searchDocument.ts  # 附件正文检索（B8）
│   │   ├── memoryRead.ts      # memory_read 读记忆（C1）
│   │   ├── memoryWrite.ts     # memory_write 写记忆（C1）
│   │   ├── createFileHandler.ts
│   │   ├── editLocalFileHandler.ts
│   │   ├── deleteLocalFile.ts
│   │   └── ...
│   ├── toolRegistry.ts        # 工具注册表（handlerMap + CORE_TOOLS）
│   ├── toolTypes.ts           # 工具类型定义
│   ├── intentRouter.ts        # 意图路由（规则启发式）
│   ├── contextManager.ts      # 上下文压缩
│   ├── skills/                # Skills 体系（目录即 `src/main/ai/skills/`）
│   │   ├── skillLoader.ts     # 加载 + `_auto/` 模式 3 + `status` 过滤（草稿不进 prompt）
│   │   ├── skillPaths.ts      # 默认技能目录推导（`userData/skills`）
│   │   ├── skillAutoStore.ts  # 提炼草稿读写与双闸（正则 + 路径前缀）
│   │   ├── skillDistiller.ts  # 后台提炼任务（队列类型 skill_distill）
│   │   ├── skillManager.ts    # 技能管理（3 处 loadSkills 传目录）
│   │   └── skillInstaller.ts  # 技能安装
│   ├── searchClient.ts        # 多引擎搜索客户端
│   ├── secureConfig.ts        # safeStorage 加密/解密
│   ├── consent.ts             # 外发同意闸（needsKbSendConsent）
│   └── ipc/                   # IPC handler 按域拆分（13 个 handler 模块 + index + shared）
│       ├── index.ts / shared.ts
│       ├── agentHandlers.ts   # Agent 运行、附件落库、citation 回链
│       ├── chatHandlers.ts    # Chat 载荷（渲染层零调用方）
│       ├── kbHandlers.ts      # 知识库索引 / 解析 / 导入
│       ├── embeddingHandlers.ts + embeddingConfigHandlers.ts
│       ├── modelHandlers.ts + modelConfigHandlers.ts
│       ├── searchHandlers.ts + searchConfigHandlers.ts
│       ├── rewriteHandlers.ts + configConsentHandlers.ts
│       ├── memoryHandlers.ts   # 自动记忆列表/删除 + 相似合并三态审核（ai:memory:*）
│       └── skillDraftHandlers.ts # 提炼技能草稿列/采纳/驳回（ai:skilldraft:*）
└── shared/                    # 跨进程共享类型
    └── ai.ts                  # AI 相关类型定义
```

## AI Agent 架构

### 工具系统

工具注册表 `toolRegistry.ts`（`handlerMap`）维护 **30 个工具**（5 核心 + 25 延迟加载）：

| 类别 | 工具 | 说明 |
|------|------|------|
| 只读 | listFiles, readFile, readLocalFile, listLocalDirectory | 文件访问 |
| 只读 | searchKB, web_search, research_search | 检索 |
| 只读 | searchDocument, readPage, extractTable, analyzeChart | 附件文档工具（B8） |
| 只读 | analyze_folder, check_links, get_task_activity | 辅助 |
| 只读 | memory_read | 读 `agent_memory` 当前有效记忆（kind/subject/keyword 过滤，`user_id` 隔离；传 `hyde:true` 走语义混合召回） |
| 写入 | createFile, createFolder, editLocalFile, deleteLocalFile | 文件操作 |
| 写入 | renameFile, moveFile, deleteFile | 文件重命名/移动/删除（`fileOperations.ts`） |
| 写入 | editBlocks, preview_file_revision, preview_patch_files | 内容修改 |
| 写入 | memory_write | 写 `agent_memory`（upsert，恒 `source='auto'`，同轮去重 + 单轮 10 条自限） |
| 交互 | ask_question_card | 用户提问 |
| 技能 | runSkill, list_skills, get_skill_details | 技能系统 |

### 意图路由

`intentRouter.ts` 规则启发式分类（纯函数，无 LLM 依赖）：

| 意图 | 触发条件 | 可用工具 |
|------|----------|----------|
| chat | 闲聊/通用问题 | 无意图特有工具（仍拿基础区全量：15 个文件/辅助工具 + memory_read / memory_write = 17；`hasSearchConfig` 时再加 web_search / research_search，`hasInteractionSupport` 时加 ask_question_card） |
| rewrite | 修改/润色/删除 | editBlocks + 文件操作 + searchKB |
| create | 写/创作/新建 | createFile + editBlocks + searchKB |
| tech | 代码/技术问题 | 同 create |
| kbQa | 知识库/笔记 | searchKB |
| web | 搜索/网站/URL | web_search + research_search + searchKB |

**强信号加权**：输入含 URL 或"网站"等强信号词时，web 意图得分 ×1.5。

### Agent 循环

`agentLoop.ts` 核心流程：

1. 意图识别 → 工具集确定
2. 系统提示 + 历史消息 + 文档上下文组装
3. LLM 流式调用（带 tools 定义）
4. 工具执行（只读并行 + 写入串行）
5. 结果返回 LLM → 下一轮
6. 按意图最多 6~12 轮（`getRoundsForIntent`，默认 10），死循环检测（相同结果/连续失败）

### 写控制

- `writeMode: auto` — AI 直接执行写操作
- `writeMode: manual` — 弹确认卡片（红删绿增预览）
- AI 写入必经确认：preview → 用户确认 → `updateContent` 入 undo 栈

### 搜索配置

`web_search` 工具可用性检查：

1. 从 `ai_search_config` 表读取配置
2. 检查 `enabled` 和 API key
3. 未配置时不注入 `web_search`（避免 LLM 调用注定失败的工具）
4. 已配置时对所有非 chat 意图可用（Agentic RAG 模式）

## IPC 通信

119 个通道常量，按域拆分为 11 组（`src/shared/constants.ts` 的 `IPC_CHANNELS`）：

| 组 | 通道数 | 说明 |
|----|--------|------|
| AI | 72 | Agent 循环 / 工具 / 知识库 / 配置 / 记忆 / 提炼草稿 / 事件推送（27 个子域注释块） |
| 文件与历史 | 16 | 文件 CRUD、历史、目录、导出 |
| 认证与账号 | 6 | 登录 / 注册 / Token / 多账号 |
| 应用与更新 | 6 | 版本检测、更新、通知 |
| 窗口 | 5 | 最大化 / 最小化 / 关闭 |
| 对话框 | 5 | 打开 / 保存 / 上传文件选择 |
| 邮件 | 4 | 问题反馈邮件 |
| 设置 | 2 | 配置读写 |
| 剪贴板 / 链接 / 通知 | 3 | 剪贴板、外链、系统通知 |

> 通道数与分组以 `IPC_CHANNELS` 常量为准；本页表格为聚合视图（合计 119）。
> agent-memory-optimize 新增 8 条：`ai:memory:list` / `ai:memory:delete`（第二批 C3）、
> `ai:memory:similar:list|accept|reject`（第三批 D5）、`ai:skilldraft:list|approve|reject`（第三批 D3）。

## 安全规则

- 所有 SQL 参数化查询（`?` 占位符）
- API key 使用 `safeStorage` 加密存储
- 系统关键路径黑名单（deleteLocalFile）
- 禁止删除测试、削弱认证、暴露内部服务
