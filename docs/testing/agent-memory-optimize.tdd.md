# agent-memory-optimize — TDD 证据报告（L / strict）

> 创建：2026-09-29 | 档位：**L** | 强度：**strict**（RED 实测 → 最小实现 GREEN → 重构 → 改动行覆盖率 ≥80% → checkpoint → 本报告）
> 来源：[计划](../plan/agent-memory-optimize.plan.md) / [状态](../plan/agent-memory-optimize.status.md) / [需求](../requirements/agent-memory-optimize.req.md)
> 本文只转录与核验已留存的实测证据；**未留存原始输出的 RED 一律显式标注，不做补造**（见 §3、§8）。

## 1. 元信息

| 项 | 值 |
|----|----|
| 日期 | 2026-09-29 |
| 档位 / TDD 强度 | **L** / **strict** |
| 代码基线 | HEAD `dd19c478ebbd49afff8bb4ea87e5498c2253ed5a`（`feat(agent): unify chat history, persist tool turns with assistant rows and rewrite KB queries by reference`）**+ 未提交改动**（`src/` 6 文件、`tests/` 10 文件、`e2e/ai-agent-panel.spec.ts`、新文件 `agentToolExecutor.test.ts` / `QuestionCard.test.tsx`） |
| 覆盖率 diff 基线 | `968e056`（status Q18 口径：`git diff -U0 968e056`），覆盖 HEAD 已提交部分 + 未提交部分 |
| 范围 | P0-1 ~ P0-7（req §二），批 A（P0-1/2/3）+ 批 B（P0-4/5/6/7）+ E2E 场景①② |
| 不在范围 | 模块三/五/六、E2E 场景③、`anthropicClient`/`anthropicCompat` 丢 `tool` 角色、DDL 迁移 |
| 本报告取数方式 | 只跑目标测试文件（`npx vitest run <files> --reporter=json`），**未跑全量 vitest、未跑 playwright**；覆盖率不复算（`coverage-gateb2/` 已删），按 status 转录 |

## 2. 测试范围（测试文件 → 用例数 → 覆盖 P0）

用例数为 vitest json reporter 实测（运行期计数，含 `for` 循环生成的用例），2026-09-29 实跑：

| # | 测试文件 | 用例数 | 覆盖 | 性质 |
|---|----------|-------:|------|------|
| 1 | `tests/main/db/aiMessagesWrite.test.ts` | 14 | P0-4 | 新建（B-a 11 + B-b-fix 3） |
| 2 | `tests/main/db/aiMessagesRead.test.ts` | 18 | P0-5 | 新建 |
| 3 | `tests/main/ai/agentContext.test.ts` | 38 | P0-1/2/3/4/5/6 | 扩展（基线 14 → 38） |
| 4 | `tests/main/ai/agentToolExecutor.test.ts` | 7 | P0-4 | 新建（B-b 6 + B-b-fix 1） |
| 5 | `tests/main/ai/knowledgeClarify.test.ts` | 28 | P0-7 | 新建 |
| 6 | `tests/main/ai/searchKBHandler.test.ts` | 6 | P0-6 | 新建 |
| 7 | `tests/main/ai/agentKbPreloader.test.ts` | 28 | P0-6 | 扩展（26 → 28，+2 覆盖补测） |
| 8 | `tests/main/ai/ipc.test.ts` | 83 | P0-6 | 扩展（+1 覆盖补测） |
| 9 | `tests/main/ai/agentMedia.test.ts` | 15 | P0-4 | 扩展（+3） |
| 10 | `tests/main/ai/agentLoop.test.ts` | 31 | P0-4 | 扩展（+4）+ 阶段 6 补测（流式死循环 +1、S16 改真断言） |
| 11 | `tests/render/components/AIAgent/QuestionCard.test.tsx` | 1 | E2E 钩子 | 新建 |
| | **小计（实跑 #1–11）** | **268** | | **268 passed / 0 failed** |
| 12 | `tests/main/ai/agentPromptBuilder.test.ts` | 50 | P0-2 | 扩展（仅追加，0 删除） |
| 13 | `tests/main/ai/contextManager.test.ts` | 18 | P0-2 | 改写 1 条（plan §4 必改 #1） |
| 14 | `tests/main/ai/intentRouter.test.ts` | 17 | P0-3 | 扩展（+5） |
| 15 | `tests/main/ai/queryPlannerEnhanced.test.ts` | 52 | P0-6 | 改写 1 条（Q12）+ 追加 8 |
| 16 | `tests/main/ai/toolRegistry.test.ts` | 33 | P0-6 保绿 | **未改** |
| 17 | `tests/main/ai/kbSearch.test.ts` | 24 | P0-6 三红线保绿 | **未改** |
| 18 | `tests/main/db/aiDao.test.ts` | 34 | P0-4 夹具 | 扩展 |
| | **小计（实跑 #12–18）** | **228** | | **228 passed / 0 failed** |
| 19 | `tests/render/stores/agentStore.test.ts` | 36 | P0-4 回写链 | 扩展（+1） |
| 20 | `tests/main/db/migrations.test.ts` | 22 | 保绿（本批无迁移） | **未改** |
| 21 | `tests/main/ai/streamingToolExecutor.test.ts` | 16 | P0-4 mock key | 扩展（+2 行） |
| | **小计（实跑 #19–21）** | **74** | | **74 passed / 0 failed** |
| | **合计 21 文件** | **571** | | **571 passed / 0 failed / 3 轮独立运行 + 阶段 7 复跑复核** |

命令：

```bash
npx vitest run tests/main/db/aiMessagesWrite.test.ts tests/main/db/aiMessagesRead.test.ts \
  tests/main/ai/agentContext.test.ts tests/main/ai/agentToolExecutor.test.ts \
  tests/main/ai/knowledgeClarify.test.ts tests/main/ai/searchKBHandler.test.ts \
  tests/main/ai/agentKbPreloader.test.ts tests/main/ai/ipc.test.ts \
  tests/main/ai/agentMedia.test.ts tests/main/ai/agentLoop.test.ts \
  tests/render/components/AIAgent/QuestionCard.test.tsx
# → Test Files 11 passed (11) / Tests 268 passed (268), Duration 18.16s
```

## 3. RED 实测记录（逐 P0）

> 证据强度标注口径：**【实测】** = status 留存了该步的失败计数/原始输出片段；**【推导】** = 计数有留存但未留逐条失败输出，按实现前断言失败逻辑推导；**【补测】** = 先有实现后补断言，按定义无 RED。

### P0-1 chat 意图保留历史与摘要

| 项 | 内容 |
|----|------|
| 断言落点 | `agentContext.test.ts` → `P0-1：chat 意图下 buildCompressed 收到 history.length > 1 且 summary 非空` |
| 断言内容 | `expect(historyArg.length).toBeGreaterThan(1)`、`filter(role==='user').length > 1`、`String(args[1]).toContain('导出能力')`（summary）、`flat` 含 `上一轮问题一` / `上一轮回答二` |
| RED | **【实测·汇总】** 批 A 步骤 A-b-1：`3 failed → 18 passed`（status 批 A 表） |
| 失败断言输出 | **未留原始输出 → 【推导】** 改前 `agentContext.ts` `const history = isChat ? [currentUserMsg] : allDbMessages` 使 chat 下 history 恒 1 条、`!isChat && summary` 使 summary 恒空，上述长度与非空断言必红 |

### P0-2 移除「忽略之前所有对话」反上下文指令

| 项 | 内容 |
|----|------|
| 断言落点 | ① `agentPromptBuilder.test.ts` → `describe('P0-2 — 去反上下文统一措辞')`，运行期 9 条（3 个 target × 「不含反上下文表述」/「保留防串题条款 + 统一措辞」+ 3 条结构断言）；② `contextManager.test.ts` → `returns only summary system when no keep rounds`（改写）；③ `agentContext.test.ts` → `:449 反上下文行改写：不含「忽略之前的所有对话」，保留 :444 分隔行` |
| 断言内容 | 三处 `not.toContain('忽略之前的所有对话')` / `not.toContain('独立的新')` / `not.toContain('不要延续之前的问题')`，且 `toContain('必须且只能回答用户的最后一条消息')` 与统一措辞 `历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答` |
| RED | **【实测·汇总】** A-a：`7 failed → 68 passed`（68 = agentPromptBuilder 50 + contextManager 18，本报告复核一致）；③ 归入 A-b-1 的 `3 failed` |
| 失败断言输出 | **① ③ 未留原始输出 →【推导】**；② **可复原**：`git diff 968e056 -- tests/main/ai/contextManager.test.ts` 显示改前硬断言为 `expect(out).toEqual([{ role:'system', content:'以下为历史摘要（仅供参考，不要延续之前的问题回答）：S' }])` —— 该断言对新前缀必红，新断言对旧前缀必红，双向可证 |

### P0-3 `needsClarification` 不再被纯长度触发

| 项 | 内容 |
|----|------|
| 断言落点 | `intentRouter.test.ts` 5 条新用例：`P0-3: 有历史时零命中 chat 兜底不再被长度门触发` / `P0-3: 无历史 / 缺省调用保持现状（仍需澄清）` / `P0-3: length<6 长度门仅在无历史时生效` / `P0-3: confidence<0.85 && length<10 长度门仅在无历史时生效` / `P0-3: confidence < 0.7 在有历史时无条件保留`；`agentContext.test.ts` `describe('A-b-3 — classifyIntent 接线 { hasHistory }')` 4 条 |
| 断言内容 | `classifyIntent('它有什么优势', { hasHistory:true }).needsClarification === false`；`hasHistory:false` / 缺省调用仍为 `true`；`classifyIntent('改一下', { hasHistory:true })` 为 `false` |
| RED | **【实测·汇总】** A-b-2：`3 failed → 17 passed`；A-b-3：`4 failed → 22 passed` |
| 失败断言输出 | **未留原始输出 → 【推导】**；并可确证 5 条新断言中仅 3 条先红，余 2 条中 `confidence < 0.7` 条因该门本就是无条件保留、`无历史 / 缺省` 条因断言的是「维持现状」，按断言内容属**首跑即绿的回归守护** |

### P0-4 `tool_calls` 落库与合法行序

| 步骤 | RED（status 原文） | 失败断言输出 |
|------|--------------------|--------------|
| B-a + B-e（新建 `aiMessagesWrite`/`aiMessagesRead` + 拆回写链） | **【实测】** `tests/main/db/` **24 例失败** + `agentStore` **1 例红** | 摘录：缺三个新 DAO 导出、`rowid` 断言红、6 处静态验收命中 `updateLatestAssistantToolCalls` 标识符 |
| B-b（写路径切新 DAO） | **【实测】** **8 failed** | 原始输出摘录：`createPendingToolWrite is not a function`、`expected "spy" to be called 1 times, but got 0 times` |
| B-b-fix（Q16 `runId` 运行维度） | **【实测】** **9 failed / 12 passed** | 原始输出摘录：`expected 3 to be 4`、`expected undefined to be 'run-x'`、静态验收命中 `db/ai.ts` 旧拼接 |
| B-c（读取集成 + 配对修复） | **【实测】** **12 failed / 36 passed（3 文件）** | 原始输出摘录：`expected [] to have a length of 25 but got +0`、`expected undefined to deeply equal [...]`、`expected null not to be null` |
| **`agentTaskWorker.ts:398` 新断言** | **无断言级 RED（首跑即绿）** | 该行基线已被既有测试覆盖（逐行取值复核 s=5），是第一轮「行映射判定误差」；新断言 `ipc.test.ts` → `P0-6：searchKb 透传 expandedQueries 到底层 searchKB（双路召回）` 补的是**行为验证**（缺行透传则收到 `undefined` 必红）。见 §8 |

### P0-5 上下文读取按轮次统一

| 项 | 内容 |
|----|------|
| 断言落点 | `aiMessagesRead.test.ts` 18 例（`SQL 参数化 + 排序含 rowid DESC` / `多 tool 单轮 25 行完整取回` / `跨 3 轮 60 行取回 3 轮` / `max(最近 3 轮全量, 20 行)` / `字节预算超支时在轮边界停，但至少保留最近 1 轮` / `预算充足时不截断工具结果（红线）` / 迭代器 `close=1`/`close=0` 2 例）；`agentContext.test.ts` `describe('B-c P0-5 — 上下文按轮读取')` 3 例 |
| RED | **【实测·汇总】** 归入 B-a 的 `tests/main/db/` 24 例（`rowid DESC` 断言红）与 B-c 的 12 failed（`expected [] to have a length of 25 but got +0`） |
| 失败断言输出 | 仅 B-c 一条有原始输出留存；B-a 侧**未留逐条输出 →【推导】**（新建文件对未实现的 `getRecentMessagesByRounds` 必然模块级/断言级红） |

### P0-6 searchKB 拿到历史并接入代词改写

| 项 | 内容 |
|----|------|
| 断言落点 | `searchKBHandler.test.ts` 6 例（`有历史 → 检索 query 被改写为含明确对象，expandedQueries 附原 query` / `无历史 → 恒等返回，且不带 expandedQueries` / `有历史但解不出明确实体 → 恒等返回 + 无 expandedQueries（Q12 回退收紧）` / `无指代词的普通 query…` / `有历史 → 不再触发 pronoun_reference 澄清问题` / `无历史 → 保持现状…`）；`queryPlannerEnhanced.test.ts` 追加 `describe('resolveReferencesDetailed（P0-6 Q12 回退收紧）')` 8 例；`agentContext.test.ts` `toolCtx.history 注入` 2 例 |
| RED | **【实测】** B-d **9 failed** → **58 passed** |
| 失败断言输出 | **原始输出摘录**：`'WeaveMD项目的架构是怎样的的的主要模块有哪些？'` —— 该红用例本身即被删硬拼回退有害性的实证 |
| 覆盖补测 | `agentKbPreloader.test.ts` 2 例（`expandedQueries 非空 → 绕过预载缓存直调 original（P0-6）` / `expandedQueries 为空数组 → 不绕过，仍走预载缓存（P0-6）`）→ **【实测】覆盖口径先红后绿**（status 原文）；`ipc.test.ts` 的 `P0-6：searchKb 透传 expandedQueries…` **未记录 RED → 见 §8 标注** |

### P0-7 `knowledgeClarify` 只补测试

| 项 | 内容 |
|----|------|
| 断言落点 | `knowledgeClarify.test.ts` 28 例（`needsClarification` 三分支 + 4 条边界、`插值模板统一使用「」，不出现『』`、`源文件不含任何 history 引用（门控在 queryPlanner.ts:432）`、`历史已消解歧义的理解结果…不触发澄清`、分轮提问与截断等） |
| RED | **【补测·无 RED】** status 原文：「28 例一次全绿 —— 如实记录为『新增测试对既有实现的验证，无 RED 可造』」。plan §3 P0-7 本身即「只补测试、不改代码」，`git diff -- src/main/ai/knowledge/knowledgeClarify.ts` 两次为空 |
| 验收 | `knowledgeClarify.ts` diff 为空 ✅；`searchKB` 拒答 0.6 / 置顶 ×1.5 / searchMode 三模式由 `kbSearch.test.ts`（24 例，未改）回归守绿 ✅ |

## 4. GREEN 记录

### 4.1 Gate A（2026-09-28 实测，批 A 完成后）

| 门禁 | 结果 |
|------|------|
| `npm run typecheck` | **0 error** ✅ |
| `npx vitest run` | **162 文件 / 3869 测试全通过**（exit 0）✅ |
| `npm run lint` | **0 error**（106 warning 全为既有）✅ |
| `npx vite build` | **exit 0** ✅ |
| `npx playwright test` | **31 failed / 101 passed / 1 skipped**，`test-results/` 逐 spec 分组与基线完全一致 → **零新增** ✅ |

批 A 逐步 GREEN：A-a `7 failed → 68 passed`、A-b-2 `3 failed → 17 passed`、A-b-1 `3 failed → 18 passed`、A-b-3 `4 failed → 22 passed`；批 A 合计 4 源码文件 + 4 测试文件。

### 4.2 批 B 逐步 GREEN（status 原文）

| 步骤 | GREEN |
|------|-------|
| B-a + B-e | `tests/main/db/ + agentStore` → **189 passed（10 文件）**；全量 `npx vitest run --coverage` → **166 文件 / 3942 测试全绿**；`src/main/db/ai.ts` 87.45 stmts / 81.76 branch |
| B-d | **58 passed**；`tests/main/ai/` 45 文件 / 996 测试绿；`queryPlanner.ts` 96.58 lines |
| B-f | `knowledgeClarify.test.ts` **28 例全绿**；`knowledgeClarify.ts` Stmts 95.88 / Branch 95.34 / Funcs 100 |
| B-b | `tests/main/ai/` **46 文件 / 1006 测试**、全量 **167 文件 / 3952 测试**；`agentLoop.ts` 84.72 / `agentToolExecutor.ts` 85.82 Stmts |
| B-b-fix | `tests/main/` 64 文件 / 1287 测试（排除既有 flaky 后 63/1250 全绿，单跑 37/37 绿）；`agentContext.ts` 88.01 Stmts |
| B-c | `tests/main/` 64 文件 / 1305 例、`tests/render/` 30 文件 / 276 例全绿；`agentContext.ts` **89.77** / `agentMedia.ts` **89.28** Stmts |
| Gate B 第一轮 | typecheck 0 / vitest 168 文件 3976 例（3975 passed + 1 既知 flaky）/ eslint 0 error / vite build 成功 / E2E 零新增 —— **唯覆盖率 6/17 未达标 → 触发 Q18** |

### 4.3 Gate B 复跑（口径 A，2026-09-29 实测）

| 门禁 | 结果 |
|------|------|
| `npm run typecheck` | **0 error** ✅（tsconfig `include` 含 `tests`） |
| `npx vitest run` ×3 | 168 文件 / 3977~3979 测试；3 次红项**恒且仅**为既知 flaky，隔离单跑 **37/37 ×3、59/59 ×2 全绿** → 复跑判过 ✅ |
| coverage run（`--exclude` 两个 flaky 文件） | **166 文件 / 3920 测试全绿 ×3**，`coverage-final.json` run #3 落盘 ✅ |
| `npx eslint src/ --ext .ts,.tsx`（不带 `--fix`） | **0 error / 106 warning**；跑后 `git status --short src/` 仍为原 6 个 M，无文件被改写 ✅ |
| `npx vite build` | 成功（renderer 13.62s + preload 50ms），仅既有 dynamic-import 分块提示 ✅ |
| `npx playwright test` | **31 failed / 103 passed / 1 skipped**，11 个 spec 逐组与基线一致，新增 2 条 passed ✅ |
| **改动行覆盖（Q18）** | **287 / 287 = 100.00% ≥ 80%**，**0 个未覆盖新增行** ✅ |

### 4.4 本报告实跑（2026-09-29，仅目标文件）

21 个目标/保绿测试文件 → **571 passed / 0 failed**（269 + 228 + 74，分 3 轮 `npx vitest run` 实测；269 含阶段 6 补测的 `agentLoop` 死循环 +1 例）。**未跑全量 vitest、未跑 playwright**（Gate B 已有实测，见 §6）。

## 5. 重构与必须保持不变的断言

### 5.1 plan §4「必须改动的既有断言（4 处）」逐条确认

| # | 断言/面 | 状态 | 证据 |
|---|---------|:----:|------|
| 1 | `contextManager.test.ts:72-75` 摘要前缀硬断言 | **已改（P0-2 必改）** | diff 11+/1-；改前 `toEqual([{role:'system',content:'以下为历史摘要（仅供参考，不要延续之前的问题回答）：S'}])` → 改为 `toContain` 分项 + `not.toContain('忽略之前的所有对话')` 等 3 条否定断言；18 例全绿 |
| 2 | `queryPlannerEnhanced.test.ts:101-106` 硬拼回退断言 | **已改（Q12 有意回退）** | 见 §5.3 单独成段 |
| 3 | `tests/setup.ts:71`、`weaveMDBridge.ts:687` 回写通道连带 | **已改** | `tests/setup.ts` diff `0 增 1 删`（删 `updateMessageToolCalls: vi.fn(...)`）；`weaveMDBridge.ts` `0 增 1 删` |
| 4 | mock 面：`agentContext.test.ts:24-28`、`agent-perf-benchmark.test.ts:458-488`、`agentLoop.test.ts:19-22` 的 `@main/db/ai` mock 须补新增 DAO 导出 | **已改** | `agentContext.test.ts` 删 `getMessagesByConversationPaginated` mock 键 → 换 `getRecentMessagesByRounds`（该文件 4 条删除行全部属此项）；benchmark `+22/0`；`agentLoop.test.ts` mock 补 `appendToolTurnWithAssistant` |

### 5.2 plan §4「必须保持不变的既有断言」逐条确认

| 断言 | 状态 | 证据（2026-09-29 实测） |
|------|:----:|--------------------------|
| `queryPlannerEnhanced.test.ts` 原 `:107-110`（无历史恒等，`:225` 守护） | **绿·未改** | 现位于 `:110-113` `it('无历史时，指代词查询原样返回')` → `expect(result).toBe('这个是什么意思？')`；该测试无 diff |
| `queryPlannerEnhanced.test.ts` 原 `:112-124`（`"上面提到的"` 提取最近主题） | **绿·未改** | 现位于 `:115-126`，`expect(resolved).not.toBe('该组件支持哪些策略？')` 保留 |
| `contextManager.test.ts:77-107` 轮/tool 切分 | **绿·未改** | diff 唯一 hunk 起于 71 行，其后无改动；`keeps recent N rounds…` 断言原样，18 例全绿 |
| `toolRegistry.test.ts` 全部 searchKB 用例 | **绿·未改** | `git diff 968e056 -- tests/main/ai/toolRegistry.test.ts` 为空；33 例全绿 |
| `kbSearch.test.ts` 三红线（0.6 拒答 / 置顶 ×1.5 / searchMode 三模式） | **绿·未改** | diff 为空；24 例全绿 |
| `agentPromptBuilder.test.ts` 不涉文案的原用例 | **绿·未改** | diff **0 删除、仅 +50 行追加**；运行期 50 例全绿 |
| `intentRouter.test.ts:71-82` 兜底语义 | **绿·未改** | diff 首个 hunk 起于 86 行；`falls back to chat when no keyword hits` / `returns fuzzy candidates…` 原样；17 例全绿 |
| `migrations.test.ts` 全量（本批无迁移） | **绿·未改** | diff 为空；22 例全绿 |
| `agentKbPreloader.test.ts` 预载缓存（无 `expandedQueries` 时行为不变） | **绿·未改** | diff **0 删除、仅 +32 行**（新增 2 例）；28 例全绿 |

> **行号漂移提示**：`queryPlannerEnhanced.test.ts` 在 Q12 改写后整体 +2 漂移，status B-d 段写作「`queryPlannerEnhanced:107-110` 按 Q12 改为断言恒等返回 + `resolved:false`」，与 plan §4「`:101-106` 必改 / `:107-110` 必须不变」是同一组断言的**改前/改后行号混用**。语义上两类断言已分别按 §5.2、§5.3 核验，均符合预期；行号引用应以改前（`968e056`）为准。见 §8-7。

### 5.3 Q12 有意回退（`queryPlannerEnhanced.test.ts` 单独成段）

**性质**：req Q12 = 「取消 `extractRecentTopic` 的『最近 3 条 user 文本硬拼 `${topic}的`』回退」，**属计划内的能力回退**，不是回归。plan §4 把它列入「必须改动」，plan §7 风险 10 要求本报告留证。

**改前断言**（`git diff 968e056` 取回）：

```ts
it('"它的" 代指消解（跨文档引用）', () => {
  const history = [{ role: 'user', content: 'WeaveMD项目的架构是怎样的？' }];
  const resolved = resolveReferences('它的主要模块有哪些？', history);
  expect(resolved).not.toBe('它的主要模块有哪些？');   // 依赖硬拼回退
  expect(resolved).toContain('WeaveMD');
});
```

**改后当前断言**（`tests/main/ai/queryPlannerEnhanced.test.ts:99-108`）：

```ts
it('"它的" 代指消解（跨文档引用）→ 解不出明确实体则原样返回 + resolved:false（Q12 取消硬拼回退）', () => {
  const history = [{ role: 'user', content: 'WeaveMD项目的架构是怎样的？' }];
  // 历史里没有可提取的明确实体（无 关于/对于/在/讨论、无并列/书名号结构）
  expect(resolveReferences('它的主要模块有哪些？', history)).toBe('它的主要模块有哪些？');
  const detailed = resolveReferencesDetailed('它的主要模块有哪些？', history);
  expect(detailed.query).toBe('它的主要模块有哪些？');
  expect(detailed.resolved).toBe(false);
});
```

**佐证**：B-d 的 RED 9 failed 中含 `'WeaveMD项目的架构是怎样的的的主要模块有哪些？'` —— 硬拼回退确实会产出重复助词的劣化 query，回退取消有实证。回退后的正向能力由同文件新增 `describe('resolveReferencesDetailed（P0-6 Q12 回退收紧）')` 8 例守护（`历史空 → 恒等返回 + resolved:false` / `解不出明确实体 → 恒等返回 + resolved:false` / `能解出明确实体 → 改写并 resolved:true`），52 例全绿。

## 6. 覆盖率（Q18 改动行口径）

**口径**（req/plan/status Q18，用户选定 A）：改动行覆盖 ≥80%；**删除行不计**；`preload.ts` 与 `toolTypes.ts` 判不适用；未覆盖的新增行补测。保留 strict TDD 本意（新代码必须有测），不为本任务未写的代码造测。

### 6.1 18 文件改动行明细（`git diff -U0 968e056 --numstat -- src/` 实测，2026-09-29）

> **时点口径**：本表为 **Gate B（口径 A）时点** 的 18 文件。阶段 6.5 新增 `AgentTab.tsx` 修复后 `src/` 为 **19 文件 / 597 新增行**，最新覆盖见 §9（589/589 = 100%）。

| # | 文件 | 新增 | 删除 | 备注 |
|---|------|-----:|-----:|------|
| 1 | `src/main/db/ai.ts` | 226 | 21 | `getRecentMessagesByRounds` / `appendToolTurnWithAssistant` / 删 `updateLatestAssistantToolCalls` |
| 2 | `src/main/ai/agent/agentContext.ts` | 137 | 39 | `runId` / `repairToolTurnPairing` / `toLlmToolCalls` / P0-5 接线 / `:449` 文案 |
| 3 | `src/main/ai/agent/agentToolExecutor.ts` | 61 | 14 | `PendingToolWrite` 批次 + 单次 flush |
| 4 | `src/main/ai/knowledge/queryPlanner.ts` | 60 | 32 | `resolveReferencesDetailed` + 删 `extractRecentTopic` 硬拼 |
| 5 | `src/main/ai/tools/searchKBHandler.ts` | 17 | 8 | 改写前置 + `expandedQueries` 双路召回 |
| 6 | `src/main/ai/agent/agentMedia.ts` | 13 | 1 | `tool_calls` 行类型与映射透传 |
| 7 | `src/main/ai/toolTypes.ts` | 8 | 0 | **判不适用**（纯类型） |
| 8 | `src/main/ai/agent/agentLoop.ts` | 8 | 3 | 流式轮次单次 flush |
| 9 | `src/main/ai/intentRouter.ts` | 8 | 3 | `hasHistory` 签名 + 三处长度门 |
| 10 | `src/main/ai/agent/agentKbPreloader.ts` | 6 | 0 | `expandedQueries` 绕过预载缓存 |
| 11 | `src/main/ai/contextManager.ts` | 5 | 1 | `SUMMARY_USAGE_NOTE` 摘要前缀 |
| 12 | `src/main/ai/agent/agentPromptBuilder.ts` | 5 | 5 | 核心规则 2/3 + `CHAT_SYSTEM_PROMPT` 2/3/4 |
| 13 | `src/main/ai/agent/agentTaskWorker.ts` | 3 | 1 | `:398` 透传 `expandedQueries`（1 行真实语句） |
| 14 | `src/render/components/AIAgent/cards/QuestionCard.tsx` | 1 | 0 | `:493` `data-testid="question-card"` |
| 15 | `src/render/stores/agentStore.ts` | 1 | 8 | 删回写（1 行为注释） |
| 16 | `src/main/ai/ipc/chatHandlers.ts` | 0 | 16 | **纯删除** |
| 17 | `src/main/preload.ts` | 0 | 6 | **判不适用** + 纯删除 |
| 18 | `src/render/utils/weaveMDBridge.ts` | 0 | 1 | **纯删除** |
| | **合计** | **559** | **159** | |

### 6.2 汇总与双口径对照

| 项 | 数值 |
|----|-----:|
| 新增行合计 | **559** |
| 已覆盖 | **287** |
| 未覆盖新增行 | **0** |
| N/A（注释 48 / 空行 / 纯括号 / 纯类型 / JSX 纯属性） | **264** |
| 判不适用（`toolTypes.ts` 8 行） | **8** |
| **合计校验** | 287 + 0 + 264 + 8 = **559** ✅ |
| **改动行覆盖** | **287 / 287 = 100.00% ≥ 80%** ✅ |
| 双口径对照（status 原文转录） | 窄口径（按不可执行类别剔 N/A）**100%**；字面口径（仅「无 statement 映射」算 N/A）**287→551/551** 同样 100%，**结论不随口径变化** |

> **未复算声明**：`coverage-gateb2/coverage-final.json` 已 `rm -rf`（status「临时产物已清理」），本表的「新增/删除行」列由 `git diff -U0 968e056 --numstat` **实测复算**（合计 559 与 status 完全一致），「已覆盖 / N/A」两列为 **status 转录**，本报告未重新跑覆盖率。双口径的字面数字（287→551/551）按原文转录，口径定义细节依赖已删除的分析脚本，**建议后续重跑时留存脚本**（见 §8-6）。

### 6.3 不适用项理由

| 文件 | 判定 | 理由 |
|------|:----:|------|
| `src/main/preload.ts` | 不适用 | Electron contextBridge 脚本，`tests/` 无引用，**vitest 结构性加载不到，0% 无法靠补测改变**；本批 0 新增行、6 删除行 |
| `src/main/ai/toolTypes.ts` | 不适用 | 纯类型声明文件，8 新增行全为类型，v8 覆盖率无 statement 条目 |
| `chatHandlers.ts` / `weaveMDBridge.ts` | 通过 | 纯删除（0 新增行），无覆盖概念 |

### 6.4 CLI 覆盖率命令与 `vitest.config.ts` 声明

```bash
# 实测所用旗标（按 status 记录复原，报告目录用完即删）
npx vitest run --coverage \
  --coverage.include='<本批 18 个改动文件>' \
  --coverage.reporter=json \
  --exclude='**/{cacheMonitor,ab-test}.test.ts'
# 报告目录 coverage-gateb2/  → 分析后 rm -rf；分析脚本在 %TEMP%，仓库内无残留
```

- **`vitest.config.ts` 全程未改** ✅ —— 其 `coverage.include` 仍为 PLAN-EDIT-FT4 的 5 个编辑器文件（`inlineLexer` / `inlineRenderer` / `selection` / `formatCtrl` / `ContentBlock`），属上一批口径；改它会污染 FT4 覆盖率口径，超出本任务范围。本批一律走 CLI `--coverage.include` 临时覆盖。
- **两个 flaky 文件被 `--exclude` 的理由**：`cacheMonitor.test.ts`（`getStats 10万次 < 50ms` 耗时断言，实测 107.14ms > 50ms）与 `ab-test.test.ts`（djb2 比较）在**并行负载下偶发、隔离单跑全绿**（37/37 ×3、59/59 ×2）。覆盖率 run 要求 `coverage-final.json` 落盘，**带红用例的 run 不产报告**，故必须排除才能取数；`--exclude` 只接受单个 glob，故用 `{a,b}` 花括号合并。**本轮未改被测代码**，按「复跑判过」处置（见 §8-4）。

### 6.5 覆盖补测（只动 `tests/`，`src/` 一行未动）

| 文件 | 改动 | 断言 | RED |
|------|------|------|-----|
| `tests/main/ai/agentKbPreloader.test.ts` | +32 行 / +2 例 | `expandedQueries 非空 → 绕过预载缓存直调 original（P0-6）`、`expandedQueries 为空数组 → 不绕过，仍走预载缓存（P0-6）` | **【实测】覆盖口径先红后绿**（status 原文） |
| `tests/main/ai/ipc.test.ts` | +10 行 / +1 例 | `P0-6：searchKb 透传 expandedQueries 到底层 searchKB（双路召回）` | **未记录 RED → 见 §8-3** |

## 7. checkpoint — Gate B 五门禁 + E2E

| # | 门禁 | 命令 | 实测结果 |
|---|------|------|----------|
| 1 | 类型检查 | `npm run typecheck` | **0 error**（exit 0）✅ |
| 2 | 单元测试 | `npx vitest run` | **168 文件 / 3977~3979 例**；3 次红项恒且仅为既知 flaky，隔离单跑 **37/37 ×3、59/59 ×2** 全绿 → **复跑判过** ✅ |
| 3 | Lint | `npx eslint src/ --ext .ts,.tsx`（**不带 `--fix`**） | **0 error / 106 warning**；跑后 `git status --short src/` 仍为原 6 个 M，无文件被改写 ✅ |
| 4 | 构建 | `npx vite build` | 成功（renderer 13.62s + preload 50ms），仅既有 dynamic-import 分块提示 ✅ |
| 5 | E2E | `npx playwright test` | **31 failed / 103 passed / 1 skipped**，逐 spec 与基线**完全一致**，新增 2 条 passed → **基线零新增** ✅ |
| + | 覆盖率 | CLI `--coverage.include`（Q18 口径） | **287 / 287 = 100% ≥ 80%** ✅ |

### 7.1 E2E 三数与逐 spec 分组一致性

| 轮次 | failed | passed | skipped | 合计 |
|------|-------:|-------:|--------:|-----:|
| 基线（2026-09-28，Q4 依据） | 31 | 101 | 1 | 133 |
| Gate B 第一轮 | 31 | 103 | 1 | 135 |
| Gate B 复跑（口径 A） | **31** | **103** | **1** | **135** |

逐 spec 分组（failed 31 条，基线与 Gate B 复跑**逐 spec 完全一致**）：

| spec | 失败数 | spec | 失败数 |
|------|-------:|------|-------:|
| `editor-table` | 7 | `floating-toolbar` | 2 |
| `feedback` | 5 | `exit-behavior` | 2 |
| `drag-selection-markers` | 5 | `thematic-break` | 2 |
| `ai-agent-panel` | 4 | `editor` / `image-resize` / `recent-history` / `welcome-doc` | 各 1 |
| | | **合计** | **31** |

- passed `101 → 103`（+2）= 新增场景①②；failed `31 = 31` 零新增；skipped 持平。
- 新增 2 条：`npx playwright test e2e/ai-agent-panel.spec.ts` → **33 passed / 4 failed**（7.1m），新增 2 条均 passed，4 条失败全为该文件既有登记失败 → **无新增**。
- **口径（如实）**：E2E 为 **renderer-only**（`playwright.config` 只起 vite，不启 Electron），主进程 `intentRouter` / `agentContext` 不参与，`pendingInteraction` 由 mock `runAgent` 推送 → 场景①②是**现象层回归护栏，不是根因证明**；根因证明只在 vitest。场景③经 Q2 裁定留第二批，未写。

## 8. 偏差与风险（如实记录，不粉饰）

| # | 偏差 / 风险 | 性质与处置 |
|---|-------------|-----------|
| 1 | **`agentTaskWorker.ts:398` 新断言首跑即绿，无断言级 RED** | 逐行取值复核该行**基线即已被既有测试覆盖（s=5）**，是 Gate B 第一轮「行映射判定误差」而非真实缺口。补的 `ipc.test.ts` 断言是**行为验证**（缺行透传则 `searchKB` 收到 `undefined` 必红）。属 strict 口径下「已覆盖行再补断言」，**不构成先红后绿证据**，如实标注 |
| 2 | **`agentKbPreloader.ts:169-170` 补测的 RED 是「覆盖数据先红」、断言本身首跑即绿** | status 原文「覆盖口径先红后绿」：先红的是 v8 行覆盖数字（该行 0 → 有），**不是断言失败**。实现（B-d）早于补测（Gate B 覆盖补测阶段）。属**补测（先有实现后补断言）**，见 §3 P0-6 |
| 3 | **`ipc.test.ts` 的 `P0-6：searchKb 透传 expandedQueries` 未记录 RED** | 同属覆盖补测，status 只写了「+10 行（判别性行为断言）」，**未写红**。本报告不补造；按 §3 标注为「未记录 RED 的补测」。其红绿可用「删掉 `agentTaskWorker.ts:398` 的 `expandedQueries: opts?.expandedQueries` 即必红」人工反证，**本轮未做该反证实验** |
| 4 | **既知 flaky：三次全量红、隔离单跑全绿，按「复跑判过」处置；本轮未改被测代码** | `cacheMonitor`「`getStats` 10万次 < 50ms」（实测 107.14ms > 50ms）与 `ab-test` djb2 比较。3 次全量 run 红项**恒且仅**为这两条，隔离单跑 `37/37 ×3`、`59/59 ×2` 全绿。覆盖率 run 因带红用例不产报告，须 `--exclude`。**属既有 flaky（`project_fullsuite_flaky_perf_tests.md` 已登记），本批 0 处改动其被测代码**，未做修复 |
| 5 | **fake DB 无法证明真实 `transaction()` / `iterate()` 语义；本批未新增 cjs 脚本** | plan §4「fake 约束」明示盲区：真实 better-sqlite3 因 Electron ABI 无法在系统 Node 下加载，`appendToolTurnWithAssistant` 的 `db.transaction()` 回滚/幂等与 `getRecentMessagesByRounds` 的 `stmt.iterate()` 提前停机/IteratorClose 只由自包含 fake 断言（`aiMessagesRead` 的 `close=1`/`close=0` 2 例、`aiMessagesWrite` 的事务回滚例）。**B-a 曾判断不给 `aiDao.test.ts` 的 `FakeDatabase` 补 `transaction()`/`iterate()`**（补进成死代码），改为扩 `kb_enable_*` 夹具抬 branch。真实语义只有源码取证 + 人工 review。**建议后续用既有 `scripts/*.cjs`（Electron 下）补 smoke** —— 本批按 plan「不新增 cjs」未做 |
| 6 | **v8 `statementMap` 实为逐行粒度，Q18「无映射 → N/A」字面几乎不触发** | 实际按**不可执行类别**（注释 48 / 空行 / 纯括号 / 纯类型 / JSX 纯属性）剔除得到 N/A 264，并做了双口径对照（窄口径 / 字面口径均 100%，status 原文）。**分析脚本与 `coverage-gateb2/` 已删除，本报告未复算「已覆盖 287 / N/A 264」**，仅复算了新增行合计 559。字面口径数字 287→551/551 的中间口径定义**无法从留存材料复原**，建议后续留存脚本 |
| 7 | **plan §3/§4 的验收与行号和实际测试存在漂移 / 计数偏差（不自行改文档）** | ① `queryPlannerEnhanced.test.ts` 改后行号 +2 漂移，plan 写「`:101-106` 必改 / `:107-110` 必须不变」（改前口径），status B-d 写「`:107-110` 按 Q12 改为…」（改后口径），**同一组断言两种行号**；② status 批 A 表记 `intentRouter.test.ts`「+4 例」「P0-3 4例」，实际 diff 为 **5 例**（12→17），RED `3 failed → 17 passed` 表明 5 例中 3 例先红；③ status 记 `agentPromptBuilder`「P0-2 3例结构断言」，实际新用例运行期 **9 例**（3 target × 2 + 3）。三处均为**记录计数/行号**偏差，**断言语义与门禁结论不受影响**，570 例实跑全绿。**建议由文档 owner 在 status 中更正，本报告不擅自改动任何文档** |
| 8 | **`agentLoop.test.ts` 有 12 行删除未列入 plan §4「必须改动的既有断言（4 处）」** | 删的是 2 处 `role:'tool' 落库 → appendMessage` 断言（`toolWrites.length === 1` + `content` 断言），随写路径从 `appendMessage` 切到 `appendToolTurnWithAssistant` 必然改写，现由 `expect(dbMock.appendToolTurnWithAssistant).toHaveBeenCalledTimes(1)` 与 `turnInput.tools` 断言替代。**属必然连带，非计划外删测试**；plan §4 未预列此 5 处（含 #4 的 mock 键），记为清单不全 |
| 9 | **E2E 场景①② 的 `toHaveCount(0)` 无法自证 locator 有效** | testid 拼错同样返回 0。locator 存在性由源码 `QuestionCard.tsx:493` 确认，正向渲染断言由新建 `QuestionCard.test.tsx`（1 例）承担；「修复前红 / 修复后绿」的反证在 E2E 层**做不到**（根因逻辑不在该进程） |
| 10 | **Q16/Q17 为实施期新增裁定，非 grill 轮次产物** | `runId` 运行维度盐与 `toLlmToolCalls` 形状转换均为实施中发现并报用户裁定；二者都有独立断言（`不同 runId → 4 行` / `同 runId 重跑 → 仍 2 行` / `每次 prepareAgentContext 生成唯一 runId`），RED 分别在 B-b-fix 9 failed 与 B-c 12 failed 中体现 |

## 9. 阶段 6 ~ 8 增量（本报告成稿后追加，2026-09-29）

本报告覆盖到 Gate B 为止；后续四个阶段改动了 `tests/` 与 2 个 `src/` 文件，**最新实测数字以下表为准**（与 §2 / §6 / §7 的差异来源逐条标明）。

| 阶段 | 改动 | 实测数字 |
|---|---|---|
| 6 测试质量门禁 | 4 项缺口处置（只动 `tests/` 3 文件）：`agentLoop` 流式死循环 +1、`AIPanelSession` 挂载 +2、`aiMessagesRead` 改 1、`S16` 改真断言 | 子集 85 文件 / 1464 例全绿；typecheck 0 error；改动 3 文件 eslint 0 error |
| 6.5 连通性 | 产出 `plan/agent-memory-optimize.connectivity.md`，12 链路 8✅/4⚠️/0❌ | typecheck 0 / lint 0 error / 19 文件 499 例全绿 |
| 6.5 风险修复 | **R2** `src/render/components/AIAgent/AgentTab.tsx`（跳过空气泡）+ **R1** `src/main/ai/knowledge/queryPlanner.ts`（跳过以指代词开头的消息）；各带 RED 实测（`expected 4 to be 1`、自指字符串 `not.toContain`） | 3 文件 67 例全绿 → 子集 70 文件 / 1297 例；typecheck 0 / eslint 0 error / vite build exit 0 |
| 7 合规核对 | 产出 `plan/agent-memory-optimize.compliance.md`，37 条 31✅/2❌/4⚠️；**2 条 ❌ 即本报告 §8 #7 的计数偏差，已按阶段 7 报告更正**（`570→571`、`30→31`、`tests/ 8→10`） | 21 文件 571 例独立复跑复核 |
| **8 交付 Gate** | 五门禁全量复跑 + 19 文件覆盖率复算 | **门禁通过、阻塞 0**：typecheck 0 error / vitest **168 文件 3986 例**（3985 passed + 1 既知 flaky，隔离单跑 `37/37 ×3`、`22/22` 判过）/ eslint 0 error 106 warning / vite build 成功 / E2E **31f·103p·1s = 135 与基线逐项相等**且新增 2 条 passed / **改动行覆盖 589/589 = 100%**（597 新增 = `git diff --stat` insertions，N/A 8 行纯类型） |

**与本报告原数字的差异**：
- §2 表的 **570 → 571**：阶段 6 补 `agentLoop` 死循环 +1（已在 §2 表内更正）。
- §6 的 **18 文件 / 287 覆盖 → 19 文件 / 589 覆盖**：阶段 6.5 新增 `AgentTab.tsx` 改动、R1 又给 `queryPlanner.ts` 加 4 行，分母随 `git diff` 增长；比例仍 **100% ≥ 80%**。§6.1 标题的「18 文件」为 Gate B 时点口径，最新为 19 文件。
- §7 的 **168 文件 3977~3979 例 → 3986 例**：阶段 6 补 3 例 + 阶段 6.5 追加用例。
- §8 #7 记的 3 处计数/行号偏差**已由文档 owner 在 `status.md` / `plan.md` / 本报告更正**。
- §8 「覆盖复算材料已删」→ 阶段 8 已把分析脚本留存于 `%TEMP%\gate8_cov_analyze.js` 与 `%TEMP%\gate8_line_verify.js`（仍未入仓库），可复算。

**计划外改动（待用户追认）**：`AgentTab.tsx` 与 `queryPlanner.ts` 不在 plan §2.1 原始清单内，已由总指挥按阶段 6.5 裁定执行并补录进 plan §2.1（标注「待用户追认」）。

## 10. 结论

- **RED**：P0-1 ~ P0-6 均有 status 留存的实测失败计数（批 A `7/3/3/4`、B-a+B-e `24+1`、B-b `8`、B-b-fix `9`、B-c `12`、B-d `9`）与部分原始输出片段；**P0-7 按需求即「只补测试」，明确为补测、无 RED**。未留逐条输出处已逐项标注【推导】。
- **GREEN**：Gate A 五门禁全绿（162 文件 / 3869 例）；Gate B 复跑（口径 A）五门禁全绿（168 文件 / 3977~3979 例，flaky 隔离单跑复核判过）+ E2E `31f/103p/1s` 逐 spec 零新增 + 改动行覆盖 `287/287 = 100%`。
- **重构**：plan §4 必改 4 处全部确认；必须保持不变的 9 组断言**全部绿且未改**（`agentPromptBuilder` / `agentKbPreloader` 为 0 删除纯追加）；Q12 有意回退已单独成段留证（§5.3）。
- **本报告实跑**：21 个目标/保绿测试文件 **571 passed / 0 failed**（未跑全量 vitest、未跑 playwright，Gate B 实测为准）；阶段 7 合规核对独立复跑同一 21 文件亦得 **571 passed**。
- **残留风险**：见 §8 —— 主要为 fake DB 事务/迭代语义盲区（未补 cjs smoke）、既知 flaky 未修、覆盖复算材料已删、以及 3 处文档计数/行号偏差（待文档 owner 更正）。
