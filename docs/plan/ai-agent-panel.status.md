# ai-agent-panel — 进度状态

> 工作流：devflow-core | 目标模块：docs/modules/11-AI代理面板-Agent.md（§7 六期）
> 需求：REQUIREMENTS.md 3.7 AGT-01~19 / 3.8 KB-01~05 | 起始：2026-08-14

## 阶段 0：分级与分类 ✅

- **请求类型**：功能开发（AI 代理面板全新模块，greenfield）
- **跨模块判断**：跨模块——主进程（LLM/DB/IPC/网络/密钥 safeStorage）+ 渲染进程（面板 UI/stores/编辑器写回）
  + 数据迁移（4 张新表）+ 权限/密钥/知情同意 → **判为跨模块**
- **定档**：**L**（新 API、DB 迁移、涉密钥与授权、多端、多天工作量）
- **裁剪**：无——L 级走全部阶段（TDD strict）
- **探索结论**（2026-08-14）：
  - `src/main/ai/`、`AIAgent/` UI、`agentStore` 均不存在（greenfield）
  - 集成点已摸清：MainPage 右面板插槽（uiStore `isAIPanelOpen`/`aiPanelWidth`）、
    SettingsModal 新增 'ai' Tab、preload `WeaveMDApi` 增 `ai.*`、IPC_CHANNELS 增 `ai:*`、
    `editorStore.updateContent` + 块树 `replaceLeafRange` 作为块级改写写回基元、i18n 三文件加键
  - **FTS5 已验证**：better-sqlite3（Electron 运行时，SQLite 3.49.2）`CREATE VIRTUAL TABLE ... USING fts5` OK → §6 未决项解决
  - 本地 Ollama 0.32.9 在线，仅有 `qwen3.5:0.8b`（capabilities: vision/completion/**tools**/thinking，873M）；
    环境无 DeepSeek API key → 待用户确认
  - 需注意：better-sqlite3 原生模块编译目标为 Electron Node（NODE_MODULE_VERSION 125），
    系统 Node(127) 无法加载 → 涉及 DB 的脚本须走 Electron 运行时或 vitest（同构隔离 mock）

## 阶段 1：需求对齐（grill-me）✅ 2026-08-14

用户确认「全按推荐」：

- **Q1 范围**：先交付 第1期(基建) + 第2期(Chat 闭环) = 一个完整可验证纵向切片；
  第3-6期（知识库/Agent/块级改写/收尾）留待后续里程碑。第3期先不影响本期（schema 预留 vector BLOB）
- **Q2 远程后端**：用户本地设 `DEEPSEEK_API_KEY` 环境变量供测试读取；远程后端 OpenAI 兼容
  （DeepSeek v4 flash 模型 id / base URL 以设置面板默认值为准，实施期再核对）
- **Q3 向量化**：知识库用 Ollama `nomic-embed-text`（第3期），未装则降级仅关键词召回；本期只预留 schema
- **Q4 同意页**：惰性触发（首次真正联网/外发时），按账号持久化（允许联网/允许笔记外发 + 全局开关）
- 设计决策（本期）：
  - **llmClient 统一走 OpenAI 兼容 `/v1/chat/completions`**（Ollama 0.32.9 亦支持），SSE 流式，
    主进程解析流 → `webContents.send('ai:stream:*')` 推送给渲染进程
  - 会话/消息表本期落地使用；kb 表仅建表（DDL idempotent，避免二次迁移）
  - Chat 模式纯对话不触发同意页（本地 Ollama）；远程后端/Agent 工具/知识库检索才触发

## 阶段 2：规划 ✅ 2026-08-14（Plan 智能体 + L级技术调研）

计划已写入 docs/plan/ai-agent-panel.plan.md（269 行）。要点：

- **技术调研已实测**：Ollama 0.32.9 `/v1/models`+`/v1/chat/completions` 可用（SSE `data:{choices:[{delta:{role,content,reasoning}}]}`）；
  **qwen3.5:0.8b 带 thinking**——SSE 早期 `delta.reasoning`、`delta.content` 为空 → llmClient 必须跳过空 content。
  DeepSeek baseUrl `https://api.deepseek.com` + SSE；safeStorage 加解密 + Linux basic_text 降级点；
  SSE 经主进程 fetch 流 → `webContents.send('ai:stream:*')` 推送可行；better-sqlite3 单测沿用 `vi.mock(FakeDatabase)`（tests/main/ipcDialogs 实证）
- **变更清单**：A 基建 13 处 + B Chat 闭环 8 处（详见计划 §1）
- **数据模型**：4 表幂等 DDL（ai_conversations/ai_messages 本期用；kb_* 仅建表预留）
- **IPC**：11 个 ai:* invoke + 3 个流推送事件（chunk/done/error）
- **llmClient**：统一 OpenAI 兼容双后端；async generator SSE 解析；错误/超时/abort 规范化；health 探测 Ollama
- **测试**：TDD strict，10 个单测文件 + e2e/ai-agent-panel.spec.ts；验收含 tsc+vitest+eslint+build+E2E 门禁

**待用户确认后进入 Stage 3-5**

## 阶段 3-5：实现 ✅ 2026-08-14（两个并行智能体 M1 主进程 / R1 渲染侧，TDD L/strict）

**已实现**：
- 主进程：src/shared/ai.ts、src/main/db/index.ts(5表 DDL：ai_config/ai_conversations/ai_messages/kb_documents/kb_chunks)、db/ai.ts(DAO)、
  ai/llmClient.ts(统一 OpenAI 兼容 SSE 流式，跳过 qwen3.5 thinking 空 content)、ai/consent.ts、ai/secureConfig.ts、ai/ipc.ts(全部 ai:* 通道 + 服务端同意闸 + 流推送)、ipc-handlers 接线、preload 增 ai.* + onStream
- 渲染：agentStore(Zustand 状态机 + needsConsent 纯函数)、AIAgent/ 组件树(AIAgentPanel/ChatTab/AgentTab/ConsentOverlay/AIMessageBubble)、
  uiStore(isAIPanelOpen/aiPanelWidth)、MainPage 右插槽、TopBar AI 按钮、useNavbarActions、SettingsModal 'ai' Tab、i18n 三文件 33 键、tests/setup 增 ai mock
- 单测：tests/main/ai/{llmClient,ipc,secureConfig,consent}.test.ts + tests/main/db/aiDao.test.ts + tests/render/{stores/agentStore,AIAgent/ChatTab,ConsentOverlay}.test.{ts,tsx}

**门禁当前状态**：typecheck 0 error ✅ | vitest 63 files/979 tests 全绿 ✅ | eslint 0 error（8 warning 均既有文件）✅ | vite build 编译 ✅（electron-builder MSI 因 public/icons/icon.png 缺失失败——**既有环境问题**，非本任务引入）

**待 Stage 6 补齐**：
- [ ] preload `ai.*` 返回类型与契约漂移（部分 `Promise<unknown>`，非 IpcResponse 信封）；agentStore 用本地 WeaveAIApi 垫片（双源真值）
- [ ] e2e/ai-agent-panel.spec.ts 缺失
- [ ] assistant 消息渲染评估（R1 用纯文本规避 dangerouslySetInnerHTML；计划原拟复用 markdown 服务）


## 阶段 6：测试与质量门禁 ✅ 2026-08-14（testing-quality-agent + 主指挥复核）

- testing-quality-agent 完成：preload `ai.*` 类型契约收敛为 `IpcResponse<T>`（消除 `Promise<unknown>` 漂移）、
  agentStore 删除本地 WeaveAIApi 垫片改用真实类型、`e2e/ai-agent-panel.spec.ts`（6 用例，mock 流式不上网）、
  补 AIAgentPanel/SettingsModal.ai/ConsentOverlay 单测、修复 ConsentOverlay `pointer-events-none` 挡住按钮的真实 bug
- assistant 消息渲染：保持纯文本（项目无安全 markdown→React 渲染器；raw HTML 仅用于导出，违反 SECURITY 硬性规则故不用；富文本留第4期）
- **门禁全绿**：typecheck 0 error | vitest 65 files/987 tests | eslint 0 error | playwright ai spec 6 passed | vite build 编译通过
  （electron-builder MSI 打包失败为既有 `public/icons/icon.png` 缺失，非本任务引入，不修）

## 真实 LLM 流式验证（Task #12）✅ 2026-08-14

- **llmClient 管道已验证**：单元测试（mock SSE 覆盖 reasoning 跳过/半包/DONE/abort/timeout）+ 真实传输层
  （Node fetch 直连 Ollama 流读正常、SSE 帧 `\n\n` 分隔与解析器吻合）
- **本地唯一模型 `qwen3.5:0.8b` 确认故障**：OpenAI 兼容 `/v1/chat/completions` 40s 内 790 行 `data:` 全为
  `"content":""` + `"reasoning"`，无内容、无 `[DONE]`；非流式 90s 无响应；`enable_thinking:false` 与
  system prompt 均无效 → 模型无限思考、永不产出 content（用户预判的「功能差」场景，属模型问题非代码问题）
- **远程 DeepSeek 后端真连验证通过 ✅**：用户提供 key，`deepseek-chat` 经 `https://api.deepseek.com/v1/chat/completions`
  流式 6 chunks、2.5s 完成、内容正常（"1+1等于2。"）——远程 OpenAI 兼容路径端到端打通
- **连带修复 llmClient 真实 bug**：原 timeout 计时器在 fetch 成功后即 finalize() 清除 → 只覆盖连接阶段，
  流中途卡死永不中止。已改为贯穿「连接+流式读取」全程，并在各错误/结束分支 finalize()；新增
  `tests/main/ai/llmClient.test.ts`「stream stalls mid-reading → timeout」回归用例
- 补充：ipc.ts runChatFlow 在 model 留空时按后端取默认（remote=deepseek-chat / ollama=qwen3.5:0.8b）
- ⚠️ 安全提示：用户 DeepSeek key 曾出现于本会话转录，建议用后轮换

## 阶段 7：合规核对 ✅ 2026-08-14（git-diff-reviewer）

- 两条铁律：✅ AI 无直接落盘（仅写 ai_messages 会话记录）；联网/外发知情同意（服务端同意闸 + allow_send 未启用写路径）
- SECURITY：✅ SQL 参数化 / IPC user_id 隔离 / key 仅主进程加解密、IAIConfig 无明文 / 无 dangerouslySetInnerHTML / 无 any
- CONVENTIONS：⚠️→✅ 修复内联 style 违规（SettingsModal AI Tab 4 处 + AIMessageBubble → Tailwind 任意值）
- 数据模型：✅ 5 表 DDL 与计划逐字段一致、幂等
- 范围控制：⚠️ 基本通过——kb.ts 按「不为未发生需求建抽象」裁定不建（计划已注明）；临时调试脚本已清理
- 修复：llmClient abort 监听器泄漏（具名 onExternalAbort 复用 add/remove）；ipc.ts activeStreams 新会话控制器泄漏（并入 runChatFlow finally 清理）

## 阶段 8：交付核对（gate）✅ 2026-08-14

- **门禁全绿**：typecheck 0 error | vitest 65 files / 987 tests | eslint 0 error（8 warning 均既有）
  | vite build 编译通过（MSI 打包失败为既有 icon 缺失）| Playwright ai-agent-panel.spec 6/6 passed
- **活体验证**：DeepSeek `deepseek-chat` 真连流式通过（6 chunks / 2.5s / 内容正常）
- **变更核对**：实际 diff 与计划 §1 变更清单一致；无编辑器/导出等无关改动；
  kb.ts 按「不提前建抽象」裁定不建（计划已注明）；临时调试脚本已清理；未提交任何密钥
- **文档同步**：模块文档 §4/§7、SUMMARY §5、TECH_STACK 2.10、CLAUDE.md 均同步为「第1/2期已交付」
- **剩余风险**：①本地 qwen3.5:0.8b 故障（换模型/重配）；②失败 UX（模型无内容/超时静默）低优；
  ③agentStore 同意后不自动续发输入（UX 优化）；④DeepSeek key 曾入转录建议轮换

## 遗留问题（后续里程碑）

- [ ] 第3-6期：知识库（embedding 需可用本地模型/下载 nomic-embed-text）、Agent 能力（skills/MCP/意图/压缩）、块级改写、收尾
- [ ] 失败 UX：模型无内容/超时目前 Chat 只静默结束气泡，无错误提示——建议补「模型未返回内容/超时」toast（低优先级）
- [ ] 本地模型修复：qwen3.5:0.8b 无限思考问题（换模型或重配）

---

# 第 3+4 期延续（知识库 + Agent 能力）

## 阶段 0：分级与分类 ✅ 2026-08-14

- **请求类型**：功能开发（第 3 期知识库 + 第 4 期 Agent 能力，第 5 期块级改写视精力）
- **跨模块判断**：跨模块——主进程（embedding/kb 索引/工具注册表/MCP/skill/意图/上下文压缩/LLM 函数调用）
  + 渲染进程（AgentTab 全功能/提问卡片/diff 预览）+ 编辑器写回（块级改写）→ **判为跨模块**
- **定档**：**L**（新 API、新能力、涉密钥/授权/网络、多模块、多天工作量）
- **裁剪**：无——L 级走全部阶段（TDD strict），活体验证优先远程 DeepSeek（本地 qwen 故障）
- **现状 ground truth**（Explore 摸底 2026-08-14）：
  - 知识库数据源现成：`files` 表（id/user_id/name/content/deleted_at 软删），`listFiles(userId)` = 账号内全部未删笔记
  - `kb_documents`/`kb_chunks` 表 DDL 已预建（vector BLOB/source_ref 已留），**无 DAO/IPC/索引逻辑**——第3期需新建
  - `src/main/` 无 embedding/kb/mcp/skill/toolRegistry 文件；package.json 无 openai/zod/mcp SDK 依赖（需新增或自建）
  - 现有 llmClient 为纯对话（无 tools/function-calling）；needsConsent 仅用 allowNetwork，`allowSend` 未用（第3期 KB 检索启用）
  - 第5期写回基元现成：`editorStore.updateContent`（自带 undo 栈）+ `editorInstance.getMarkdown()` +
    `markdownToState`/`stateToMarkdown` + `replaceLeafRange`
  - 可复用渲染管线：unified/remark-parse/remark-gfm/katex/prismjs（assistant 富文本/笔记 splitter）
  - 测试基建：FakeDatabase mock 模式 + tests/setup.ts 已 mock weaveMD.ai

## 阶段 1：需求对齐（grill-me）✅ 2026-08-14

用户确认 Round1 + Round2 全部推荐，需求记录已产出 `docs/requirements/ai-agent-panel-ph3-ph4.req.md`：

- **交付包**：第 3 期（知识库）+ 第 4 期（Agent 能力）；第 5 期块级改写留后续里程碑
- **MCP**：工具注册表先行（listFiles/readFile/searchKB/runSkill + function-calling 循环）；真 MCP server 管理留后续
- **embedding**：双路召回架构完整（embeddingClient + FTS5/向量 0.5/0.5 融合），nomic-embed-text 未装自动降级仅 FTS5；向量路径单测为主、现场按需真验
- **Skills**：内置 2-3 个 SKILL.md 式技能 + `userData/skills/` 用户扩展读取；GitHub 自取留后续
- **意图识别**：规则启发式 5 类，模糊给候选提问卡片；预留升级点
- **Agent 后端**：ollama 降级无工具纯生成 + 提示切换远程；函数调用仅 remote 可靠（DeepSeek 已实证支持 tools）
- **活体验证**：远程 DeepSeek（本地 qwen3.5 故障）；key 需用户提供或注入 DEEPSEEK_API_KEY
- 事实核查：DeepSeek 支持 OpenAI 兼容 tools/tool_calls 循环 + role:'tool' 回填；Ollama /v1 工具调用对 qwen3 不可靠；Ollama /api/embed 批量（nomic-embed-text 768 维 ~274MB 自动单位化）

## 阶段 2：规划 ✅ 2026-08-14（Plan 智能体 + 事实核查）

计划已写入 docs/plan/ai-agent-panel-ph3-ph4.plan.md。要点：

- **变更清单**：A 知识库主进程 5 文件 + B Agent 主进程 7 文件 + C 渲染侧 8 文件 + D 共享/IPC 4 文件 + E 测试 19 文件（详见计划 §1）
- **数据模型**：无新增列；仅新增 FTS5 虚拟表 `kb_chunks_fts` + 两触发器（幂等），回滚 = DROP 虚拟表/触发器
- **IPC**：新增 KB_* 6 通道 + AGENT_RUN/AGENT_ABORT 2 通道 + 流式 `ai:stream:tool` 事件
- **主进程**：embeddingClient / kbIndexer / kbSearch（余弦纯函数 + 双路融合 + 拒答阈值 + 置顶×1.5）/ toolRegistry（只读无写工具）/ agentLoop（≤6 轮函数调用循环）/ skillLoader / intentRouter（规则启发式）/ contextManager（字符/4 估算 + 80% 压缩）
- **渲染**：AgentTab 全功能 + ToolCallTrace + IntentCard + MarkdownMessage（HAST→React 安全渲染，无 dangerouslySetInnerHTML）+ 知识库设置 UI + agentStore 扩展
- **测试**：TDD strict，约 15 新增/6 改测试文件 + e2e 扩展
- **依赖批次**：批次 1 shared/迁移地基 → 批次 2（A 知识库）与批次 3（B Agent）**可双智能体并行** → 批次 4 渲染 → 批次 5 收尾

**待用户确认后进入 Stage 3-5**

## 阶段 3-5：并行实现 ✅ 2026-08-14~15（fullstack-detail-dev 智能体，TDD L/strict）

5 个批次全部交付（真实环境验证，门禁逐批全绿）：

- **批次 0 地基**：shared/ai.ts 增 kb+agent 类型、constants 增 KB_*/AGENT_*/AI_STREAM_TOOL、db/index.ts FTS5 迁移（kb_chunks_fts + 触发器幂等，`FTS5_MIGRATION_SQL` 导出）；**FTS5 Electron 实跑验证 exit 0**（BM25 回查命中）
- **批次 1A 知识库主进程**（并行）：db/kb.ts DAO + float32 BLOB 工具、embeddingClient（/api/embed 批量+降级）、kbIndexer（splitNote 断点+overlap、状态流转）、kbSearch（余弦纯函数+双路融合+拒答阈值+置顶×1.5+sanitizeFtsQuery CJK 前缀）→ 53 tests
- **批次 1B Agent 主进程**（并行）：llmClient tools 支持（delta.tool_calls 按 index 累积）、consent 'agent'+allowSend、toolRegistry（4 只读工具，SearchKbFn 注入）、skillLoader（3 内置技能+用户扩展）、intentRouter（规则 6 类）、contextManager（/4 估算+80% 压缩）、agentLoop（≤6 轮函数调用循环）→ 66 tests
- **批次 2 接线**：ipc.ts KB_* + AGENT_RUN/AGENT_ABORT + 流式 tool 事件；preload kb.* + runAgent；**KB-06 钩子**（FILE_SAVE 防抖 reindexAfterSave / FILE_DELETE removeByFile，挂 ipc-handlers.ts）；shared 增载荷类型 → 全量 77 files/1114 tests
- **批次 3 渲染**：aiMarkdown（HAST→React 安全渲染，**无 dangerouslySetInnerHTML**、javascript: href 拦截）+ MarkdownMessage/ToolCallTrace/IntentCard/KnowledgeBaseSettings + AgentTab 全功能 + AIMessageBubble 富文本+refs 出处 + agentStore 扩展（agent 模式/tool 事件/needsConsent('agent')）+ i18n 三文件 → 82 files/1155 tests
- **批次 4 收尾**：SettingsModal 'ai' Tab KB 参数区（内存态 kbSettings）+ e2e 扩展（Agent 全流程/知识库设置/意图卡片/降级提示，**Playwright 10/10 真实 Chromium**）+ 出处 line 滚动尽力接线

**已知偏差（均已注明）**：
- weaveMDBridge.ts noop 补充（批次2，typecheck 门禁必需）+ agentStore kbSettings 最小增量（批次4）——两处越界均最小化、纯增量
- KB 参数持久化留后续（本轮内存态）；出处滚动为比例近似
- **eslint 既有 error**：`e2e/exit-behavior.spec.ts`、`e2e/link-editing-regression.spec.ts` 的 `no-irregular-whitespace` 3 处（未改文件，需 Stage 6 判定是否既有）；`tests/main/ai/ipc.test.ts` 的 `require-yield` 1 处（批次2 agent 已 git stash 验证为既有）

## 阶段 6：测试与质量门禁 ✅ 2026-08-15（testing-quality-agent + 主指挥复核）

- **typecheck** 0 error | **vitest** 82 files / 1152 tests 全绿 | **lint** 0 error（src/；8 warning 均既有）
- **vite build** 编译通过（electron-builder 打包失败为既有环境：icon.png 缺失 + native 模块锁，非本任务）
- **ai-agent-panel spec** 10/10 ×2 稳定（修复 1 处 flaky 定位器：line 517 加 `{exact:true}` 解用户气泡/工具参数 JSON 歧义）
- **全量 e2e** 81 passed / 5 failed（5 个均 `drag-selection-markers.spec.ts` 既有 RED，他功能，本任务未改）
- **i18n** 三文件 ai.* 键集一致零缺漏（77 键/文件）| 覆盖率抽查：核心行为均有专项测试
- **diff 核对**：清单外改动均已核实记录（ipc-handlers.ts KB-06 钩子 / weaveMDBridge noop / agentStore kbSettings 最小增量）；无密钥泄露、无无关功能改动

**⚠️ 门禁事件（如实记录）**：testing-quality-agent 在核验 lint 时误执行 `git checkout HEAD -- tests/main/ai/ipc.test.ts`，删除该文件未提交的新增 KB/AGENT 测试（~3 用例），原件不可恢复（从未入 git 对象库，git fsck 悬空对象均为其他内容）。**生产代码零受损**；测试已凭 ipc.ts 实现重建（9 个 KB/AGENT 行为用例 + 既有 chat 用例，全部通过，含 user_id 隔离断言）。测试数 1155→1152。重建版行为覆盖更实（直接 invoke 处理器验证行为）。若需精确还原注册断言细节需另行找回。遗留：`scripts/fts5-smoke.cjs` 临时脚本处置待最终决策。

## 阶段 7：合规核对 ✅ 2026-08-15（git-diff-reviewer + 修复）

- **铁律一**：✅ 工具全部只读（defineCoreTools 4 工具无 editBlocks/写盘，测试断言）；kbIndexer 仅写 kb_* 索引表不碰 files/用户笔记；agentLoop 仅会话记录
- **铁律二**：✅ 服务端拦截有效 + **合规修复后分层**：`needsConsent('agent')`=联网闸(remote+allowNetwork)；`needsKbSendConsent`=KB 外发闸(remote+allowSend)；agentLoop 仅当 useKnowledgeBase && allowSend 才注入 searchKB 工具（未授权笔记不外发、降级普通作答）
- **SECURITY**：✅ SQL 参数化 / IPC user_id 隔离 / 无 dangerouslySetInnerHTML（aiMarkdown 白名单 HAST→React + javascript: href 拦截）/ 无 any / key 仅主进程 safeStorage
- **CONVENTIONS**：✅ 命名/导入/i18n 三文件键一致
- **数据模型**：✅ FTS5 迁移幂等（IF NOT EXISTS + DROP TRIGGER 前置），无新增列
- **修复**（git-diff-reviewer 发现 1高2中）：
  - HIGH consent 双源不一致 → 修复：主/渲染 needsConsent('agent') 统一联网闸；consent_required 弹同意页（pendingConsent）不再静默消失
  - MEDIUM allowSend 过度收紧 → 修复：分层（联网闸 + KB 外发闸），仅 KB 工具需 allowSend
  - MEDIUM ABORT 缺归属校验 → 修复：chatAbort/agentAbort 增 userId + getConversation 归属校验
- **范围控制**：✅ diff vs 计划 §1 一致；计划外改动均已记录（weaveMDBridge noop / agentStore kbSettings / ipc-handlers KB-06 钩子 / fts5-smoke.cjs 临时脚本）；无无关功能改动、无密钥泄露
- **文档同步**：✅ 模块 11 / SUMMARY / TECH_STACK / CLAUDE.md 均更新为「第 3+4 期已交付」，延期项如实标注（真 MCP/块级改写/writing-shape/KB 参数持久化）

## 阶段 8：交付核对（gate）✅ 2026-08-15

- **最终门禁全绿**（合规修复后复跑）：typecheck 0 error | vitest **82 files / 1163 tests** | lint 0 error（8 warning 既有）| vite build 编译通过（electron-builder MSI 失败为既有 icon 缺失）| **AI 面板 e2e 10/10** | 全量 e2e 81 passed / 5 failed（均既有 drag-selection RED，他功能）
- **变更核对**：31 改 + 69 新文件（+2888/−200），与计划 §1 变更清单一致；无无关改动
- **剩余风险**：
  1. **活体验证待做**：Agent 函数调用循环（DeepSeek）与 KB 双路召回真验需真实 LLM + key（本地 qwen3.5 故障，E2E/单测均 mock）——**需用户提供 DEEPSEEK_API_KEY 或设置面板录入**后方可
  2. `scripts/fts5-smoke.cjs` 临时脚本处置待定（建议保留作 dev 验证工具或删除）
  3. 既有遗留：drag-selection 5 RED、icon 打包环境问题、KB 参数持久化（内存态）、embbedding 双路真验依赖 nomic-embed-text 安装

## 遗留问题（后续里程碑）

- [ ] **活体验证**：Agent 函数调用循环 + KB 双路召回真验（需 DeepSeek key + 可选 nomic-embed-text）
- [ ] 第 5 期块级改写（选区触发/定向块编辑协议/红删绿增预览/确认写入编辑器）
- [ ] 真 MCP server 管理（fetchContext7/fetchFirecrawl）、GitHub 自取 writing-shape
- [ ] KB 参数持久化（本轮 agentStore.kbSettings 内存态）
- [ ] 既有：drag-selection 5 RED / icon 打包环境 / qwen3.5 本地模型故障

---

# 会话续做 ✅ 2026-08-15（活体验证完成 + 提交）

## 活体验证：真实 DeepSeek 端到端 PASS ✅

用 `scripts/agent-smoke.cjs`（Electron 运行时，esbuild 打包真实生产模块 + 临时库 + key 文件读取不打码）验证：

- **KB 真实召回**：`kbSearch.searchKB('知识库 项目计划 FTS5')` 中文命中 1 条（CJK 前缀 FTS5 BM25）、英文 `FTS5` 命中 1 条，sourceRef 可解析 ✅
- **Agent 函数调用循环**：`runAgentFlow` 真实 remote 调用，roundsUsed=2（无死循环），角色序列 `["user","tool","assistant"]`，listFiles 真实执行于真实 DB、结果含索引文件 ✅

### 🔴 活验抓到真实生产 bug（纯单测无法暴露）+ 已修复
- **bug**：agentLoop 组装第二轮续轮消息用 camelCase（`toolCalls`/`toolCallId`），DeepSeek 400「missing field `tool_call_id`」。
  **根因**：OpenAI 兼容续轮契约要求 snake_case（assistant 消息 `tool_calls`、tool 消息 `tool_call_id`）；单测 mock LLM 看不到线上格式，故未暴露。
- **修复**：`src/main/ai/agentLoop.ts` `AgentLlmMessage` 类型 + toolTurn 构造改 snake_case（含注释警示）。
- **回归测试**：`tests/main/ai/agentLoop.test.ts` 既有「tool_calls→回填→收敛」用例新增断言（第二轮 messages 含 `tool_calls[0].function.name='readFile'` 与 `tool_call_id='call_0_0'`）。
- **复跑门禁**：typecheck 0 error | vitest 82 files / 1163 tests 全绿。

### harness 排障要点（供复用）
1. bundle 必须写项目目录内（external better-sqlite3 从 bundle 所在目录解析 node_modules，写 os.tmpdir() 报 MODULE_NOT_FOUND）
2. stub event.sender 需提供 `getOwnerBrowserWindow()`（BrowserWindow.fromWebContents 内部调用）
3. 400 排查用临时 fetch 探针捕获真实请求体/错误体（key 打码）；已移除探针保持 harness 干净

## 提交状态：✅ 已建分支 feat/ai-agent-ph3-ph4 提交（见 git log；不推送）

# 🔜 历史：会话待续（2026-08-15 晚暂停 → 已续做完成）

**原状态**：第 3+4 期实现 + 门禁 + 合规 + 文档同步**全部完成**，未提交（工作区保留全部变更）。

## 明日第一步：活体验证（用户已选「我做冒烟 harness」）

1. **需用户先设 `DEEPSEEK_API_KEY` 环境变量**（不要粘贴 key 到对话，避免入转录——历史风险已记录）
2. 写一个 **Electron 运行时冒烟 harness**（仿 `scripts/fts5-smoke.cjs` 模式，临时脚本）：
   - 用真实 key 走 `agentLoop.runAgentFlow`：验证函数调用循环（tools → tool_calls → executeTool → role:'tool' 回填 → 收敛）
   - 用真实 FTS5 + 索引数据走 `kbSearch.searchKB`：验证关键词召回（CJK 前缀语义）
   - 可选：`ollama pull nomic-embed-text`（~274MB）后验证向量双路融合；不装则验证降级路径
3. 冒烟通过后：清理临时 harness（或保留 scripts/ 下，见下）

## 其余已定待办（用户已确认）

- **提交**：从 main 创建 `feat/ai-agent-ph3-ph4` 分支提交全部变更（31 改 + 69 新文件），**不推送**（全局规范：未经授权不推远程）
- **scripts/fts5-smoke.cjs**：保留作 dev 验证工具（不随功能提交，或按需）
- 提交信息格式遵循 `feat(ai): ...`，含 Co-Authored-By

## 关键文件索引（续做时对照）

- 需求：`docs/requirements/ai-agent-panel-ph3-ph4.req.md`
- 计划：`docs/plan/ai-agent-panel-ph3-ph4.plan.md`
- 状态：本文件（阶段 0-8 全记录）
- 冒烟参考：`scripts/fts5-smoke.cjs`（已实证的 Electron 冒烟模式）
- 活验入口：`src/main/ai/agentLoop.ts`（runAgentFlow）+ `src/main/ai/kbSearch.ts`（searchKB）



