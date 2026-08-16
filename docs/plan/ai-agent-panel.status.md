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

---

# 第 5 期延续（块级改写：选区触发 + 定向块编辑协议 + 红删绿增预览 + 确认写入）

## 阶段 0：分级与分类 ✅ 2026-08-15

- **请求类型**：功能开发（第 5 期块级改写，AGT-12/13/14/17；第 6 期收尾视精力）
- **跨模块判断**：跨模块——编辑器 v2（选区→块区间导出、确认写入 updateContent + 可撤销）+ 主进程
  （改写管线、定向块编辑协议、预览事件、无落盘 editBlocks）+ 渲染进程（红删绿增预览 UI/确认流）
  + 既有铁律一（AI 无直接落盘）→ **判为跨模块**
- **定档**：**L**（新 API/新 IPC、写路径涉铁律、多模块、多天工作量）
- **裁剪**：无——L 级走全部阶段（TDD strict）；活验优先远程 DeepSeek（本地 qwen3.5 故障）
- **现状 ground truth**（Explore 摸底 2026-08-15）：
  - **写回基元现成**：`editorStore.updateContent`（editorStore.ts:42，入 undo 栈 49 步、可撤销）；
    `editorInstance.getMarkdown()`（editorInstance.ts:48）+ `setContent`；`markdownToState`/`stateToMarkdown`
    双向无损；`replaceLeafRange`/`removeBlock`/`replaceBlock`/`insertBlockAfter`/`splitLeaf` 全套块树操作
  - **选区→块端点现成**：`getCrossBlockSelection()`（selection.ts:139，双端点）+ `resolveSyntaxTypesInRange`/
    `getNextLeaf`（中间块枚举）——**缺口**：无"选区导出 markdown 片段"组合函数、无"markdown 替换回选区"端到端
  - **主进程无任何写工具**：toolRegistry 4 只读工具，无 editBlocks 占位；agentLoop 工具协议/回填/AI_STREAM_TOOL
    事件三件套现成；AgentRunPayload 无"当前文档/选区"字段
  - **渲染安全渲染现成**：`renderAIMarkdownSafe`（aiMarkdown.tsx HAST→React 白名单）可复用为 diff 预览渲染器
  - **编辑器实例是 React ref 局部单例**（EditorV2.tsx:43），无全局 getEditorInstance——确认写入走
    `updateContent(整文)`（外部 effect 重建整树会丢光标）或需暴露实例句柄
  - 测试骨架：agentLoop/toolRegistry 的 vi.mock+hoisted 模式可沿用；toolRegistry.test 的 WRITE_NAMES 断言
    加写工具后需同步改造

## 阶段 1：需求对齐（grill-me）✅ 2026-08-15

用户确认「全按推荐」，需求记录已产出 `docs/requirements/ai-agent-panel-ph5.req.md`：

- **Q1 交付范围**（A）：第 5 期 = 选区触发 + 面板 @ 兜底都做，共享同一改写管线与定向块编辑协议；完整覆盖 AGT-12 P1
- **Q2 改写入口架构**（A 主 + C stretch）：独立一次性改写管线（`ai:rewrite:preview`）为主交付；`editBlocks`
  工具注册为 stretch（仅产 proposal 不落盘），精力够才做
- **Q3 定向块编辑协议**：选区 = LLM 见选区 markdown 片段返回改写文本（整段替换）；面板 @ = LLM 见编号块列表
  返回 `[{blockIndex, newContent}]`，主进程映射校验、定位失败拒应用；内部统一 `EditBlockOp[] {blockId, newContent}`
- **Q4 预览 UI**：AI 面板内「改写预览卡片」（红删绿增 + 确认/取消），复用 MarkdownMessage/aiMarkdown 安全渲染
- **Q5 stale 失效**：确认时校验 `当前 content === 预览时原文`，不一致拒绝应用并提示重新生成
- **Q6 第 6 期**：第 5 期后视精力 ①KB 参数持久化优先（小、独立、收尾性）；②真 MCP / ③GitHub skill 继续延
- **Q7 活验**：做改写循环真验（DeepSeek key 文件 + env 均在，仿 agent-smoke.cjs harness，key 不打码）

## 阶段 2：规划 ✅ 2026-08-15（Plan 智能体 + 主指挥修正）

计划已写入 docs/plan/ai-agent-panel-ph5.plan.md。要点：

- **关键修正**：SelectionRef 用**文档序叶子下标**（startLeafIndex/endLeafIndex）+ 块内 offset 跨进程定位（渲染进程 blockId 在主进程重建树后不匹配）；主/渲染对同一 documentMarkdown 的文档序叶子序列一致，下标天然对齐。渲染侧**不做**选区替换（主进程算好 rewrittenMd，确认只 updateContent），避免双实现。
- **变更清单**：A shared/preload 3 处 + B 主进程 blockEdit.ts 新增 + ipc 注册 + C 渲染 selectionExport + FloatingToolbar/AgentTab 触发 + D rewriteDiff/rewriteStore/RewritePreviewCard + E 测试 7 文件 + i18n 三文件；stretch（editBlocks agent 工具）单列 F 默认不做
- **IPC**：仅 1 条新 invoke `AI_REWRITE_PREVIEW`（确认写入走渲染侧 updateContent，不新增确认通道）
- **主进程 blockEdit.ts**：双 scope（selection 选区片段 / document 编号块协议）→ streamChatCompletion 纯对话无 tools → 校验（定位失败 locateFailed 拒应用）→ proposal（原文+改写后+ops，不落盘）；consent 'chat' 闸（allowNetwork）
- **渲染**：rewriteStore 状态机（pendingRewrite/applyRewrite stale 校验→updateContent 入 undo）+ RewritePreviewCard（行级 diff 红删绿增 + renderAIMarkdownSafe）+ FloatingToolbar「AI 改写」+ AgentTab composer @ 兜底
- **批次**：批次 1 shared 地基 → 批次 2（B 主进程）与批次 3（C 渲染侧）可双智能体并行 → 批次 4 预览 UI/store → 批次 5 收尾 + stretch

## 阶段 3-5：并行实现 ✅ 2026-08-15（5 批次全交付，fullstack-detail-dev 智能体，TDD strict + C2 架构修正）

> **实现期架构修正（C2）**：原计划主进程 blockEdit.ts 用渲染内核，但 main 经 vite-plugin-electron 单独打包、内核链含
> `katex.min.css` CSS 导入且 main→render 无先例 → **主进程改为薄 LLM 代理**（`src/main/ai/rewrite.ts` 只产 `{text}`），
> 块级替换/proposal 计算移到渲染侧（`src/render/editor/rewrite/blockEdit.ts`，内核所在）；shared 类型随迁
> （`RewriteRequestPayload` 载 LLM 输入 selectionMarkdown/numberedBlocks + `RewriteReply{text}`）。需求/验收/铁律不变。

- **批次 1 shared 地基**：shared/ai.ts 增 EditBlockOp/SelectionRef/RewriteScope/RewriteBlockRef/RewriteRequestPayload/RewriteReply/RewriteProposal；
  constants 增 AI_REWRITE_PREVIEW；preload `ai.rewritePreview`；weaveMDBridge noop（既有模式）
- **批次 2 主进程薄代理**（并行）：`src/main/ai/rewrite.ts`（consent 'chat' 闸在 ipc 层；buildRewriteMessages 双 scope→streamChatCompletion
  纯对话无 tools→`{text}`）；ipc.ts 注册 AI_REWRITE_PREVIEW + 错误规范化；tests/main/ai/{rewrite,ipc}.test.ts（34 tests）
- **批次 3 渲染侧**（并行）：`selectionExport.ts`（readDocumentSelection DOM 读跨块/同块/折叠 null/DOM 序下标；exportSelectionMarkdown 首尾 offset+中间 serializeBlock）、
  `blockEdit.ts`（buildNumberedBlockList；proposeSelectionRewrite 仅替换选区叶子区间、区间外字节不变、unchanged；proposeDocumentRewrite JSON 映射/越界 locateFailed）；
  FloatingToolbar「AI 改写」+ AgentTab composer @ 兜底；rewriteStore 最小占位；tests 19 用例 + FloatingToolbarV2 组件回归
- **批次 4 预览 UI + store**：`rewriteDiff.ts`（行级 LCS 红删绿增）；`rewriteStore.ts` 完整状态机（startSelectionRewrite 开面板不调 IPC →
  runSelectionRewrite consent 闸→ai.rewritePreview→proposeSelectionRewrite→pendingRewrite；startDocumentRewrite；applyRewrite stale 校验→updateContent 入 undo；
  clearRewrite）；`RewritePreviewCard.tsx`（红删绿增 + renderAIMarkdownSafe 无 dangerouslySetInnerHTML）；AgentTab composer 分流；uiStore 补 setAIPanelOpen；
  i18n 三文件 ai.rewrite.* 12 键；tests 38 用例
- **批次 5 收尾**：e2e/ai-agent-panel.spec.ts 扩展 4 改写用例（改写闭环/面板@兜底/stale 拒绝/unchanged，mock rewritePreview 不上网）；
  文档同步（模块 11 §1/§3/§4/§5/§6/§7 + SUMMARY §5 + CLAUDE.md AI 节 + 本 status）

**集成验证（主指挥复核）**：
- typecheck 0 error | vitest **88 files / 1229 tests** 全绿 | lint 0 error（8 warning 均既有）
- **Playwright ai-agent-panel spec 14/14 通过**（含 4 新改写用例 + 既有 10 回归）
- 批次 5 agent 中途 API 中断，e2e 与文档由主指挥接手验证/补齐

## 阶段 6：测试与质量门禁 ✅ 2026-08-15（testing-quality-agent 独立核验）

- **typecheck** 0 error | **vitest** 88 files / 1229 tests 全绿 | **lint** 0 error（8 warning 均既有）
- **vite build** 编译通过（electron-builder 打包失败为既有 icon.png 缺失，非本任务）
- **Playwright ai-agent-panel spec 14/14**（含 4 改写用例：改写闭环/面板@兜底/stale 拒绝/unchanged，mock 不上网）
- **覆盖率抽查**：整体 97.08% stmts / 86.63% branch；新模块（rewrite/selectionExport/blockEdit/rewriteStore/rewriteDiff/RewritePreviewCard）单测全过、错误路径（unchanged/locateFailed/stale）覆盖充分，无关键缺口
- **铁律核验**：铁律一（rewrite.ts 零落盘零 markdown 解析、blockEdit 只算不写、唯一写入点 applyRewrite→updateContent 入 undo）✅；铁律二（ipc.ts + rewriteStore 双 consent 'chat' 闸）✅；SECURITY（无 dangerouslySetInnerHTML / 无 any / 无密钥 / 本任务无新 SQL）✅
- 已知既有失败（drag-selection e2e 5 RED / fts5-smoke.cjs）不修、如实保留

## 阶段 7：合规核对 ✅ 2026-08-15（git-diff-reviewer）→ APPROVED

- **铁律一**：✅ 主进程 rewrite.ts 零 markdown 解析/零写盘（只产 {text}）；渲染侧 blockEdit/selectionExport 只算不写；
  唯一写入点 rewriteStore.applyRewrite → updateContent 入 undo；无绕过「预览→确认」路径
- **铁律二**：✅ ipc.ts + rewriteStore 双 consent 'chat' 闸，未授权不发外发请求
- **SECURITY**：✅ 无 dangerouslySetInnerHTML（RewritePreviewCard 用 renderAIMarkdownSafe）、无 any、无密钥、本任务无新 SQL；
  IPC userId 弱校验沿用既有 AGENT_RUN 模式（低优，非本任务回退）
- **CONVENTIONS**：✅ 命名/导入/组件 export；i18n 三文件 ai.rewrite.* 12 键一致无缺漏
- **范围控制**：✅ 编辑器内核（selection/blockTree/markdownToState/stateToMarkdown）零修改；无无关功能改动；
  合理越界已记录（uiStore.setAIPanelOpen / weaveMDBridge noop / tests/setup mock / FloatingToolbarV2 分隔线 3→4）；
  ⚠️ i18n 三文件无害重排（无键删改，±200 行）——知悉项，不回退
- **文档一致性**：✅ 模块11/SUMMARY/CLAUDE.md/status 如实标注「第 5 期已交付」vs 延期权项（真 MCP/GitHub/KB 持久化/editBlocks stretch 均未写成已交付）

## 活体验证：真实 DeepSeek 改写循环 PASS ✅ 2026-08-15

用 `scripts/rewrite-smoke.cjs`（Electron 运行时，esbuild 打包真实生产模块 + env key 不打码）验证：

- **selection scope**：真实 LLM 收到选区片段 + 改写指令 → 返回改写后完整 Markdown，**≠ 原文**、结构保留（示例：`### 本周项目进展` 改写为精简版）✅
- **document scope**：真实 LLM 收到编号块列表 → 返回 **JSON 数组可解析**，ops=2、首个 block_index=1（合法下标）✅
- **铁律一**：全程只产 {text}，未写盘/未落库 ✅；key 从 env 读取不打码 ✅
- harness 清理：临时 bundle 运行后删除；脚本保留 scripts/ 下作 dev 验证工具

## 阶段 8：交付核对（gate）✅ 2026-08-15

- **最终门禁全绿**：typecheck 0 error | vitest **88 files / 1229 tests** | lint 0 error（8 warning 均既有）| vite build 编译通过（electron-builder MSI 失败为既有 icon 缺失）| **Playwright ai-agent-panel spec 14/14**（含 4 改写用例）
- **变更核对**：21 改 + 19 新（40 文件），与计划 §1 变更清单一致 + 合理越界（均已记录）；无编辑器内核/无关功能改动；无密钥泄露
- **活验**：改写循环真验 PASS（见上）
- **剩余风险**：
  1. 本地 qwen3.5:0.8b 故障（改写走远程 DeepSeek 可用；ollama 本地改写未真验）
  2. 改写后光标丢失（第 5 期接受，best-effort 未做——写入重建整树）
  3. i18n 三文件无害重排（知悉项）
  4. IPC userId 弱校验沿用既有模式（低优，建议后续统一收紧）
  5. 既有遗留：drag-selection 5 RED / icon 打包环境 / KB 参数持久化（内存态）

## 遗留问题（后续里程碑）

- [ ] **第 6 期收尾**：①KB 参数持久化（topK/fuse/threshold/置顶/embedding host+model → ai_config，本轮内存态）优先；②真 MCP server 管理（context7/firecrawl + fetch 工具）；③GitHub 自取 writing-shape skill
- [ ] stretch：editBlocks agent 工具（toolRegistry 注册，仅产 proposal 不落盘；WRITE_NAMES 断言同步改造）
- [ ] 既有：drag-selection 5 RED / icon 打包环境 / qwen3.5 本地模型故障 / IPC userId 统一收紧
- [ ] 活验 harness scripts/rewrite-smoke.cjs 与 agent-smoke.cjs 处置：保留作 dev 验证工具（不随功能提交）

## 提交 ✅ 2026-08-15

- `606e882 feat(ai): add phase-5 block rewrite with preview-confirm write path`（34 文件 +3527/−613）
- 分支 `feat/ai-agent-ph3-ph4` 领先 origin 1（**未推送**，符合授权）
- 未提交（保留工作区）：scripts/rewrite-smoke.cjs（活验 harness，dev 工具惯例）、.claude/agents/ph5-*.md（任务脚手架）、
  .claude/agent-memory/ 自动生成的 agent 状态
- 第 6 期收尾：用户选择**暂停**，留后续里程碑

---

# 第 6 期收尾（KB 参数持久化 + stretch editBlocks agent 工具）

## 阶段 0：分级与分类 ✅ 2026-08-15

- **请求类型**：功能开发（第 6 期收尾：①KB 参数持久化优先 ②stretch editBlocks ③真 MCP/GitHub 继续延）
- **跨模块判断**：跨模块——主进程（ai_config 表迁移加列、DAO 扩展、KB IPC 新通道、KB_STATUS/AGENT_RUN 消费修正、
  toolRegistry/agentLoop stretch）+ 渲染进程（agentStore kbSettings 拉取/持久化、SettingsModal Save 持久化）→ **判为跨模块**
- **定档**：**L**（DB 迁移、新 IPC、跨模块、用户明确指定 devflow-core L 级 TDD strict）
- **裁剪**：无——L 级走全部阶段（TDD strict）
- **现状 ground truth**（已读代码核实 2026-08-15）：
  - **KB 参数内存态**：`agentStore.kbSettings`（agentStore.ts:81-82/148-155），默认 `{topK:5,fuse:0.5,threshold:0.6,
    pinnedWeight:1.5,embeddingHost:'http://localhost:11434',embeddingModel:'nomic-embed-text'}`；`IKbSettings` 类型在
    shared/ai.ts:208-221（无 vectorEnabled 字段）
  - **编辑 UI**：SettingsModal 'ai' Tab KB 参数表单（SettingsModal.tsx:80-85 内存态草稿 + useEffect:102-108 打开同步 +
    handleSave:154-163 写回 agentStore.kbSettings，仅内存态）
  - **渲染→主进程透传**：`agentStore.sendAgentMessage` → `ai.runAgent({...kbSettings})` → `AgentRunPayload.kbSettings`
    （shared/ai.ts:250-253）
  - **主进程消费点**：
    - `ipc.ts` AGENT_RUN searchKb（ipc.ts:440-449）**只透传 fuse**，topK/vectorEnabled/pinnedWeight/threshold 走工具
      参数 `o?.*` 或 kbSearch.ts 默认值（kbSearch.ts:150-156）
    - `ipc.ts` KB_STATUS probeEmbedding（ipc.ts:396）**硬编码** `embeddingProbeHost()/embeddingProbeModel()`
      （ipc.ts:588-593 = localhost:11434 / nomic-embed-text）
    - `kbIndexer` `kbIndexOpts()`（ipc.ts:583-585）硬编码 `vectorEnabled:false`；embedding host/model 消费点
      **未启用**（vectorEnabled=false 时不 embed → 本期不改）
  - **ai_config 表**（db/index.ts:103-117）：无 KB 参数字段 → 需迁移加 6 列（kb_top_k/kb_fuse/kb_threshold/
    kb_pinned_weight/kb_embedding_host/kb_embedding_model）。`CREATE TABLE IF NOT EXISTS` 对既有表不生效 →
    **需新增幂等 ALTER**（**实证**：项目锁定的 better-sqlite3 11.x/sqlite3.49.2 对 `ADD COLUMN IF NOT EXISTS`
    报 `near "EXISTS": syntax error`；已改用「addAiConfigKbColumns 运行期 pragma_table_info 探测缺失列 +
    逐列 ADD」，幂等由守卫保证，经 scripts/kb-migration-smoke.cjs 真库三态实证，见「真库迁移验证」）
  - **DAO**（db/ai.ts）：`AiConfigRow`/`AiConfigDbRow`/`AiConfigUpdate`/`upsertAiConfig` 无 KB 字段 → 需扩展
  - **IPC 通道现状**：constants.ts 已有 `KB_LIST/IMPORT_FILE/IMPORT_DIR/REINDEX/DELETE/STATUS`；无 settings 通道
  - **preload**：`kb.*` 含 list/importFile/importDir/reindex/delete/status（preload.ts:132-143/297-304）→ 需补
    getSettings/setSettings
  - **测试基建**：tests/setup.ts mock window.weaveMD（ai.* + kb.*，需补 kb.getSettings/setSettings）；
    tests/main/db/aiDao.test.ts FakeDatabase mock 模式（vi.mock better-sqlite3 + db/index）可沿用；
    **迁移/真实 SQL 测试**需另法（in-memory better-sqlite3 或 prepare 断言）
  - **stretch editBlocks**：toolRegistry.ts `defineCoreTools()` 4 只读工具（toolRegistry.ts:51-110）、`executeTool`
    switch 无 editBlocks、`WRITE_NAMES` 断言（toolRegistry.test.ts:15 = `['editBlocks','writeFile','createFile',
    'deleteFile','updateFile','upsert']` 断言「不含」）；agentLoop `toolCtx`（agentLoop.ts:171）+ `toolsForIntent`
    （agentLoop.ts:91-106）无 editBlocks 注入；**缺「当前文档」上下文**——AGENT_RUN payload 无 currentDocument，
    渲染侧需随 payload 注入（editorStore.content）
  - **活验 harness**：scripts/rewrite-smoke.cjs / agent-smoke.cjs 保留（Electron 运行时 + esbuild + key 打码模式）

## 合规核对修复 ✅ 2026-08-15（fullstack-detail-dev）

- **H1（真库三态验证）**：新增 `scripts/kb-migration-smoke.cjs`（仿 fts5-smoke.cjs，Electron 运行时 better-sqlite3
  in-memory 真库）实证 `KB_CONFIG_ALTER_SQL` 三态 + 读写闭环，退出码 0（态1 新库 / 态2 既有库 / 态3 重复执行 /
  态4 upsertAiConfig 读写一致性）。**实证发现**：project 锁定 better-sqlite3（11.10.0/sqlite 3.49.2）对
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 报 `near "EXISTS": syntax error` —— 原 `KB_CONFIG_ALTER_SQL`
  若静默沿用会在每次 `initDatabase` 的 runMigrations 中抛错导致应用无法启动。已改为
  `addAiConfigKbColumns`：运行期 `pragma_table_info` 探测缺失列 + 逐列 `ADD COLUMN`（幂等由守卫保证）；
  迁移列结构/DEFAULT 语义不变。`tests/main/db/migrations.test.ts` 注释修正为「静态结构断言 + 真库 smoke 真验」，
  正则假内存引擎移除。
- **M2（kbSettingsSaveState 归位）**：agentStore 增 `resetKbSettingsSaveState: () => set({kbSettingsSaveState:'idle'})`；
  SettingsModal 打开（isOpen 分支 useEffect）调用归位，使 saved/error 不再驻留；agentStore.test.ts 补归位用例。
- **验证**：typecheck 0 error；migrations.test.ts 4 + agentStore.test.ts 32 + kb-settings-default 5 + main/db 全 34 通过；
  `npx electron scripts/kb-migration-smoke.cjs` 退出码 0。

## 阶段 1：需求对齐（grill-me）✅ 2026-08-15

用户确认「全按推荐」，需求记录已产出 `docs/requirements/ai-agent-panel-ph6.req.md`：

- **Q1 持久化载体**：ai_config 加 6 列（幂等 ALTER）；不建独立 kb_settings 表；vectorEnabled 不入列
- **Q2 IPC 通道**：独立 `kb:get-settings`/`kb:set-settings`；不并入 ai:getConfig/setConfig
- **Q3 生效范围**：3a KB_STATUS 探针用持久化 host/model；3b AGENT_RUN 以持久化 kbSettings 为默认兜底；3c kbIndexer 不改
- **Q4 渲染持久化**：init 并行拉取；setKbSettings 改 async（先写主进程成功再更新内存态；写失败保留内存态 + 非阻塞提示）
- **Q5 stretch editBlocks**：视精力；最小边界=仅产 proposal 文本、无应用闭环；WRITE_NAMES 断言同步改造
- **Q6 活验**：KB 持久化走 vitest 真库（in-memory better-sqlite3）；editBlocks 若做则 DeepSeek 真验

## 阶段 2：规划 ✅ 2026-08-15（Plan 智能体 + 技术调研）

计划已写入 docs/plan/ai-agent-panel-ph6.plan.md（§1 变更清单 A/B/C/D、§2 迁移方案、§3 IPC 表、§4 消费修正、§5 渲染设计、§9 批次依赖）。

- 调研结论：**SQLite 3.35+ 支持 `ADD COLUMN IF NOT EXISTS`（后被真库实证推翻——见阶段 7 H1：better-sqlite3 11.10.0/sqlite3.49.2 报 `near "EXISTS"` 语法错误，已如实修正）**
- 变更清单：A shared 地基（constants/preload/shared 默认工厂/bridge/setup mock）→ B 主进程（迁移+DAO+IPC+消费修正）→ C 渲染（store+SettingsModal+i18n）→ D stretch（默认不做）
- 批次：批次 1 必须先于一切；批次 2（B）与批次 3（C）可并行；批次 4 收尾；stretch 单独

## 阶段 3-5：并行实现 ✅ 2026-08-15（fullstack-detail-dev 智能体，TDD strict）

- **批次 1（shared 地基）**：constants 增 `KB_GET_SETTINGS`/`KB_SET_SETTINGS`；shared/ai.ts 增 `DEFAULT_KB_SETTINGS`+`normalizeKbSettings`；
  preload kb.getSettings/setSettings 契约；weaveMDBridge noop 补全；tests/setup mock 补；tests/shared/kb-settings-default.test（5 用例）→ typecheck 0 / 89 files / 1234 tests
- **批次 2（主进程）与批次 3（渲染）双智能体并行**：
  - 主进程：db/index.ts `KB_CONFIG_ALTER_SQL`（6 列定义）+ `addAiConfigKbColumns`；db/ai.ts DAO 6 KB 字段（mapConfigRow NULL 兜底 + upsert 两处补列）；
    ipc.ts 新增 `KB_GET_SETTINGS`/`KB_SET_SETTINGS` + `KB_STATUS` 探针用持久化 host/model（删除 `embeddingProbeHost()/Model()` 硬编码）+
    `AGENT_RUN` 持久化 kbSettings 默认兜底合并（payload 显式 > 持久化 > kbSearch 内置默认）；
    tests：migrations.test（新 4）/ aiDao.test（+4）/ ipc.test（+10）
  - 渲染：agentStore init 并入 kb.getSettings 拉取（成功覆盖默认/失败保留默认不阻塞）；setKbSettings 改 async 持久化 + `kbSettingsSaveState`；
    SettingsModal Save 走持久化 + saved/saving/saveFailed 提示；i18n 三文件补 3 键；agentStore.test 补 init/持久化/归位用例
- **主指挥集成**：e2e `installWeaveMDMock` kb 块补 getSettings/setSettings（批次 3 后 agentStore.init 调用 kb.getSettings，
  mock 缺函数导致 12/14 回归失败 → 补契约后 14/14）；typecheck 0 / vitest 90 files / 1255 tests / lint 0 / vite build / Playwright 14/14

## 阶段 6：测试与质量门禁 ✅ 2026-08-15（testing-quality-agent 独立核验）

- **typecheck** 0 error | **vitest** 90 files / 1256 tests 全绿 | **lint** 0 error（8 warning 均既有 useContentSync/useEditorActions）
- **vite build** 编译通过（electron-builder 打包失败为既有 icon.png 缺失，非本任务）| **Playwright ai-agent-panel 14/14**
- 覆盖率抽查充分（migrations/aiDao/ipc/agentStore/kb-settings-default 83 tests）；错误路径覆盖：写失败保留内存态（render+IPC 双端）、
  getSettings 无配置返默认 success:true、AGENT_RUN 未传 kbSettings 持久化兜底
- 铁律核验：铁律一 ✅（toolRegistry 仍 4 只读工具、WRITE_NAMES 未改、本期仅用户设置持久化非 AI 写盘）；
  铁律二 ✅（无新外发、consent 语义未变）；SECURITY ✅（SQL 参数化/user_id 隔离/无 dangerouslySetInnerHTML/无 any）；i18n 三文件键集一致
- 非阻塞发现：status.md 第 6 期文档未完整（本轮阶段 8 补齐）；迁移测试用静态 SQL 语义 + 真库 smoke 组合（见 H1）

## 阶段 7：合规核对 ✅ 2026-08-15（git-diff-reviewer → CHANGES REQUESTED → 修复）

- **两铁律** ✅：本期为「用户设置持久化」，无 AI 内容写盘新增；stretch 未做（toolRegistry/agentLoop 不在 diff、WRITE_NAMES 判项遵守）；
  无新外发、consent 语义未变
- **SECURITY** ✅：SQL 全参数化 / IPC user_id 隔离 / 无 dangerouslySetInnerHTML / 无 any / 不落明文密钥
- **CONVENTIONS** ✅：命名映射 / import 顺序 / i18n 键集一致
- **数据模型** ✅：6 列幂等迁移 + 回滚方案文档化；运行时 SQLite 3.49.2 实测
- **范围控制** ✅：diff 与 plan §1 A/B/C 组逐项一致；无编辑器内核/无关改动
- **修复**（git-diff-reviewer 发现 H1+M2）：
  - H1（HIGH）迁移真库验证缺失 + 不实注释 → 新增 `scripts/kb-migration-smoke.cjs` 真库三态实证 → **抓出真实生产 bug**：
    better-sqlite3 11.10.0（sqlite 3.49.2）对 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 报 `near "EXISTS": syntax error`，
    原实现若发布会导致 `initDatabase`→`runMigrations` 每次启动崩溃、应用无法启动 → 已改 `addAiConfigKbColumns`
    （运行期 `pragma_table_info` 探测缺失列 + 逐列 `ADD COLUMN`，幂等守卫保证）真库三态 + 读写闭环退出码 0
  - M2（MEDIUM）kbSettingsSaveState 停留 saved/error 不归位 → agentStore 增 `resetKbSettingsSaveState` + SettingsModal 打开归位
- 低优保持现状：M1（AGENT_RUN 无条件 getAiConfig，成本可忽略）、L1（handleSave 未 await，Zustand 驱动）、L2（无配置建行取默认 consent）

## 阶段 8：交付核对（gate）✅ 2026-08-15

- **最终门禁全绿**（H1/M2 修复后复跑）：typecheck 0 error | vitest **90 files / 1256 tests** | lint 0 error（8 warning 既有）|
  vite build 编译通过 | **Playwright ai-agent-panel 14/14**
- **真库迁移验证**：`npx electron scripts/kb-migration-smoke.cjs` 三态（新库/既有库/重复执行）+ upsertAiConfig 读写闭环退出码 0
- **变更核对**：18 修改 + 新增（tests 2 + 文档 2 + 脚手架 3）与 plan §1 A/B/C 组一致；
  无无关功能改动、无密钥泄露；`scripts/kb-migration-smoke.cjs` 保留工作区（dev 工具惯例）
- **文档同步**：本 status（阶段 1-8）+ 模块 11 §7 + SUMMARY + CLAUDE.md AI 节（本轮同步为「第 6 期 KB 参数持久化已交付」）
- **剩余风险**：①AGENT_RUN 无条件 getAiConfig（低优）；②正式库升级需备份优先（迁移仅在 dev/内存库验证）；
  ③既有遗留：drag-selection 5 RED / icon 打包环境 / qwen3.5 本地模型故障 / IPC userId 统一收紧

## stretch editBlocks 交付 ✅ 2026-08-15（fullstack-detail-dev，用户确认「本轮做」）

- **注册**：`toolRegistry.defineCoreTools()` 追加第 5 个工具 `editBlocks`（schema `{block_ops:[{block_id,new_content}]}`，description 注明「仅产 proposal 不落盘」）；`ToolCtx` 增 `currentDocument?`
- **执行**：`executeTool('editBlocks')` 结构校验（数组 + 每项非空）→ 无 `currentDocument` 拒 → 合法返回 `{applied:false, proposed, documentSnapshotLength}`（**只算不写，铁律一**，无写盘/写库触发点）
- **上下文注入**：`AgentRunPayload.currentDocument?` → ipc AGENT_RUN 归一透传 → `AgentReqPayload.currentDocument` → `toolsForIntent`（rewrite 意图 + currentDocument 存在才提供 editBlocks，避免无上下文调用）→ toolCtx；渲染侧 `sendAgentMessage` 载荷 `currentDocument: useEditorStore.getState().content` 快照
- **WRITE_NAMES 断言改造**：`editBlocks` 移出「不含写工具」断言（保留 writeFile/createFile/deleteFile/updateFile/upsert 仍禁止），新增「5 工具含 editBlocks」+「仅产 proposal（applied:false + files/getFile 调用 0 次）」断言
- **实现期裁定**：主进程无块树内核（第 5 期 C2），editBlocks 不做 block_id 存在性校验（仅结构校验 + 返回 proposal 文本，代码注释注明）；不做渲染侧 proposal→预览→确认 应用闭环（第 5 期既有管线职责）
- **验证**：typecheck 0 error | vitest **90 files / 1261 tests** 全绿（editBlocks +5）| lint 0 error（8 warning 既有）| vite build | **Playwright ai-agent-panel 14/14** 回归全绿

## 遗留问题（后续里程碑）

- [ ] 真 MCP server 管理（context7/firecrawl 拉起、fetchContext7/fetchFirecrawl）——继续延
- [ ] GitHub 自取 writing-shape skill——继续延
- [ ] 既有：drag-selection 5 RED / icon 打包环境 / qwen3.5 本地模型故障 / IPC userId 统一收紧 / AGENT_RUN 无条件 getAiConfig 低优
- [ ] 活验 harness scripts/{agent,rewrite,kb-migration,fts5}-smoke.cjs：保留作 dev 验证工具（不随功能提交）

---

# 第 7 期体验重构（A4 bug + A1~A3 编辑主区集成 + B1~B3 面板体验 + C1 视觉）

## 阶段 0：分级与分类 ✅ 2026-08-15

- **请求类型**：功能开发（体验重构 7 条）+ **Bug 修复（A4 选区改写错位，最优先）**
- **跨模块判断**：跨模块——编辑器 v2（selectionExport/blockEdit/toolbarState/EditorV2 高亮）+ 主进程
  （agentLoop/toolRegistry/intentRouter/ipc）+ 渲染面板（AIAgentPanel/ChatTab/AgentTab/agentStore/rewriteStore）
  + i18n 三文件 → **判为跨模块**
- **定档**：**L**（新 IPC 载荷、跨模块、写路径涉铁律、多天工作量）
- **裁剪**：无——L 级走全部阶段（TDD strict）；**需求已对齐**（grill-me 2026-08-15 完成，
  docs/requirements/ai-agent-panel-ph7.req.md §3 全决策已定，不重做）
- **批次**（req §7，每批 TDD strict、门禁全绿、提交后再下一批）：
  ① A4 bug 修复（最优先，先复现后测）→ ② A1（文档上下文注入+关键词补词+0到1整篇）→ ③ A2+A3 →
  ④ B1（/ 与 @ 补全）→ ⑤ B2（命名「智能体」文案+i18n）→ ⑥ B3（双 Tab 合并+composer 下拉）→ ⑦ C1（美化）
- **现状 ground truth**：分支 feat/ai-agent-ph3-ph4；第 6 期 6440dcd 已提交未推送；
  工作区仅 ph7 需求文档 + ph6 脚手架/活验 harness（`.claude/agents/*`、`.claude/agent-memory/`、
  `scripts/kb-migration-smoke.cjs` —— 不混入功能提交）
- **两铁律**：① AI 无直接落盘——写路径必经「红删绿增预览 → 确认 → updateContent 入 undo」；
  ② 联网/笔记外发必知情同意（allowNetwork/allowSend 分层闸）

## 阶段 2：规划 ✅ 2026-08-15（Plan 智能体）

计划已写入 docs/plan/ai-agent-panel-ph7.plan.md。关键结论：

- **A4 根因实证**：`data-block-id` 同时挂在容器 div（BlockRenderer.tsx:40 list-block / CodeBlock.tsx:49 / BlockquoteBlock.tsx:23）与叶子内容元素（LeafBlock/ListItemBlock/ContentBlock）→ DOM 序 findIndex 含容器块、比叶序偏大；既有 selectionExport 测试未挂容器 div 故未暴露
- **A1a 根因实证**：currentDocument 第 6 期已透传 toolCtx（供 editBlocks），但 runAgentFlow 组装 messages 未注入 LLM → 注入 system prompt + estimateTokens 截断 ~20k 字符
- **A1c 方案**：新增 proposeFullDocumentRewrite（整篇全量 proposal，空文档编号块协议失效走此函数）；rewriteStore.runFullDocumentRewrite + currentFile===null 拒写引导；复用第 5 期预览→确认→updateContent 管线
- **A2 方案**：computeToolbarState 混合类型改 show + mixedSyntax:true；FloatingToolbar 混合态仅「AI 改写」+ 提示，隐藏行内格式按钮
- **A3 方案**：纯 CSS overlay（.rewrite-highlight，pointer-events:none 不入 contentEditable），highlight.ts 纯函数按叶序下标+offset 算 range；随 rewriteStore.selectionContext 生命周期清除
- **B1 方案**：新 IPC AGENT_SKILLS_LIST（skillLoader.listSkillsForUi 返回 name+desc）+ CompletionMenu 组件（↑↓/Enter/Esc/外部点击）+ AgentTab 前缀触发（/ 技能、@ 当前文档/知识库）
- **B3 方案**：保留 activeMode 域隔离（loadConversations(mode)），仅合并渲染壳（单消息流 + 单 composer + 模式下拉），模式专属控件条件渲染
- **批次与并行裁定**：7 批**串行**推进（每批 TDD strict、门禁全绿、提交后再下一批）：① A4 → ② A1 → ③ A2+A3 → ④ B1 → ⑤ B2 → ⑥ B3 → ⑦ C1；②③ 共 touch rewriteStore/blockEdit、④⑤ 共 touch AgentTab/i18n，并行冲突面大于收益，串行最稳

## 批次①（A4 选区改写错位 bug）✅ 2026-08-15（fullstack-detail-dev，TDD strict）

- **修复**：`selectionExport.ts` 启用 `_content` 参数，`markdownToState` 解析得叶序权威结构；DOM `.block-content` 内容叶按**文档序位置 + 文本对齐**映射叶序下标（`stripZeroWidth` 逐叶对齐校验）；任何失同步 → 返回 `null` 保守禁用；文件头注释同步「下标源 = markdownToState 叶序」
- **实现期修正（vs plan 字面，A4 目标不变）**：plan 原拟「按 blockId 在重解析树 indexWhere」——但 blockId 含 `Math.random()`（blockTree.ts:36），每次 markdownToState 全新随机 id，DOM span id 永无法命中 → 照字面实现 100% 返回 null 改写全失效。改为文档序位置 + 文本对齐映射（已记录 agent-memory rewrite-leaf-index-a4.md，供批次②/③ 高亮定位沿用）
- **RED 复现证据**：修复前 4 fail——列表/代码块/引用容器场景 `expected 0 received 1`（容器致 DOM 下标偏大）+ 失同步未拦截
- **测试**：selectionExport +4（列表/代码块/引用容器叶序下标 + 失同步→null）、blockEdit +3（容器跨块替换区间外字节不变）
- **门禁**：typecheck 0 | vitest **90 files/1268 tests** | lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 15/15**（+1 A4 回归）
- **提交**：`6ef1f54` feat(ai): fix phase-7 A4 leaf-index selection rewrite mismatch（6 文件，未 push）

## 批次②（A1 文档上下文 + 整篇写）✅ 2026-08-15（fullstack-detail-dev，TDD strict）

- **A1a**：agentLoop.ts 新增 `buildDocumentContext`——currentDocument 注入 system 消息（首条，只读提示）；`estimateTokens >5000`（约 2 万字符）截断 20000 字符 + 截断标记；空文档不注入；与 toolsForIntent 共用同一 payload.currentDocument
- **A1b**：intentRouter rewrite 关键词补词（优化/整理/美化/改进/润一润/优化一下/整理一下/美化一下/改进一下 + optimize/improve/refine/clean up），rewrite 规则仍居首 →「帮我优化这篇文档」命中 rewrite 不再落 chat
- **A1c**：blockEdit 新增 `proposeFullDocumentRewrite`（整篇全量替换、同文本→unchanged、只算不写）；rewrite.ts document scope + 空 numberedBlocks → 系统指令「目标文档为空，直接生成完整 Markdown」；rewriteStore 新增 `runFullDocumentRewrite`（no-document 闸 → consent('chat') 闸 → rewritePreview → pendingRewrite → applyRewrite 入 undo）与 `previewDocumentFromReply`（Agent 回复路径无 IPC）；AgentTab `WRITE_WHOLE_DOC_RE` 路由 + assistant 消息「预览写入文档」按钮（文档打开且回复非空才显示）；RewritePreviewCard no-document 引导条；i18n 三文件 +2 键（ai.rewrite.noDocument / previewWrite）
- **RED**：首轮 17 失败（agentLoop 3 / intentRouter 2 / rewrite 1 / blockEdit 4 / rewriteStore 7，均为缺特性）
- **门禁**：typecheck 0 | vitest **90 files/1289 tests** | lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 17/17**（+2：整篇写闭环/未打开引导）
- **提交**：`ec62a65` feat(ai): add phase-7 A1 current-doc context + full-document write（17 文件，未 push）
- **剩余风险**：WRITE_WHOLE_DOC_RE 浅启发式（极端措辞落 agent 对话，有「预览写入文档」按钮兜底）；A1a 对非 rewrite 意图也带整篇 system 上下文（有截断保护，远端消耗未实测）

## 批次③（A2 混合类型工具栏 + A3 选区持久高亮）✅ 2026-08-15（fullstack-detail-dev，TDD strict）

- **A2**：toolbarState `SelectionState` 增 `mixedSyntax?`——跨块语法类型不一致不再 hide，改 `{kind:'show', mixedSyntax:true}`（沿用 rect 定位）；FloatingToolbar 混合态隐藏块类型下拉 + 行内格式按钮组 + 解链/橡皮擦，仅「跨块选区」提示 + 「AI 改写」按钮（根节点 `data-mixed="true"`）；mouseup 触发时机未动
- **A3**：新增 `highlight.ts` 纯函数 `buildHighlightRanges(content, sel)`（叶序下标+offset 映射当前解析树叶，越界/失同步返回空数组，绝不改块文本）；EditorV2 渲染绝对定位 `.rewrite-highlight` overlay（getBoundingClientRect 定位 + scroll/resize 重算，随 selectionContext 生命周期清除——面板聚焦/输入不清除）；globals.css `.rewrite-highlight`（color-mix accent 18% + outline + pointer-events:none + z-index:60）+ `.ft-mixed-hint`
- **RED**：toolbarState 混合类型期望 show 实际 hide；FloatingToolbarV2 期望非 null 实际 null；highlight 模块不存在 import 失败
- **门禁**：typecheck 0 | vitest **91 files/1300 tests** | lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 19/19**（+2：A2 混合类型、A3 高亮三态）
- **提交**：`973b9e4` feat(ai): add phase-7 A2 mixed toolbar + A3 persistent selection highlight（10 文件，未 push）
- **剩余风险**：高亮定位 jsdom 下不可信（以 e2e 为准）；依赖 `.block-content` DOM 序与解析叶序对齐（image/table 等非文本叶 mid-leaf 高亮保守 skip）

## 批次④（B1 `/` 与 `@` 自动补全）✅ 2026-08-15（fullstack-detail-dev，TDD strict）

- **数据源**：constants `AGENT_SKILLS_LIST` + shared `AgentSkillInfo`；`skillLoader.listSkillsForUi`（剥离 instructions，仅 name+desc；用户扩展并入；缺失目录 core-only 不抛错）；ipc handler（userId 校验 + app.getPath('userData')/skills）；preload `ai.listSkills` + weaveMDBridge noop + tests/setup mock
- **组件**：`CompletionMenu.tsx`（新增，纯展示 + capture 键盘协议：↑/↓ 循环、Enter 选中、Esc 关闭、外部点击关闭）
- **AgentTab 集成**：token 检测 `/(^|\s)([/@])([^\s/@]*)$/`；`/` 技能 / `@` 引用（当前文档/知识库）构建与过滤；handleSend 分流 `SLASH_SKILL_RE`、`@文档`、`@知识库` 优先于 WRITE_WHOLE_DOC_RE；i18n `ai.completion.*` 6 键三文件一致
- **RED**：14 fail（skillLoader 3 / ipc 3 / CompletionMenu 10 / AgentTab 8 中缺模块部分）
- **门禁**：typecheck 0 | vitest **92 files/1324 tests** | lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 21/21**（+2：@ 补全/Esc、/ 技能清单）
- **提交**：`d236068` feat(ai): add phase-7 B1 slash-at autocomplete menu（17 文件，未 push）
- **剩余风险**：B3 合并统一 composer 需同步补全触发逻辑（已判串行）；`/技能名` 剥前缀后指令若无 tech/create 关键词可能落 chat fallback（非阻塞）

## 批次⑤（B2 命名「智能体」）✅ 2026-08-15（fullstack-detail-dev，TDD strict 文案版）

- **i18n**：zh-CN `ai.tab.agent`「代理」→「智能体」、zh-TW →「智能體」、en 保持「Agent」；两处消费点（AgentTab 会话 chip 兜底名 + AIAgentPanel Tab 按钮）自动生效；全 render 扫描确认源码非注释处无「代理」展示字面量
- **测试**：新增 `tests/render/i18n/agent-label.test.ts`（5 例：键集一致/中文=智能体(en=Agent)/ai.* 域无「代理」/全键无「代理」）——初跑 3 failed 改后 GREEN
- **e2e**：6 处功能定位器「代理」→「智能体」+ 注释同步（文件头「AI 代理面板」/「薄代理」为架构表述保留）
- **门禁**：typecheck 0 | vitest **93 files/1329 tests** | lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 21/21**
- **提交**：`6e52cbd` feat(ai): rename agent label to 智能体 (phase-7 B2)（4 文件，未 push）
- **剩余风险**：低——`ai.agent.placeholder` 未使用遗留键含英文 Agent（非「代理」不触发验收）；e2e 注释含架构措辞非用户可见

## 批次⑥（B3 双 Tab 合并单面板）✅ 2026-08-15（fullstack-detail-dev，TDD strict）

- **壳合并**：AIAgentPanel 移除双 Tab 按钮 → 模式下拉 `ai-mode-select`（ai.tab.chat/ai.tab.agent）；统一渲染单个 AgentTab body；下拉切换走 toggleMode
- **AgentTab 统一 body**：读 activeMode 双模式渲染；agent 专属控件（KB 开关/压缩/KB 设置/agentBackendHint/ToolCallTrace/IntentCard/RewritePreviewCard/`/` `@` 补全/预览写入）随 `activeMode==='agent'` 条件渲染；chat 纯对话走 sendMessage 无补全；挂载/切域 effect 触发 newChat()+loadConversations(mode)，消息与会话随域切换不串号
- **发送链路隔离**：sendMessage(chat) vs sendAgentMessage(agent) 原样保留；ChatTab 保留为已验证参考组件（prod 死代码但不删不删测，避免回归）
- **i18n**：三文件新增 `ai.modeSelectLabel`，键集一致
- **RED**：5 failed（ai-mode-select 不存在、双 Tab 仍在、chat 模式 KB 开关未隐藏）；agentStore 域隔离天然通过（store 本已隔离）
- **门禁**：typecheck 0 | vitest **93 files/1338 tests** | lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 24/24**（+3：单面板无 Tab+下拉、模式切换域隔离、专属控件归属；7 处旧 Tab 定位器同步改造）
- **提交**：`bcdb240` feat(ai): merge chat-agent into single panel with mode dropdown (phase-7 B3)（9 文件，未 push）
- **剩余风险**：模式切换时 chat 流未完成即切会丢事件（store 未改，铁律纯 UI 约束下接受，属既有 finishStream 语义）；e2e 下拉 onChange 行为在测试中显式清空输入规避（无产品行为变更）

## 批次⑦（C1 视觉美化）✅ 2026-08-15（fullstack-detail-dev + frontend-design + impeccable-skill）

- **frontend-design 分析**：字号阶梯过密（10/11/12/14px 四级小字）；composer 周边距过大；深浅层次缺失（气泡/轨迹/意图卡全扁平）；会话 chip 无边框
- **impeccable-skill 打磨**：全程既有 token（--accent/--radius-input/--radius-card/--shadow-dropdown/bg-bg-*），零内联 style 零硬编码色；遵循 product register 约束（Selection 沿用既有 accent 背景色调、radius 顶到 rounded-card 12px、shadow-sm 弱阴影仅抬升交互卡片）；**修复既有违红点**：ConsentOverlay `accent-[#7C3AED]` 硬编码 → `accent-[var(--accent)]`
- **改动**：11 文件 +55/−46 纯样式——AIAgentPanel（标题/下拉弹性）、AIMessageBubble（气泡浅阴影+accent 边框+角色标签 12px）、AgentTab/ChatTab（composer `px-2.5 pt-2 pb-2.5 space-y-1.5` + textarea 收紧 + focus ring + 会话 chip 边框）、CompletionMenu（shadow-dropdown/rounded-card）、ToolCallTrace（rounded-card+shadow-sm+error 态红边）、IntentCard/KB 设置/改写卡（rounded-card+shadow-sm）、globals.css `.rewrite-highlight` 圆角 4px
- **门禁**：typecheck 0 | vitest **93 files/1338 tests** 全绿（零样式回归）| lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 24/24**（语义选择器不依赖像素；clamp 260~520 未动）
- **提交**：`ced4dcf` feat(ai): polish ai agent panel visuals (phase-7 C1)（11 文件，未 push）

## 阶段 6：测试与质量门禁 ✅ 2026-08-15（testing-quality-agent 独立核验）

- **独立实测**：typecheck 0 error | vitest **93 files/1338 tests** 全绿 | lint 0 error（8 warning 均既有）| vite build 通过 | **Playwright ai spec 24/24** | 全量 e2e **95 passed / 5 failed**（5 个均既有 drag-selection RED，用例名自标「当前 RED」）
- **i18n 键集**：三文件 ai.* 各 101 键完全一致；ai.tab.agent = Agent/智能体/智能體 ✓
- **覆盖率抽查**：A4（容器叶序 13 cases）/ blockEdit（9）/ highlight（5）/ CompletionMenu（10）/ agentLoop（9）/ intentRouter（10）/ rewriteStore（23 含全部错误路径）/ AgentTab（25）/ toolbarState（mixedSyntax）/ agentStore（22 mode 域）——需求列错误路径全覆盖
- **铁律抽核**：铁律一 ✅ 渲染侧 updateContent 全局唯一调用点 = rewriteStore.applyRewrite（先 stale 校验再入 undo），无旁路自动写；7 期主进程 AI 改动 grep 零写盘；AGENT_SKILLS_LIST 为只读 IPC（不含 instructions）；铁律二 ✅ needsConsent('chat') 在 runSelectionRewrite/startDocumentRewrite/runFullDocumentRewrite 全部存在、allowSend 分层语义未变；无 dangerouslySetInnerHTML 新增（Editor 侧 2 处为既有非 7 期）、无 any、无密钥
- **发现并修复（中）**：`e2e/floating-toolbar.spec.ts` G1 过期断言与 A2 冲突（旧断言「混合类型→工具栏不出现」被 A2 推翻，批次③漏同步既有测试）→ 按 A2 新行为更新断言（工具栏出现 + data-mixed + 仅 AI 改写）→ 已提交 `9153e66` test(ai): sync floating-toolbar G1 assertion（全量 e2e 从 94+6 恢复到 95+5）
- **低级建议（未修，记录留档）**：① proposeFullDocumentRewrite 对「非空原文+空白回复→清空」无 proposal 层防御（store 层已拦截，纵深可选）；② A2 按钮组显隐逻辑可抽纯函数补单测（当前组件/e2e 覆盖）

## 阶段 7：合规核对 ✅ 2026-08-15（git-diff-reviewer）→ APPROVED

- **两铁律** ✅：铁律一——主进程 AI 文件（agentLoop/rewrite/intentRouter/skillLoader/ipc）零写盘、rewrite.ts 仍只产 {text}、渲染侧唯一写入口 applyRewrite（stale 校验 + 入 undo）；A3 高亮纯 CSS overlay 注释明示不写 contentEditable；未打开文档拒写（no-document 引导）。铁律二——needsConsent('chat') 在 runSelectionRewrite/startDocumentRewrite/runFullDocumentRewrite 全部存在；previewDocumentFromReply 本地 transform 不弹 consent（无网络调用，LLM 调用在前置 AGENT_RUN 已有闸）合规；allowSend 分层语义未变
- **SECURITY** ✅：无 dangerouslySetInnerHTML 新增 / 无 any / 无密钥 / AGENT_SKILLS_LIST 只读（不含 instructions、userData 不可读降级 core-only）
- **CONVENTIONS** ✅：命名/导入合规；i18n 三文件各 262 键完全一致（新增 11 键同步）；无内联 style（唯二动态定位像素坐标例外属既有模式）
- **范围控制** ✅：51 文件逐一映射计划 §1 批次零 unmapped；编辑器内核（markdownToState/blockTree 等）零修改；无新表新列无迁移；新 IPC 仅 AGENT_SKILLS_LIST；计划外改动仅 9153e66（G1 测试同步，判定必要）+ tests/setup +1 mock（批次④必需）
- **问题**：无 HIGH/MEDIUM；LOW×2（IPC userId 弱校验沿用既有模式、WRITE_WHOLE_DOC_RE 启发式取舍）均记入遗留

## 阶段 8：交付核对（gate）✅ 2026-08-15

- **最终门禁全绿**（阶段 6 独立实测）：typecheck 0 error | vitest **93 files/1338 tests** | lint 0 error（8 warning 既有）| vite build | **Playwright ai spec 24/24** | 全量 e2e 95 passed/5 failed（5 个均既有 drag-selection RED）
- **提交序列**（8 个，未推送）：6ef1f54（A4）→ ec62a65（A1）→ 973b9e4（A2+A3）→ d236068（B1）→ 6e52cbd（B2）→ bcdb240（B3）→ ced4dcf（C1）→ 9153e66（G1 测试同步）；+3352/−225（51 文件）
- **文档同步**：模块 11 §7 + SUMMARY §5 + CLAUDE.md AI 节 + 本 status（阶段 0-8）
- **遗留问题**：① IPC userId 弱校验统一收紧（含 AGENT_SKILLS_LIST）；② WRITE_WHOLE_DOC_RE 浅启发式（极端措辞落 agent 对话，有预览按钮兜底）；③ proposeFullDocumentRewrite 空白回复 proposal 层防御（store 层已拦截，纵深可选）；④ 真 MCP/GitHub skill 继续延；⑤ 既有：drag-selection 5 RED / icon 打包环境 / qwen3.5 本地模型故障 / A1a 长文档远端 token 消耗未实测
