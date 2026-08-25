# AI 代理面板 (Agent) 功能总结

> 模块编号：11 | 优先级：P1 | 最后更新：2026-08-25 | 状态：**第 1~7 期均已交付；后端收敛 remote-only；Notus Agent 克隆完成（21 项功能）；写控制与任务安全模块 R1~R7 全部完成；真 MCP / GitHub 继续延**
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）
> 交付记录：第1期基建 + 第2期 Chat 闭环（2026-08-14）、第3期知识库 + 第4期 Agent 能力
> （2026-08-15）；远程 DeepSeek 后端已真连验证通过；
> 历史曾试点本地 ollama qwen3.5:0.8b（实测故障：无限思考不产 content），2026-08-16 已彻底去除 ollama、收敛 remote-only

## 1. 功能概述

右侧 AI 面板（顶部导航栏「AI」按钮开合），Chat / Agent 双智能体：

- **Chat**：纯对话——无工具、无知识库、无 @ 文件、无块改写、无意图路由
- **Agent**：辅助创作（第3+4期已交付）——内置 4 只读工具（listFiles/readFile/searchKB/runSkill）+ **editBlocks（第 6 期 stretch，仅产 proposal 不落盘）** + 3 内置 skills + 用户扩展 + 可选「依照知识库创作」+ 意图识别/提问卡片/上下文压缩/工具调用轨迹 +
  知识库召回（仅 FTS5，后端收敛后无向量/双路）与出处；⚠️ MCP（context7/firecrawl）为**第 6 期延期未交付**
- **块级改写**（第5期已交付）：编辑器选区触发（FloatingToolbar「AI 改写」→ AI 面板 composer 描述 → 红删绿增预览 → 确认 `updateContent` 一次可撤销）+ 面板 @ 兜底；定向块编辑协议（内部 `EditBlockOp[]`，面板 @ 走编号块 `[{block_index,new_content}]`，定位失败拒应用）；主进程只产 LLM 文本（薄代理），块级替换在渲染侧，**AI 无直接落盘**（写仅确认后）

两条铁律：**① AI 无直接落盘能力**，写路径必经「红删绿增预览 → 用户确认」；**② 联网/笔记外发必须用户知情同意**。

**三视图 UI（2026-08-16 重构）**：面板为 home（主界面：大图标 + RECENT 最近 3 会话，点击进入）/ session（会话标题=第一个问题，标题行 × 关闭；agent 模式复用知识库导入）/ settings（左侧栏 模型·skills·MCP，AI 设置从导航栏设置弹窗迁入模型模块）。composer 底部含 chat/agent 模式下拉 + 模型下拉（`ai.listModels`：后端恒 remote，取 `/models`）。改写失败状态条可 × 关闭。

## 2. 架构位置

```
src/main/ai/                  # AI 主进程服务（第1/2/3/4/5期已交付 + 2026-08-21 重构）
├── llmClient.ts              # LLM 调用（仅远程 OpenAI 兼容 API，SSE 流式 + tools 支持）
├── kbIndexer.ts              # 知识库导入/分块/增量重索引（保存防抖重嵌入、删除清理）
├── kbSearch.ts               # 关键词召回（仅 FTS5 BM25 + 拒答 + 置顶加权；向量召回已去除）
├── intentRouter.ts           # 意图识别（规则 6 类）+ 候选提问卡片
├── contextManager.ts         # 上下文压缩（/4 估算 + 80% 阈值自动 + 手动）
├── skillLoader.ts            # skills 体系（3 内置 + userData/skills/ 用户扩展）
├── toolRegistry.ts           # 内置只读工具注册（listFiles/readFile/searchKB/runSkill + editBlocks 仅产 proposal，第6期 stretch）
├── agentLoop.ts              # 函数调用循环（≤6 轮，后端恒 remote、无降级）
├── rewrite.ts                # 改写薄 LLM 代理（第5期：consent 'chat' 闸 + 调 LLM 返回 {text}，零 markdown 解析）
├── modelList.ts              # ai.listModels（面板模型下拉数据源）：remote /models（Bearer key 主进程）
├── consent.ts                # 知情同意（re-export needsConsent from @shared/ai + needsKbSendConsent）
└── ipc/                      # IPC handler 按域拆分（原 ipc.ts 771 行 → 7 模块）
    ├── index.ts              # 注册入口（registerAiIpcHandlers re-export）
    ├── shared.ts             # 共享工具（toIAIConfig/toIAIConsent/activeStreams/sendStream/默认值）
    ├── configConsentHandlers.ts  # AI 配置 + 知情同意（4 handler）
    ├── chatHandlers.ts       # 对话 CRUD + 流式聊天 + abort（8 handler + runChatFlow）
    ├── kbHandlers.ts         # 知识库导入/检索/设置（8 handler）
    ├── agentHandlers.ts      # Agent 运行/中断/技能列表（3 handler）
    ├── rewriteHandlers.ts    # 改写预览（1 handler）
    └── modelHandlers.ts      # 模型列表（1 handler）
src/render/components/AIAgent/   # 面板 UI（已交付 + 三视图重构）：AIAgentPanel 三视图外壳（home 主界面 RECENT 最近3 /
                                 #   session 会话 / settings 设置侧栏 模型·skills·MCP，顶部 WeaveMD+新建+⚙+×）/
                                 #   AIPanelComposer（共享 composer：模式下拉 + ModelDropdown + handleSendAgent 分流；②草稿提升到 AIAgentPanel 跨视图保留）/
                                 #   AgentTab 精瘦为消息流展示区 / settings/{ModelForm 迁自 SettingsModal ai Tab, SkillsPanel 只读, McpPanel 延期占位} /
                                 #   ToolCallTrace / IntentCard / MarkdownMessage / KnowledgeBaseSettings /
                                 #   ConsentOverlay / RewritePreviewCard（第5期）/ CompletionMenu（第7期B1）
src/render/editor/rewrite/       # 改写块逻辑（第5期，渲染侧内核所在）：selectionExport.ts（DOM 选区→SelectionRef+片段）/
                                 #   blockEdit.ts（proposal 计算，仅替换目标块，只算不写）/ highlight.ts（①选区改写覆盖块整块渐变蓝高亮 + 左端取消胶囊）
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
| LLM 后端 | **仅远程 OpenAI 兼容 API**（后端收敛 remote-only，必须填 key；ollama 已彻底去除）；见 AGT-04 |
| 知识库 | ✅ = 账号内全部笔记（files 表 user_id 过滤 + 软删排除）+ 导入 md/txt 文档统一索引（kb DAO + FTS5 虚拟表 kb_chunks_fts + 触发器）；置顶 = 文件级开关（召回 ×1.5）；@ 文件 = 文件树当前目录的 .md（第 5 期块级改写）；**KB 参数（topK/fuse/threshold/置顶权重）第 6 期已持久化到 ai_config（kb:get/setSettings IPC）** |
| 召回 | ✅ **仅 FTS5 BM25** 关键词召回（后端收敛后向量/embedding 已去除），top-k 默认 5；低于拒答阈值（默认 0.6）拒答不生成答案；CJK 连续中文字符匹配注意（FTS5 unicode61：连续 CJK 视为单 token） |
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
| 安全 | ✅ safeStorage 加密密钥；首次联网/外发弹知情同意页（可勾选：允许联网 `allowNetwork` / 允许笔记外发 `allowSend`）；联网与 KB 外发分层闸（consent 'agent' 需两者配合 needsKbSendConsent）；后端恒 remote、需填 key（无 ollama 降级）；召回仅关键词/FTS5 |
| 会话 | ✅ Chat/Agent 各自独立会话（mode 区分），SQLite 持久化，按账号隔离，含历史摘要字段 |

> 说明：KB 参数（topK/fuse/threshold/置顶权重；embedding host+model 已随向量召回去除）**第 6 期已持久化到 ai_config 表**（幂等迁移，`pragma_table_info` 探测 + 逐列 ADD；agentStore.kbSettings 由 `kb:get-settings`/`kb:set-settings` IPC 同步；KB_STATUS 探针与 AGENT_RUN 检索兜底均消费持久化值）。当前实现召回**仅走关键词/FTS5**，无向量路径。

## 4. 数据模型（新增表，全部 `user_id` 隔离）

```sql
ai_config(id, user_id UNIQUE, backend /*收敛 remote-only；遗留 'ollama' 读取时转 'remote'*/, ollama_base_url /*遗留列保留*/, remote_base_url, model,
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
| 设置界面 | AI 配置（key 与「允许联网」— ④ 当前提供商状态行 + 断开连接、阈值、授权开关）加入设置面板 |
| 数据持久化 | 新增 4 表 + 迁移；safeStorage 加密密钥 |
| IPC | ✅ 新增白名单通道：`ai:*`（第1/2期）+ `kb:*` 6 通道 / `agent:*` 2 通道 / 流式 `ai:stream:tool`（第3+4期） |
| 国际化 | ✅ 面板/提问卡片/同意页/Agent 全功能全量 i18n（en/zh-CN/zh-TW 键集一致） |

## 6. 未决项 / 延期标注（不写成已交付）

- ✅ **第 5 期块级改写已交付**（2026-08-15）：选区触发 + 面板 @ 兜底 + 定向块编辑协议 + 红删绿增预览 + 确认写入（可撤销）；写路径仍仅确认后写入，AI 无直接落盘（工具全部只读/仅产 proposal，无真写工具）
- ⚠️ **真 MCP server 管理**（context7/firecrawl 的 `mcpManager.ts` 拉起/下载、`fetchContext7`/`fetchFirecrawl` 工具）——**延期**；仅工具注册表 + 函数调用循环先行
- ⚠️ **GitHub 自取 `writing-shape` 技能**——**延期未实施**；已交付的是 3 个内置 core skill + `userData/skills/` 用户扩展
- ✅ **KB 参数持久化已交付**（第 6 期，2026-08-15）：topK/fuse/threshold/置顶权重 → ai_config 幂等迁移 + `kb:get-settings`/`kb:set-settings` IPC + 主进程消费修正（KB_STATUS 探针/AGENT_RUN 兜底），真库三态实证（scripts/kb-migration-smoke.cjs）；embedding host+model 参数已随后端收敛去除
- ✅ **stretch editBlocks 已交付**（第 6 期，2026-08-15）：toolRegistry 第 5 个工具 `editBlocks`（`{block_ops:[{block_id,new_content}]}`），`executeTool` 仅产 `{applied:false,proposed}` 不落盘（铁律一）；`currentDocument` 经 AgentRunPayload→ipc→agentLoop→toolCtx 注入（渲染侧 editorStore.content 快照），rewrite 意图 + 有上下文才提供；WRITE_NAMES 断言改造；不做 block_id 存在性校验（主进程无块树内核，仅结构校验，注释注明）；无应用闭环（第 5 期管线职责）
- ~~⚠️ embedding 双路真验~~ ——已随后端收敛 remote-only / 仅 FTS5 去除（embeddingClient 删除，不再有待验向量路径）
- 已解决：FTS5 在 better-sqlite3（Electron SQLite 3.49.2）**实证可用**，kb_chunks_fts 虚拟表 + 触发器已落地

## 7. 分期实施（总策略）

1. ✅ **基建**（第1期，2026-08-14）：DB 迁移（ai_* 4 表 + kb_* 预留）、`ai:*` IPC 骨架、设置面板 AI 配置、知情同意页、导航栏按钮
2. ✅ **Chat 闭环**（第2期，2026-08-14）：llmClient（SSE 流式，当时支持 Ollama/远程，现收敛 remote-only）+ 面板 UI + 会话持久化 → 可对话；远程 DeepSeek 真连验证通过
3. ✅ **知识库**（第3期，2026-08-15）：导入 → kb 表 → FTS5 关键词召回 →（当时 embeddingClient 双路召回，现收敛仅 FTS5、向量已去除）+ 拒答 + 出处 + 置顶；KB-06 保存防抖重嵌入/删除清理
4. ✅ **Agent 能力**（第4期，2026-08-15)：skills 体系（3 内置 + 用户扩展）+ 工具注册表 + agentLoop 函数调用循环 + 意图识别/提问卡片 + 上下文压缩 + 失败兜底；consent 分层（allowNetwork + allowSend）
5. ✅ **块级改写**（第5期，2026-08-15 已交付）：选区触发 + 面板 @ 兜底 + 定向块编辑协议 + 红删绿增预览 + 确认写入（可撤销）；主进程只产 LLM 文本、块级替换在渲染侧；e2e 4 用例 + 门禁全绿
6. ✅ **收尾**（第6期，2026-08-15）：**KB 参数持久化已交付**（ai_config 6 列幂等迁移 + `kb:get/setSettings` + 主进程消费修正 + 真库三态实证）+ **stretch `editBlocks` 已交付**（仅产 proposal 不落盘）；真 MCP 进程管理、`fetchContext7`/`fetchFirecrawl` 工具、GitHub 自取 skill 继续延
7. ✅ **第 7 期辅助创作强化**（2026-08-15，批次①~⑦ 全部交付）：A4 选区改写叶序错位修复（`data-block-id` 同时挂容器 div 与叶子 → DOM 序下标偏大；readDocumentSelection 改用 content 解析叶序 = 位置+文本对齐映射，失同步保守 null）、A1 当前文档上下文注入（agentLoop system prompt + estimateTokens 截断）+ 意图补词（优化/整理/美化/改进…）+ 从 0 到 1 整篇写（`proposeFullDocumentRewrite` + `runFullDocumentRewrite`/`previewDocumentFromReply`，预览确认 → updateContent 入 undo；未打开文档拒写引导）、A2 混合类型工具栏（mouseup 弹 AI 改写，隐藏行内格式按钮）、A3 选区改写 → 覆盖块**整块渐变蓝高亮**（`highlight.ts` 纯函数 + `.rewrite-highlight` 纯 CSS overlay 不入 contentEditable，随改写状态清除）+ **左端取消胶囊**（`.rewrite-cancel-capsule`，定位首高亮块左缘上方，常显可点）、B1 `/ @` 自动补全（`AGENT_SKILLS_LIST` 只读 IPC + `CompletionMenu` ↑↓/Enter/Esc/外部点击）、B2 命名「智能体」（仅文案 + i18n 三文件）、**B3 双 Tab 合并统一单面板 + composer 上下拉「对话/智能体」模式选择**（保留 `activeMode` 域隔离，chat 纯对话 / agent 保专属控件，消息与会话随域切换不串号）、C1 视觉美化（frontend-design + impeccable-skill：字号 ≥13px、composer 收紧、圆角/间距节奏统一、CSS 变量体系，修复 ConsentOverlay 硬编码色）

> 已完成各阶段独立可交付、可验证；需求/技术文档先行更新。第 3+4 期门禁全绿（typecheck 0 error、vitest 82 files/1152 tests、lint 0 error、Playwright ai spec 10/10、vite build）；第 5 期门禁全绿（typecheck 0 error、vitest 88 files/1229 tests、lint 0 error、Playwright ai spec 14/14 含 4 改写用例、vite build）；第 6 期门禁全绿（typecheck 0 error、vitest 90 files/1256 tests、lint 0 error、Playwright ai spec 14/14、vite build + 真库迁移 smoke 退出码 0）；第 7 期门禁全绿（typecheck 0 error、vitest 93 files/1338 tests、lint 0 error、Playwright ai spec 24/24、vite build；全量 e2e 95 passed/5 failed 均为既有 drag-selection RED）。

## 8. 2026-08-16 ai-panel-ux-optimize 变更（后端收敛 remote-only + 体验优化）

> 本任务改动已合并并通过全量门禁；本节仅同步「当前现状/架构」描述，历史过程记录保留在上面各期。

- **③ 彻底去除 ollama**：`ChatBackend` 收敛为 `'remote'`；主进程删 `probeOllama`/AI_HEALTH/`agentBackendHint`/ollama 分支/`embeddingClient.ts`（整文件删，含向量/embedding host+model）；
  KB 降级**仅 FTS5**（删向量召回）；后端固定远程、必须填 key；DB 遗留列保留但读时 `'ollama'`→`'remote'` 收敛
- **④ ModelForm**：API key 与「允许联网」之间新增「当前提供商」状态行 + 断开连接（清 key 即断开 → `hasApiKey=false` → 显示「未配置」）
- **②** composer 草稿提升到 AIAgentPanel 跨视图保留（home/session 共享同一份 draft）
- **①** 选区改写 → 覆盖块**整块渐变蓝高亮**（`.rewrite-highlight` 纯 CSS overlay，不入 contentEditable）+ **左端取消胶囊**（`.rewrite-cancel-capsule`）
- **⑤** AI 面板字号整体放大一档（C1 基础上再放大）
- 门禁：typecheck 0 error | vitest / lint 0 | Playwright 全绿 | vite build

## 9. 2026-08-21 AI 面板体验优化

> 本次调整为纯 UI 优化，无数据模型/IPC/后端变更。门禁全绿（tsc 0 | vitest 1492 | lint 0）。

### 主界面（home）

- **R1 最近会话删除**：每个会话项右侧 🗑 图标，点击 `window.confirm` 确认后删除（`deleteConversation` IPC）
- **R2 历史会话列表**：「View All」切换到 `history` 视图，显示全部会话（updatedAt 倒序），含返回按钮 + 删除功能
- **R3 会话标题栏**：session 视图顶部栏布局 = 会话名（左）+ 🗑（右）+ ✕（右）

### 会话内界面

- **R4 /compact 命令**：输入框支持 `/compact` 或 `/compact <描述>` 触发上下文压缩（`runManualCompress`），替代点击按钮；`CompletionMenu` 补全菜单含 `/compact` 选项；chat/agent 双模式可用
- **R5 上下文指示器**：底栏 ModelDropdown 右侧绿/黄/红圆点 + token 估算数（字符数/4），悬停 `title` 显示 `Token 使用：{used} / {total}`；<50% 绿、50-80% 黄、>80% 红
- **R6 改写消息显示**：选区改写模式下，用户指令作为 `user` 消息加入 `agentStore.messages`（仅 convId 存在时），改写预览卡片作为 AI 回复
- **R7 改写预览格式**：移除整段输出（`renderAIMarkdownSafe`），仅保留 diff（红删绿增）；diff 可折叠（默认展开），字体 13px→15px；新增「AI 改动说明」区域（统计删除/新增行数）

### 编辑主区与目录区

- **R8 字体统一**：`.editor-scroll-container` 和 `.outline-scroll` 的 `font-family` 改为 `Consolas`（英文）+ `KaiTi`/`楷体`/`STKaiti`（中文）+ 系统 fallback；代码块字体不受影响（`--font-code` 独立控制）

### 变更文件

| 文件 | 变更 |
|------|------|
| `AIPanelHome.tsx` | 删除按钮 + history 视图入口 |
| `AIAgentPanel.tsx` | `history` 视图（全量会话列表 + 删除） |
| `AIPanelComposer.tsx` | /compact 命令 + 上下文指示器 + 改写消息入会话 |
| `RewritePreviewCard.tsx` | diff 可折叠 + AI 改动说明 + 移除整段输出 |
| `globals.css` | `.editor-scroll-container` + `.outline-scroll` 字体 |
| `i18n/{en,zh-CN,zh-TW}.json` | 新增 12 个翻译键 |

## 10. Notus Agent 克隆（2026-08-24）

> 深度模仿 Notus 项目的 AI Agent 功能，采用完全替换策略，21 项功能全部实现。

### 核心架构变更

**任务队列系统**：
- `agent_task_queue` 表：SQLite FIFO 队列，同会话串行
- `agentTaskQueue.ts`：入队、出队、supersede 机制
- `agentTaskWorker.ts`：1s 轮询 Worker，后台执行任务

**Session 状态机**：
- `agent_sessions` 表：11 种状态（created/queued/running/waiting_interaction/waiting_operation_confirmation/waiting_limit/waiting_retry/waiting_model_recovery/completed/failed/cancelled/superseded）
- `agentSession.ts`：状态转换验证、DB 持久化

**Checkpoint/Resume 系统**：
- `checkpoint_json` 字段：LLM 调用前/工具执行后保存检查点
- `agentCheckpoint.ts`：序列化/反序列化、断线恢复

**SSE 事件持久化**：
- `agent_run_events` 表：所有事件持久化，支持增量回放
- `agentEventStore.ts`：persistAndSend + replayFromSeq

**文件快照+回滚**：
- `agent_file_snapshots` 表：会话创建时快照所有 .md 文件
- `agentSnapshot.ts`：createSnapshot + rollbackToSnapshot

**死循环检测**：
- `agentLoopGuard.ts`：3x 相同结果 / 2x 连续失败自动终止

### 新增工具（6 个，共 13 个）

| 工具 | 功能 | 类型 |
|------|------|------|
| `ask_question_card` | 结构化提问卡片 | 交互 |
| `preview_patch_files` | 多文件补丁预览 | 预览 |
| `web_search` | 联网搜索（集成 searchClient） | 搜索 |
| `analyze_folder` | 目录结构分析 | 分析 |
| `check_links` | 内部链接检查 | 检查 |
| `get_task_activity` | 任务活动查询 | 查询 |

### 新增 UI 组件

| 组件 | 功能 |
|------|------|
| `ClarifyDrawer` | 结构化提问卡片（多题问答、条件依赖） |
| `PatchPreviewDialog` | 多文件补丁预览（左列表+右 diff） |
| `MentionPreview` | @ 引用预览弹窗（文件/目录/Skill） |

### 新增 IPC 通道

| 通道 | 方向 | 功能 |
|------|------|------|
| `AGENT_TASK_STATUS` | render → main | 查询任务状态 |
| `AGENT_TASK_CANCEL` | render → main | 取消任务 |
| `AI_CONVERSATION_EXPORT` | render → main | 导出对话为 Markdown |
| `AI_CONVERSATION_SEARCH` | render → main | 搜索对话 |
| `AI_MESSAGE_EDIT` | render → main | 编辑消息+级联删除 |

### 文件清单

**新增文件**：
```
src/main/ai/agentSession.ts
src/main/ai/agentTaskQueue.ts
src/main/ai/agentTaskWorker.ts
src/main/ai/agentCheckpoint.ts
src/main/ai/agentEventStore.ts
src/main/ai/agentSnapshot.ts
src/main/ai/agentLoopGuard.ts
src/main/ai/conversationExport.ts
src/main/ai/tools/askQuestionCard.ts
src/main/ai/tools/previewPatchFiles.ts
src/main/ai/tools/webSearch.ts
src/main/ai/tools/analyzeFolder.ts
src/main/ai/tools/checkLinks.ts
src/main/ai/tools/getTaskActivity.ts
src/main/db/agentTaskDao.ts
src/main/db/agentSessionDao.ts
src/main/db/agentEventDao.ts
src/main/db/agentSnapshotDao.ts
src/render/components/AIAgent/MentionPreview.tsx
```

**修改文件**：
```
src/shared/ai.ts — 新增 11 个类型
src/shared/constants.ts — 新增 4 个 IPC channel
src/main/db/index.ts — 新增 4 张表 DDL
src/main/db/ai.ts — 新增 3 个查询函数
src/main/ai/agentLoop.ts — 扩展依赖接口
src/main/ai/toolRegistry.ts — 注册 6 个新工具
src/main/ai/ipc/agentHandlers.ts — 改造 AGENT_RUN + 新增 handler
src/main/ai/ipc/chatHandlers.ts — 新增 3 个 handler
src/main/index.ts — 初始化队列和 Worker
src/main/preload.ts — 新增 3 个桥接方法
src/render/stores/agentStore.ts — 适配异步入队
src/render/components/AIAgent/ModelDropdown.tsx — 添加搜索
```

## 11. 写控制与任务安全模块（2026-08-24 ~ 2026-08-25）

> 参考 Notus 项目 Write Control & Task Safety，R1~R7 全部交付。
> 需求文档：[write-control-task-safety.req.md](../requirements/write-control-task-safety.req.md)
> 实施计划：[write-control-task-safety.plan.md](../plan/write-control-task-safety.plan.md)
> 任务状态：[write-control-task-safety.status.md](../plan/write-control-task-safety.status.md)

### R1 写模式切换

`autoApplyRewrite: boolean` 泛化为 `writeMode: WriteMode ('auto' | 'manual')`，覆盖 editBlocks / createFile / createFolder。设置持久化到 `ai_config.write_mode` 列（幂等迁移）。`auto` 模式下单文件 editBlocks 自动应用 + createFile/createFolder 自动创建；`manual` 模式全部弹确认卡片。AIPanelComposer 底部控制条提供 auto/manual 切换。

### R2 写预览版本对比（staleness detection）

editBlocks proposal 生成时计算 MD5 contentHash，用户确认应用时二次校验。哈希不一致 → 拒绝静默覆盖，显示「文件已变更」警告卡片 + 新旧 diff。

### R3 Agent 交互暂停/恢复

`ask_question_card` 工具执行成功后，agentLoop 暂停等待用户答案（`AgentLoopDeps.onInteractionRequired` + `waitForInteraction` 回调）。`AgentTaskWorker` 用 `Map<sessionId, {resolve,reject}>` 管理暂停/恢复。IPC 三通道：`AGENT_INTERACTION_QUESTION`（主→渲染推送问题）、`AGENT_RESUME_INTERACTION`（渲染→主提交答案）、`AGENT_RETRY_TASK`（重试失败任务）。向后兼容：回调缺失时行为不变。

### R4 待处理状态 UI

`QuestionCard.tsx` 新组件支持 text/choice/confirm 三种问题类型 + 条件依赖。AgentTab 在 `pendingInteraction` 非空时渲染。AIPanelSession 标题栏显示 waiting 状态视觉标识（橙色圆点 + 文案）。`cancelTask()` 同时 reject 挂起交互避免永久阻塞。

### R5 事件持久化先于推送（第一期）

`agentLoop.ts` 和 `agentTaskWorker.ts` 全部事件走 `persistAndSend()`（先写 SQLite 再推 IPC）。渲染侧 `visibilitychange` 事件触发 `replayFromSeq(lastSeq)` 补发丢失事件。

### R6 IndexedDB 草稿恢复

`src/render/services/draftStore.ts` 新建：原生 IndexedDB API，DB `weavemd-drafts`，ObjectStore `drafts`（keyPath: `conversationId`）。`createDebouncedSaver(300)` 返回闭包用 `useRef` 保持稳定。AIAgentPanel 集成：防抖保存 effect + 恢复 effect + 所有关闭/切换/发送/删除操作清理。

### R7 已实现模块集成（第一期）

- R7a：`DeadLoopDetector` 替代硬编码 `MAX_ROUNDS=6`（默认 12）
- R7b：每轮结束 `saveCheckpoint()`，断点续跑
- R7c：`createSnapshot()` 备份完整文件内容
- R7d：渲染侧「回滚到快照」操作入口（AIPanelSession 标题栏按钮）

### 变更文件总览

**新增文件**：
```
src/render/services/draftStore.ts          — R6 IndexedDB 草稿存储
src/render/components/AIAgent/QuestionCard.tsx — R4 提问卡片组件
```

**修改文件**：
```
src/shared/ai.ts                           — WriteMode 类型 + AgentInteractionPayload
src/shared/constants.ts                    — AI_GET/SET_WRITE_MODE + AGENT_INTERACTION/RESUME/RETRY
src/main/db/index.ts                       — ai_config.write_mode 幂等迁移
src/main/db/ai.ts                          — AiConfigRow/DbRow/Update 新增 writeMode
src/main/ai/agentLoop.ts                   — AgentLoopDeps 扩展 + ask_question_card 暂停检测
src/main/ai/agentTaskWorker.ts             — pendingInteractions Map + resumeInteraction
src/main/ai/ipc/agentHandlers.ts           — AGENT_RESUME_INTERACTION + AGENT_RETRY_TASK handler
src/main/ai/ipc/configConsentHandlers.ts   — getWriteMode / setWriteMode handler
src/main/preload.ts                        — resumeInteraction / retryTask / getWriteMode / setWriteMode
src/render/stores/agentStore.ts            — writeMode + pendingInteraction + resumeInteraction/retryTask
src/render/components/AIAgent/AgentTab.tsx — 渲染 QuestionCard
src/render/components/AIAgent/AIPanelSession.tsx — waiting 标识 + onSend 透传
src/render/components/AIAgent/AIPanelHome.tsx    — onSend 透传
src/render/components/AIAgent/AIPanelComposer.tsx — writeMode 切换 UI
src/render/utils/weaveMDBridge.ts          — 浏览器 mock bridge 补齐
```
