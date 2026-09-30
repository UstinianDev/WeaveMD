# agent-memory-optimize-3 — TDD 测试报告（第三批 / P2）

> 日期：2026-10-01 | 档位 **L**（含 2 处 L4 迁移 + 1 处 L3 改既有 DDL）| TDD 强度 **strict**
> 需求 `docs/requirements/agent-memory-optimize-3.req.md`（Q1~Q9）｜计划与实施记录 `docs/plan/agent-memory-optimize-3.plan.md`（§6）
> 结论：**三 Gate 六件套全绿，55 处变异全部变红后还原复绿，E2E 零新增失败，计划外 `src/` 改动经逐项追认后为 0**

## §1 范围与交付对账

方向文档第三批（P2）共 6 项 + **1 项范围扩张 + 1 项实施期追加授权** = 9 个交付任务。

| Gate | 任务 | 交付要点 | RED → GREEN |
|---|---|---|---|
| D | **D1** = 二.3 指代触发率接入 diagnostics（L2） | `kbSearch` 补 `queryUnderstanding` 赋值（含 2 条早退路径）+ `toolTypes` 契约补 `diagnostics` + `searchKBHandler` 挂进 content | `20 failed \| 51 passed` → `71 passed` |
| D | **D2** = 五.4 遗忘/过期机制（L3+L4） | `addAgentMemoryAccessColumns` 补 `access_count`/`last_read_at` + `written_at` 索引；容量上限 `MAX_ACTIVE_MEMORIES=500`；三处触发（启动/C1 写入后/后台提取后） | 迁移 `4 failed` → `30 passed`；policy `15 failed` → `152 passed` |
| E | **D3** = 六.1 轨迹→Skill 提炼（L3，**改走纯 FS 无 L4**） | 三条断链修复（3 处无参 `loadSkills()`）+ 草稿态三重防线 + 后台提炼任务 + IPC 三通道；轨迹源 `ai_messages` | 五模块 `10/7/resolve-import/resolve-import/1 failed` → `206/27/16/8 passed` |
| E | **D4** = 六.2 结构化存储 + 任务类型注入（L3） | front matter `intents` + `buildAgentSystemPrompt` 第 7 参 / `buildChatSystemPrompt` 第 3 参（插画像块后）；`EXPERIENCE_TOKEN_LIMIT=2000` | `28 failed \| 179 passed` → `207 passed` |
| E | **D5** = 六.3 防膨胀三防线（L3+L4 建 FTS） | `agent_memory_fts`（trigram）+ 跨 subject 语义合并 + 三态审核 + 复用 D2 触发 | `44 failed \| 2 passed` → `268 passed` → 全量 `4418` |
| E | **D7** = 知识库 FTS 触发器修复（L3，**范围扩张**） | 3 处触发器改标准 `DELETE ... WHERE rowid = old.rowid`；影响面含**所有 `UPDATE kb_documents`** | 真库 `FAILED: SQL logic error` + 单测 `4 failed` → 两态全绿 |
| F | **D6** = 三.3 向量化经验库（L4 加列，**Q8=A**） | `addAgentMemoryVectorColumns`（`vector`+`embedding_model`）+ `searchMemories` 加权 RRF 混合召回 + 三处异步接线 + 回填 + `memory_read` 语义路径 | 迁移 `5 failed`、检索 `17 failed`、接线 `28 failed` → 全量 `4491` |
| F | **D6.1** = Q9 `memory_read` 语义可达（L3，**追加授权**） | `hyde?: boolean` opt-in（对齐 `searchKB`）+ 生成器与 LRU 缓存复用 + 静默降级 | `7 failed \| 6 passed` → `17 passed` |

## §2 三 Gate 六件套实测

| 门禁 | Gate D（09-30） | Gate E 第1轮（09-30） | Gate E 第2轮（09-30/10-01） | Gate F 第1轮（10-01） | Gate F 收口（10-01） |
|---|---|---|---|---|---|
| `npm run typecheck` | 0 | 0 | 0 | 0 | 0 |
| `npx vitest run` | `4234 \| 1`（flaky） | **`4418 例 0 failed`** | **`4430 例 0 failed`** | **`4491 例 0 failed`** | `4507 \| 1`（flaky，单跑 `22 passed`） |
| `npx eslint src/ --ext .ts,.tsx` | 0 err / 108 warn | 0 / 108 | 0 / 108 | 0 / 108 | 0 / 108 |
| `npx vite build` | 0 | 0 | 0 | 0 | 0 |
| 真库 smoke | agent-memory **五态** | agent-memory **六态** | agent-memory 六态 + **`fts5-smoke` 删除态** | agent-memory **七态** + fts5 | agent-memory **七态** + fts5 |
| `npx playwright test` | `31f/104p/1s` | `31f/104p/1s` | `31f/104p/1s` | `31f/104p/1s` | `31f/104p/1s` |

**E2E 判定**：五轮的 **31 条失败清单逐条相同**（含 10 条 B 类废弃能力失败，**不得修**），passed/skipped 恒为 **104 / 1**，**总数 136、零新增失败**。

**既知 flaky 处置**（两条均未改被测代码）：
- `tests/benchmarks/ab-test.test.ts` 的 `djb2 should be faster than simulated MD5` —— 性能断言，本机单跑 3~5 轮 = 绿·红·绿（约 60% 绿）；Gate D/Gate F 收口各命中一次，**完整输出均捕获到文件名与用例名**，单跑复核 `22 passed`。
- `tests/main/ai/cacheMonitor.test.ts` 的 `getStats 10万次调用 < 50ms` —— 本批多轮未复现红，历史单跑复核 `37 passed`。

> **测试规模**：第二批 Gate C 收口 `175 文件 / 4191 例` → 第三批 Gate F 收口 **`189 文件 / 4508 例`**，净增 **+14 文件 / +317 例**。

## §3 改动行覆盖（Q18 口径）

> `vitest.config.ts` **全程零改动**；一律 CLI `--coverage.include` + 临时 `--coverage.reportsDirectory`，用完 `rm -rf`。

| 任务 | 改动行覆盖 |
|---|---|
| D1 | `kbSearch.ts` **48/48** + `searchKBHandler.ts` **34/34** = **100%**（`toolTypes.ts` 纯类型不插桩） |
| D2 | **255/268 = 95.1%**（`agentMemory` 100%、`memoryPolicy` 95.8%、`memoryWrite` 100%、`index.ts` 81.8%、`agentHandlers` 69.2% —— 未覆盖为 `runMigrations` 调用与不可达防御性 catch） |
| D3 | 总 **Stmts 88%**（`skillPaths` 100%、`skillDistiller` 98.63%、`skillLoader` 98.49%、`skillDraftHandlers` 92.96%、`skillAutoStore` 90.29%、`agentContext` 91.36%、`db/ai.ts` 88.34%） |
| D4 | **1069/1107 = 96.6%**（`skillDistiller` 98.64%、`skillLoader` 98.68%、`agentPromptBuilder` 95.22%、`agentContext` 92.13%、`skillAutoStore` 91.47%） |
| D5 | **1239/1329 = 93.2%**（`memoryPolicy` 98.8%、`agentMemory` 97.5%、`memoryHandlers` 97.6%、`index.ts` 90.5%、`AgentPersonalityPanel` **100%**） |
| D7 | 改动行 **100%**（`index.ts` 整体 47.41% Stmts，但改动行 `66-72`/`704-724` 逐行核对全为 C） |
| D6 | **316/317 = 99.7%**（`agentMemory` D6 段 170/170、`vectorBackfill` D6 段 125/125、`memoryRead` 46/46 等全 100%；唯一未覆盖 = `runMigrations` 调用行，**D2/D5 同位置同样未覆盖属既有范式**） |
| D6.1 | `memoryRead.ts` **Stmts·Branch·Funcs·Lines 全 100%（无 uncovered 行）** |

## §4 变异验证汇总（**55 处**，全部变红后还原复绿）

| 任务 | 变异数 | 代表结果 |
|---|---|---|
| D1 | 5 | content 不挂 diagnostics → **8 failed**；`hadPronounRef` 恒 false → 4 failed |
| D2 | 8 | 删 manual 容量豁免 → 2 failed；删 `markAccessed` → 4 failed；策略扫描加计数 → 1 failed |
| D3 | 8 | **M4 组合变异（去 `_auto` status 闸 + 扫 `_drafts` + 去 draft 过滤）→ 5 failed**；分页 SQL 去 `user_id` → 6 failed |
| D4 | 8 | 空块注入占位 → **8 failed（含 6 条既有 A1/B4 护栏）**；`isExperienceIntent` 放行 chat → 1 failed |
| D5 | 10 | FTS 候选 SQL 去 `user_id` → **6 failed**；`selectActiveRows` 去 `valid_to IS NULL` → **4 failed** |
| D7 | 5 | ad 改回 `'delete'` → smoke `EXIT=1` + vitest 2 failed；au 去删旧行 → smoke `EXIT=1`（fts5 重复约束） |
| D6 | 6 | 去两通道 `user_id` → **12 failed**；去向量通道 `valid_to IS NULL` → **首版 0 红**（fake 自身硬编码过滤 → 补 SQL 文本守卫后 4 failed） |
| D6.1 | 5 | 生成结果不传 `searchMemories` → **4 failed**；去 opt-in 判断 → 3 failed；去失败降级 → 3 failed |
| **合计** | **55** | — |

> 两处「变异首版不红」均被识别并加固：D3 的双防线需**组合变异**、D6 的 fake 自带过滤需**SQL 文本守卫** —— 两例都说明**变异不红不等于断言无效，可能是测试夹具自身在兜底**。

## §5 红线验证

| 红线（req §五 7 条） | 验证方式 | 结果 |
|---|---|---|
| 1. 不减历史轮次、不截断工具结果 | `agentContext.test.ts:633/642/663` 全程零改动 | 全绿 |
| 2. 铁律一仅约束笔记 + 必须有可见可删/可审核入口 | D3 草稿三通道 + D5 三态审核 + C3 列表删除；铁律一三处测试 | **77 passed 零改动** |
| 3. 拒答 0.6 / 置顶 ×1.5 / searchMode 三模式不变 | D1 不碰分数与阈值；D6/D6.1 `git diff` 对 `filterKbEgressResults`/`searchMode` **为空**、`kbSearchFts.ts` **为空**；`embedding-architecture.md` 的两处冲突**改文档不改代码** | 达标 |
| 4. 迁移双路径、历史迁移不擅改 | D2/D5/D6 各自**新建独立函数 + `runMigrations` 一行调用**，4 个既有迁移函数本体零改动（测试 + smoke 双重断言其体内不含新列/新表名）；三态断言 + 真库 smoke **七态 EXIT=0**；D7 改 3 处触发器走 `DROP TRIGGER IF EXISTS + CREATE` 幂等重放（**不 DROP 表/索引/不改列结构**） | 达标 |
| 5. `vitest.config.ts` 禁改 | 五轮门禁前后 `git status` | **零改动** |
| 6. 不提交密钥 / 不删测试 / SQL 参数化 | 全程未 `git add`；既有测试仅 D2 的 1 条因裁定互斥改写、D4 的 import 换行，**均非削弱**；新增 SQL 全 `?` 参数化（fake 引擎的占位符校验会拦拼接） | 达标 |
| 6. 阈值按 `CONTEXT_WINDOW=64000` 实测调优、不照抄外部数值 | D4 `EXPERIENCE_TOKEN_LIMIT=2000` 注释附实测（典型 188 / 极限 2521 / 三块满载占 4.92%、顶格 11.82%）；D5/D6 全部阈值常量标「无实测数据、待校准」 | 达标 |

## §6 计划外改动与追认（累计 25 类）

| # | 项 | 裁定 |
|---|---|---|
| 1 | D1 文档偏离：`researchLoop` 写「仅声明，尚未赋值」而非任务书要求的「已接线」 | **追认**（该函数不在 D1 范围，**不写假文档正确**，任务书措辞不准确） |
| 2 | D1 `agentTaskWorker.ts:502` 闭包未透传 `hadPronounRef`（该文件归 D2 并行期不可动） | **总指挥 Gate D 前自行补上**（+2 行） |
| 3 | D1 `isFallthrough` 取 agent 任务路由语义（按裁定原文） | **追认**，KB 侧语义需求记 TODO |
| 4 | D2 `memoryHandlers.test.ts` +27（fake 补 `runUpdate` 分支） | **追认**（补列后 `getActiveProfile` 发 `UPDATE`，只加语句能力零断言改动） |
| 5 | D2 `runMemoryPolicy` 返回仍 `{evicted, merged}`、容量关闭折进 `evicted` | **追认**（保既有 3 例 `toEqual` 零改动，JSDoc 已写明） |
| 6 | D2 操作事故：`git checkout` 回退 `index.ts` 后改动一度丢失 | **已从备份找回**，总指挥独立复核 `22/0` + 30 例 + 五态 smoke 全符 |
| 7~16 | D3 清单外 10 项（`agentTaskWorker` 触发、`resolveUserId` 加 export、preload/constants/shared/ipc/store/bridge、4 新 src、5 新测试） | **全部追认**（任务书要求的触发点 + 三通道与 UI 必需 + 不做则 TS2741） |
| 17 | D3 `agent_task_queue.status` 枚举：req 写 `'done'` 实为 `'completed'` | **req 措辞已同步修正** |
| 18 | D4 追认 4 项（chat 分支生产恒空 / 内置 skill 也参与推断注入 / `skills→agentPromptBuilder` 跨层依赖 / `approveDraftSkill` 报错不具体） | **全部追认**（详见 plan §6 D4 段） |
| 19 | D5 清单外 12 类（最大项 `agentMemory.ts` +243、IPC 常量/类型/preload/bridge/store、`tests/setup.ts`、文案 key 独立化等） | **全部追认**（`memoryPolicy` 头注明「不写 SQL」故 SQL 必须落 DAO；文案 key 为**主动规避**既有 `findByText(/加载失败/)` 多元素命中） |
| 20 | D7 `addKbDocumentsFtsIndex` 加 `export` | **追认**（零行为改变，不导出则改动行 0% 覆盖；与 D5 导出 `addAgentMemoryFts` 同款先例） |
| 21 | D6 `vectorBackfill.ts` +177（**首次进入本批改动集**） | **追认**（任务书点名复用其 `resolveEmbedding` 但未点名放导出；不新建 src 文件符合全局规范，该文件本就是向量回填唯一归属） |
| 22 | D6 `agentHandlers.ts` +15 | **追认**（任务书「复用 D2 三处触发」必经该文件） |
| 23 | D6.1 参数取 `hyde` 而非 `semantic` | **追认**（对齐 `searchKB:142` 且复用同一生成器与缓存） |
| 24 | D6.1 不 import `vectorBackfill.resolveEmbedding`，改走 `ctx.generateHydeVector` | **追认**（前者会打破既有 D6 测试的 `vi.mock` 导出集合；后者内部先判 `getEmbeddingConfig`，未配置零 API 调用） |
| 25 | D6.1 handler 同步 → `async` | **追认**（已 grep 确认无未知同步调用方，typecheck + 41 例既有用例全绿） |

**计划外 `src/` 改动：经逐项追认后为 0**（各任务均按预登记清单核验）。

## §7 已知限制与遗留

1. **范围扩张 D7 的附带发现**：知识库的**删除与更新路径此前整体报错回滚**（`AFTER DELETE`/`AFTER UPDATE` 触发器在普通 fts5 表上用仅限 contentless 的 `'delete'` 命令），既有 `fts5-smoke` 只验插入查询故从未暴露。已修 3 处触发器；**未重建旧库 FTS 内容**（红线禁 DROP，回填 `rowid NOT IN` 只补不删）。
2. **D6 启动回填的成本**：embedding 已配置时对存量缺口行发起批量 API 调用，**首个升级版本可能有一次批量 embedding 成本**（未配置时零成本空转、在途去重、失败静默）→ 建议生产观察。
3. **D6.1 成本**：`hyde:true` 每个新 query 一次 LLM 假设文档 + 一次 embedding（10 分钟 LRU 50 条兜底），未配置 embedding 零 API 调用。
4. **全部阈值/权重常量无实测数据**，注释均标「待校准」：`MAX_ACTIVE_MEMORIES=500`、`MEMORY_EVICT_MAX_AGE_DAYS=90`、`MEMORY_MERGE_SIMILAR_THRESHOLD=0.5`、`MEMORY_SEARCH_*` 7 个、`EXPERIENCE_TOKEN_LIMIT=2000`、`SKILL_DISTILL_*` 4 个。
5. **队列跨任务类型 supersede**：`memory_extract` 与 `skill_distill` 同点入队互相顶掉（提炼给 memory 让位、首轮延后 1 轮）—— 记 TODO。
6. **chat 分支经验块生产恒空**（裁定 3「chat 不注入」∩ 现有分支条件），能力完整有 4 条单测 —— 记 TODO。
7. **D3/D4 渲染侧改动行无单测**（`SkillsPanel` 提炼栏、`agentStore` 若干 action、经验注入渲染侧）—— 主进程侧 D3 88% / D4 96.6%。
8. **D6.1 未在 `agentPromptBuilder` 的工具提示词加 hyde 引导**（属 D4 文件不在授权范围），目前仅靠工具 schema `description` 传达 —— 记 TODO。
9. 一次 `vitest --coverage` 出现 1 红**未捕获文件名**（随后两次全量全绿）；D3 亦有 2 次未捕获 —— 后续任务已强制要求完整输出捕获，D6.1/D7 均成功捕获。

## §8 未提交清单（截至本报告）

- **已提交（第二批）**：`8fd28f1` / `6ed0b4c` / `33c3763`
- **第三批全部未提交**：D1（3 src + 2 test + 1 doc）、D2（5 src + 2 test + 1 script）、D3（4 新 src + 改 9 src + 5 新 test）、D4（5 src + 4 test 追加）、D5（5 新 src + 改 7 src + 3 新 test + 3 test 追加 + 1 script）、D7（1 src + 1 script + 1 新 test）、D6（1 新 src 段 + 改 6 src + 4 新 test + 1 script + 1 doc）、D6.1（1 src + 1 新 test）
- **文档**：`agent-memory-optimize-3.req.md` / `.plan.md` 本报告 / `TODO.md` / `SUMMARY.md` / `README.md` / `.claude/CLAUDE.md` / `modules/11` / `architecture/{database,knowledge}` / `modules/07` / `specs/embedding-architecture.md`
