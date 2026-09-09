# 主进程架构

> 最后更新：2026-09-09

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron | ^31 |
| 构建工具 | Vite | ^5 |
| 打包 | Electron Builder | - |
| 数据库 | better-sqlite3 | ^11 |
| AI 后端 | 远程 OpenAI 兼容 API | remote-only |
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
├── db/                        # 数据访问层
│   ├── index.ts               # 数据库初始化 + 连接管理
│   ├── files.ts               # 文件 CRUD
│   ├── ai.ts                  # AI 会话/消息 DAO
│   ├── searchConfig.ts        # 搜索配置 DAO
│   ├── embeddingConfig.ts     # Embedding 配置 DAO
│   └── ...
├── ai/                        # AI 服务层
│   ├── llm/                   # LLM 客户端
│   │   ├── llmClient.ts       # SSE 流式调用 + tools 支持
│   │   └── modelList.ts       # 模型列表
│   ├── agent/                 # Agent 核心
│   │   ├── agentLoop.ts       # 函数调用循环（≤12 轮）
│   │   ├── agentLoopGuard.ts  # 死循环检测
│   │   ├── agentSession.ts    # 会话管理
│   │   ├── agentTaskQueue.ts  # 任务队列
│   │   ├── agentTaskWorker.ts # 后台任务执行器
│   │   └── agentEventStore.ts # 事件持久化
│   ├── knowledge/             # 知识库
│   │   ├── kbIndexer.ts       # 导入/分块/增量重索引
│   │   ├── kbSearch.ts        # FTS5 关键词召回
│   │   └── embeddingClient.ts # Embedding 客户端
│   ├── tools/                 # 工具处理器（24+）
│   │   ├── webSearch.ts       # web_search 联网搜索
│   │   ├── webSearchHandler.ts
│   │   ├── searchKBHandler.ts
│   │   ├── createFileHandler.ts
│   │   ├── editLocalFileHandler.ts
│   │   ├── deleteLocalFile.ts
│   │   ├── previewFileRevision.ts
│   │   └── ...
│   ├── toolRegistry.ts        # 工具注册表（handlerMap + CORE_TOOLS）
│   ├── toolTypes.ts           # 工具类型定义
│   ├── intentRouter.ts        # 意图路由（规则启发式）
│   ├── contextManager.ts      # 上下文压缩
│   ├── skillLoader.ts         # Skills 体系
│   ├── searchClient.ts        # 多引擎搜索客户端
│   ├── secureConfig.ts        # safeStorage 加密/解密
│   └── ipc/                   # IPC handler 按域拆分（7 模块）
│       ├── index.ts
│       ├── aiChatIpc.ts
│       ├── aiAgentIpc.ts
│       ├── aiKbIpc.ts
│       └── ...
└── shared/                    # 跨进程共享类型
    └── ai.ts                  # AI 相关类型定义
```

## AI Agent 架构

### 工具系统

工具注册表 `toolRegistry.ts` 维护 24+ 工具：

| 类别 | 工具 | 说明 |
|------|------|------|
| 只读 | listFiles, readFile, readLocalFile, listLocalDirectory | 文件访问 |
| 只读 | searchKB, web_search, research_search | 检索 |
| 只读 | analyze_folder, check_links, get_task_activity | 辅助 |
| 写入 | createFile, createFolder, editLocalFile, deleteLocalFile | 文件操作 |
| 写入 | editBlocks, preview_file_revision, preview_patch_files | 内容修改 |
| 交互 | ask_question_card | 用户提问 |
| 技能 | runSkill, list_skills, get_skill_details | 技能系统 |

### 意图路由

`intentRouter.ts` 规则启发式分类（纯函数，无 LLM 依赖）：

| 意图 | 触发条件 | 可用工具 |
|------|----------|----------|
| chat | 闲聊/通用问题 | 无工具 |
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
6. 最多 12 轮，死循环检测（相同结果/连续失败）

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

80+ 通道，按域拆分为 9 组：

| 组 | 通道数 | 说明 |
|----|--------|------|
| 文件 | ~10 | CRUD + 导入/导出 |
| AI Chat | ~5 | 聊天/模型列表 |
| AI Agent | ~15 | 代理循环/工具/事件 |
| AI KB | ~10 | 知识库索引/搜索 |
| 搜索 | ~5 | 搜索配置/测试 |
| 设置 | ~10 | 配置读写 |
| 窗口 | ~5 | 最大化/最小化/关闭 |
| 认证 | ~5 | 登录/注册/Token |
| 系统 | ~10 | 更新/通知/路径 |

## 安全规则

- 所有 SQL 参数化查询（`?` 占位符）
- API key 使用 `safeStorage` 加密存储
- 系统关键路径黑名单（deleteLocalFile）
- 禁止删除测试、削弱认证、暴露内部服务
