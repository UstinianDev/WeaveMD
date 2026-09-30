# agent-memory-optimize-2 — 实施计划（第二批 / P1）

> 日期：2026-09-29 | 依据：`docs/requirements/agent-memory-optimize-2.req.md`（Q1~Q14 已裁定）
> 档位 L（含 L4 迁移）| TDD 强度 **strict** | 三子批三 Gate

## §1 范围与文件清单

### 子批 A（提示词/检索层，无 DB 变更）

| 任务 | 文件 | 改动性质 |
|---|---|---|
| **A1** 三文件注入 | `src/main/ai/agent/agentPromptBuilder.ts`（`buildAgentSystemPrompt` 加可选参 `memoryBlock?: string`，块插在 `L286-290`【核心规则】之后；内含 2000 token 截断 + 标注）、`src/main/ai/agent/agentContext.ts`（`L551-558` 附近读 `getGlobalAgentFiles()` 拼 `memoryBlock` 传入）、`tests/main/ai/agentPromptBuilder.test.ts`、`tests/main/ai/agentContext.test.ts` | L3 |
| **A2** 摘要 prompt 保留先行词 | `src/main/ai/contextManager.ts` **两处**：`L209-212`（cache-safe fork 主路径 user 消息）+ `L246`（回退模式 system prompt）、`tests/main/ai/contextManager.test.ts`（`:177-196` / `:223-237` 现锁措辞，按新文案更新） | L3 |
| **A3** classifyIntent 接主管线 | `src/main/ai/tools/searchKBHandler.ts`（`L70`~`L88` 之间插 `classifyIntent(effectiveQuery, ctx.history)` → 扩展策略 → `expandedQueries`）、`src/main/ai/knowledge/queryPlanner.ts`（新增纯函数扩展策略，不改既有 `classifyIntent` 语义）、`tests/main/ai/searchKBHandler.test.ts`、`tests/main/ai/queryPlannerEnhanced.test.ts` | L3 |
| **A4** 红线护栏补测 | **只动 `tests/`**：`tests/main/ai/kbSearch.test.ts`（pinned=1 ×1.5 端到端、`fts5`/`vector` 分支、未传 `threshold` 时 `result.threshold===0.6`）、必要时 `tests/main/ai/searchCache.test.ts` | **L1（`src/` diff 必须为空）** |

**A 明确不动**：`agentHelpers.ts`（`CONTEXT_WINDOW`/`KEEP_RECENT_ROUNDS`/`getCompressThreshold`）、`buildCompressed` 结构、`intentRouter.ts`、`AgentPersonalityPanel.tsx` 的 `recommendedChars`。

### 子批 B（存储层，L4）

| 任务 | 文件 | 改动性质 |
|---|---|---|
| **B3** 迁移（先行） | `src/main/db/index.ts`（追加 `export function addAgentMemoryTables(database)` + 在 `runMigrations L117-291` 内一处调用）、`tests/main/db/migrations.test.ts`（新 describe 三态）、`scripts/agent-memory-migration-smoke.cjs`（**新建**，抄 `attachments-migration-smoke.cjs` 源码正则抽取防漂移） | **L4** |
| **B1** 单表 + 双时间 | `src/main/db/agentMemory.ts`（**新建** DAO）、`src/shared/ai/`（仅在需新类型时） | L3 |
| **B2** Ledger/Views/Policy | `src/main/db/agentMemory.ts`（追加）+ `src/main/ai/agent/memoryPolicy.ts`（**新建**，驱逐/合并） | L3 |
| **B4** 分层 Prompt | `src/main/ai/agent/agentPromptBuilder.ts`（画像层并入 A1 同一 `memoryBlock` 通道）、`src/main/ai/agent/agentContext.ts`（`toolCtx`/prompt 组装处读画像） | L3 |

**B 硬约束**：`git diff -- src/main/db/index.ts` **只能是新增函数 + 一处调用**；不 DROP/DELETE/UPDATE；历史迁移零改动行。

### 子批 C（读写工具层）

| 任务 | 文件 | 改动性质 |
|---|---|---|
| **C1** 两工具 | **新建** `src/main/ai/tools/memoryRead.ts` + `memoryWrite.ts`；改 `toolRegistry.ts`（import + `handlerMap L62-92` + `CORE_TOOLS L99-388`）、`agentToolSelector.ts`（基础区 `L75-90`）、`concurrencyDefs.ts`（并发表，不加则 fail-closed 串行）、`agentPromptBuilder.ts`（工具规则 `L321-329`）；**改计数断言** `tests/main/ai/toolRegistry.test.ts L36/L38`、`tests/main/ai/deferredToolLoading.test.ts L57/61/68`、`tests/main/ai/concurrencyDefs.test.ts` | L3 |
| **C2** 后台写入 | `src/main/ai/agent/agentTaskWorker.ts` 或 `agentEventStore` 消费点（`AI_STREAM_DONE` 后入队）、**新建** `src/main/ai/agent/memoryWriter.ts`（冲突清洗：时间新者赢 / `memory.md` 恒赢 / 置 `valid_to`）、对应 tests | L3 |
| **C3** 可见入口 | `src/render/components/AIAgent/settings/AgentPersonalityPanel.tsx`（segmented 加「自动记忆」栏）、IPC `src/main/ai/ipc/agentHandlers.ts`、`preload.ts`、`agentStore.ts`、对应 tests | L3 |
| **C4** 场景③ + 门禁 | `e2e/*.spec.ts`（补压缩后指代场景，**注入大历史触发**，不调阈值） | L2 |

**C 必同步的文档硬编码计数**：`docs/architecture/ai-agent.md`（`:12` 28 工具 / `:96-103` 意图表 / `:109-152` 三张表 / `:98` chat 无工具漂移）、`docs/architecture/backend.md`（`:59`/`:93`）、`docs/modules/11-AI代理面板-Agent.md`（`:21`/`:50`/`:114-129`）。

## §2 必须改动的既有断言（预登记，避免被当计划外改动）

| # | 文件 | 原因 |
|---|---|---|
| 1 | `tests/main/ai/contextManager.test.ts:177-196` / `:223-237` | A2 改了两处 prompt 文案，现锁措辞必红 |
| 2 | `tests/main/ai/toolRegistry.test.ts:36/:38` | C1 新增 2 工具，28 名字数组断言必红 → 30 |
| 3 | `tests/main/ai/deferredToolLoading.test.ts:57/61/68` + `:24-47` | C1 同上（28/5/23 → 30/5/25） |
| 4 | `docs/architecture/ai-agent.md` 等 4 处工具计数 | 同上，文档硬编码同步 |

**不改**（红线）：`agentContext.test.ts:633/642/663`（历史轮次）、`kb-settings-default.test.ts:13/14`（0.6/1.5 配置）、`toolRegistry.test.ts:70/194` + `RewritePreviewCard.test.tsx:93` + `rewriteStore.test.ts`（铁律一）、`searchKBHandler.test.ts` 既有 3 个 describe。

## §3 TDD 与门禁

- 强度 **strict**：每任务 RED 实测 → 最小实现 GREEN → 改动行覆盖 ≥80%（CLI `--coverage.include`，**`vitest.config.ts` 禁改**，临时 `--coverage.reportsDirectory` 用完 `rm -rf`）。
- 每 Gate 跑五件套，全绿才推进：
  `npm run typecheck` / `npx vitest run` / `npx eslint src/ --ext .ts,.tsx`（**不带 --fix**）/ `npx vite build`（**不用 `npm run build`**）/ `npx playwright test`。
- E2E 基线口径沿用第一批 Q4=A：**31 failed / 103 passed / 1 skipped = 135**，逐 spec 相等、零新增失败；已知 10 条 B 类废弃能力失败**不得修**。
- 证据落 `docs/testing/agent-memory-optimize-2.tdd.md`（新建，需在完成后同步 SUMMARY/README/CLAUDE.md 计数）。

## §4 风险与红线

| 等级 | 风险 | 处置 |
|---|---|---|
| **L4** | B3 迁移破坏既有库 | 三态断言 + 真库 smoke 四态 + `index.ts` diff 仅新增；历史迁移零改动 |
| L3 | A1 改系统提示词影响 37 个护栏用例 | 可选参数缺省空串，不传参输出逐字不变 |
| L3 | A3 改检索路径影响拒答用例（`1/61` 精确断言） | 只加 `expandedQueries`，不改分数计算与 `threshold` |
| L3 | C1 计数断言与文档 4 处硬编码 | 列入 §2 必改清单，随代码同批改 |
| L2 | E2E 新增场景③引入 flaky | 注入大历史触发压缩，连续 3 次复跑判过 |

**红线**（req §五全 6 条）：不减历史轮次、铁律一仅约束笔记、知识库三参数不变、迁移双路径且历史迁移不擅改、`vitest.config.ts` 禁改、不提交密钥不删测试。

## §5 执行顺序与并行度

```
Gate A:  A4(纯测试, 可并行) ┐
         A1+A2(提示词层)    ├→ 五门禁 → Gate A
         A3(检索层)         ┘
Gate B:  B3 → B1 → B2 → B4 → 五门禁 + 真库 smoke → Gate B
Gate C:  C1 → C2 → C3 → C4 → 五门禁全量 → Gate C
```

子批 A 三路并行的文件所有权互不重叠（A1/A2 动 `agentPromptBuilder`+`contextManager`+`agentContext`；A3 动 `searchKBHandler`+`queryPlanner`；A4 只动 `tests/main/ai/kbSearch.test.ts`），各子代理返回 `{完成项, 测试证据, 未完成项, 风险}`，计划外 `src/` 改动一律登记待追认。

## §6 实施记录

### Gate A（子批 A，2026-09-29）

**TDD RED → GREEN 实测**

| 任务 | RED | GREEN | 测试增量 |
|---|---|---|---|
| A1 + A2（提示词层） | `16 failed`（只加测试、实现前） | `125 passed`（基线 106 → 125） | `agentPromptBuilder.test.ts` 37→50、`agentContext.test.ts` 38→46、`contextManager.test.ts` 18→26 |
| Q15 chat 注入（实施期新增） | `9 failed \| 122 passed`（全部 `TypeError: buildChatSystemPrompt is not a function`） | `131 passed`（125 → 131） | 4 条锁定 `CHAT_SYSTEM_PROMPT` 的护栏断言改为 `toBe(buildChatSystemPrompt(...))`，`sha256` 双证无参产物与常量全等，零删除 |
| A3（检索层） | `3 failed \| 75 passed`（摘除 `expandByIntent` 接入点复现） | `78 passed` | `queryPlannerEnhanced.test.ts` +60（9 例）、`searchKBHandler.test.ts` +113（8 例）；18 个新用例中 4 个为改前即绿的红线断言 |
| A4（护栏补测，只动 `tests/`） | 5 次变异逐条变红（`??1.5→1.0` ×2、`??0.6→0.5`、去掉 `fts5` 分支、去掉 `vector` 分支），还原后 62 例绿 | 同左 | `kbSearch.test.ts` +230（3 describe / 10 例）；`src/` diff 为空 |

**Gate A 五门禁（全量）**

| 门禁 | 实测 | 判定 |
|---|---|---|
| `npm run typecheck` | exit 0 | 通过 |
| `npx vitest run` | 168 文件 / 4038 例 → `4037 passed \| 1 failed`，唯一红为既知 flaky `ab-test.test.ts djb2`；**单跑复核 `22 passed (22)`** | 通过（flaky 按单跑复核判过） |
| `npx eslint src/ --ext .ts,.tsx` | `0 errors, 106 warnings`（与改动前一致，未新增） | 通过 |
| `npx vite build` | exit 0（renderer 13.69s + preload 41ms） | 通过 |
| `npx playwright test` | **31 failed / 103 passed / 1 skipped = 135**，与基线逐 spec 相等、零新增失败 | 通过 |

**改动行覆盖（Q18 口径）**：CLI `--coverage.include` + 临时 `--coverage.reportsDirectory`（用完 `rm -rf`），`vitest.config.ts` / `package.json` / `playwright.config.ts` diff 均为空；测试范围为引用这 5 个文件的 12 个测试文件（373 例全绿）。

| 文件 | 改动行 | 覆盖 |
|---|---|---|
| `src/main/ai/agent/agentPromptBuilder.ts` | 69 | 69（100%） |
| `src/main/ai/agent/agentContext.ts` | 40 | 40（100%） |
| `src/main/ai/knowledge/queryPlanner.ts` | 59 | 59（100%） |
| `src/main/ai/tools/searchKBHandler.ts` | 24 | 24（100%） |
| `src/main/ai/contextManager.ts` | 3 | 3（100%） |
| **合计** | **195** | **195（100%）** |

**计划外 `src/` 改动**：无（`git status --short src/` 仅 5 个计划内文件）。

**实施期追认**：① A3 `buildMinimalUnderstanding` 由 `function` 改 `export function`（0 行逻辑改动，仅可见性，为 history 透通提供唯一可测出口）；② Q15 chat 注入（用户裁定：改成函数，chat 也注入）。

**遗留风险**：`expandedQueries` 非空时绕过 `agentKbPreloader.ts:168` 模糊预加载缓存（命中率下降，+1 `UNION ALL`）；chat 意图每轮一次磁盘读（已 try/catch 包裹，两分支共享同一读取）；`classifyIntent` 的 `hasReference` 字符类过松（上游缺陷，本批不修）；`getGlobalAgentFilesDir()` 仍为死导出。

### Gate B（子批 B，2026-09-29 ~ 09-30）

#### B3 迁移双路径（L4）—— 验收通过

**改动范围核验（总指挥复核）**：`git diff --numstat` → `src/main/db/index.ts` = **36 / 0**（纯新增，diff 恰 2 个 hunk：`runMigrations` 末尾一处调用 + 文件末尾新增 `addAgentMemoryTables` 导出函数）、`tests/main/db/migrations.test.ts` = **276 / 0**（既有 22 例零改动）。DDL 逐字等于 req §二 B1 冻结的 11 列 + 3 索引，无 `created_at`、无 FTS 虚拟表、无 VIEW。diff 内无 DROP/DELETE/UPDATE。

**TDD RED → GREEN 实测**
- RED（实现前仅加测试）：`4 failed | 22 passed (26)`，含 `TypeError: addAgentMemoryTables is not a function` 与 anti-drift 的 `addAgentMemoryTables 未在 src/main/db/index.ts 中找到`
- GREEN：`26 passed (26)`
- **变异复核**（随后还原）：删 DDL 的 `valid_to` 行 → `3 failed | 23 passed`（态1/态2/anti-drift 同红）；删 `runMigrations` 内调用 → `1 failed | 25 passed`（接线断言红）；还原复绿 `26 passed`

**真库 smoke**：`npx electron scripts/agent-memory-migration-smoke.cjs`（**总指挥独立复跑**）四态全绿、`SMOKE_EXIT=0` —— 空库首建（11 列 + 3 索引、无 `created_at`）/ 旧库升级（既有 `users`·`ai_messages` 数据行留存）/ 重复执行（零新增结构、数据不变）/ 读写闭环（`user_id` 隔离 + `valid_to` 置值后当前有效查询不返回且行留存）。脚本按 `attachments-migration-smoke.cjs` 范式**运行时从 `src/main/db/index.ts` 源码正则抽取 DDL**，不硬编码。

**B3 单元门禁**：tsc exit 0 / vitest `168 文件 4042 例 → 4042 passed, 0 failed`（两轮全绿，两条既知 flaky 本轮未复现）/ eslint `0 errors, 106 warnings`（与 Gate A 基线一致）/ vite build exit 0。

**L4 残余风险**：① `runMigrations` 内调用行无单测覆盖（本仓既有格局，由源码接线断言 + 真库 smoke 双保险补位）；② smoke 用源码抽取形态构造的 pre-B3 **in-memory** 库，未拿真实 `weaveMD.db` 走升级（真实用户库依赖 `IF NOT EXISTS` 幂等）；③ `src/main/db/index.ts` 为 CRLF 文件，源码正则抽取与运行期模板串比对必须先归一化换行（`migrations.test.ts` 内已封装 `norm()`，后续同类断言须沿用）。

#### B1 单表 DAO + 双时间 —— 验收通过

**改动范围**：**仅新建 2 个文件** —— `src/main/db/agentMemory.ts`（DAO）+ `tests/main/db/agentMemoryDao.test.ts`（15 例）；`src/main/db/index.ts`、迁移、`docs/`、`vitest.config.ts` 零改动，计划外 `src/` 改动 **0 行**。

**TDD RED → GREEN 实测**
- RED：`Failed to resolve import "@main/db/agentMemory" ... Does the file exist?` → `Test Files 1 failed (1)`
- GREEN：`agentMemoryDao.test.ts (15 tests)` → `15 passed (15)`
- **变异验证**（4 处，逐个还原复绿）：去 `listActiveMemories` 的 `user_id = ?` 但留参数 → `14 failed`（占位符校验先炸）；去掉条件与参数 → `2 failed`（user_id 隔离 + 全读接口带 user_id）；删 upsert 的 manual 闸 → `1 failed`（manual 恒赢 Q10）；`closeMemory` 改 DELETE → `5 failed`（Ledger 破坏）

**B1 单元门禁**：tsc 0 error / vitest `169 文件 4057 例 → 4056 passed \| 1 failed`（唯一红为既知 flaky `cacheMonitor getStats`，单跑复核 `37 passed`；`ab-test` 单跑 `22 passed`）/ eslint `0 errors, 106 warnings`（新文件零告警）/ vite build 13.46s exit 0 / **改动行覆盖 `agentMemory.ts` 100%（Stmts·Branch·Funcs·Lines 全 100%）**，临时目录已 `rm -rf`。

**实施期裁定（总指挥，4 项）**：
1. `AgentMemoryRow` 字段名**维持 camelCase**（对齐 `AiConfigRow`，`validTo` ↔ 列 `valid_to`）
2. `upsertMemory` manual 恒赢**按字面保留**（同 user+kind+subject 存在 manual active 行时零写入返回其 id）；配套约束是 **C1 Agent 写入一律 `source='auto'`**
3. 同 `user_id+kind+subject` 多条 active 的矛盾事实 **由 B2 Policy 合并**（不推给 C2）
4. `closeMemory` 缺 `AND valid_to IS NULL` 幂等闸 → B2 追加时补

**残余风险**：vitest 下 better-sqlite3 ABI 不可用（`ERR_DLOPEN_FAILED`），SQL 语义由内存 fake 引擎模拟，**未与真实 SQLite 对跑**（真实 DDL 闭环由 B3 真库 smoke 覆盖）；fake 仅支持等值 / `IS NULL` / 单列 `ORDER BY LIMIT`，DAO 将来改用 JOIN·GROUP BY·`LIKE` 需同步扩 fake（否则会抛错暴露，非静默）。

#### B2 Ledger / Views / Policy —— 验收通过

**改动范围**：`src/main/db/agentMemory.ts` **追加**（既有函数语义除下述裁定外零改动）+ 新建 `src/main/ai/agent/memoryPolicy.ts`（151 行）+ 测试 `agentMemoryDao.test.ts` 15 → **24 例** + 新建 `tests/main/ai/memoryPolicy.test.ts` **14 例**（既有 15 例一字未改）。`index.ts` / 迁移 / `docs/` / `vitest.config.ts` 零改动，计划外 `src/` 改动 **0 行**。

**交付**
- Views（DAO 查询函数，未建 SQL VIEW；**时间过滤与聚合在 TS 侧**，SQL 仅 `user_id = ?` / `kind = ?` / `valid_to IS NULL` 等值条件，以兼容既有 fake 引擎）：`getActiveProfile` / `getRecentEntities(db, userId, days, now?)`（`now - written_at <= days*86400000` 含边界）/ `getActiveTopics`（count 降序 → `lastWrittenAt` 新者优先 → subject 升序）
- `memoryPolicy.ts`：`evictStale`（**manual 永不驱逐**）/ `mergeConflicts`（同 `kind+subject` 组内：manual 优先 → `written_at` 新者 → 同刻 id 大者；只关非 manual 败者）/ `runMemoryPolicy`（**先 merge 后 evict**，注释写明顺序理由，测试已锁）/ `MEMORY_EVICT_MAX_AGE_DAYS = 90`（**注释明写无实测数据、待校准**）
- 新增 `memoryNowStamp()` / `parseMemoryStamp()`，统一「近 N 天」与「超龄驱逐」的 `YYYY-MM-DD HH:MM:SS` UTC 解析口径

**TDD RED → GREEN 实测**
- RED：`8 failed | 15 passed (23)`（`getRecentEntities/getActiveTopics is not a function` 等）+ memoryPolicy `Failed to resolve import "@main/ai/agent/memoryPolicy"` → `no tests`
- GREEN：`agentMemoryDao.test.ts (24) + memoryPolicy.test.ts (14)` → `38 passed (38)`
- **变异验证 6 处**（逐个变红后还原复绿）：删 `evictStale` 的 manual 豁免 → `2 failed`；merge 改用 `deleteMemory` → `1 failed`（「败者仍在 listMemories」红）；新者赢→旧者赢 → `2 failed`；`closeMemory` 去幂等闸 → `1 failed`；`getRecentEntities` 边界 `<=`→`<` → `1 failed`；同刻 id 比较反向 → `1 failed`

**B2 单元门禁**：tsc 0 / vitest `170 文件 4080 例 → 4080 passed, 0 failed`（首轮既知 flaky `cacheMonitor getStats` 单跑复核 `37 passed`、`ab-test` 单跑 `22 passed`，终次全量两处均绿）/ eslint `0 errors, 106 warnings`（本批两文件单独 lint 0 problems）/ vite build 17.20s exit 0 / 改动行覆盖 `memoryPolicy.ts` **Stmts 100 · Funcs 100 · Lines 100（Branch 84.37）**、`agentMemory.ts` **Stmts 99.72 · Lines 99.72（Branch 92.15）** —— 未覆盖分支均为 `now` 缺省参数与不可达 guard，**不为覆盖率改源码**。

**实施期裁定（总指挥，5 项）**
1. `closeMemory` 补 `AND valid_to IS NULL` 幂等闸（重复 close 由「返回 true 覆盖时间」改为「返回 false 不覆盖」；全仓唯一调用点 `upsertMemory` 语义更正确，既有 15 例无回归）
2. Views 走 DAO 查询函数、**不建 SQL VIEW**；时间过滤与聚合放 TS 侧（记忆量级小 + SQL 保持简单参数化 + fake 引擎无需扩展）
3. 同 `user_id+kind+subject` 多条 active 的冲突**在本批 Policy 内合并**，不推给 C2（C2 以后只负责触发时机）
4. `getRecentEntities` 增加可选第 4 参 `now` 用于锁边界（3 参调用完全兼容）
5. **manual 恒免按绝对口径执行** → `mergeConflicts` 中 manual 败者不关闭，**同组多条 manual 会并存**（短期不可达：表内 manual 写入方要到 C3 才存在），记入 TODO 已知问题，届时按需求再定「组内只留一条」

**残余风险**：`MEMORY_EVICT_MAX_AGE_DAYS=90` 为无数据的保守取值，待实测校准；`memoryPolicy.test.ts` 自持一份与 DAO 版本同构但非同一份的精简 fake（改 fake 语义需两处同步）；5 个未覆盖分支为缺省参数与不可达 guard。




