# AI 代理面板 (Agent) 功能总结

> 模块编号：11 | 优先级：P1 | 最后更新：2026-10-01
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）

**关联文档（渐进式披露，按需加载）：**

| 文档 | 内容 |
|------|------|
| [ai-panel-features](../specs/ai-panel-features.md) | 7 期分期实施 + 体验优化 + Notus 对齐 + 写控制 + Agentic RAG 交付记录 |
| [ai-agent 架构](../architecture/ai-agent.md) | Agent 循环 / 工具系统 / 意图路由 / 协议分流 |

**分册（渐进式披露，按需加载）：**

| 文档 | 内容 |
|------|------|
| [01-optimization-history](./11-AI代理面板-Agent/01-optimization-history.md) | §3.1 最近优化（agent-md-kb-optimize）+ §3.2 Skills 加载链路、提炼技能与经验注入（memory-3 D3/D4） |
| [02-diff-cards](./11-AI代理面板-Agent/02-diff-cards.md) | §7 Diff 卡片系统（DiffSummaryCard / 薄壳卡片 / DetailModal / staleness） |
| [03-question-cards](./11-AI代理面板-Agent/03-question-cards.md) | §8 提问卡片系统（向导模式 / 分轮澄清 / 意图标记） |
| [04-trigger-and-prompt-rules](./11-AI代理面板-Agent/04-trigger-and-prompt-rules.md) | §9 触发优化 + §10 Emoji 禁令 |

> 本文档保留 §1-§6（功能概述、架构、设计决策、数据模型、模块交互、未决项）；§3.1/§3.2 与 §7-§10 按主题拆为分册，分册正文与原章节逐字一致，原编号不变——正文里的 `§3.1`、`§7`~`§10` 引用按上表到对应分册查找。

---

## 1. 功能概述

右侧 AI 面板（顶部导航栏「AI」按钮开合），**仅 Agent 模式**（Chat 模式已删除）：

- **Agent**：辅助创作——30 个工具（5 核心 + 25 延迟；只读/写入/交互/搜索）+ 3 内置 skills + 用户扩展 + 意图识别/提问卡片/上下文压缩/工具调用轨迹 + 知识库召回（FTS5）与出处
- **块级改写**：AI 面板 composer 输入 `@文档 ` / `@ + 描述` 触发（document scope）→ 红删绿增预览 → 确认 `updateContent` 入 undo 栈
- **Composer 标签**：TipTap contentEditable 实现，`/skill`（蓝色 chip）和 `@file`（绿色 chip）以可视化标签渲染，支持整体选中/删除，@tiptap/suggestion 自动补全
- **AI 标题自动编号**：渲染层自动为 h1-h4 添加编号（h1→中文数字、h2→阿拉伯、h3→层级、h4→带圈），已有编号检测跳过
- **Agentic RAG**：所有非 chat 意图均可自主调用 searchKB（LLM 决定是否检索）
- **HyDE**：假设性文档 embedding 检索（语义匹配更精准）
- **自动记忆**：`memory_read` / `memory_write` 两工具 + 设置页「自动记忆」tab 可见可删 +
  后台 `memory_extract` 增量提取（入 `agent_memory` 16 列）+ 轨迹提炼技能（`skill_distill` → `userData/skills/_auto/`）
  + 记忆画像/经验块注入 system prompt + 相似合并建议三态审核（`ai:memory:similar:*`）

两条铁律：**① AI 写入必经确认**；**② 笔记外发必须用户知情同意**（联网同意已停用，三配置齐全即视为许可）。

**三视图 UI**：home（RECENT 最近 3）/ session（会话）/ settings（设置侧栏）

## 2. 架构位置

```
src/main/ai/                  # AI 主进程服务
├── llm/                      # LLM 客户端（remote-only SSE 流式）
│   ├── llmClient.ts
│   └── modelList.ts
├── agent/                    # Agent 核心
│   ├── agentLoop.ts          # 函数调用循环（按意图 6~12 轮）
│   ├── agentLoopGuard.ts     # 死循环检测
│   ├── agentSession.ts       # 会话管理
│   ├── agentTaskQueue.ts     # 任务队列
│   ├── agentTaskWorker.ts    # 后台任务执行器（含 memory_extract / skill_distill 分流）
│   ├── memoryWriter.ts       # 后台记忆提取（节流 + LLM 结构化 + runMemoryPolicy 清洗）
│   ├── memoryPolicy.ts       # 记忆策略（merge(同 subject) → merge(跨 subject) → evict → capacity）
│   └── agentEventStore.ts    # 事件持久化
├── knowledge/                # 知识库
│   ├── kbIndexer.ts          # 导入/分块/增量重索引
│   ├── kbSearch.ts           # FTS5 关键词召回
│   └── embeddingClient.ts    # Embedding 客户端
├── tools/                    # 工具处理器（30 个）
│   ├── webSearch.ts          # 联网搜索
│   ├── deleteLocalFile.ts    # 本地文件删除
│   ├── previewFileRevision.ts# 全文修订预览
│   ├── memoryRead.ts         # memory_read（可选 hyde:true 走语义混合召回）
│   ├── memoryWrite.ts        # memory_write（同轮去重 + 单轮 10 条自限）
│   └── ...
├── toolRegistry.ts           # 工具注册表
├── intentRouter.ts           # 意图路由（规则启发式 6 类）
├── contextManager.ts         # 上下文压缩
├── skills/                   # Skills 体系（loader/paths/autoStore/distiller/manager/installer）
├── searchClient.ts           # 多引擎搜索客户端
└── ipc/                      # IPC handler 按域拆分（13 个 handler 模块 + index + shared）

src/render/components/AIAgent/   # 面板 UI
├── panel/                      # 三视图外壳
├── cards/                      # QuestionCard 底部滑出面板
└── settings/                   # AI 设置组件

src/render/stores/
├── agentStore.ts               # 会话状态 + 工具轨迹 + 提案
└── rewriteStore.ts             # 改写状态机
```

## 3. 关键设计决策

| 维度 | 决策 |
|------|------|
| LLM 后端 | 仅远程 OpenAI 兼容 API（remote-only，必须填 key） |
| 知识库 | 账号内全部笔记 + 导入 md/txt 文档统一索引（FTS5） |
| 召回 | FTS5 关键词召回 + 拒答阈值 0.6 + 出处可跳转 + 置顶 ×1.5 |
| 意图识别 | 规则启发式 6 类（chat/rewrite/create/tech/kbQa/web） |
| 上下文压缩 | token 估算 = 字符数/4；动态阈值自动触发 |
| 写控制 | writeMode: auto/manual；staleness detection（MD5） |
| 搜索配置 | 未配置时不注入 web_search（避免 LLM 调用失败） |
| 安全 | safeStorage 加密密钥；系统路径黑名单（deleteLocalFile） |

## 4. 数据模型

```sql
ai_config(id, user_id UNIQUE, remote_base_url, model, api_key_enc, write_mode, ...)
ai_conversations(id, user_id, mode, summary, created_at, updated_at)
ai_messages(id, conversation_id, role, content, tool_call_id, tool_calls, created_at)
agent_run_events(id, session_id, conversation_id, seq, event_type, payload_json, created_at)
kb_documents(id, user_id, file_id, source_type, title, pinned, status, created_at)
kb_chunks(id, document_id, seq, content, vector BLOB, embedding_model, source_ref, created_at)
kb_chunks_fts -- FTS5 虚拟表 + 触发器同步（增删改走标准 INSERT/DELETE）
kb_documents_fts -- FTS5 文档级虚拟表 + 触发器同步（D7 同修）
agent_memory(id, user_id, kind, subject, content, source, conversation_id, fingerprint,
             valid_from, valid_to, written_at, access_count, last_read_at,
             vector BLOB, embedding_model, merge_skip)  -- 16 列，Ledger 关闭不删行
agent_memory_fts -- FTS5 虚拟表（trigram，只索引 subject/content）+ ai/ad/au 3 触发器
images_vec -- vec0 虚拟表（仅图片向量）
```

## 5. 与其他模块的交互

| 模块 | 交互 |
|------|------|
| 编辑主区 v2 | 块级改写复用块树 + 面板 `@文档 ` 触发（document scope）+ updateContent 可撤销 |
| 文件管理 | 知识库检索账号内文件 + 保存/删除联动重嵌入 |
| 设置界面 | AI 配置（key/联网/写模式/阈值）加入设置面板；`AgentPersonalityPanel` 第 4 个 tab「自动记忆」（列表 / 单条删除 / 相似合并建议三态审核） |
| 数据持久化 | 27 表（23 实表 + 4 虚拟表，含 `agent_memory` / `agent_memory_fts`）+ safeStorage 加密 |
| IPC | 119 通道（11 组；本模块新增 8 条 `ai:memory:*` / `ai:skilldraft:*`） |

## 6. 未决项 / 延期

- ⚠️ **真 MCP server 管理**（context7/firecrawl）——延期
- ⚠️ **GitHub 自取 `writing-shape` 技能**——延期
- ✅ 其余功能均已交付（详见 [交付记录](../specs/ai-panel-features.md)）

---
