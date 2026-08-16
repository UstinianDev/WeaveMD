# AI 代理面板 (Agent) 功能总结

> 模块编号：11 | 优先级：P1 | 最后更新：2026-08-15 | 状态：**第 1/2/3+4/5/6 期均已交付；第 7 期体验重构 ①~⑦（A4/A1/A2+A3/B1/B2/B3/C1）全部交付（2026-08-15）；真 MCP / GitHub 继续延**
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）
> 交付记录：第1期基建 + 第2期 Chat 闭环（2026-08-14）、第3期知识库 + 第4期 Agent 能力
> （2026-08-15，详见 docs/plan/ai-agent-panel.status.md）；远程 DeepSeek 后端已真连验证通过；
> 本地 ollama qwen3.5:0.8b 实测故障（无限思考不产 content）

## 1. 功能概述

右侧 AI 面板（顶部导航栏「AI」按钮开合），Chat / Agent 双智能体：

- **Chat**：纯对话——无工具、无知识库、无 @ 文件、无块改写、无意图路由
- **Agent**：辅助创作（第3+4期已交付）——内置 4 只读工具（listFiles/readFile/searchKB/runSkill）+ **editBlocks（第 6 期 stretch，仅产 proposal 不落盘）** + 3 内置 skills + 用户扩展 + 可选「依照知识库创作」+ 意图识别/提问卡片/上下文压缩/工具调用轨迹 +
  知识库双路召回与出处；⚠️ MCP（context7/firecrawl）为**第 6 期延期未交付**
- **块级改写**（第5期已交付）：编辑器选区触发（FloatingToolbar「AI 改写」→ AI 面板 composer 描述 → 红删绿增预览 → 确认 `updateContent` 一次可撤销）+ 面板 @ 兜底；定向块编辑协议（内部 `EditBlockOp[]`，面板 @ 走编号块 `[{block_index,new_content}]`，定位失败拒应用）；主进程只产 LLM 文本（薄代理），块级替换在渲染侧，**AI 无直接落盘**（写仅确认后）

两条铁律：**① AI 无直接落盘能力**，写路径必经「红删绿增预览 → 用户确认」；**② 联网/笔记外发必须用户知情同意**。

**三视图 UI（2026-08-16 重构）**：面板为 home（主界面：大图标 + RECENT 最近 3 会话，点击进入）/ session（会话标题=第一个问题，标题行 × 关闭；agent 模式复用知识库导入）/ settings（左侧栏 模型·skills·MCP，AI 设置从导航栏设置弹窗迁入模型模块）。composer 底部含 chat/agent 模式下拉 + 模型下拉（`ai.listModels`：ollama `/api/tags`、remote `/models`）。改写失败状态条可 × 关闭。

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
├── toolRegistry.ts           # 内置只读工具注册（listFiles/readFile/searchKB/runSkill + editBlocks 仅产 proposal，第6期 stretch）
├── agentLoop.ts              # 函数调用循环（≤6 轮，仅 remote 可靠；ollama 降级纯 chat）
├── rewrite.ts                # 改写薄 LLM 代理（第5期：consent 'chat' 闸 + 调 LLM 返回 {text}，零 markdown 解析）
├── modelList.ts              # ai.listModels（面板模型下拉数据源）：ollama /api/tags、remote /models（Bearer key 主进程）
└── consent.ts                # 知情同意（联网闸 allowNetwork + KB 外发闸 allowSend）
src/render/components/AIAgent/   # 面板 UI（已交付 + 三视图重构）：AIAgentPanel 三视图外壳（home 主界面 RECENT 最近3 /
                                 #   session 会话 / settings 设置侧栏 模型·skills·MCP，顶部 WeaveMD+新建+⚙+×）/
                                 #   AIPanelComposer（共享 composer：模式下拉 + ModelDropdown + handleSendAgent 分流）/
                                 #   AgentTab 精瘦为消息流展示区 / settings/{ModelForm 迁自 SettingsModal ai Tab, SkillsPanel 只读, McpPanel 延期占位} /
                                 #   ToolCallTrace / IntentCard / MarkdownMessage / KnowledgeBaseSettings /
                                 #   ConsentOverlay / RewritePreviewCard（第5期）/ CompletionMenu（第7期B1）
src/render/editor/rewrite/       # 改写块逻辑（第5期，渲染侧内核所在）：selectionExport.ts（DOM 选区→SelectionRef+片段）/
                                 #   blockEdit.ts（proposal 计算，仅替换目标块，只算不写）
src/render/filters/rewriteDiff.ts  # 行级红删绿增 diff（纯函数，第5期）
src/render/stores/agentStore.ts  # 会话状态（已交付，agent 模式 + tool 事件 + kbSettings 持久化同步 kb:get/setSettings）
src/render/stores/rewriteStore.ts# 改写状态机（第5期：selectionContext/pendingRewrite/applyRewrite stale 校验→updateContent）
src/main/db/ai.ts / kb.ts        # 会话 CRUD + 知识库 DAO（已交付）
```

> 真 MCP server 管理（context7/firecrawl 的 `mcpManager.ts` 拉起/下载）**本轮未交付**，仅工具调用骨架先行（延期项）。

IPC 通道 `ai:*`（白名单）+ `kb:*` + `agent:*` + 流式 `ai:stream:tool`；密钥经 Electron `safeStorage` 加密存 SQLite，网络请求全走主进程，密钥不落渲染进程。

## 3. 关键设计决策

| 维度 | 决策 |
| ---- | ---- |
| LLM 后端 | 双支持：默认本地 Ollama，可选远程 OpenAI 兼容 API（设置配置）；见 AGT-04 |
| 知识库 | ✅ = 账号内全部笔记（files 表 user_id 过滤 + 软删排除）+ 导入 md/txt 文档统一索引（kb DAO + FTS5 虚拟表 kb_chunks_fts + 触发器）；置顶 = 文件级开关（召回 ×1.5）；@ 文件 = 文件树当前目录的 .md（第 5 期块级改写）；**KB 参数（topK/fuse/threshold/置顶权重/embedding host+model）第 6 期已持久化到 ai_config（kb:get/setSettings IPC）** |
| 双路召回 | ✅ FTS5(BM25) + 本地向量余弦 0.5/0.5 融合，top-k 默认 5；低于拒答阈值（默认 0.6）拒答不生成答案；CJK 连续中文字符匹配注意（FTS5 unicode61：连续 CJK 视为单 token） |
| 出处 | ✅ 每条回答附「[来源: 文件名 · 块]」，点击 openFile 打开文档（尽力按行滚动，比例近似接线） |
| 导入 | ✅ md/txt（单文件 + 目录批量，主进程读盘），进 SQLite 按账号隔离；pdf/docx 后续（需引入解析器） |
| Skills | ✅ 内置 3 个 core skill（润色/缩写/扩写、技术资料整理、知识库问答引导）+ 用户可扩展（`userData/skills/` 下 SKILL.md）；**GitHub 自取 `writing-shape` 延期**，未实施 |
| MCP | ⚠️ **延期**：真 MCP server 进程管理（context7/firecrawl 拉起/下载）本轮未交付；仅工具注册表 + 函数调用循环先行，`fetchContext7`/`fetchFirecrawl` 工具未注册 |
| 块级改写 | ✅ **第 5 期已交付**（2026-08-15）：选区触发（编辑器 FloatingToolbar「AI 改写」）+ 面板 @ 兜底（AgentTab composer `@ + 描述`）；定向块编辑协议内部统一 `EditBlockOp[] {blockId,newContent}`（选区=整段替换、面板=编号块 `[{block_index,new_content}]` 映射校验，定位失败 `locateFailed` 拒应用）；主进程只产 LLM 文本（薄代理 `rewrite.ts`），块级替换在渲染侧（`blockEdit.ts`，内核所在） |
| 预览应用 | ✅ **第 5 期已交付**：diff 红删绿增（`rewriteDiff` 行级 LCS）→ 用户确认后才经 `updateContent(rewrittenMd)` 写入编辑器（入 undo 栈一次可撤销）；stale 校验（确认时 content===原文，不一致拒应用） |
| 意图识别 | ✅ 规则启发式 6 类（创作/改写、知识库问答、技术资料、网页抓取、闲聊、其他）；模糊 → 候选提问卡片（IntentCard）；工具失败自动兜底降级 |
| 上下文压缩 | ✅ token 估算 = 字符数/4（非精确计分器，仅作相对阈值）；达 80% 自动 + 手动；早期对话合并为「历史摘要」，保留最近 N 轮原文 |
| 工具权限 | ✅ 只读 4 工具（listFiles/readFile/searchKB/runSkill）+ `editBlocks`（第 6 期 stretch，仅产 proposal 不落盘、无写盘触发点）自动执行；**无真写工具**；
  ⚠️ `fetchContext7`/`fetchFirecrawl`（第 6 期 MCP）未注册 |
| 安全 | ✅ safeStorage 加密密钥；首次联网/外发弹知情同意页（可勾选：允许联网 `allowNetwork` / 允许笔记外发 `allowSend`）；联网与 KB 外发分层闸（consent 'agent' 需两者配合 needsKbSendConsent）；Ollama 未装 -> 引导，语义召回降级仅关键词 |
| 会话 | ✅ Chat/Agent 各自独立会话（mode 区分），SQLite 持久化，按账号隔离，含历史摘要字段 |

> 说明：KB 参数（topK/fuse/threshold/置顶权重/embedding host+model）**第 6 期已持久化到 ai_config 表**（6 列幂等迁移，`pragma_table_info` 探测 + 逐列 ADD；agentStore.kbSettings 由 `kb:get-settings`/`kb:set-settings` IPC 同步；KB_STATUS 探针与 AGENT_RUN 检索兜底均消费持久化值）；embedding 双路真实验证依赖本地安装 `nomic-embed-text`（未装则实际走关键词/FTS5 召回）。

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
| 编辑主区 v2 | ✅ 块级改写（第5期）复用块树（markdownToState/stateToMarkdown/blockTree，渲染侧）+ 选区触发（FloatingToolbar 读 DOM 选区）+ 确认写入 `updateContent` 可撤销；KB-04 出处「打开文档」复用 editorStore.openFile |
| 文件管理 | ✅ 知识库检索账号内文件（files 表）；KB-06 保存/删除联动重嵌入与清理 |
| 设置界面 | AI 配置（后端选择、key、阈值、召回融合权重、授权开关）加入设置面板 |
| 数据持久化 | 新增 4 表 + 迁移；safeStorage 加密密钥 |
| IPC | ✅ 新增白名单通道：`ai:*`（第1/2期）+ `kb:*` 6 通道 / `agent:*` 2 通道 / 流式 `ai:stream:tool`（第3+4期） |
| 国际化 | ✅ 面板/提问卡片/同意页/Agent 全功能全量 i18n（en/zh-CN/zh-TW 键集一致） |

## 6. 未决项 / 延期标注（不写成已交付）

- ✅ **第 5 期块级改写已交付**（2026-08-15）：选区触发 + 面板 @ 兜底 + 定向块编辑协议 + 红删绿增预览 + 确认写入（可撤销）；写路径仍仅确认后写入，AI 无直接落盘（工具全部只读/仅产 proposal，无真写工具）
- ⚠️ **真 MCP server 管理**（context7/firecrawl 的 `mcpManager.ts` 拉起/下载、`fetchContext7`/`fetchFirecrawl` 工具）——**延期**；仅工具注册表 + 函数调用循环先行
- ⚠️ **GitHub 自取 `writing-shape` 技能**——**延期未实施**；已交付的是 3 个内置 core skill + `userData/skills/` 用户扩展
- ✅ **KB 参数持久化已交付**（第 6 期，2026-08-15）：topK/fuse/threshold/置顶权重/embedding host+model → ai_config 6 列幂等迁移 + `kb:get-settings`/`kb:set-settings` IPC + 主进程消费修正（KB_STATUS 探针/AGENT_RUN 兜底），真库三态实证（scripts/kb-migration-smoke.cjs）
- ✅ **stretch editBlocks 已交付**（第 6 期，2026-08-15）：toolRegistry 第 5 个工具 `editBlocks`（`{block_ops:[{block_id,new_content}]}`），`executeTool` 仅产 `{applied:false,proposed}` 不落盘（铁律一）；`currentDocument` 经 AgentRunPayload→ipc→agentLoop→toolCtx 注入（渲染侧 editorStore.content 快照），rewrite 意图 + 有上下文才提供；WRITE_NAMES 断言改造；不做 block_id 存在性校验（主进程无块树内核，仅结构校验，注释注明）；无应用闭环（第 5 期管线职责）
- ⚠️ **embedding 双路真验**——依赖本地安装 `nomic-embed-text`（未装则实际走 FTS5 关键词召回；向量路径以单测覆盖）
- 已解决：FTS5 在 better-sqlite3（Electron SQLite 3.49.2）**实证可用**，kb_chunks_fts 虚拟表 + 触发器已落地

## 7. 分期实施（总策略）

1. ✅ **基建**（第1期，2026-08-14）：DB 迁移（ai_* 4 表 + kb_* 预留）、`ai:*` IPC 骨架、设置面板 AI 配置、知情同意页、导航栏按钮
2. ✅ **Chat 闭环**（第2期，2026-08-14）：llmClient（Ollama/远程 SSE 流式）+ 面板 UI + 会话持久化 → 可对话；远程 DeepSeek 真连验证通过
3. ✅ **知识库**（第3期，2026-08-15）：导入 → kb 表 → FTS5 关键词召回 → embeddingClient（nomic 未装降级）→ 双路召回 + 拒答 + 出处 + 置顶；KB-06 保存防抖重嵌入/删除清理
4. ✅ **Agent 能力**（第4期，2026-08-15)：skills 体系（3 内置 + 用户扩展）+ 工具注册表 + agentLoop 函数调用循环 + 意图识别/提问卡片 + 上下文压缩 + 失败兜底；consent 分层（allowNetwork + allowSend）
5. ✅ **块级改写**（第5期，2026-08-15 已交付）：选区触发 + 面板 @ 兜底 + 定向块编辑协议 + 红删绿增预览 + 确认写入（可撤销）；主进程只产 LLM 文本、块级替换在渲染侧；e2e 4 用例 + 门禁全绿
6. ✅ **收尾**（第6期，2026-08-15）：**KB 参数持久化已交付**（ai_config 6 列幂等迁移 + `kb:get/setSettings` + 主进程消费修正 + 真库三态实证）+ **stretch `editBlocks` 已交付**（仅产 proposal 不落盘）；真 MCP 进程管理、`fetchContext7`/`fetchFirecrawl` 工具、GitHub 自取 skill 继续延
7. ✅ **第 7 期辅助创作强化**（2026-08-15，批次①~⑦ 全部交付）：A4 选区改写叶序错位修复（`data-block-id` 同时挂容器 div 与叶子 → DOM 序下标偏大；readDocumentSelection 改用 content 解析叶序 = 位置+文本对齐映射，失同步保守 null）、A1 当前文档上下文注入（agentLoop system prompt + estimateTokens 截断）+ 意图补词（优化/整理/美化/改进…）+ 从 0 到 1 整篇写（`proposeFullDocumentRewrite` + `runFullDocumentRewrite`/`previewDocumentFromReply`，预览确认 → updateContent 入 undo；未打开文档拒写引导）、A2 混合类型工具栏（mouseup 弹 AI 改写，隐藏行内格式按钮）、A3 持久选区高亮（`highlight.ts` 纯函数 + `.rewrite-highlight` 纯 CSS overlay 不入 contentEditable，随改写状态清除）、B1 `/ @` 自动补全（`AGENT_SKILLS_LIST` 只读 IPC + `CompletionMenu` ↑↓/Enter/Esc/外部点击）、B2 命名「智能体」（仅文案 + i18n 三文件）、**B3 双 Tab 合并统一单面板 + composer 上下拉「对话/智能体」模式选择**（保留 `activeMode` 域隔离，chat 纯对话 / agent 保专属控件，消息与会话随域切换不串号）、C1 视觉美化（frontend-design + impeccable-skill：字号 ≥13px、composer 收紧、圆角/间距节奏统一、CSS 变量体系，修复 ConsentOverlay 硬编码色）

> 已完成各阶段独立可交付、可验证；需求/技术文档先行更新。第 3+4 期门禁全绿（typecheck 0 error、vitest 82 files/1152 tests、lint 0 error、Playwright ai spec 10/10、vite build）；第 5 期门禁全绿（typecheck 0 error、vitest 88 files/1229 tests、lint 0 error、Playwright ai spec 14/14 含 4 改写用例、vite build）；第 6 期门禁全绿（typecheck 0 error、vitest 90 files/1256 tests、lint 0 error、Playwright ai spec 14/14、vite build + 真库迁移 smoke 退出码 0）；第 7 期门禁全绿（typecheck 0 error、vitest 93 files/1338 tests、lint 0 error、Playwright ai spec 24/24、vite build；全量 e2e 95 passed/5 failed 均为既有 drag-selection RED）。
