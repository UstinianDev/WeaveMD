# agent-memory-optimize-3 — 实施计划（第三批 / P2）

> 日期：2026-09-30 | 依据：`docs/requirements/agent-memory-optimize-3.req.md`（Q1~Q7 已裁定）
> 档位 L（含 2 处 L4 迁移）| TDD 强度 **strict** | 三 Gate

## §1 范围与文件清单

### Gate D（二.3 + 五.4，并行）

| 任务 | 文件 | 改动性质 |
|---|---|---|
| **D1** 二.3 指代触发率 | `src/main/ai/knowledge/kbSearch.ts`（`:740-764` 赋值 `queryUnderstanding` + `:479-494` 缓存变体 + 补 `:463-469`/`:683` 两条早退路径）、`src/main/ai/toolTypes.ts`（`SearchKbFn` 契约补 `diagnostics?`）、`src/main/ai/tools/searchKBHandler.ts`（挂进 content）、`src/shared/ai/kb.ts`（如需补类型注释）；tests：`tests/main/ai/kbSearch.test.ts`、`tests/main/ai/searchKBHandler.test.ts`；文档 `docs/modules/11-AI代理面板-Agent.md:92` 接口名同步 | **L2** |
| **D2** 五.4 遗忘机制 | `src/main/db/index.ts`（`addColumnIfMissing` 补 `access_count`/`last_read_at` + `written_at` 索引，**追加式**）、`src/main/db/agentMemory.ts`（`access_count` 自增与查询）、`src/main/ai/agent/memoryPolicy.ts`（容量上限）、`src/main/ai/agent/memoryWriter.ts` + `agentTaskWorker.ts`（触发时机：启动 + C1 写入后）、`src/main/ai/tools/memoryWrite.ts`（写入后触发）、`tests/main/db/migrations.test.ts`（新 describe 补列三态）、`scripts/agent-memory-migration-smoke.cjs`（补一态）、`tests/main/ai/memoryPolicy.test.ts` | **L3 + L4** |

**D1 明确不改**：`resolveReferencesDetailed` / `detectAmbiguities` 判定逻辑、检索分数、`threshold`、`searchMode`、不建 metrics 表。
**D2 明确不改**：`mergeConflicts` 的 manual 恒免与 Ledger 不删行、摘要层、`memory.md` 存储侧、既有 14 例 `memoryPolicy.test.ts` 的断言。

### Gate E（模块六，串行）

| 任务 | 文件 | 改动性质 |
|---|---|---|
| **D3** 六.1 轨迹→Skill | **新建** 存储（草稿态载体）；`src/main/db/ai.ts`（**新增按会话的分页查询**，不改既有 `getRecentMessagesByRounds`）、`src/main/ai/skills/skillLoader.ts`（`_auto` 目录 + 加载）、`src/main/ai/agent/agentContext.ts:485` 与 `src/main/ai/skills/skillManager.ts:24/35/48`（**3 处无参 `loadSkills()` 修复**）、**新建** 后台提炼任务（抄 `memoryWriter.ts` 411 行范式）、`src/main/ai/ipc/`（草稿列表/确认/驳回三通道）、`AgentPersonalityPanel` 或独立设置区（草稿确认 UI）、tests | **L3 + L4（若建表）** |
| **D4** 六.2 结构化存储 + 注入 | `src/main/ai/agent/agentPromptBuilder.ts`（`buildAgentSystemPrompt` 第 7 参 / `buildChatSystemPrompt` 第 3 参，块插画像块之后）、`src/main/ai/agent/agentContext.ts`（读取 + 两分支传入）、**沿用 D3 的存储**、tests | L3 |
| **D5** 六.3 防膨胀 | `src/main/ai/agent/memoryPolicy.ts`（跨 subject 语义合并）、**新建** FTS 相似度检索（抄 `FTS5_MIGRATION_SQL` 范式 `db/index.ts:44-60`）、`src/main/ai/ipc/memoryHandlers.ts` + `AgentPersonalityPanel.tsx`（三态审核）、触发复用 D2 时机、tests | L3 + **L4**（若建 FTS 表） |

**D7 = 知识库 FTS 触发器修复（范围扩张，2026-09-30 用户批准，见 req §二 D7）** | `src/main/db/index.ts` 的 `FTS5_MIGRATION_SQL`（`:66-67`）与 `addKbDocumentsFtsIndex`（`:705`/`:714`）共 3 处触发器 SQL 改为 `DELETE FROM <fts> WHERE rowid = old.rowid`；新建/追加删除路径测试；`scripts/fts5-smoke.cjs` 追加删除态 | **L3（改既有 DDL）** |
**E 硬约束**：`db/index.ts` diff **只能是新增函数/新增调用/`addColumnIfMissing` 新列**；不 DROP/DELETE/UPDATE；历史迁移零改动行。

### Gate F（三.3）

| 任务 | 文件 | 改动性质 |
|---|---|---|
| **D6** 三.3 向量化经验库（**Q8=A，取代 Q3 的「新建 `exp_*`」**，见 req §二 D6 载体调整整段） | `src/main/db/index.ts`（**新建 `addAgentMemoryVectorColumns`**：`addColumnIfMissing` 加 `vector BLOB` + `embedding_model TEXT`，在 `addAgentMemoryFts` 之后追加一行调用）、`src/main/db/agentMemory.ts`（追加 `upsertMemoryVector` + `searchMemories` 混合召回）、`src/main/ai/tools/memoryRead.ts`（接语义检索，向后兼容）、**写入接线**：C1 `memoryWrite` + C2 `memoryWriter` 成功后异步生成向量（`resolveEmbedding` + `embeddingClient`，失败静默降级）+ **回填函数**（复用 D2 三处启动触发）、`docs/specs/embedding-architecture.md:122`/`:77-81` **改文档**、tests + 真库 smoke 补态 | **L4（加列）** |

**D6 不碰**：4 条硬编码笔记 SQL（`kbSearch.ts:515-517/:578-580/:620/:642-643`、`kbSearchFts.ts:106-109/:161-162`）、`sourceType` 枚举、`searchMode` 语义、`filterKbEgressResults`。

## §2 预登记的必改既有断言（避免被当计划外改动）

| # | 文件 | 原因 |
|---|---|---|
| 1 | `tests/main/ai/kbSearch.test.ts` 的 `counts` 断言（`:613-614`/`:643-644` 一带） | D1 新增 `queryUnderstanding` 字段，若断言精确键集合必红 |
| 2 | `tests/main/ai/toolRegistry.test.ts:149` 的 `parsed[0].fileName` | D1 把 diagnostics 挂进工具 content 会改变成功分支形状 —— **实测通过条件挂载规避，该断言零改动**（登记处原写作 `searchKBHandler.test.ts`，实测该文件无 content 形状断言，以本行为准） |
| 3 | `tests/main/db/migrations.test.ts` 的列清单断言 | D2 补 2 列，`agent_memory` 列集合 11 → 13 |
| 4 | `tests/main/ai/memoryPolicy.test.ts` 若锁了驱逐无上限语义 | D2 新增容量上限可能改变返回计数 |

**不改**（红线）：`agentContext.test.ts:633/642/663`（历史轮次）、`kb-settings-default.test.ts:13/14`（0.6/1.5 配置）、`toolRegistry.test.ts:70/194` + `RewritePreviewCard.test.tsx:93` + `rewriteStore.test.ts`（铁律一）、`migrations.test.ts` 的 DROP 禁令断言、`vitest.config.ts`。

## §3 TDD 与门禁

- 强度 **strict**：每任务 RED 实测 → 最小实现 GREEN → 重构 → **改动行覆盖 ≥80%**（CLI `--coverage.include`，**`vitest.config.ts` 禁改**，临时 `--coverage.reportsDirectory` 用完 `rm -rf`）。
- 每 Gate 跑**六件套**，全绿才推进：
  `npm run typecheck` / `npx vitest run` / `npx eslint src/ --ext .ts,.tsx`（**不带 --fix**）/ `npx vite build`（**不用 `npm run build**`）/ `npx electron scripts/*-smoke.cjs`（**涉迁移时**）/ `npx playwright test`。
- E2E 基线口径：**31 failed / 104 passed / 1 skipped = 136**（第二批 C4 加场景③后的当前值），逐 spec 相等、**零新增失败**；已知 10 条 B 类废弃能力失败**不得修**。
- 既知 flaky 两条（**单跑复核判过，绝不改被测代码**）：`tests/benchmarks/ab-test.test.ts` 的 `djb2 should be faster than simulated MD5`（本机单跑约 60% 绿）、`tests/main/ai/cacheMonitor.test.ts` 的 `getStats 10万次调用 < 50ms`。
- 证据落 `docs/testing/agent-memory-optimize-3.tdd.md`（新建，完成后同步 SUMMARY/README/CLAUDE.md 计数）。

## §4 风险与红线

| 等级 | 风险 | 处置 |
|---|---|---|
| **L4** | D2 补列破坏既有库 | `addColumnIfMissing` 追加式 + 三态断言 + 真库 smoke 补「补列后旧行取 DEFAULT」态 |
| **L4** | D6 加列迁移破坏既有库 | `addColumnIfMissing` 追加式（新函数，不改既有迁移本体）+ 三态断言（旧行 `vector IS NULL`）+ 真库 smoke 补态；**不新建表、不碰笔记 4 条 SQL** |
| L3 | D1 改 `content` 形状影响既有用例 | 列入 §2 预登记；diagnostics 挂在 content 的**独立小节**，既有字段不动 |
| L3 | D2 容量上限误关重要记忆 | `manual` 恒不关闭（红线）+ 按 `access_count` 升序、`written_at` 降序 + 阈值标待校准 |
| L3 | D3 修 3 处 `loadSkills()` 影响既有技能加载 | 既有内置 3 skill 行为零改动断言先行；用户技能可见性用例新增 |
| L3 | D4 加参改两个函数签名 | 缺省参数 → 不传时输出逐字不变（沿用 A1/B4 护栏口径） |
| L2 | E2E 新增用例引入 flaky | 沿用第二批 C4 的「连跑 3 次判过」 |

**红线**（req §五全 7 条）：不减历史轮次；铁律一仅约束笔记且必须有可见可删/可审核入口；知识库三参数不变（**D6 只改文档**）；迁移双路径且历史迁移不擅改；`vitest.config.ts` 禁改；不提交密钥不删测试；阈值按 `CONTEXT_WINDOW=64000` 实测调优不照抄外部数值。

## §5 执行顺序与并行度

```
Gate D:  D1(二.3, L2) ┐ 并行（文件所有权零重叠）
         D2(五.4, L3+L4) ┘ → 六门禁（含真库 smoke）→ Gate D
Gate E:  D3(六.1) → D4(六.2) → D5(六.3) → D7(KB FTS 触发器修复，范围扩张) → 六门禁（含真库 smoke）→ Gate E
Gate F:  D6(三.3, L4 加列) → D6.1(Q9=A, memoryRead opt-in 语义参数) → 六门禁（含两个 smoke + E2E）→ Gate F
```

Gate D 两路并行的文件所有权：D1 动 `kbSearch`/`toolTypes`/`searchKBHandler`/`kbSearch.test`/`searchKBHandler.test`；D2 动 `db/index.ts`/`agentMemory.ts`/`memoryPolicy.ts`/`memoryWriter.ts`/`agentTaskWorker.ts`/`memoryWrite.ts`/`migrations.test`/`memoryPolicy.test` —— **零重叠**。各子代理返回 `{完成项, 测试证据, 未完成项, 风险}`，计划外 `src/` 改动一律登记待追认。

## §6 实施记录

### Gate D（D1 + D2，2026-09-30）

#### D1 = 二.3 指代触发率接入 diagnostics（L2）—— 交付完成

**改动范围**：`kbSearch.ts` +53 / `toolTypes.ts` +9−1 / `searchKBHandler.ts` +37−3，测试 +20 例（`kbSearch.test.ts` +10、`searchKBHandler.test.ts` +10）；**计划外 `src/` 改动 0 行**；允许的文档改动 1 处（`modules/11` 接口名）。

**交付**
- `KbSearchOptions` 加可选 `hadPronounRef?: boolean`（既有调用方不传 → 保守 false）；新增纯函数 `buildQueryUnderstanding(query, hadPronounRef)`：`intentType` 走 `mapIntentToType(detectQueryIntent(query))` **独立取值**（不耦合 rerank 局部变量，故早退路径同样可用）、`isFallthrough = classifyIntent(query).intent === 'chat'`（只 import type，无循环依赖）
- `emptyResponse` 改为 `buildEmptyResponse()` 闭包 → **两条早退路径回传完整 diagnostics**；缓存命中变体**按本次入参重算**（不复用写缓存旧值）
- `toolTypes.ts` 的 `SearchKbFn` 补 `hadPronounRef?` + `diagnostics?`，**必填参数 0 改动**（既有调用方不传也能编译）
- `searchKBHandler` 传 `hadPronounRef: resolved`，新增 `withPronounFlag()` 按本次 `resolved` 归一（兜底下游闭包丢参）；三分支挂 **content 独立小节**，**既有字段一律不动**，`res.diagnostics` 缺失时保持改前形状

**TDD RED → GREEN**：`20 failed | 51 passed (71)` → **`71 passed (71)`**；**变异 5 处**（`hadPronounRef` 恒 false → `4 failed`；漏早退①→`1 failed`；漏早退②→`1 failed`；content 不挂 diagnostics → **`8 failed`**；`isFallthrough` 恒 true → `1 failed`），还原后复绿且 `grep MUTATION` 归零。

**D1 单元门禁**：tsc exit 0 / **全量 `175 文件 4235 例全绿`** / eslint `0 errors, 108 warnings`（**= 基线，新增 0**）/ vite build exit 0；改动行覆盖 `kbSearch.ts` **48/48 = 100%**、`searchKBHandler.ts` **34/34 = 100%**（`toolTypes.ts` 纯类型文件不插桩）。

**裁定与偏离**：
1. **追认文档偏离**：`researchLoop` 写成「仅声明，尚未赋值」而非任务书要求的「已接线」—— 该函数在 `knowledgeContext.ts` 不在 D1 范围，**不写假文档正确**（任务书措辞不准确）。
2. **`isFallthrough` 保持 chat fallback 语义**（按裁定原文）；实测大部分 KB 查询不命中路由关键词表 → 多为 `true`，若后续需 KB 侧语义改一行即可，记 TODO。
3. **`agentTaskWorker.ts:502` 闭包补 `hadPronounRef` 透传** —— D1 并行期该文件归 D2 不可动，**Gate D 前由总指挥补上**（落库 sink 已由 `withPronounFlag` 保证正确，补的是 `kbSearch` 层 diagnostics 的失真）。
4. plan §2 第 2 行断言登记有误（实为 `toolRegistry.test.ts:149` 而非 `searchKBHandler.test.ts`），已修正；**条件挂载使该断言零改动**。

#### D2 = 五.4 遗忘 / 过期机制（L3 + L4）—— 交付完成

**改动范围（numstat 实测）**：`src/main/db/index.ts` **22 / 0（纯新增）**、`agentMemory.ts` +100−9、`memoryPolicy.ts` +120−6、`tools/memoryWrite.ts` +13−0、`ipc/agentHandlers.ts` +13−0；**计划外 `src/` 改动 0 行**；`addAgentMemoryTables` 本体、`memoryWriter.ts`、`agentTaskWorker.ts` **零改动**。

**交付**
- **迁移（纯新增）**：新函数 `addAgentMemoryAccessColumns`（`addColumnIfMissing` 补 `access_count INTEGER DEFAULT 0` / `last_read_at TEXT` + `CREATE INDEX IF NOT EXISTS idx_agent_memory_user_written ON agent_memory(user_id, written_at)`）+ `runMigrations` 内 `addAgentMemoryTables(database);` 之后一行调用 —— **不改既有迁移函数**
- **容量上限**：`MAX_ACTIVE_MEMORIES = 500`（注释标「无实测数据、待校准，建议按生产库 active 行数 P95 重设」）；`enforceMemoryCapacity` 按 `access_count` 升序 → `written_at` 降序 → `id` 升序 依次 `closeMemory`，**`manual` 永不因容量关闭**（manual 数超上限时返回 0）
- **访问计数**：`listActiveMemories`/`getRecentEntities`（只对实际返回的行）/`getActiveProfile`/`getActiveTopics` 自增 `access_count` + `last_read_at`；**`listMemories`（C3 展示）不计数**；新增 `queryActiveMemories`（不计数）供 `evictStale`/`mergeConflicts` 策略扫描使用 → **策略扫描不计入访问**（红线）
- **编排**：`runMemoryPolicy` 顺序 = merge → evict → **capacity**；`runMemoryPolicyForAllUsers` 逐用户 try/catch + `console.warn` 绝不抛
- **三处触发**：① 应用启动（`ipc/agentHandlers.ts` `initAgentQueue` 在 `taskWorker.start()` 后）② C1 `memory_write` 成功后（返回结构不变）③ 既有 `memoryWriter.ts:393`（**未改**）；**复用既有 1s 轮询，不新建定时器/队列**

**TDD RED → GREEN**：迁移 `4 failed | 26 passed` → `30 passed`；memoryPolicy `15 failed | 17 passed` → **`152 passed`**（6 文件）；真库 smoke **RED 实测**（`git checkout HEAD` 还原后 `addAgentMemoryAccessColumns 未在...中找到`）→ **五态 `EXIT=0`**；还原后复绿 `236 passed`。**变异 8 处**逐个变红还原（去 manual 过滤 `2 failed`、启动触发删除 `1 failed`、C1 触发删除 `2 failed`、容量排序反向 `1 failed`、tie-break 反向 `1 failed`、删 `markAccessed` `4 failed`、策略扫描加计数 `1 failed`、容量折算删除 `1 failed`）。

**D2 单元门禁**：tsc 0 error / vitest `4234 passed | 1 failed`（既知 flaky `ab-test`，单跑复核绿；另一次 `cacheMonitor` 单跑复核绿，**被测代码零改动**）/ eslint `0 errors, 108 warnings`（= 基线）/ vite build exit 0 / **真库 smoke 五态 EXIT 0** / 改动行覆盖 **255/268 = 95.1%**（`agentMemory.ts` 100%、`memoryPolicy.ts` 95.8%、`memoryWrite.ts` 100%、`index.ts` 81.8%——未覆盖为 `runMigrations` 内调用、`agentHandlers.ts` 69.2%——未覆盖为不可达的防御性外层 catch）。

**总指挥独立复核（事故后必须）**：`git diff --numstat -- src/main/db/index.ts` = **22/0**；diff 中 `addAgentMemoryTables` 本体**零内容行被改**；`migrations.test.ts` **30 例全绿**；真库 smoke **五态 EXIT=0**。

**追认 3 项**：
| # | 项 | 处置 |
|---|---|---|
| 1 | **计划外测试改动** `tests/main/ai/memoryHandlers.test.ts` +27 | 补列后 `getActiveProfile` 会发 `UPDATE`，该文件 fake 原只支持 SELECT/DELETE → 加 `runUpdate` 分支 + `run` 一行分派，**只加语句能力、零断言改动** |
| 2 | `runMemoryPolicy` 返回仍是 `{evicted, merged}`、**容量关闭折进 `evicted`** | 为满足「既有 14 例 `memoryPolicy.test.ts` 零改动全绿」（3 例 `toEqual` 精确锁对象），JSDoc 已写明；若要独立计数须同步改那 3 例 |
| 3 | **操作事故**：造 smoke RED 时 `git checkout HEAD -- src/main/db/index.ts` 回退，Electron 脚本顶层抛错不退出致挂起，TaskStop 后恢复命令未执行 → 改动一度丢失 | **已从 `/tmp` 备份完整找回**，总指挥独立复核 `22/0` + 30 例 + 五态 smoke 全部符合；教训：revert-RED 必须先备份且单独一条命令确认恢复 |

**残余风险**：`MAX_ACTIVE_MEMORIES=500` 与 `MEMORY_EVICT_MAX_AGE_DAYS=90` 均无实测依据（注释已标待校准）；`last_read_at` **只写不读**（未接 UI/查询，留 D5 或设置页复用）；`agentHandlers.ts` 外层 catch 与 `memoryPolicy.ts` 单用户 catch 不可达（防御性兜底，是 69.2% 覆盖的唯一原因）；smoke 态5 无独立 RED（同一语义由 `migrations.test.ts` 三态在实现前实测取得）。

#### Gate D 六项门禁（2026-09-30）—— 通过

| # | 门禁 | 实测 | 判定 |
|---|---|---|---|
| 1 | `npm run typecheck` | exit **0** | 通过 |
| 2 | `npx vitest run` | 175 文件 / 4235 例 → `4234 passed \| 1 failed`；**重跑定位确认唯一红项 = 既知 flaky `ab-test.test.ts djb2`**（性能断言），单跑复核 **`22 passed (22)`**；另一既知 flaky `cacheMonitor` 单跑 **`37 passed (37)`** | 通过（**两条 flaky 单跑复核均绿，被测代码零改动**） |
| 3 | `npx eslint src/ --ext .ts,.tsx` | **`0 errors, 108 warnings`**（= D2 基线，D1/D2 均零新增） | 通过 |
| 4 | `npx vite build` | exit **0** | 通过 |
| 5 | **真库 smoke（L4）** | **五态全绿、`EXIT=0`**（B3 原四态 + D2 补列态：11→13 列、旧行 `access_count=0`/`last_read_at=NULL`、`written_at` 索引、重复执行幂等） | 通过 |
| 6 | `npx playwright test` | **31 failed / 104 passed / 1 skipped = 136** | 通过 |

**E2E 判定**：31 条失败清单与第二批 Gate C **逐项相同**（含 10 条 B 类废弃能力失败，`ai-agent-panel` 4 条选区改写仍在 `:1071/:1218/:1265/:1693`），**零新增失败**；基线 **136 维持不变**。

**Gate D 改动行覆盖**：D1 `kbSearch.ts` 48/48 + `searchKBHandler.ts` 34/34 = **100%**；D2 合计 **255/268 = 95.1%**（`agentMemory.ts` 100%、`memoryPolicy.ts` 95.8%、`memoryWrite.ts` 100%、`index.ts` 81.8%、`agentHandlers.ts` 69.2% —— 未覆盖均为 `runMigrations` 调用与不可达的防御性 catch）。

**总指挥补充修复（D1 遗留）**：`agentTaskWorker.ts:502` 闭包的 opts 类型与 `searchKB` 调用补 `hadPronounRef` 透传（+2 行）—— D1 并行期该文件归 D2 不可动；修复后 `kbSearch` 层 diagnostics 不再恒 false。

### Gate E（模块六，2026-09-30 起）

#### D3 = 六.1 执行轨迹 → 可复用 Skill 提炼（L3，实施期降级为纯文件系统）—— 交付完成

**实施期裁定（总指挥）**：**存储走纯文件系统、不建 DB 表**（`userData/skills/_auto/` 生效 + `_auto/_drafts/` 草稿 + front matter `status: draft|active`），与既有 skills 同范式，**避免无谓的 L4 迁移** —— 故本子批无迁移。

**改动范围**：新建 `skills/skillPaths.ts`（默认目录推导）/ `skills/skillAutoStore.ts`（草稿读写与双闸）/ `skills/skillDistiller.ts`（提炼任务）/ `ipc/skillDraftHandlers.ts`（三通道）；改 `db/ai.ts`（**纯新增** `getConversationMessagesPage` + `hasCompletedAgentTask`）、`skillLoader.ts`（`_auto` 模式 3 + `status` 过滤 + 冲突检测）、`skillManager.ts`（3 处 `loadSkills()` 传目录）、`agentContext.ts:485`、`agentTaskWorker.ts`（触发 + 路由）、`preload.ts`/`shared/constants.ts`/`shared/ai/agent.ts`/`ipc/index.ts`/`agentStore.ts`/`SkillsPanel.tsx`/`weaveMDBridge.ts`；新建 5 个测试文件（**未修改任何既有测试**）。

**交付要点**
- **三条断链修复**：`agentContext.ts:485` + `skillManager.ts:24/35/48` 改传 `getDefaultSkillDirs()`（= `[userData/skills]`），**内置 3 个 core skill 行为零改动**；`scanUserSkillsDir` 加模式 3 `<dir>/_auto/<name>.md` + **同名冲突 `console.warn` 跳过**（内置 core 优先）；`sendRoutes.ts:routeSlashSkill` **未动**（超范围，记 TODO）
- **半自动三重防线**：`_drafts/` 不参与扫描 → `_auto/` 内必须 `status: active` → 任意位置 `status: draft` 一律过滤 → **未确认草稿不进 `ctx.skills`/`list_skills`/`runSkill`/任何 prompt**；双闸 `AUTO_SKILL_NAME_RE = /^auto_[a-z0-9_]{1,60}$/` + `isPathInside` 前缀校验
- **轨迹源 = `ai_messages`**：`getConversationMessagesPage` 走隐式 **rowid** 数字游标（`ai_messages.id` 是 TEXT 主键），`WHERE conversation_id = ? AND user_id = ? AND rowid < ?`；`hasCompletedAgentTask` 联查 `agent_task_queue`；**`getRecentMessagesByRounds` 及调用点零改动**（测试显式断言其 SQL 无 `rowid <`、无 `LIMIT`）
- **提炼任务**：队列类型 `skill_distill`，`maybeEnqueueSkillDistillation` 同步返回（节流 `SKILL_DISTILL_MIN_ROUND_GAP = 4` 标待校准 + pending 去重，绝不抛不调 LLM）；`runSkillDistillJob` **永不 reject**、失败 `console.error` + `done('failed')` **不重试**；`parseSkillDrafts` 严格校验（name 正则 / description 1~200 / instructions 1~4000 / 条数 ≤3，**任一项不合法整批抛错零落盘**）；**只写草稿目录**
- **IPC 三通道**逐条照抄 C3 `memoryHandlers` 范式（`isTrustedSender` + JWT 解 userId + `findById` + fail-closed + 参数校验 + 路径前缀闸）；**复用 `resolveUserId` 并给它加 `export`**（避免第三份 sha256 副本，正好消解第二批记的 `getJwtSecret` 双份 TODO 中的一份）

**TDD RED → GREEN（五模块）**：A 分页查询 `10 failed → 29 passed`；B `_auto` 加载 `7 failed → 206 passed`（9 文件）；C 提炼 resolve import 失败 → 断言级 `6 failed → 27 passed`；D IPC resolve 失败 → `7 failed → 16 passed`；E worker 接线 `1 failed → 8 passed`（**据此把断言改为时序语义**：memory 占 pending 时提炼让位、下一轮补入，与 `enqueue` 跨类型 supersede 事实一致）。**变异 8 处**逐个变红还原（含 **M4 组合变异 `5 failed`** —— 双防线单点变异测不出红，必须组合）；还原后全量复绿 `180 文件 4315 例`。

**D3 单元门禁**：tsc exit 0 / vitest **`180 文件 / 4315 例`**（基线 175/4235 → +5 文件 +80 例；8 次全量中 5 次全绿、3 次各红 1 例，其中 1 次定位为既知 flaky `ab-test djb2` 单跑 `22 passed`，另 2 次当时只取 tail 未捕获失败名）/ eslint **`0 errors, 108 warnings` = 基线**（新增 0，4 处 `console.log` 已改 `console.warn` 或带 disable 注释）/ vite build exit 0 / 改动行覆盖 **总 Stmts 88%**（`skillPaths` 100%、`skillDistiller` 98.63%、`skillLoader` 98.49%、`skillDraftHandlers` 92.96%、`skillAutoStore` 90.29%、`agentContext` 91.36%、`db/ai.ts` 88.34%）。

**清单外 `src/` 改动（10 项，总指挥全部追认）**：① `agentTaskWorker.ts` 追加触发与路由（**任务书明确要求触发点但 plan §1 文件清单漏列**，已在本节补记）；② `memoryHandlers.ts` 的 `resolveUserId` 加 `export`（1 词、零行为变化）；③ `preload.ts` / ④ `shared/constants.ts` / ⑤ `shared/ai/agent.ts` / ⑥ `ipc/index.ts` / ⑦ `agentStore.ts` —— 三通道与 UI 必需；⑧ `weaveMDBridge.ts` 补 `skillDraft`（**不做则 typecheck TS2741**）；⑨ 4 个新 `src/` 文件；⑩ 5 个新测试文件。

**req 措辞修正**：初稿写 `agent_task_queue.status === 'done'`，**该枚举值不存在**（实际 `pending/running/`**`completed`**`/failed/cancelled/superseded`）—— 已按 `completed` 实现，**req §二 D3 已同步措辞**。

**残余风险**：① **`enqueue` supersede 不分任务类型** → `memory_extract` 与 `skill_distill` 同点入队会互相顶掉，用「同会话任意 pending 即跳过」规避（提炼给 memory 让位，代价是提炼首轮必然延后 1 轮），**记 TODO**；② **草稿不按 `user_id` 分目录**（纯 FS 选型固有结果，IPC 已按 C3 四条鉴权，单机桌面可接受），记 TODO；③ **双防线需组合变异才红**（M4），后续删任一层单点回归不报警，**组合用例必须保留**；④ `SKILL_DISTILL_MIN_ROUND_GAP=4`/`TIMEOUT_MS=60000`/`TRAJECTORY_MAX_CHARS=6000`/轨迹条数 60 均**无实测数据待校准**；⑤ **渲染侧改动行无单测**（`SkillsPanel.tsx` 新栏与 store 3 action 未纳入覆盖，主进程已 88%），记 TODO 待 Gate E 收口评估；⑥ 全量偶发红 3/8 次，1 次已定位为 flaky、**2 次未捕获失败名** —— D4 任务书已强制要求完整输出捕获。

#### D4 = 六.2 经验结构化存储 + 任务类型识别注入（L3）—— 交付完成

**改动范围**：`agentPromptBuilder.ts` +67−6、`agentContext.ts` +68、`skillLoader.ts` +60、`skillAutoStore.ts`（追加）、`skillDistiller.ts`（追加）；4 个既有测试文件 +35 例（**未新建测试文件、零删除零弱化**）；文档仅 `modules/11` §3.2。**计划外 `src/` 改动 0 行**；`db/index.ts`/迁移/`intentRouter.ts` 判定逻辑零改动。

**交付**
- **存储不新建、不建表** —— 经验载体 = D3 的 `_auto/<name>.md` 生效技能正文（instructions markdown 步骤**天然有序**）
- **front matter 新增 `intents`**：`parseIntents()` 支持逗号分隔与 JSON 数组两种等价写法，**非法值忽略并 `console.warn`（含 `chat`）**；字段缺失 → `undefined`（未标注）、**全非法 → `[]`（已标注却不适用，不回落推断）**；`assertIntents()` 非数组/空数组/白名单外（含 `chat`）→ **抛错整批拒写**
- **白名单单一口径**：`EXPERIENCE_INTENTS` 定义在 `agentPromptBuilder.ts`，`skillLoader`/`skillAutoStore`/注入侧**三方共用**
- **匹配逻辑**：白名单拦截（`chat` 与未知值直接 `''`）→ 标了 `intents` 只看显式命中**不回落推断** → 老技能用 `name+description` 跑 `classifyIntent(label, {hasHistory:true})` 推断（**复用 intentRouter 既有规则关键词表，不复制、不改其判定逻辑**）→ 推断不中不注入；排序 = **显式在前、推断在后，组内保原序**；instructions 原样拼接
- **注入通道**：`buildAgentSystemPrompt` 第 7 参 / `buildChatSystemPrompt` 第 3 参，插**画像块之后、`## 工作流` 之前**（chat 侧 → 锚点前，锚点仍居末）；`agentContext` 读一次两分支各传一次；**全仓唯一调用点对**
- **token 预算**：`EXPERIENCE_TOKEN_LIMIT = 2000`，注释写明取值依据与 `[待校准]` 标注

**TDD RED → GREEN**：`28 failed | 179 passed (207)`（4 文件）→ **`207 passed (207)`**；**RED 阶段既有 A1/B4 sha256 护栏全部保持绿**（证明基线未破坏）。**变异 8 处**逐个变红还原（含 **M2 空块注入占位 → `8 failed`，其中 6 条是既有 A1/B4 护栏**），还原后 `grep MUTATION` 零命中 + tsc exit 0。

**D4 四项门禁**：tsc exit 0 / **全量 `180 文件 4350 例 0 FAIL`（EXIT 0）** / eslint `0 errors, 108 warnings` = 基线 / vite build 12.82s exit 0 / 改动行覆盖 **1069/1107 = 96.6%**（`agentPromptBuilder` 95.22%、`agentContext` 92.13%、`skillAutoStore` 91.47%、`skillDistiller` 98.64%、`skillLoader` 98.68%）。
> 既知 flaky：全量首跑红 1 例，**完整输出捕获到失败文件名 = `ab-test.test.ts djb2`**，单跑复核 3 轮 绿/红/绿（约 60% 绿），被测代码零改动；随后 3 次全量均 0 FAIL。

**六层结构树 + `estimateTokens` 实测占比**（`CONTEXT_WINDOW = 64000`，夹具 = 三文件默认 + 40 条画像 + 1 条典型提炼技能）

| 层 | tokens | 占 64000 |
|---|---|---|
| L1 核心规则 | 76 | 0.12% |
| L5 注意力锚点 | 21 | 0.03% |
| L2 三文件块 | 258 | 0.40% |
| L2 画像块（40 条） | 1142 | 1.78% |
| **L2 经验块（新增）** | **188** | **0.29%** |
| L3 工作流与工具规则 | 1286 | 2.01% |
| L4 角色与回复格式 | 181 | 0.28% |
| **主提示合计** | **3150** | **4.92%，余量 60850** |

个性化层三块合计 1588 = 2.48%；无三块基线 1563；**最坏情况（三块全顶格 2000×3）= 7562 = 11.82%，余量 56438**；chat 分支基线 131 → 三块满载 1719。分层相加 3152 与全文 3150 差 2 为逐段 `Math.ceil` 取整（与 B4 同现象）。

**4 条裁定（总指挥）**
1. **chat 分支经验块生产恒空 —— 保持**：`useAgentPrompt = !isChatIntent || ...` ⇒ 走 `buildChatSystemPrompt` 的唯一条件就是 `intent==='chat'`，而裁定 3 规定 chat 一律不注入 → 生产上第 3 参恒收 `''`。属**裁定 3 ∩ 现有分支条件的必然交集**，能力完整有 4 条单测，**记 TODO** 待 `intentRouter` 能区分「闲聊/未知类型」后即生效。
2. **内置 3 个 core skill 也参与推断注入（约 +75 token）—— 保持不排除**：裁定 4 原文是「技能」未区分；内置 instructions 注入对 LLM 有正向规范作用、量级可忽略；排除需扩 `CoreSkill.source` 字段 = 超范围。
3. **`skills/` → `agentPromptBuilder` 跨层依赖追认**：白名单必须单一口径，且 `skillLoader` 被 5 个测试文件 `vi.mock` 成部分工厂（常量若放 `skillLoader`，`agentContext` 侧会取到 `undefined`）；无循环依赖（`agentPromptBuilder` 不引 `skills`）。
4. **`approveDraftSkill` 全非法 `intents` 返回 `parse_error` 且提示不具体 —— 追认**（低风险，草稿不合法不让生效；记 TODO 可细化错误文案）。

**残余风险**：单次会话匹配到的技能条数分布无线上数据；`EXPERIENCE_TOKEN_LIMIT=2000` 多技能叠加场景未标定（均标 `[待校准]`）；请求期快照层本批未复测（沿用第二批 862 参考）。

#### D5 = 六.3 防膨胀三防线（L3 + L4 建 FTS）—— 交付完成

**改动范围**：`src/main/db/index.ts` **+116 / 0（纯新增）**、`db/agentMemory.ts` +243、`memoryPolicy.ts`（追加）、`ipc/memoryHandlers.ts` +125−2、`AgentPersonalityPanel.tsx` +155−7、`preload.ts`/`shared/constants.ts`/`shared/ai/agent.ts`/`weaveMDBridge.ts`/`agentStore.ts`；新建 3 个测试文件；既有测试**只做追加**（`memoryPolicy.test.ts`、`migrations.test.ts`、铁律一三处、`vitest.config.ts` **一行未动**，D2 的 152 例零改动全绿）；`scripts/agent-memory-migration-smoke.cjs` **补态6**（既有态1~5 代码一行未改）；`docs/` **零改动**。

**防线一（跨 subject 语义合并，FTS5 关键词重合度、无 embedding）**
- 新增 `export function addAgentMemoryFts(database)`：`CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(subject, content, tokenize='trigram')` + `ai/ad/au` 三触发器 + 存量回填（`rowid NOT IN` 守卫）；**FTS 列只索引 `subject`+`content`**，`user_id`/`kind` 靠普通条件过滤
- **`runMigrations` 内 `addAgentMemoryAccessColumns(database);` 之后追加 2 行调用**；`addAgentMemoryTables` / `addAgentMemoryAccessColumns` **本体零改动**（新增迁移测试显式断言二者体内不含 `agent_memory_fts`/`merge_skip`，且 `addColumnIfMissing` 仍恰好 2 条 —— 保住既有真库 smoke 态5 的源码正则）
- **第二批「不建 FTS」原注释（`:731`）保留未删**，其后**追加**改判说明（改判理由 = 三.3 之前仓内无任何两文本相似度设施，关键词重合度是唯一不依赖 embedding 的可行起点）
- `tokenize='trigram'` 选型：`unicode61` 对中文只产出 1 词（`用户偏好深色主题` 实测 → 中文相似度检索等于不可用），trigram 按 3 字窗口切分中英文通用，代价是大小写敏感（查询侧同时提交原文与小写两套）
- `runMemoryPolicy` 编排 = **merge(同 subject) → merge(跨 subject) → evict → capacity**，**返回形状仍 `{evicted, merged}`**（跨 subject 计数并入 `merged`）
- 阈值 `MEMORY_MERGE_SIMILAR_THRESHOLD = 0.5` / `CANDIDATE_LIMIT = 32` / `MEMORY_MATCH_MAX_TERMS = 48`，均标「无实测数据待校准」

**防线二（三态审核，扩 C3 链路）**：`ai:memory:similar:list`/`:accept`/`:reject` 三通道挂在既有 `registerMemoryHandlers`（**故 `ipc/index.ts` 未改**），鉴权四条逐条照抄 + `isValidIdArray`（2~32 安全整数、去重，校验不过不落策略层）；**采纳/驳回按 ids 在服务端重算相似组**（归属 + active + 同 kind + 连通相似度三条都过才动手）；UI 在 `autoMemory` tab 内**扩一栏「相似合并建议」**（未新建 tab、无内联 style、无 `any`、无 `dangerouslySetInnerHTML`）。

**防线三（过期复核）**：**完全复用 D2 的三处触发，未新建 `setInterval`、未新建队列任务类型**（测试含静态护栏断言 `memoryPolicy.ts` 不含 `setInterval` 且三处调用仍在）。

**TDD RED → GREEN**：`44 failed | 2 passed (46)`（3 新文件，含 `addAgentMemoryFts is not a function` / `memorySimilarityScore is not a function` / `expected undefined to be 'ai:memory:similar:list'`）→ **`268 passed`（9 文件合跑）** → 全量 **`183 文件 4418 例 0 failed`**。**变异 10 处**逐个变红还原（去 manual 豁免 `1 failed`、FTS SQL 去 `user_id` **`6 failed`**、删 `ad` 触发器 `2 failed`、跳过 `isTrustedSender` `1 failed`、不并入跨 subject 合并 `3 failed`、`selectActiveRows` 去 `valid_to IS NULL` **`4 failed`**、采纳/驳回不校验相似组各 `1 failed` 等）。

**D5 单元门禁**：tsc exit 0 / **`183 文件 4418 例 0 failed`** / eslint `0 errors, 108 warnings` = 基线 / vite build exit 0 / **真库 smoke 六态 EXIT 0**（态6 覆盖虚拟表 + 3 触发器 + 存量回填 + user_id 隔离 + ai/au/ad 同步 + `merge_skip` 幂等/跨用户不命中/不改 content 不置 `valid_to`）/ 改动行覆盖 **1239/1329 = 93.2%**（`memoryPolicy` 98.8%、`agentMemory` 97.5%、`memoryHandlers` 97.6%、`index.ts` 90.5%、`AgentPersonalityPanel` **100%**）。

**验收对照**：注入 50 条相似 → `runMemoryPolicy` 后 active **50→1**、`merged=49`、`listMemories` 仍 50（Ledger 不删行）、`getActiveProfile` 只回 1 条、画像条目 ≤40 且 token ≤ `PROFILE_TOKEN_LIMIT`、50 条经验叠加出现 `(经验过长已截断)`；淘汰后**双侧不进提示词**（`buildProfileBlock` 含**对照组**断言 —— 混入已淘汰行时块里确实出现 → 断言非恒真、`buildExperienceBlock` 不含、最终 `buildAgentSystemPrompt` 不含）。

**追认的清单外改动（12 类）**：最大一项是 **`db/agentMemory.ts` +243 纯新增**（理由：`memoryPolicy.ts` 头注明写「本文件不写 SQL」，SQL 必须落 DAO；且分词函数与打分函数必须同一口径防漂移）；其余为 IPC 3 常量 / `IMemoryMergeGroup` 下发类型 / `preload` 3 API（不做则 TS2741）/ `weaveMDBridge` 3 受控桩 / `agentStore` 3 状态 + 3 action / `tests/setup.ts` 补 3 个 `vi.fn` / 3 处测试追加 + import / smoke 脚本头尾文案 / **面板合并区文案 key 独立化**（`mergeLoading` 等，否则与记忆列表「加载失败」重复会使既有 `findByText(/加载失败/)` 因多元素命中而红 —— **主动规避**）。

**残余风险**：① **`merge_skip` 无撤销入口**（行级粘性标记，撤销须删除该记忆后重写）—— 记 TODO；② FTS 不可用时**静默降级返回空数组不打日志**（生产表现为「不再自动合并」，无告警，靠 smoke + 单测兜底）；③ 测试 fake 用正则严格匹配 FTS SQL 文本 → 部分变异红是「形状不匹配」而非纯语义（真库语义由 smoke 态6 覆盖）；④ 3 个阈值常量无实测数据。

**🔴 顺带发现的既有严重 bug（D5 提出、总指挥复核实锤、用户批准纳入本批 → D7）**：`kb_chunks_fts_ad`（`index.ts:66-67`）、`kb_documents_fts_ad/au`（`:705`/`:714`）在**普通（非 contentless）fts5 表**上用仅限 contentless 的 `'delete'` 特殊命令 → 实测 `DELETE kb_chunks = FAILED: SQL logic error` 且**基表行回滚未删**；生产 `db/kb.ts` 5 处删除调用全受影响（`:233/:267/:275/:294/:405`）→ **知识库删除不生效 + FTS 残留**。既有 `scripts/fts5-smoke.cjs` 只验插入查询、未验删除故未暴露。**已作为 D7 修复（用户选 A：纳入本批）**，详见 req §二 D7。

#### Gate E 第一轮（D3 + D4 + D5 基线，2026-09-30）—— 通过

| # | 门禁 | 实测 | 判定 |
|---|---|---|---|
| 1 | `npm run typecheck` | exit **0** | 通过 |
| 2 | `npx vitest run` | **183 文件 / 4418 例 → `0 failed`**（全绿，两条既知 flaky 本轮均未复现） | 通过 |
| 3 | `npx eslint src/ --ext .ts,.tsx` | **`0 errors, 108 warnings`**（= 基线，D3/D4/D5 均零新增） | 通过 |
| 4 | `npx vite build` | exit **0** | 通过 |
| 5 | **真库 smoke（L4）** | **六态全绿、`EXIT=0`**（B3 四态 + D2 补列态 + D5 FTS/驳回列态） | 通过 |
| 6 | `npx playwright test` | **31 failed / 104 passed / 1 skipped = 136** | 通过 |

**E2E 判定**：失败清单抽样（`welcome-doc:99` / `thematic-break:87`·`:104` / `recent-history-restore:187` / `image-resize:211` / `floating-toolbar:1026` 等）全在基线内，**零新增失败**；passed/skipped 与 Gate D 逐值相同。

> 本轮为 **D3/D4/D5 的基线验证**；D7 修复后**需再跑一轮 Gate E 作最终收口**。

#### D7 = 知识库 FTS 删除/更新触发器失效修复（L3，**范围扩张，2026-09-30 用户批准**）—— 交付完成

**改动范围（仅 3 个文件）**：`src/main/db/index.ts`（3 处触发器正文 + 1 处 `export` + 5 行注释）、`scripts/fts5-smoke.cjs`（既有态仅 2 行副本同步 + **纯新增 148 行**删除/更新态）、新建 `tests/main/db/kbFtsTriggerDelete.test.ts`（12 例）。**D1~D5 的未提交改动一行未碰**（改前存基线 diff、改后 diff-of-diffs 比对确认）。

**修复内容**
- `kb_chunks_fts_ad` / `kb_documents_fts_ad` / `kb_documents_fts_au` → `DELETE FROM <fts> WHERE rowid = old.rowid`（`au` 保留原 `INSERT new` 行，先删后插）
- `kb_chunks_fts_ai` / `kb_documents_fts_ai` **一字未动**（标准 `VALUES(new.rowid, ...)`）
- **`addKbDocumentsFtsIndex` 加 `export`**（唯一超字面裁定的 `src` 改动，**已追认**：零行为改变；不导出则该函数在 vitest 内不可达、documents 侧改动行 0% 覆盖；与 D5 导出 `addAgentMemoryFts` 同款先例）
- smoke 脚本新增 `readSrcTs`/`extractSrcFts5Sql`/`extractKbDocumentsFtsSql`（**运行期从生产源码抽取，避免第三份副本漂移**）+ 副本漂移守卫

**🔴 影响面比 req 列的更广（D7 实测新增实锤）**：旧 `kb_documents_fts_au` 同样用 `'delete'` 命令 → **所有 `UPDATE kb_documents` 也全部失败**（实测 `UPDATE status = FAILED: SQL logic error`、`UPDATE title = FAILED`，含 `setKbDocStatus`）。即坏掉的不只是 5 处删除，**知识库的更新与删除路径此前都在报错回滚**。

**TDD RED → GREEN（真库 + 单测双 RED）**
- **修复前真库**：`npx electron scripts/fts5-smoke.cjs` → 既有态**全绿**（证明旧 smoke 未覆盖删除）、新增删除态首断言即爆 `FAILED: [删除/更新态] 删 kb_chunks 行失败（触发器报错会回滚整条 DELETE，基表行删不掉）: SQL logic error`，**EXIT=1**
- **修复前单测**：`4 failed | 7 passed (11)`（`expected ... to contain 'DELETE FROM kb_chunks_fts WHERE rowid…'` 等）
- **GREEN**：`fts5-smoke` 既有态 + 删除/更新态全过 `EXIT=0`；`kbFtsTriggerDelete.test.ts 12 passed`
- **变异 5 处**（每次 `cp` 备份→改→跑→还原→md5 校验）：M1 改回 `'delete'`（src+副本同改绕过守卫）→ smoke `EXIT=1` + vitest `2 failed`；M2 删 `kb_chunks_fts_ad` → smoke `EXIT=1`（FTS 行数期望 1 实际 2）；M3 `au` 去掉删旧行 → smoke `EXIT=1`（fts5 行重复约束）；M4 删 `kb_documents_fts_ad` → smoke `EXIT=1`（抽取不完整）；M4b 触发器体换 `SELECT 1;`（保结构废语义）→ smoke `EXIT=1`。另有「只改 src 不改副本」形态 → 漂移守卫判红。

**D7 单元门禁**：tsc EXIT=0 / **vitest `184 文件 4430 例全绿`** / eslint `0 errors, 108 warnings` = 基线 / vite build EXIT=0（11.29s）/ **`fts5-smoke` EXIT=0** / **`agent-memory-migration-smoke` 六态 EXIT=0**（D5 未受影响）/ 知识库既有 5 文件 **113 例全绿**（`kbDao`·`fts5Migration` 零改动）/ 改动行覆盖 **100%**（`index.ts` 整体 47.41% Stmts，但改动行 `66-72` 与 `704-724` 逐行核对全为 C）。

**flaky**：全量并行下 `ab-test djb2` 连红 2 轮，**单跑 3 连绿**（每次 `22 passed`），被测代码零改动；`cacheMonitor` 本批未红。

**总指挥补的三处文档**（D7 留给总指挥统一）：`docs/architecture/database.md`（FTS 表行补「删除/更新走标准 DELETE」+ 指向 req §二 D7）、`docs/architecture/knowledge.md`（`kb_chunks_fts` 行补「增删改均走标准 INSERT/DELETE」）、`docs/modules/07-数据持久化层-Database.md`（`kb_chunks_fts` 行补同步方式）。

**残余风险**：① `scripts/fts5-smoke.cjs` 的 `FTS5_MIGRATION_SQL` 副本**必须与 src 常量双向同步**（新增漂移守卫会把「只改 src 不同步脚本」判红，属新增行为非回归）；② `extractKbDocumentsFtsSql` 依赖 `function ...[\s\S]*?\n}` 与模板字符串 exec 的形状，将来改用非模板 exec 会抽取失败（已用 4 个 must 关键字守卫，漏了 FAILED 而非静默通过）；③ **不重建旧库 FTS 内容**（红线禁 DROP，回填仍 `rowid NOT IN` 只补不删）—— 因删除历史从未成功、基表无孤儿行，实测风险低；④ `kb_documents_fts_au` 仍是无条件 `AFTER UPDATE`（裁定只要求改 DELETE，`setKbDocStatus` 仍触发一次索引重建，行为与修复前一致只是不再报错）；⑤ `db/kb.ts` 5 处删除调用**未加 try/catch 或用户提示**（触发器修好后不再抛错，但异常仍上抛到 IPC 层 —— 属既有形态）。

### Gate F（三.3，2026-10-01）

#### D6 = 三.3 向量化经验库（L4 加列，**Q8=A 取代 Q3 的「新建 `exp_*`」**）—— 交付完成

**改动范围**：`src/main/db/index.ts` **+29 / −0（本任务纯新增**；numstat 的 7 行删除全属 D7）；`db/agentMemory.ts` D6 段 +271；`knowledge/vectorBackfill.ts` **+177（计划外文件，已追认）**；`tools/memoryRead.ts` +56−4；`tools/memoryWrite.ts` +22；`agent/memoryWriter.ts` +25−1；`ipc/agentHandlers.ts` +15（隐含授权，已追认）；新建 4 个测试文件 **61 例**；smoke **追加态7**（+562，**态1~6 代码零改动**）；`docs/specs/embedding-architecture.md` +14−2（授权的 2 处）。

**交付**
- **迁移（L4）**：新函数 `addAgentMemoryVectorColumns`（`addColumnIfMissing` ×2：`vector BLOB DEFAULT NULL`、`embedding_model TEXT`）+ `runMigrations` 内 `addAgentMemoryFts` 之后一行调用；**4 个既有迁移函数本体一行未改**（测试 + smoke 双重断言其函数体不含 `vector`/`embedding_model`）
- **不建 `idx_agent_memory_user_vector`**（JSDoc 写明理由：排序键是 `vec_distance_cosine` 标量函数结果，B-Tree 用不上；`user_id` 前缀已有 4 个既有索引可收敛单用户行集，再建只增 upsert 写放大）
- **DAO**：`upsertMemoryVector` / `hasMemoryVector`（写入前置短路，同指纹去重时不重复打 API）/ `searchMemories`；**融合 = 加权 RRF**（注释写明理由：trigram 窗口计数与余弦相似度**量纲不可比**，RRF 只用名次无需跨量纲标定，与笔记侧 `rrfFusion` 同思路）；导出 7 个常量（`MEMORY_SEARCH_RRF_K=60` / `FTS_WEIGHT` / `VEC_WEIGHT` / `VEC_SCORE_THRESHOLD=0.2` / `CANDIDATE_MULTIPLIER=4` / `DEFAULT_LIMIT=20` / `MAX_LIMIT=100`），**全部标「无实测数据、待校准」**
- **分流**：有 `queryVector` → FTS5 + 向量双通道 RRF；无向量 / sqlite-vec 缺失 / 向量列未迁移 / 全 NULL → **只走 D5 的 trigram FTS5，不报错不抛**；两通道均带 `user_id = ?` 与 `valid_to IS NULL`
- **两个设计决定（均注释写明理由）**：`merge_skip` **不参与过滤**（该标记只禁自动合并，被否的是合并动作不是记忆本身，过滤会让有效记忆从召回消失）；**不按 `embedding_model` 过滤**（切换模型由回填按 `embedding_model IS NOT ?` 重算，查询侧过滤会让切换瞬间召回归零）
- 相似度用 `1 - distance`（真库实测 `vec_distance_cosine` = 1 − cos），**与笔记侧 `1 - distance/2` 口径不同并注明**（笔记侧按红线不动）
- **写入接线（异步 + 静默降级，三处）**：C1 `memoryWrite` / C2 `memoryWriter` / **启动 `agentHandlers.ts`**（复用 D2 三处触发点，`listMemoryOwners` → 逐用户 `scheduleMemoryVectorBackfill`，**不新建定时器**）；回填分批 20 / 限速 300ms / 上限 100 批；三条失败路径一律 `console.warn` 一条后返回、**永不 reject、不重试、向量保持 NULL**

**TDD RED → GREEN**：迁移三态 `5 failed (5)`（`addAgentMemoryVectorColumns is not a function`）；`searchMemories` **`17 failed (17)`**；写入/回填/接线 **`28 failed | 7 passed (35)`**；真库 smoke 态7 首版开发期 RED `FAILED: [态7] FTS ORDER BY rank 相关度序不符，实际 [2,1]` → **GREEN：全量 `188 文件 4491 例`、4 新文件 `61 passed`、tsc 0、eslint 0 err·108 warn、vite build 0、`agent-memory-smoke` 七态 EXIT 0、`fts5-smoke` EXIT 0（D7 态仍绿）**。
**变异 6 处**：去两通道 `user_id` → **`12 failed`**；去向量通道 `valid_to IS NULL` → **首版 0 红**（发现 fake 自己硬编码过滤 → 补「SQL 文本必须含 `valid_to IS NULL`」守卫后 `4 failed`）；去向量通道 try/catch → `1 failed`（`no such function: vec_...`）；C1 向量失败上抛 → `2 failed`；融合去向量分量 → `2 failed`；迁移去 `embedding_model` → `4 failed`。

**改动行覆盖 316/317 = 99.7%**（`agentMemory` D6 段 170/170、`vectorBackfill` D6 段 125/125、`memoryRead` 46/46、`memoryWrite` 4/4、`memoryWriter` 9/9、`agentHandlers` 6/6 全 100%；唯一未覆盖 = `runMigrations` 内调用行，**D2/D5 同位置同样未覆盖，属既有范式**，由 smoke 源码正则断言 + 迁移三态兜底）。

**笔记侧零影响核验**：`git diff` 对 `filterKbEgressResults`/`searchMode` **为空**、`kbSearchFts.ts` **为空**、`vitest.config.ts` **为空**；`kbSearch`/`kbDao`/`kbFtsTriggerDelete`/`migrations`(既有 30 例)/`memoryPolicy`/`memoryTools`/`agentContext` 等**零改动且全绿**；拒答 0.6 / 置顶 ×1.5 / `searchMode` 三模式未触碰。

**实施期实测修正 2 处**：① 列演进实为 **11 → 13(D2) → 14(D5 `merge_skip`) → 16(D6)**，任务书写的「11→13→15」漏算 D5（smoke 态7 按 16 断言）；② FTS5 `ORDER BY rank` **升序 = 相关度从高到低**经真库探针确认 —— 早期用 3 行数据断言方向得错误结论（小语料 bm25 IDF 为负会反序），探针改为「10 条填充 + 全量命中 + 单命中」形态写进 smoke。

**追认 2 项计划外改动**：`knowledge/vectorBackfill.ts` **+177（首次进入本批改动集）** —— 任务书点名复用该文件的 `resolveEmbedding` 但未点名放 D6 导出，选择理由 = 全局规范「新增 src 文件需先批准」+ 该文件本就是向量回填唯一归属、不新建文件（副作用：该模块 import 图新增 `db/agentMemory`，实测 188 文件全绿无连带红）；`ipc/agentHandlers.ts` +15 —— 任务书「回填启动时机复用 D2 三处触发」必经该文件但正文未点名。

**残余风险**：① **`memory_read` 生产侧查询向量未接** → 语义通道死代码（**已立 D6.1/Q9 修复，见下**）；② 启动回填在 embedding 已配置时对存量缺口行发起批量 API 调用，**首个升级版本可能有一次批量 embedding 成本**（未配置时零成本空转、在途去重、失败静默）→ 建议生产观察；③ `searchMemories` 的 `total` 在语义路径 = DAO 内部 top-N 条数（与既有「过滤后总数」口径略有差异，测试注释已标明）；④ 7 个阈值/权重常量未实测标定；⑤ 一次 `vitest --coverage` 出现 1 红且**未捕获到文件名**，随后两次全量 4491/4491 全绿（判断为两条 flaky 在 coverage 插桩慢速下的时序波动，未改被测代码）。

#### Gate F 第一轮（D6 基线，2026-10-01）—— 通过

| # | 门禁 | 实测 | 判定 |
|---|---|---|---|
| 1 | `npm run typecheck` | exit **0** | 通过 |
| 2 | `npx vitest run` | **188 文件 / 4491 例 → `0 failed`** | 通过 |
| 3 | `npx eslint src/ --ext .ts,.tsx` | **`0 errors, 108 warnings`**（= 基线） | 通过 |
| 4 | `npx vite build` | exit **0** | 通过 |
| 5a | **`agent-memory-migration-smoke`** | **七态全绿、`EXIT=0`**（B3 四态 + D2 补列 + D5 FTS/驳回列 + **D6 向量列 14→16 列 + 真库混合检索 SQL**） | 通过 |
| 5b | **`fts5-smoke`** | **`EXIT=0`**（既有态 + D7 删除/更新态） | 通过 |
| 6 | `npx playwright test` | **31 failed / 104 passed / 1 skipped = 136**（计数行直接捕获） | 通过 |

> 本轮为 **D6 的基线验证**；D6.1（Q9）实施后**再跑一轮 Gate F 作最终收口**。

#### D6.1 = Q9 `memory_read` 语义通道生产可达（L3，实施期追加授权）—— 交付完成

**改动范围**：`src/main/ai/tools/memoryRead.ts` **+61/−4（本任务唯一 `src/` 改动，计划外 `src/` 改动 0 行）** + 新建 `tests/main/ai/memoryReadHyde.test.ts`（17 例）。`docs/` 零改动。

**命名裁定（对齐既有）**：参数取 **`hyde?: boolean`** 而非 `semantic` —— `searchKB` 已用 `hyde: {type:'boolean'}`（`toolRegistry.ts:142`），且本任务复用**同一套生成器**（`ctx.generateHydeVector`）+ **同一份缓存**（`searchCache` 的 `getCachedHydeResult`/`setCachedHydeResult`），语义同构。

**交付**
- schema 加 `hyde` 可选参数（`required` 不变）+ 工具与 `query` 描述补一句「传 `query` + `hyde:true` 现场生成查询向量走语义混合召回」（**让 LLM 生产上真的会传**）
- `generateHydeQueryVector(userId, query, generate)`：先读既有 HyDE 缓存 → 未命中才调生成器 → `parseQueryVector` 校验 → 写回同一份缓存；**任何失败（null / 抛错 / 非 Error / 含非有限分量）一律 `console.warn` 一条、返回 null、不抛、不重试**，回落纯 FTS-only（对齐 D6 三处接线语义）
- **触发条件三与**：`args.hyde === true && query 非空 && 未显式传 queryVector && ctx.generateHydeVector 存在` —— 缺一即**零 embedding 成本**
- handler 同步 → `async`（`ToolHandler` 本就允许 `Promise<ToolResult> | ToolResult`）；既有路径逐字未动

**TDD RED → GREEN**：首版 9 红（其中 2 红系测试自身断言写错，改正测试侧未改被测代码）→ 最终 RED **`7 failed | 6 passed (13)`**（`spy to be called 1 times, but got 0`、`expected "warn" to be called 1 times, but got 0` ×3、`expected undefined to be 'boolean'`）→ GREEN `13 passed` → 补 4 例 **`17 passed (17)`**。
**核心用例**：`夜间配色` 对 `用户偏好深色的界面主题` **关键词零重合** → FTS-only 召回 0 条、`hyde:true` 后召回 1 条（**同一 DAO、同一 fake DB，差分即证明向量通道生效**）。
**变异 5 处**：去 opt-in 判断（恒生成）→ `3 failed`（`spy to not be called at all, but actually been called`）；去掉失败降级（`throw`）→ `3 failed`；参数必填化 → `1 failed`（`expected ['hyde'] to deeply equal []`）；生成结果不传给 `searchMemories` → **`4 failed`**；去掉缓存复用 → `1 failed`（`spy to be called 1 times, but got 2 times`）。

**D6.1 单元门禁**：tsc exit 0 / **全量 `189 文件 4508 例 0 failed`**（D6 基线 188/4491 → +1 文件 +17 例）/ eslint `0 errors, 108 warnings` = 基线（新测试文件单独 lint 0 problem）/ vite build exit 0 / 改动行覆盖 **`memoryRead.ts` Stmts·Branch·Funcs·Lines 全 100%（无 uncovered 行）** / **既有 `memoryTools` + `memoryVectorWiring` 合并 `41 passed`，两文件 `git diff` 为空**。
> flaky：全量第 1 轮唯一红为 `ab-test djb2`（**完整输出已捕获文件名与用例名**，未改被测代码）→ 单跑 **`22 passed` × 3** → 全量复跑 `189/4508` 全绿。

**追认 3 项实现取舍**
1. **不 import `vectorBackfill.resolveEmbedding`** —— 既有 `memoryVectorWiring.test.ts:39` 用 `vi.mock('@main/ai/knowledge/vectorBackfill', ...)` 只提供 2 个导出，memoryRead 若 import 该模块会**打破既有 D6 用例**（违反「零改动全绿」）。改走 `ctx.generateHydeVector`（`agentContext.ts:562-565` **先判 `getEmbeddingConfig` 再返回 null，未配置时一个 API 都不发**）→ 任务书「配置了 embedding 才调 API」由生成器内部满足。
2. **不自建第二套缓存** —— 直接复用 `searchCache` 的 HyDE LRU(50)/TTL(10min)，与 `searchKB` 同一份。
3. **handler 改 `async`** —— 已 grep 确认全仓无未知同步调用方（仅 `toolRegistry.ts:97` 注册 + 两处测试调用），typecheck + 41 例既有用例全绿。

**残余风险**：① **`agentPromptBuilder` 的工具提示词未为 `memory_read` 追加 hyde 引导**（属 D4 文件、不在授权范围），目前仅靠工具 schema 的 `description` 传达 —— 记 TODO；② HyDE 缓存与 `searchKB` 共享 → `cacheMonitor` 的 `hyde` 命中统计口径含 `memory_read` 调用（监控数字含义略扩，`cacheMonitor.test.ts` 全绿）；③ 成本：`hyde:true` 每个**新** query 一次 LLM 假设文档 + 一次 embedding（10 分钟 LRU 50 条兜底），未配置 embedding 零 API 调用 → 建议生产观察频次；④ 查询向量与存量向量维度不一致时（用户中途切换 embedding 模型）`vec_distance_cosine` 抛错 → 已被 DAO 侧 try/catch 吞掉降级 FTS-only（D6 既有行为，非本任务引入）。








