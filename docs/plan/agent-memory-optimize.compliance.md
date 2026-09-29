# agent-memory-optimize — 阶段 7 合规核对报告

> 日期：2026-09-29 | 任务：agent-memory-optimize（P0 第一批，批 A + 批 B） | 档位：L
> 产出：devflow-base SKILL 阶段 7 正式产物。**本报告为只读审查结果，审查过程未改动 `src/`、`tests/`、`e2e/`、`vitest.config.ts` 及任何其他 `docs/`。**

## 1. 头部信息

| 项 | 值 |
|----|----|
| diff 基线 | `968e056`（上一批提交 `docs: split oversized docs...`） |
| 对比终点 | HEAD `dd19c47` **+ 全部工作区未提交改动**（`git diff 968e056` 为权威口径） |
| 基线确认 | `git log --oneline -8`：`dd19c47` 为本批已提交部分，其父即 `968e056`；本批主体在工作区未提交 |
| 改动规模 | 54 文件 / +4298 −190（`git diff 968e056 --stat`） |
| 审查范围 | A 安全（SECURITY.md）9 条 / B 命名与风格（CONVENTIONS.md）10 条 / C 测试与工作流（WORKFLOW.md + 全局 CLAUDE.md）11 条 / D CLAUDE.md 项目规范 7 条 = **37 条** |
| 审查方式 | 逐条比对规范文档与实际 diff；实跑 typecheck / eslint（不带 `--fix`）/ 21 个目标测试文件；核对 4 份本批文档的可验证事实 |
| 不在范围 | 功能正确性深审、E2E 复跑、`vite build` 复跑、覆盖率复算（见 §5-5） |

## 2. 逐条核对表

### A. 安全（`.claude/rules/SECURITY.md`）

| # | 规范条目 | 出处 | 实际情况 | 结论 | 证据 |
|---|---|---|---|:--:|---|
| A1 | 禁止 hardcode 密钥/Token/密码 | SECURITY.md「密码与认证」 | 本批新增行无 `sk-*` / Bearer / 明文 password / `api_key` 字面量 | 通过 | `git diff 968e056 \| grep "^+" \| grep -E "sk-\|Bearer \|password"` → 0 命中 |
| A2 | SQL 必须参数化（`?` 占位） | SECURITY.md「数据库」 | `getRecentMessagesByRounds`：`WHERE conversation_id = ? AND user_id = ?`，绑定在 `stmt.iterate(conversationId, userId)` | 通过 | `src/main/db/ai.ts:744-752` |
| A3 | 同上 | 同上 | `ASSISTANT_UPSERT_SQL` / `TOOL_INSERT_SQL` 均为 10 个 `?` 占位的**模块级常量**，值全部走 `.run(?)` 实参 | 通过 | `src/main/db/ai.ts:788-794`、`:814-840` |
| A4 | 禁止字符串拼接 SQL | 同上 | `ORDER BY created_at DESC, rowid DESC`、`UPDATE ai_conversations ... WHERE id = ? AND user_id = ?` 均为字面常量，**无用户输入进入 SQL 文本**；新增行里唯一含 `${` 的「SQL 样式」字符串只出现在 JSDoc 注释 | 通过 | `src/main/db/ai.ts:746`、`:845-848`；`git diff ... \| grep '\$\{' \| grep -i "select\|insert\|update\|delete"` 仅命中注释 |
| A5 | 用户数据严格按 `user_id` 过滤 | 同上 | 读：`user_id = ?`；写：`appendToolTurnWithAssistant` 每条 INSERT 带 `input.userId`，会话时间戳更新带 `AND user_id = ?` | 通过 | `src/main/db/ai.ts:745`、`:817`、`:831`、`:843` |
| A6 | 禁止 `dangerouslySetInnerHTML` | SECURITY.md「前端」 | 本批 diff 零命中 | 通过 | `git diff 968e056 \| grep dangerouslySetInnerHTML` → 0 |
| A7 | IPC handler 必须验证调用来源与参数合法性 | SECURITY.md「IPC」 | 本批 **IPC 面只减不增**：删除 `AI_MESSAGE_UPDATE_TOOL_CALLS` handler 与 preload 桥（原 handler 也未校验 `event.sender`）。**既有** `AI_CONVERSATION_GET` 仍以渲染进程传入的 `userId` 为权威（`chatHandlers.ts:73-83`），非本批引入 | ⚠️需关注 | `git diff 968e056 -- src/ \| grep "^[+-].*ipcMain\.(handle\|on)"` → 仅 1 行删除；`src/main/ai/ipc/chatHandlers.ts:73-83` |
| A8 | 渲染进程不直连主进程数据库 | 同上 | 渲染侧对 DB 的第二写入点（`updateMessageToolCalls` 回写链）被整体拆除，主进程成为 tool_calls 唯一写入点 | 通过 | `src/render/stores/agentStore.ts:708`、`src/main/preload.ts`（删 2 段）、`src/render/utils/weaveMDBridge.ts:687` |
| A9 | 不削弱认证与权限 | 全局 CLAUDE.md「硬性规则」 | diff 中 consent / allowSend / allowNetwork / egress 相关**零变更行**；`kbAttachmentEgressGranted` 链路未触碰 | 通过 | `git diff 968e056 -- src/ \| grep "^[+-].*(consent\|allowSend\|allowNetwork\|egress\|auth\|permission)"` → 0 |

### B. 命名与风格（`.claude/rules/CONVENTIONS.md`）

| # | 规范条目 | 出处 | 实际情况 | 结论 | 证据 |
|---|---|---|---|:--:|---|
| B1 | 组件 PascalCase / 文件名与组件名一致 | CONVENTIONS「命名规则」「组件规则」 | 本批无新增组件；唯一组件改动为 `QuestionCard.tsx` 加 `data-testid` | 通过 | `src/render/components/AIAgent/cards/QuestionCard.tsx:493` |
| B2 | 文件/函数 camelCase | 「命名规则」 | 新增函数 `resolveReferencesDetailed` / `flushPendingToolWrite` / `createPendingToolWrite` / `getRecentMessagesByRounds` / `appendToolTurnWithAssistant` / `repairToolTurnPairing` / `toLlmToolCalls` / `utf8Length` 均合规 | 通过 | `src/main/db/ai.ts:735,802`、`src/main/ai/agent/agentContext.ts:187,207`、`src/main/ai/agent/agentToolExecutor.ts:67,83` |
| B3 | 常量/枚举 UPPER_SNAKE_CASE | 同上 | `HISTORY_BYTE_BUDGET` / `MISSING_TOOL_RESULT_PLACEHOLDER` / `ASSISTANT_UPSERT_SQL` / `TOOL_INSERT_SQL` / `DEFAULT_WINDOW_ROUNDS` / `DEFAULT_WATERMARK_ROWS` / `SUMMARY_USAGE_NOTE` 均合规 | 通过 | `agentContext.ts:105,179`、`db/ai.ts:788,791,659,661`、`contextManager.ts:32` |
| B4 | 类型/接口 PascalCase | 同上 | `RoundWindowBuilder` / `RoundWindowOptions` / `RoundWindowRow` / `ToolTurnToolWrite` / `ToolTurnWriteInput` / `ToolTurnWriteResult` / `PendingToolWrite` / `ResolvedQuery` 均合规 | 通过 | `db/ai.ts:641,647,763,768,783`、`agentToolExecutor.ts:50`、`queryPlanner.ts:224` |
| B5 | 目录 PascalCase | 同上 | 本批无新增目录 | 通过 | `git diff 968e056 --name-only` |
| B6 | 禁止 `any` | 「组件规则」+ CLAUDE.md 规范 | 新增行 `: any` / `as any` 零命中；`tsc --noEmit` **0 error** | 通过 | `git diff 968e056 \| grep "^+" \| grep -E ": any\|as any"` → 0；`npx tsc --noEmit` → exit 0 |
| B7 | 导入顺序：外部 → Stores/Hooks → 组件 → 工具/类型 | 「导入顺序」 | `agentContext.ts`：`crypto` → `electron` → `@shared/ai` → `../../db/ai`；`agentMedia.ts:14` 为 `import type`（编译期擦除，避免运行期环） | 通过 | `src/main/ai/agent/agentContext.ts:5-15`、`src/main/ai/agent/agentMedia.ts:14-15` |
| B8 | 异步 async/await，禁止裸 `.then()` | 「错误处理」 | 新增行 `.then(` 零命中；删除的 `agentStore` 回写链原为 `.catch()` 已随链路移除 | 通过 | `git diff 968e056 \| grep "^+" \| grep "\.then("` → 0 |
| B9 | 禁止内联 `style={{}}` | 「CSS 规则」 | `src/render` 新增行无 `style={{`（`QuestionCard` 仅加 `data-testid`） | 通过 | `git diff 968e056 -- src/render \| grep "^+.*style={{"` → 0 |
| B10 | IPC 调用必须 try/catch | 「错误处理」 | 本批无新增 IPC handler；被删 handler 原本带 try/catch；DB 写入改由 `db.transaction()` 统一回滚 | 通过 | `src/main/db/ai.ts:812-844` |

### C. 测试与工作流（`.claude/rules/WORKFLOW.md` + 全局 `CLAUDE.md`）

| # | 规范条目 | 出处 | 实际情况 | 结论 | 证据 |
|---|---|---|---|:--:|---|
| C1 | 不删除测试 | 全局 CLAUDE.md「硬性规则」 | 静态 `it(/test(` 计数 2525（`968e056`）→ **2656**（工作区）；`git diff` 中唯一被删的 `it(` 是**改名+改断言**（Q12 裁定），非删用例；`describe(` 删除 0 | 通过 | `git grep -h -E "^\s*(it\|test)" 968e056 -- tests/ \| wc -l` = 2525；工作区 `rg -c` 合计 2656；删除行仅 `queryPlannerEnhanced.test.ts` 1 行改名 |
| C2 | 不削弱认证或权限控制 | 同上 | 见 A9 | 通过 | 同 A9 |
| C3 | 不擅自修改历史迁移 | 同上 | `git diff 968e056 --stat -- src/main/db/` 仅 `ai.ts`（+226 −21）；`migrations*`、`db/index.ts` DDL 零变更；`migrations.test.ts` 22 例未改 | 通过 | `git diff 968e056 --stat -- src/main/db/` |
| C4 | 不提交 `.env`/密钥/DB/日志/依赖/产物 | 「Git 与文档纪律」 | `git status --short` 中无 `.env` / `.log` / `dist/` / `node_modules` / `*.db`；未跟踪文件仅 4 个（3 文档 + 2 测试，其中 1 篇为本批 memory） | 通过 | `git status --short \| grep "^??"` → `agent-memory-optimize-b-c-done.md`、`agent-memory-optimize.tdd.md`、`agentToolExecutor.test.ts`、`QuestionCard.test.tsx` |
| C5 | 不擅自新增依赖 | 全局 CLAUDE.md「基本行为」 | `package.json` / `package-lock.json` diff 为空 | 通过 | `git diff 968e056 -- package.json` → 空 |
| C6 | 文档优先：本批四件套同批产出 | 「任务工作流」 | req / plan / status / tdd 四份齐备（tdd 为未跟踪新文件），另有 direction 已入索引 | 通过 | `docs/requirements/agent-memory-optimize.req.md`、`docs/plan/agent-memory-optimize.{plan,status,direction}.md`、`docs/testing/agent-memory-optimize.tdd.md` |
| C7 | 文档描述与代码逐条一致 | 「Git 与文档纪律」末条 | **3 处漂移**（tdd 用例数 / tdd 改动文件数 / status 参数名），详见 §4 | ❌不一致 | §4-1、§4-2、§4-3 |
| C8 | 索引文档覆盖本批全部新文档 | 同上 + SUMMARY 渐进披露 | `SUMMARY.md:79` 测试列为 `—`（未挂 tdd）、计划列未挂本 compliance；`CLAUDE.md:140` / `docs/README.md:83` / `SUMMARY.md:73` 仍记 `testing/ 20 篇` | ❌不一致 | §4-4、§4-5 |
| C9 | 从 `main` 开 `feat/` 或 `fix/` 分支 | WORKFLOW「第 1 步」 | 当前在 `main` 工作区开发；用户 memory `solo-dev-minimal-branching` 已裁决「个人开发倾向直接在 main 提交」 | ⚠️需关注 | `git branch --show-current` → `main`；`MEMORY.md` `solo-dev-minimal-branching` |
| C10 | 改动行覆盖率 ≥80%（Q18 口径） | status §5 / tdd §6 | tdd 自述「覆盖率不复算（`coverage-gateb2/` 已删），按 status 转录」，并声明字面口径中间定义无法复原 | ⚠️需关注 | `docs/testing/agent-memory-optimize.tdd.md:17`、`:269`、`:342` |
| C11 | 不用 `--no-verify` 跳过 hooks、不跳测试提交 | WORKFLOW「第 4 步」 | 本批**尚未提交**，无任何 `--no-verify` / 跳测行为 | 通过 | `git log --oneline -1` → `dd19c47`（上一批）；工作区未提交 |

### D. 项目规范（`.claude/CLAUDE.md`）

| # | 规范条目 | 出处 | 实际情况 | 结论 | 证据 |
|---|---|---|---|:--:|---|
| D1 | React 18 + TS strict；不用 `any` | CLAUDE.md「规范」 | `npx tsc --noEmit` **0 error**；`tsconfig` include 覆盖 `tests/` | 通过 | `npx tsc --noEmit` → exit 0 |
| D2 | 文档优先：改代码前同步需求/技术文档，完成后更新进度与验证记录 | 同上 | req/plan/status/tdd 齐；`SUMMARY`/`README`/`CLAUDE.md`/`TODO` 的文档计数已同步（requirements 4→5、plan 20→23、TODO 加 P0 条目） | 通过 | `git diff 968e056 -- .claude/CLAUDE.md docs/README.md docs/SUMMARY.md docs/TODO.md` |
| D3 | 关键文件描述与实际结构一致 | CLAUDE.md「关键文件」 | 本批改动的关键文件（`agentLoop.ts` / `agentTaskWorker.ts` / `QuestionCard.tsx` 等）其描述语义未变；CLAUDE.md 本批仅改文档计数 | 通过 | 同上 |
| D4 | 目录结构描述一致 | CLAUDE.md「目录结构」 | `src/main/ai/ipc/`「11 个 handler 模块」数量未变（只删 handler 不删模块）；无新目录 | 通过 | `git diff 968e056 --name-only \| grep -v "docs/\|tests/\|e2e/"` |
| D5 | 质量门禁：tsc + vitest + eslint(0 error) + vite build + E2E 全绿 | CLAUDE.md「Build / Test」 | **实测 3 项**：tsc 0 error；21 个目标文件 21 passed / **571** passed；eslint 0 error / 106 warning。**vite build 与 E2E 未复跑**（转录自 Gate B，见 §5-5） | ⚠️需关注 | §6 实测记录 |
| D6 | 注释使用中文、简洁；禁叙述性废话注释 | 全局 CLAUDE.md「代码输出」 | 抽样新增注释均为中文且带出处（`plan §5` / `Q12` / `P0-4`），无「这里我们做了 XX」类 | 通过 | `agentContext.ts:101-105,178,183-195,197-206`、`db/ai.ts:748-752,796-801` |
| D7 | 只改当前任务涉及的内容，不做无关重构 | 同上 | 改动全部落在 P0-1~P0-7 触点；`resolveReferences` 保留为向后兼容包装而非直接删 API | 通过 | `src/main/ai/knowledge/queryPlanner.ts:293` |

**计数：37 条 = 通过 31 / ❌不一致 2 / ⚠️需关注 4**

## 3. 不一致项清单

| # | 类别 | 条目 | 证据 | 严重度 | 建议处置 |
|---|---|---|---|:--:|---|
| 1 | 文档↔代码 | tdd §2 记 `agentLoop.test.ts` **30 例**、合计 **570 例**；实测 **31 例**、合计 **571 例**（21 文件全绿） | `docs/testing/agent-memory-optimize.tdd.md:34`、`:49`、`:169`、`:353` vs 本阶段 `npx vitest run <21 files>` → `Tests 571 passed (571)` | 中 | **改文档**（tdd §2/§7/结论三处 570→571、30→31） |
| 2 | 文档↔代码 | tdd §1 代码基线记「`tests/` **8 文件**」；工作区实际 **10 个已修改测试文件**（另 2 个新文件已单列） | `docs/testing/agent-memory-optimize.tdd.md:13` vs `git status --short tests/` → M ×10、?? ×2 | 低 | **改文档**（8→10） |
| 3 | 文档↔代码 | status 记 `buildMinimalUnderstanding(query, res, history)`；代码实为 `buildMinimalUnderstanding(effectiveQuery, res, ctx.history)`（首参为改写后 query、三参为 `ctx.history`） | `docs/plan/agent-memory-optimize.status.md:126` vs `src/main/ai/tools/searchKBHandler.ts:99` | 低 | **改文档** |
| 4 | 文档↔索引 | 索引四件套未纳入本批新建的 `agent-memory-optimize.tdd.md`、本 `compliance.md`、并行产出的 `agent-memory-optimize.connectivity.md`（`status.md:28` 记阶段 6.5 并行在跑） | `docs/SUMMARY.md:79`（测试列 `—`、计划列只有 direction/plan/status）、`docs/SUMMARY.md:73` / `.claude/CLAUDE.md:140` / `docs/README.md:83` 仍记 `testing/ 20 篇` | 中 | **改文档**（阶段 8 交付时一并补：`testing/` 20→21 篇、SUMMARY 行挂 tdd + connectivity + compliance） |
| 5 | 文档↔日历 | `docs/TODO.md:3` 记「最后更新：2026-09-28」，而本批 req/plan/status/tdd 均署 2026-09-29 | `docs/TODO.md:3` vs `docs/testing/agent-memory-optimize.tdd.md:3` | 低 | **改文档**（→2026-09-29） |
| 6 | 文档↔代码 | req 引用 `queryPlanner.ts:432-434` 的 `!history` 门；该行现为 `understandQuery` 的历史线索块，真正的历史门在 `:460` / `:476` | `docs/requirements/agent-memory-optimize.req.md:67` vs `src/main/ai/knowledge/queryPlanner.ts:432-436,460,476` | 低 | **改文档**（req 行号改为改后口径，或标注「改前口径」） |
| 7 | 文档措辞 | req Q12 记「**取消** `extractRecentTopic` 最近主题词硬拼」；`resolveReferences` 内确已取消，但 `extractRecentTopic` 仍可经 `extractEntityFromHistory`（`queryPlanner.ts:170`）在「上面提到的 / 该」代词下命中 | `docs/requirements/agent-memory-optimize.req.md:120` vs `src/main/ai/knowledge/queryPlanner.ts:170,191`；测试注释仍提 `queryPlannerEnhanced.test.ts:122` | 低 | **改文档**（限定为「resolveReferences 主路径取消硬拼回退」） |
| 8 | 死代码 | `getMessagesByConversationPaginated`（`db/ai.ts:948`）已无 `src/` 调用点，仅测试 mock 引用；`AI_MESSAGE_UPDATE_TOOL_CALLS`（`src/shared/constants.ts:192`）已无 handler——后者 plan `:148` 明确「保留」且有测试锁（`aiMessagesWrite.test.ts:347`），前者未见保留声明 | `rg "getMessagesByConversationPaginated" src/ tests/` → `db/ai.ts:948` + 2 处测试 mock | 低 | **改文档**（在 status 说明保留理由）或 **留第二批**（删除） |
| 9 | 测试 mock 面 | `e2e/ai-agent-panel.spec.ts:371` 仍向 mock preload 注入 `updateMessageToolCalls`，而 `preload.ts` 已删除该方法（真实 API 面更窄） | `e2e/ai-agent-panel.spec.ts:371` vs `src/main/preload.ts`（−6 行） | 低 | **改测试**（删 mock 行）或 **留第二批**（无行为影响） |

### 阶段外发现（非规范违规，需总指挥裁定）

| # | 发现 | 证据 | 严重度 | 建议处置 |
|---|---|---|:--:|---|
| F1 | **重载会话可能出现空 assistant 气泡**：P0-4 把 `assistant(tool_calls)` 行以 `content: ''` 落库（`agentToolExecutor.ts:73`）；`getConversation` IPC 全量返回消息（`chatHandlers.ts:77-78`），渲染层只滤 `role === 'tool'`（`AgentTab.tsx:43`），`AIMessageBubble` 对非 tool 角色无条件渲染气泡容器（`AIMessageBubble.tsx:497-527`）→ 重开会话时工具轮上方多出一个只有角色标签的空气泡。本批 4 份文档与测试**均未覆盖该渲染后果**（tdd 只覆盖 LLM 回读侧「`content:''` 行不被滤」）。 | `src/main/ai/agent/agentToolExecutor.ts:73`、`src/main/ai/ipc/chatHandlers.ts:77-78`、`src/render/components/AIAgent/AgentTab.tsx:43`、`src/render/components/AIAgent/message/AIMessageBubble.tsx:494,497-527` | 中 | **需用户/总指挥裁定**：① 渲染层过滤「`role==='assistant' && !content.trim() && toolCalls.length>0`」的行（仅取其工作流卡片）；② 或 DB 端合并写入。属 UI 层改动，阶段 7 无权自行改代码 |
| F2 | E2E `31f/103p/1s` 与 `vite build` 为**转录**，本阶段未复跑（跑 E2E 会生成 `test-results/` 产物、build 会写 `dist/`，违反本阶段只读约束） | `docs/testing/agent-memory-optimize.tdd.md:308`、`docs/plan/agent-memory-optimize.status.md:237` | 低 | **接受转录**（status Q 已裁定「覆盖率/E2E 不重跑」）或阶段 8 补跑 |

## 4. 文档同步核对表（4 份本批文档 vs 代码实际）

| # | 文档中的可验证事实 | 出处 | 代码实际 | 结论 |
|---|---|---|---|:--:|
| 1 | 删除 `updateLatestAssistantToolCalls`（保留 `updateMessageToolCalls`） | `plan.md:56`、`status.md:112` | `src/main/db/ai.ts` 中 `updateLatestAssistantToolCalls` 已不存在，`updateMessageToolCalls`（`:1041`）仍在；`grep updateLatestAssistantToolCalls src/` = **0** | 通过 |
| 2 | 验收：`grep -rn "updateLatestAssistantToolCalls\|AI_MESSAGE_UPDATE_TOOL_CALLS" src/` 仅剩常量 1 处 | `plan.md:148`、`status.md:120` | 实跑 = **1 行**（`src/shared/constants.ts:192`） | 通过 |
| 3 | 新增 `runId`：`AgentContext` 增字段 + `randomUUID()` 每运行一次 + id `aturn_${conv}_${runId}_${round}` | `plan.md:59-61`、`status.md:152`、`req.md:124` | `agentContext.ts:63`（字段）、`:260`（`randomUUID()`）、`:606`（返回）；`db/ai.ts:805` id 拼接 | 通过 |
| 4 | P0-5 接线：`getRecentMessagesByRounds(convId, userId, KEEP_RECENT_ROUNDS, { byteBudget: 45_000 })` | `plan.md:62`、`status.md:163` | `agentContext.ts:311-313`；`HISTORY_BYTE_BUDGET = 45_000` 在 `:105`（文档记 `L101-105`） | 通过 |
| 5 | 20 由上限降为**水位线（下限）** | `req.md:123`、`status.md:49` | `DEFAULT_WATERMARK_ROWS = 20`（`db/ai.ts:661`）；`RoundWindowBuilder.push` 停机条件为 `groups.length >= rounds && rowCount >= watermarkRows` | 通过 |
| 6 | SQL 排序补 `rowid DESC` 兜底，读侧流式、不设行数硬上限 | `req.md:57`、`status.md:112` | `db/ai.ts:746`（`ORDER BY created_at DESC, rowid DESC`）、`:751-753`（`stmt.iterate` + `break`）；`getMessagesByConversation` 补 `rowid ASC`（`:933`） | 通过 |
| 7 | 回写链 6 处拆除，`agentStore` 不再回写 DB | `plan.md:148`、`req.md:48` | `agentStore.ts:708`、`preload.ts`（−2 段）、`chatHandlers.ts`（−1 handler）、`db/ai.ts`（−1 导出）、`weaveMDBridge.ts:687`、`tests/setup.ts`（−1 mock）= **6 处** | 通过 |
| 8 | tdd §2 用例数：`agentLoop` 30、合计 570 | `tdd.md:34,49,169,353` | 实测 `agentLoop` **31**、21 文件合计 **571**（全部 passed） | ❌不一致（清单 #1） |
| 9 | tdd §1 代码基线「`tests/` 8 文件」 | `tdd.md:13` | 工作区 `git status --short tests/` → **M 10 + ?? 2** | ❌不一致（清单 #2） |
| 10 | status「`buildMinimalUnderstanding(query, res, history)`」 | `status.md:126` | `searchKBHandler.ts:99` → `buildMinimalUnderstanding(effectiveQuery, res, ctx.history)` | ❌不一致（清单 #3） |
| 11 | `vitest.config.ts` 全程未改、coverage.include 仍为 FT4 的 5 个编辑器文件 | `tdd.md:290` | `git status --short vitest.config.ts` → 空；文件 `:14-19` 确为 5 个编辑器文件 | 通过 |
| 12 | E2E 新增 2 条场景①② + `QuestionCard` `data-testid` | `status.md:236`、`status.md:235` | `e2e/ai-agent-panel.spec.ts:1949-2041` 新增 2 条 `test(`；`QuestionCard.tsx:493` 有 `data-testid="question-card"` | 通过 |

## 5. 结论

**能否进入阶段 8（交付核对）：可以，但需先闭合 4 项。**

1. **无安全/权限/迁移/依赖类红线违规**：A、B 两组 19 条全通过；A7（IPC 来源校验）为既有问题，非本批引入。
2. **无测试删除、无测试削弱**：C1 通过（2525 → 2656），唯一 `it(` 删除行是 Q12 裁定的改名+改断言，且已在 req `:120` 有裁定记录。
3. **2 项 ❌不一致 + 1 项功能风险必须处置**：
   - 清单 #1/#2（tdd 计数）→ 改 tdd；
   - 清单 #4（索引未挂 tdd/compliance、`testing/ 20 篇`）→ 改 SUMMARY + CLAUDE.md + docs/README；
   - **F1（重载空 assistant 气泡）→ 需总指挥/用户裁定**，阶段 7 无权自行改代码。
4. **门禁复核状态**：typecheck / eslint / 21 文件 vitest **本阶段实测全绿**；`vite build` 与 E2E 为转录（清单 #F2），建议阶段 8 一并复跑或明确接受转录。
5. **覆盖率**：Q18 口径为 status 转录、tdd 已自陈「不复算 + 中间口径无法复原」（C10）；如需闭环，建议第二批留存分析脚本后复算。

**处置清单（按 devflow 阶段 7 规则）**：
- 可单方修正 → 全部为**改文档**（清单 #1~#7）+ 可选改测试（#9）+ 可选删死代码（#8，需裁定）；
- 无法单方修正 → **F1 停下问用户**；
- 其余 31 条通过项无需动作。

## 6. 本阶段实测命令与结果

| 命令 | 结果 |
|---|---|
| `git log --oneline -8` | 基线确认：`dd19c47` ← `968e056` |
| `git diff 968e056 --stat` | 54 文件 / +4298 −190 |
| `git diff 968e056 --stat -- src/ tests/ e2e/ docs/ package.json src/main/db/` | package.json 空；`src/main/db/` 仅 `ai.ts`（迁移/DDL 零变更） |
| `git diff 968e056 -- tests/ \| grep "^-\s*it("` | 1 行（改名），`describe(` 0 行 |
| `git status --short` | 未跟踪仅 4 文件；无 `.env`/日志/DB/产物 |
| `npx tsc --noEmit` | **exit 0 / 0 error** |
| `npx eslint src/ --ext .ts,.tsx`（**不带 `--fix`**） | **0 error / 106 warning**（全部为既有 `no-console` / `no-unused-vars`） |
| `npx vitest run <21 个目标文件>` | **Test Files 21 passed (21) / Tests 571 passed (571)**，30.39s |
| `grep -rn "updateLatestAssistantToolCalls\|AI_MESSAGE_UPDATE_TOOL_CALLS" src/` | 1 行（仅 `shared/constants.ts:192`），与 plan `:148` 验收一致 |
| `git diff 968e056 \| grep "^+"` 系列扫描 | `: any`/`as any` 0；`.then(` 0；`dangerouslySetInnerHTML` 0；`src/render` 新增 `style={{` 0；密钥模式 0 |
