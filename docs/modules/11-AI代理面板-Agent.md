# AI 代理面板 (Agent) 功能总结

> 模块编号：11 | 优先级：P1 | 最后更新：2026-08-15 | 状态：**第 1/2 期基建+Chat、第 3+4 期知识库+Agent 能力均已交付；第 5 期块级改写 + 第 6 期收尾为后续**
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）
> 交付记录：第1期基建 + 第2期 Chat 闭环（2026-08-14）、第3期知识库 + 第4期 Agent 能力
> （2026-08-15，详见 docs/plan/ai-agent-panel.status.md）；远程 DeepSeek 后端已真连验证通过；
> 本地 ollama qwen3.5:0.8b 实测故障（无限思考不产 content）

## 1. 功能概述

右侧 AI 面板（顶部导航栏「AI」按钮开合），Chat / Agent 双智能体：

- **Chat**：纯对话——无工具、无知识库、无 @ 文件、无块改写、无意图路由
- **Agent**：辅助创作（第3+4期已交付）——内置 4 只读工具（listFiles/readFile/searchKB/runSkill）+ 3 内置 skills + 用户扩展 + 可选「依照知识库创作」+ 意图识别/提问卡片/上下文压缩/工具调用轨迹 +
  知识库双路召回与出处；⚠️ MCP（context7/firecrawl，第 6 期）与 @ 文件块级改写（第 5 期）为**延期未交付**

两条铁律：**① AI 无直接落盘能力**，写路径必经「红删绿增预览 → 用户确认」；**② 联网/笔记外发必须用户知情同意**。

## 2. 架构位置

```
src/main/ai/                  # AI 主进程服务（第1/2/3/4期已交付）
├── llmClient.ts              # LLM 调用（Ollama 本地 / 远程 OpenAI 兼容 API，SSE 流式 + tools 支持）
├── embeddingClient.ts        # 本地向量化（Ollama /api/embed，nomic-embed-text；未装降级仅 FTS5）
├── kbIndexer.ts              # 知识库导入/分块/嵌入/增量重索引（保存防抖重嵌入、删除清理）
├── kbSearch.ts               # 双路召回（FTS5 BM25 + 向量余弦，0.5/0.5 融合 + 拒答 + 置顶加权）
├── intentRouter.ts           # 意图识别（规则 6 类）+ 候选提问卡片
├── contextManager.ts         # 上下文压缩（/4 估算 + 80% 阈值自动 + 手动）
├── skillLoader.ts            # skills 体系（3 内置 + userData/skills/ 用户扩展）
├── toolRegistry.ts           # 内置只读工具注册（listFiles/readFile/searchKB/runSkill）
├── agentLoop.ts              # 函数调用循环（≤6 轮，仅 remote 可靠；ollama 降级纯 chat）
└── consent.ts                # 知情同意（联网闸 allowNetwork + KB 外发闸 allowSend）
src/render/components/AIAgent/   # 面板 UI（已交付）：ChatTab / AgentTab / ToolCallTrace / IntentCard /
                                 #   MarkdownMessage / KnowledgeBaseSettings / ConsentOverlay
src/render/stores/agentStore.ts  # 会话状态（已交付，agent 模式 + tool 事件 + kbSettings 内存态）
src/main/db/ai.ts / kb.ts        # 会话 CRUD + 知识库 DAO（已交付）
```

> 真 MCP server 管理（context7/firecrawl 的 `mcpManager.ts` 拉起/下载）**本轮未交付**，仅工具调用骨架先行（延期项）。

IPC 通道 `ai:*`（白名单）+ `kb:*` + `agent:*` + 流式 `ai:stream:tool`；密钥经 Electron `safeStorage` 加密存 SQLite，网络请求全走主进程，密钥不落渲染进程。

## 3. 关键设计决策

| 维度 | 决策 |
| ---- | ---- |
| LLM 后端 | 双支持：默认本地 Ollama，可选远程 OpenAI 兼容 API（设置配置）；见 AGT-04 |
| 知识库 | ✅ = 账号内全部笔记（files 表 user_id 过滤 + 软删排除）+ 导入 md/txt 文档统一索引（kb DAO + FTS5 虚拟表 kb_chunks_fts + 触发器）；置顶 = 文件级开关（召回 ×1.5，实际落地为 KB 参数内存态）；@ 文件 = 文件树当前目录的 .md（第 5 期块级改写） |
| 双路召回 | ✅ FTS5(BM25) + 本地向量余弦 0.5/0.5 融合，top-k 默认 5；低于拒答阈值（默认 0.6）拒答不生成答案；CJK 连续中文字符匹配注意（FTS5 unicode61：连续 CJK 视为单 token） |
| 出处 | ✅ 每条回答附「[来源: 文件名 · 块]」，点击 openFile 打开文档（尽力按行滚动，比例近似接线） |
| 导入 | ✅ md/txt（单文件 + 目录批量，主进程读盘），进 SQLite 按账号隔离；pdf/docx 后续（需引入解析器） |
| Skills | ✅ 内置 3 个 core skill（润色/缩写/扩写、技术资料整理、知识库问答引导）+ 用户可扩展（`userData/skills/` 下 SKILL.md）；**GitHub 自取 `writing-shape` 延期**，未实施 |
| MCP | ⚠️ **延期**：真 MCP server 进程管理（context7/firecrawl 拉起/下载）本轮未交付；仅工具注册表 + 函数调用循环先行，`fetchContext7`/`fetchFirecrawl` 工具未注册 |
| 块级改写 | ⚠️ **延期（第 5 期）**：定向块编辑协议 + 红删绿增预览均未实施；本轮全部工具只读，**无 editBlocks 写工具** |
| 预览应用 | ⚠️ **延期（第 5 期）**：diff 红删绿增 → 确认后经 `stateToMarkdown` 写入编辑器未实施 |
| 意图识别 | ✅ 规则启发式 6 类（创作/改写、知识库问答、技术资料、网页抓取、闲聊、其他）；模糊 → 候选提问卡片（IntentCard）；工具失败自动兜底降级 |
| 上下文压缩 | ✅ token 估算 = 字符数/4（非精确计分器，仅作相对阈值）；达 80% 自动 + 手动；早期对话合并为「历史摘要」，保留最近 N 轮原文 |
| 工具权限 | ✅ 只读 4 工具（listFiles/readFile/searchKB/runSkill）自动执行；**无写工具**；
  ⚠️ `fetchContext7`/`fetchFirecrawl`（第 6 期 MCP）与 `editBlocks`（第 5 期）未注册 |
| 安全 | ✅ safeStorage 加密密钥；首次联网/外发弹知情同意页（可勾选：允许联网 `allowNetwork` / 允许笔记外发 `allowSend`）；联网与 KB 外发分层闸（consent 'agent' 需两者配合 needsKbSendConsent）；Ollama 未装 -> 引导，语义召回降级仅关键词 |
| 会话 | ✅ Chat/Agent 各自独立会话（mode 区分），SQLite 持久化，按账号隔离，含历史摘要字段 |

> 说明：KB 参数（topK/fuse/threshold/置顶权重/embedding host+model）本轮为**内存态**（agentStore.kbSettings），**持久化到 ai_config 延后**；embedding 双路真实验证依赖本地安装 `nomic-embed-text`（未装则实际走关键词/FTS5 召回）。

## 4. 数据模型（新增表，全部 `user_id` 隔离）

```sql
ai_config(id, user_id UNIQUE, backend /*ollama|remote*/, ollama_base_url, remote_base_url, model,
          api_key_enc /*safeStorage 加密*/, allow_network INTEGER, allow_send INTEGER,
          consent_updated_at, created_at, updated_at)  -- 第1/2期新增：AI 配置与知情同意，按账号隔离
ai_conversations(id, user_id, mode /*chat|agent*/, summary, created_at, updated_at)
ai_messages(id, conversation_id, role /*user|assistant|tool*/, content, refs_json, created_at)
kb_documents(id, user_id, file_id, source_type /*db|disk|import*/, title, pinned, status, created_at)
kb_chunks(id, document_id, seq, content, vector BLOB, source_ref /*文件+块定位*/, created_at)
-- 第3期新增：kb_chunks_fts 虚拟表（USING fts5, tokenize='unicode61 remove_diacritics 2'）+ 两触发器同步
```

索引时机：导入/置顶即时嵌入；**文件保存后防抖异步重嵌入（KB-06，~1200ms）**；删除同步清除向量与 FTS（KB-06）。
索引状态流转：`pending → done → error`（`importing` 为瞬态）。

## 5. 与其他模块的交互

| 模块 | 交互 |
| ---- | ---- |
| 编辑主区 v2 | ⚠️ 块级改写复用块树（markdownToState/stateToMarkdown）+ 选区触发 + 确认写入可撤销，**均属第 5 期延期未实施**；已交付的 KB-04 出处「打开文档」复用 editorStore.openFile |
| 文件管理 | ✅ 知识库检索账号内文件（files 表）；KB-06 保存/删除联动重嵌入与清理 |
| 设置界面 | AI 配置（后端选择、key、阈值、召回融合权重、授权开关）加入设置面板 |
| 数据持久化 | 新增 4 表 + 迁移；safeStorage 加密密钥 |
| IPC | ✅ 新增白名单通道：`ai:*`（第1/2期）+ `kb:*` 6 通道 / `agent:*` 2 通道 / 流式 `ai:stream:tool`（第3+4期） |
| 国际化 | ✅ 面板/提问卡片/同意页/Agent 全功能全量 i18n（en/zh-CN/zh-TW 键集一致） |

## 6. 未决项 / 延期标注（不写成已交付）

- ⚠️ **第 5 期块级改写**（选区触发 / 定向块编辑协议 / 红删绿增预览 / 确认写入）——**后续未交付**；本轮工具全部只读无写工具
- ⚠️ **真 MCP server 管理**（context7/firecrawl 的 `mcpManager.ts` 拉起/下载、`fetchContext7`/`fetchFirecrawl` 工具）——**延期**；仅工具注册表 + 函数调用循环先行
- ⚠️ **GitHub 自取 `writing-shape` 技能**——**延期未实施**；已交付的是 3 个内置 core skill + `userData/skills/` 用户扩展
- ⚠️ **KB 参数持久化**（topK/fuse/threshold/置顶权重/embedding host+model）——本轮为 `agentStore.kbSettings` 内存态，**持久化到 ai_config 延后**
- ⚠️ **embedding 双路真验**——依赖本地安装 `nomic-embed-text`（未装则实际走 FTS5 关键词召回；向量路径以单测覆盖）
- 已解决：FTS5 在 better-sqlite3（Electron SQLite 3.49.2）**实证可用**，kb_chunks_fts 虚拟表 + 触发器已落地

## 7. 分期实施（总策略）

1. ✅ **基建**（第1期，2026-08-14）：DB 迁移（ai_* 4 表 + kb_* 预留）、`ai:*` IPC 骨架、设置面板 AI 配置、知情同意页、导航栏按钮
2. ✅ **Chat 闭环**（第2期，2026-08-14）：llmClient（Ollama/远程 SSE 流式）+ 面板 UI + 会话持久化 → 可对话；远程 DeepSeek 真连验证通过
3. ✅ **知识库**（第3期，2026-08-15）：导入 → kb 表 → FTS5 关键词召回 → embeddingClient（nomic 未装降级）→ 双路召回 + 拒答 + 出处 + 置顶；KB-06 保存防抖重嵌入/删除清理
4. ✅ **Agent 能力**（第4期，2026-08-15)：skills 体系（3 内置 + 用户扩展）+ 工具注册表 + agentLoop 函数调用循环 + 意图识别/提问卡片 + 上下文压缩 + 失败兜底；consent 分层（allowNetwork + allowSend）
5. ⚠️ **块级改写**（第5期，**后续**）：选区触发 + 定向块编辑协议 + 红删绿增预览 + 确认写入——未交付
6. ⚠️ **收尾**（第6期，**后续**）：真 MCP 进程管理、`fetchContext7`/`fetchFirecrawl` 工具、KB 参数持久化、GitHub 自取 skill——未交付（i18n/Vitest/Playwright 已在第3+4期完成）

> 已完成各阶段独立可交付、可验证；需求/技术文档先行更新。第 3+4 期门禁全绿（typecheck 0 error、vitest 82 files/1152 tests、lint 0 error、Playwright ai spec 10/10、vite build）。
