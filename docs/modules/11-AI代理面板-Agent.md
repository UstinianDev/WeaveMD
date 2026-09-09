# AI 代理面板 (Agent) 功能总结

> 模块编号：11 | 优先级：P1 | 最后更新：2026-09-09
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）

**子文档（渐进式披露，按需加载）：**

| 文档 | 内容 |
|------|------|
| [11-Agent-历史实施.md](./11-Agent-历史实施.md) | §7 分期实施 + §8-§9 体验优化 + §10 Notus 克隆 + §11 写控制 + §12 Agentic RAG + §13 优化方案 |

> 本文档保留 §1-§6（功能概述、架构、设计决策、数据模型、模块交互、未决项）。

---

## 1. 功能概述

右侧 AI 面板（顶部导航栏「AI」按钮开合），**仅 Agent 模式**（Chat 模式已删除）：

- **Agent**：辅助创作——24+ 工具（只读/写入/交互/搜索）+ 3 内置 skills + 用户扩展 + 意图识别/提问卡片/上下文压缩/工具调用轨迹 + 知识库召回（FTS5）与出处
- **块级改写**：编辑器选区触发 → AI 面板 composer 描述 → 红删绿增预览 → 确认 `updateContent` 入 undo 栈
- **Composer 标签**：`/skill` 和 `@doc` 在输入框内部显示
- **Agentic RAG**：所有非 chat 意图均可自主调用 searchKB（LLM 决定是否检索）
- **HyDE**：假设性文档 embedding 检索（语义匹配更精准）

两条铁律：**① AI 写入必经确认**；**② 联网/笔记外发必须用户知情同意**。

**三视图 UI**：home（RECENT 最近 3）/ session（会话）/ settings（设置侧栏）

## 2. 架构位置

```
src/main/ai/                  # AI 主进程服务
├── llm/                      # LLM 客户端（remote-only SSE 流式）
│   ├── llmClient.ts
│   └── modelList.ts
├── agent/                    # Agent 核心
│   ├── agentLoop.ts          # 函数调用循环（≤12 轮）
│   ├── agentLoopGuard.ts     # 死循环检测
│   ├── agentSession.ts       # 会话管理
│   ├── agentTaskQueue.ts     # 任务队列
│   ├── agentTaskWorker.ts    # 后台任务执行器
│   └── agentEventStore.ts    # 事件持久化
├── knowledge/                # 知识库
│   ├── kbIndexer.ts          # 导入/分块/增量重索引
│   ├── kbSearch.ts           # FTS5 关键词召回
│   └── embeddingClient.ts    # Embedding 客户端
├── tools/                    # 工具处理器（24+）
│   ├── webSearch.ts          # 联网搜索
│   ├── deleteLocalFile.ts    # 本地文件删除
│   ├── previewFileRevision.ts# 全文修订预览
│   └── ...
├── toolRegistry.ts           # 工具注册表
├── intentRouter.ts           # 意图路由（规则启发式 6 类）
├── contextManager.ts         # 上下文压缩
├── skillLoader.ts            # Skills 体系
├── searchClient.ts           # 多引擎搜索客户端
└── ipc/                      # IPC handler 按域拆分（7 模块）

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
ai_agent_events(id, session_id, conversation_id, seq, event_type, payload, created_at)
kb_documents(id, user_id, file_id, source_type, title, pinned, status, created_at)
kb_chunks(id, document_id, seq, content, source_ref, created_at)
kb_chunks_fts -- FTS5 虚拟表 + 触发器同步
embeddings_vec(id, chunk_id, user_id, embedding BLOB, created_at)
```

## 5. 与其他模块的交互

| 模块 | 交互 |
|------|------|
| 编辑主区 v2 | 块级改写复用块树 + 选区触发 + updateContent 可撤销 |
| 文件管理 | 知识库检索账号内文件 + 保存/删除联动重嵌入 |
| 设置界面 | AI 配置（key/联网/写模式/阈值）加入设置面板 |
| 数据持久化 | 8+ 表 + safeStorage 加密 |
| IPC | 80+ 通道（9 组） |

## 6. 未决项 / 延期

- ⚠️ **真 MCP server 管理**（context7/firecrawl）——延期
- ⚠️ **GitHub 自取 `writing-shape` 技能**——延期
- ✅ 其余功能均已交付（详见 [历史实施记录](./11-Agent-历史实施.md)）
