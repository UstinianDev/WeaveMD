# AI 代理面板 (Agent) 功能总结

> 模块编号：11 | 优先级：P1 | 最后更新：2026-08-14 | 状态：**第1/2期已交付（基建 + Chat 闭环）；第3-6期规划**
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）
> 交付记录：2026-08-14 第1期基建 + 第2期 Chat 闭环（详见 docs/plan/ai-agent-panel.status.md）；
> 本地 ollama qwen3.5:0.8b 实测故障（无限思考不产 content），远程 DeepSeek 后端已真连验证通过

## 1. 功能概述

右侧 AI 面板（顶部导航栏「AI」按钮开合），Chat / Agent 双智能体：

- **Chat**：纯对话——无工具、无知识库、无 @ 文件、无块改写、无意图路由
- **Agent**：辅助创作——内置 skills + MCP（context7/firecrawl）+ 可选「依照知识库创作」+ @ 文件块级改写 + 意图识别/上下文压缩/工具调用

两条铁律：**① AI 无直接落盘能力**，写路径必经「红删绿增预览 → 用户确认」；**② 联网/笔记外发必须用户知情同意**。

## 2. 架构位置

```
src/main/ai/                  # AI 主进程服务（规划）
├── llmClient.ts              # LLM 调用（Ollama 本地 / 远程 OpenAI 兼容 API，SSE 流式）
├── embeddingClient.ts        # 本地向量化（Ollama nomic-embed-text / transformers.js）
├── mcpManager.ts             # 拉起 context7/firecrawl MCP server（stdio），工具转 function-calling
├── kbIndexer.ts              # 知识库导入/分块/嵌入/增量重索引
├── kbSearch.ts               # 双路召回（FTS5 BM25 + 向量余弦，0.5/0.5 融合）
├── intentRouter.ts           # 意图识别 + 策略路由 + 提问卡片生成
├── contextManager.ts         # 上下文压缩（80% 阈值自动 + 手动）
├── toolRegistry.ts           # 内置工具注册（只读自动 / 写必确认）
└── consent.ts                # 知情同意记录
src/render/components/AIAgent/   # 面板 UI（规划）：ChatTab / AgentTab / 提问卡片 / diff 预览
src/render/stores/agentStore.ts  # 会话状态（规划）
src/main/db/ai.ts / kb.ts        # 会话与知识库表 CRUD（规划）
```

IPC 通道 `ai:*`（白名单）；密钥经 Electron `safeStorage` 加密存 SQLite，网络请求全走主进程，密钥不落渲染进程。

## 3. 关键设计决策

| 维度 | 决策 |
| ---- | ---- |
| LLM 后端 | 双支持：默认本地 Ollama，可选远程 OpenAI 兼容 API（设置配置）；见 AGT-04 |
| 知识库 | = 账号内全部笔记 + 导入文档统一索引；置顶 = 文件级开关（召回 ×1.5）；@ 文件 = 文件树当前目录的 .md |
| 双路召回 | FTS5(BM25) + 本地向量余弦 0.5/0.5 融合，top-k 默认 5；低于拒答阈值（默认 0.6）拒答不生成答案 |
| 出处 | 每条回答附「[来源: 文件名 · 块]」，点击打开文档并滚动到对应块 |
| 导入 | md/txt（单文件 + 目录批量），进 SQLite 按账号隔离；pdf/docx 二期（需引入解析器） |
| Skills | 内置（skills-creator 等）+ 用户可扩展（SKILL.md 文件式，`userData/skills/`）；「markdown 创作」阶段 3 由 AI 从 GitHub 自取（优先 `writing-shape` / mattpocock/skills），不适用则用内置 skill-creator 制作 |
| MCP | 真 MCP 协议，主进程自动拉起 server（首次联网下载）；离线禁用并提示 |
| 块级改写 | 定向块编辑协议：AI 返回 `[{定位(原文引用/块序号), 新内容}]`，块树精确定位仅替换目标块（其余字节不变），定位失败拒应用；编辑器选区触发为主、@ 文件描述兜底 |
| 预览应用 | diff 红删绿增 → 确认后经 `stateToMarkdown` 写入编辑器（作为一次可撤销编辑） |
| 意图识别 | 5 类意图路由（创作/改写、知识库问答、技术资料、网页抓取、闲聊）；模糊 → 提问卡片（grill-me 深度拷问风，列出候选意图）；工具失败自动兜底降级 |
| 上下文压缩 | token 达 80% 自动 + 手动；早期对话合并为「历史摘要」（同 LLM 一次调用），保留最近 N 轮原文 |
| 工具权限 | 只读（listFiles/readFile/searchKB/fetchContext7/fetchFirecrawl/runSkill）自动执行；写（editBlocks）必经预览确认 |
| 安全 | safeStorage 加密密钥；首次联网/外发弹知情同意页（可勾选：允许联网 / 允许笔记外发）；设置全局开关；Ollama 未装 → 安装引导，语义召回降级仅关键词 |
| 会话 | Chat/Agent 各自独立会话，SQLite 持久化，按账号隔离，含历史摘要字段 |

## 4. 数据模型（新增表，全部 `user_id` 隔离）

```sql
ai_config(id, user_id UNIQUE, backend /*ollama|remote*/, ollama_base_url, remote_base_url, model,
          api_key_enc /*safeStorage 加密*/, allow_network INTEGER, allow_send INTEGER,
          consent_updated_at, created_at, updated_at)  -- 本期(第1/2期)新增：AI 配置与知情同意，按账号隔离
ai_conversations(id, user_id, mode /*chat|agent*/, summary, created_at, updated_at)
ai_messages(id, conversation_id, role /*user|assistant|tool*/, content, refs_json, created_at)
kb_documents(id, user_id, file_id, source_type /*db|disk|import*/, title, pinned, status, created_at)
kb_chunks(id, document_id, seq, content, vector BLOB, source_ref /*文件+块定位*/, created_at)
```

索引时机：导入/置顶即时嵌入；文件保存后防抖异步重嵌入；删除同步清向量。

## 5. 与其他模块的交互

| 模块 | 交互 |
| ---- | ---- |
| 编辑主区 v2 | @ 文件定位、块级改写复用块树（markdownToState/stateToMarkdown）；选区触发入口；确认后写入可撤销 |
| 文件管理 | 知识库检索账号内文件；文件树当前目录作为 @ 候选 |
| 设置界面 | AI 配置（后端选择、key、阈值、召回融合权重、授权开关）加入设置面板 |
| 数据持久化 | 新增 4 表 + 迁移；safeStorage 加密密钥 |
| IPC | 新增 `ai:*` 白名单通道 |
| 国际化 | 面板/提问卡片/同意页全量 i18n |

## 6. 未决项 / 实施期需验证

- 「markdown 创作」skill：阶段 3 由 AI 从 GitHub 自取，**优先 `writing-shape`**（[mattpocock/skills](https://github.com/mattpocock/skills)，逐段塑文写作流）；
  注意其格式建议含 `> [!TIP]`/`> [!NOTE]` callout，WeaveMD 渲染器不支持，适配为普通引用；
  若 GitHub 无适用则用内置 skill-creator 制作 WeaveMD 原生版
- better-sqlite3 打包是否含 **FTS5** 模块（无则引入全文索引替代方案）
- 本地 embedding 模型首次下载体积与耗时
- MCP server 包（context7/firecrawl）在打包环境下的下载/版本锁定策略

## 7. 分期实施（总策略）

1. **基建**：DB 迁移（4 表）、`ai:*` IPC 骨架、设置面板 AI 配置、知情同意页、导航栏按钮
2. **Chat 闭环**：llmClient（Ollama/远程）+ 面板 UI + 会话持久化 → 可对话
3. **知识库**：导入 → kb 表 → FTS5 关键词召回 → 本地 embedding → 双路召回 + 拒答 + 出处 + 置顶
4. **Agent 能力**：skills 体系（内置 skills-creator；「markdown 创作」AI 自取 `writing-shape`，见 §6）+ MCP manager + 工具注册表 + 意图识别/提问卡片 + 上下文压缩 + 失败兜底
5. **块级改写**：选区触发 + 定向块编辑协议 + 红删绿增预览 + 确认写入
6. **收尾**：离线兜底、i18n、Vitest/Playwright、进度文档同步

> 每阶段独立可交付、可验证；需求/技术文档先行更新。
