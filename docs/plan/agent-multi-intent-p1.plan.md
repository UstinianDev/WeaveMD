# agent-multi-intent — P1/P2 八任务实施计划

> 需求裁定（锁定）：`docs/requirements/agent-multi-intent/agent-multi-intent.req.md` §6 Q17~Q24（2026-10-02「全部按推荐」）+ §3 Q1~Q14 原则仍生效
> 源任务：`C:\Users\lenovo\Desktop\优化方向\智能创作Agent-多意图识别-优化方向.md` 任务 6、7、4、9、12、13、8、10（按 Q17 顺序）
> 行号核对基准：2026-10-02 工作区实况（HEAD `a5bff32`，P0 已交付 `38edc57..e6d06df` + 修复 `03d60b3` + 文档 `a5bff32`）
> 档位 L，TDD strict；证据报告续写 `docs/testing/agent-multi-intent/agent-multi-intent.tdd.md`；每任务一个独立提交，门禁全绿才进下一任务
> 外部调研已并入任务 4/7/8（各节标注来源）

## 0. 行号核对结果（源文档快照 vs 当前实况）

源文档行号为 P0 之前快照。**凡 P0 触碰过的文件以下表为准，禁止按源文档行号施工**。

| # | 文件 / 源文档引用 | 当前实况 | 结论 |
| --- | --- | --- | --- |
| 1 | `intentRouter.ts` RULES `17-67` | 17-67 | ✓ |
| 2 | `intentRouter.ts` `classifyIntent` `75-155` | **128-208** | **偏差** |
| 3 | `intentRouter.ts:91` `lower.includes` | **141** | **偏差** |
| 4 | `intentRouter.ts:112-120` chat 兜底 | **161-169` | **偏差** |
| 5 | `intentRouter.ts:126-141` confidence/candidates | **183-198** | **偏差** |
| 6 | `intentRouter.ts:144-146` needsClarification 门 | **201-205** | **偏差** |
| 7 | `intentRouter.ts:4-5` 升级点注释 | 4-5 | ✓ |
| 8 | `agentContext.ts:64-91` AgentContext 接口 | **74-107**（`intentGateOpen` 99、`toolSelectionArgs` 103） | **偏差** |
| 9 | `agentContext.ts:403` 技能推断 classifyIntent | **419** | **偏差** |
| 10 | `agentContext.ts:517` 主分类调用 | **533**（gate 537-541） | **偏差** |
| 11 | `agentContext.ts:632-640` toolsForIntent 入参 | **658-666** | **偏差** |
| 12 | `agentContext.ts:736-743` 提示词二选一 | **771** | **偏差** |
| 13 | `agentContext.ts:770-778` 文档上下文注入 | **800-807** | **偏差** |
| 14 | `agentLoop.ts:77-105` AgentLoopDeps | **90-128**（`isChainInterrupted` 127） | **偏差** |
| 15 | `agentLoop.ts:228` runAgentFlow | **251** | **偏差** |
| 16 | `agentLoop.ts:254-631` 主循环 | **259-845**（`finalizeChainRun` 324、链启动 342、延迟重发 554-600、`processStreamingToolRound` 848） | **偏差** |
| 17 | `agentLoop.ts:407-500` 延迟重发 | **412-430（stub 判定）/ 554-600（重发块）** | **偏差** |
| 18 | `agentLoop.ts:439` skip-set | **591**（流式 865-871） | **偏差** |
| 19 | `agentLoop.ts:691` waitForAll | **599 / 865** | **偏差** |
| 20 | `agentToolExecutor.ts:127,170,417` `call_${round}_${index}` | **190, 220, 552** | **偏差** |
| 21 | `agentToolExecutor.ts:161-236` checkForceConfirmTools | **210-317** | **偏差** |
| 22 | `agentToolExecutor.ts:188` delete_confirm | **261-266** | **偏差** |
| 23 | `agentToolExecutor.ts:206-208` yes 才执行 | **293** | **偏差** |
| 24 | `agentToolExecutor.ts:224-235` 无交互拒 | **313-317（force）/ 226-231（batch）** | **偏差** |
| 25 | `agentToolExecutor.ts:288-314` waitForInteraction 暂停 | **274-296（force 等待）/ 423-450（handleInteractionPause）** | **偏差** |
| 26 | `agentToolExecutor.ts:388-402` citation 合并封顶 | **472-537**（collectCitations 472 / mergeCitations 523） | **偏差** |
| 27 | `agentToolExecutor.ts:516` toolCallsHistory | **651** | **偏差** |
| 28 | `agentToolExecutor.ts:519-529` 写成功推 preview | **643-680**（preview 事件 657） | **偏差** |
| 29 | `agentTaskWorker.ts:121-129` 暂停 | **610-629**（buildAgentDeps.onInteractionRequired → waiting_interaction） | **偏差** |
| 30 | `agentTaskWorker.ts:636-680` AI_STREAM_DONE | **651-690**（handleTaskSuccess 651，DONE 665） | **偏差** |
| 31 | `agentTaskWorker.ts:138-141` maxConcurrent | 140 | 轻微 |
| 32 | `agentTaskWorker.ts:237-250` poll | 236-252 | 轻微 |
| 33 | `agentTaskWorker.ts:215-230` 恢复 / `279-297` createSession / `610-632` deps | 216-231 / 279-297 / 610-633 | ✓ |
| 34 | `agentToolSelector.ts:18-27` READ_ONLY「16 项」 | 18-28，**现为 17 项**（含 B8 四工具） | **偏差（计数）** |
| 35 | `agentToolSelector.ts:30-33` WRITE_TOOLS | 30-37（7 项不变） | ✓ |
| 36 | `agentToolSelector.ts:36-39` FORCE_CONFIRM_TOOLS | 39-45 | **偏差（轻微）** |
| 37 | `agentToolSelector.ts:105-111` chat ask_question | 109-113 | **偏差（轻微）** |
| 38 | `agentToolSelector.ts:112-116` kbQa 分区 | 115-119 | **偏差（轻微）** |
| 39 | `agentPromptBuilder.ts:428/479/396-401/430-450/471-476/146/247-253` | 428✓、479✓、**澄清前缀 398-401**、430-450✓、471-476✓、146✓、247✓ | 1 处轻微（396→398） |
| 40 | `preload.ts` `AGENT_INTERACTION_QUESTION`（源任务2 :513-526） | **520-529**（plan 529）；`subtask_done` 541 | **偏差** |
| 41 | `agentStore.ts` pendingInteraction（源 :225/441/490/984） | **226/462/1046/1881** | **偏差** |
| 42 | `agentStore.ts` apply（源 :1258-1310） | **1271-1300** | **偏差** |
| 43 | `agentStore.ts` discard（源 :1312-1340） | **1304-1308（fileOp）/ 1375-1400（editBlocks）** | **偏差** |
| 44 | `AIPanelSession.tsx:114-121` variant 分派 | **117-128**（intent_split 120 / write_batch 122） | **偏差** |
| 45 | i18n `ai.split.*`（源任务2 :66 附近） | **zh-CN 79-88**；`ai.batchConfirm.*` 75-78 | **偏差** |
| 46 | `getTaskActivity.ts:82-130` | **85-150**（executeGetTaskActivity 85） | **偏差** |
| 47 | `ExecutionSegments.tsx:50` | 49-51（grouped 51） | 轻微 |
| 48 | `DiffSummaryCard.tsx:232-255` staleness | 232-255 | ✓ |
| 49 | `DiffSummaryCard.tsx:451-513` 全部应用/废弃 | **490-513**（discardAll 501） | **偏差** |
| 50 | `agentHandlers.ts:329-348/350-370/372-402` | 328-349 / 351-370 / 372-404 | ✓ |
| 51 | `db/index.ts:538-551 / 564 intent_json` | 538 / 564 | ✓ |
| 52 | `agentTaskDao.ts:55-73 / 80-107 / 96-100` | 55 / 80 / UPDATE 97 | ✓ |
| 53 | `agentSessionDao.ts:236-267` updateLease/clearLease | 239 / 259 | ✓ |
| 54 | `agentSnapshot.ts:15-39 / 98-136` | 15（函数体延至 ~51）/ 98 | ✓（轻微） |
| 55 | `kbSearch.ts:385` isFallthrough | 385 | ✓ |
| 56 | `queryPlanner.ts:55-81 / 93-120` | 55 / 93 | ✓ |
| 57 | `concurrencyDefs.ts:15-73 / 106-111` | 16-73 / 106 | ✓ |
| 58 | `concurrencyDefs.test.ts:34/69/97`、`docTools.test.ts:154-157` | 一致 | ✓ |
| 59 | `StreamingToolExecutor.ts:83-100 / 139-167 / 190-198` | 82-99 / 140 / 191 | ✓ |
| 60 | `editBlocksHandler.ts:47-54`、`previewFileRevision.ts:71-80` | 一致 | ✓ |
| 61 | `ai-agent.md` 意图 `93-106` | **93-141**（子节 108） | **偏差** |
| 62 | `ai-agent.md` 写控制 `145-169`（`:157` 标题） | **188-233**（三档 193、write_mode 217） | **偏差** |
| 63 | `subtaskOrchestrator.ts / confirmMatrix.ts / taskPlanner*.ts / structuredJson.ts / SplitConfirmCard / BatchConfirmCard` | P0 新增，源文档无此文件 | 新增（非偏差） |

**偏差合计：明确偏差 43 处 + 轻微偏移 4 处 = 47 处**。P0 新增关键导出（供后续引用）：`startSubtaskChain`→`subtaskOrchestrator.ts:470`、`advanceSubtaskChain` 524、`handleSubtaskFailure` 592、`stopChain` 421、`finalizeChainContent` 639、`SubtaskChain` 287、`confirmWriteBatch`→`agentToolExecutor.ts:327`、`finalizeChainRun`→`agentLoop.ts:324`、`confirmSkipSet`→`confirmMatrix.ts:89`。

## 1. 总架构与跨任务衔接

> 分册回链：本节只给总架构与跨任务衔接；八任务逐任务实施（重点文件与实况行号、RED/GREEN、外部调研标注、风险与回滚）见 [01-逐任务实施.md](./agent-multi-intent-p1.plan/01-逐任务实施.md)。

### 1.1 `intent_json` JSON 形状（任务 6 定形；任务 7/8/12 消费）

```jsonc
{
  "v": 1,                          // 形状版本，读端容错用
  "runId": "…",                    // 本次链运行幂等键成分（ctx.runId）
  "primaryIntent": "create",
  "plan": { "subtasks": [/* AgentTaskPlan 原样 */], "omittedCount": 0 },
  "deps": { "s2": ["s1"] },        // 由 SubtaskDef.preconditions 归一（任务 8 出队条件）
  "subtasks": [
    { "id": "s1", "status": "pending|running|done|failed|skipped|skipped_dependency|dependency_rejected",
      "startedAt": 0, "endedAt": 0, "rounds": 0, "summary": "…", "error": "…" }
  ],
  "outcome": "finished|stopped|failed",
  "report": { /* 任务 7 buildChainReport 输出，任务 7 起填充 */ }
}
```

- 重试计数**不落盘**（Q18：内存态，即 `SubtaskChain.retryCount`）；快照不入 JSON（复用 `agentSnapshot`，Q18）。
- 读端（getTaskActivity/报告）解析失败一律视为「无追踪数据」降级，不阻断（容错读；写端尽力而为：落库异常仅 console.error，不影响链运行）。

### 1.2 数据流

```
任务6: startSubtaskChain/advance/failure/finalize
        → deps.onChainRecordUpdate(json) → agentSessionDao.saveIntentJson(sessionId)
任务7: intent_json.report ← buildChainReport(chain, record, batchResults)
        + getTaskActivity LEFT JOIN agent_sessions 取 intent_json → 工具结果透出子任务状态
任务8: plan.preconditions → intent_json.deps → 链内调度器「依赖满足才出队」
任务12: confirmWriteBatch 拒绝 → record.deps 级联 → subtasks[].status=skipped_dependency → 入报告
```

### 1.3 提交切分（每任务一个提交，英文 `type(scope): message`）

| 序 | 任务 | 提交信息 |
| --- | --- | --- |
| 1 | 6 | `feat(agent): persist subtask tracking into agent_sessions.intent_json` |
| 2 | 7 | `feat(agent): merge multi-subtask execution report with partial-failure policy` |
| 3 | 4 | `feat(agent): add tiered intent routing with rule baseline and shared TTL cache` |
| 4 | 9 | `feat(agent): bridge agent intent into KB search with per-subtask single retrieval` |
| 5 | 12 | `feat(agent): subtask-scoped confirmation staleness and cascade skip on reject` |
| 6 | 13 | `feat(agent): consume write_mode auto/manual and converge write lists to confirmMatrix` |
| 7 | 8 | `feat(agent): dependency-aware subtask parallel scheduling with conflict guards` |
| 8 | 10 | `docs(agent): cross-reference dual intent systems and declare boundary comments` |

每提交同步：勾选 `docs/plan/agent-multi-intent.status.md` 阶段进度 + 追加任务执行记录；TDD 证据追加 `docs/testing/agent-multi-intent/agent-multi-intent.tdd.md`。

### 1.4 全局红线（P0 沿用 + P1 强调）

1. 不引依赖（无 zod / 无 `@anthropic-ai/sdk` / 无新 npm 包）；不改历史迁移、不动 `agent_task_queue`/`agent_sessions` 表结构（**8 任务全程零加列**，任务 8 的 `parent_id` 预设由 intent_json.deps 取代，须在 status 记录偏离）；
2. 铁律一与无交互 fail-closed 只强不弱；确认矩阵代码为准、提示词一致性测试防分叉；
3. sha256 钉死的提示词行（`agentPromptBuilder` 428/479/430-450/471-476、`CHAT_SYSTEM_PROMPT` 等）**不可原地改**——需要新语义一律走独立 system 段（P0 已有 `buildSplitDirectiveSegment`/`buildWriteBatchNoticeSegment` 先例）；
4. 既有测试零改动全绿（基线 4696 例）；确需适配 fixture 只许补 mock/字段，不许弱断言；mock 环境沿用 P0「命名空间访问 + try/catch fail-closed」模式（vitest factory 缺导出即抛，`tests/_probe.test.ts` 实测）；
5. gate 关路径消息序列逐字节等价；拆分失败不阻断对话；每任务门禁红即本提交内修复，不带病进入下一任务。

## 2. 逐任务实施（已拆分）

原 §2 八任务逐任务实施（原 L138-L376）已逐字迁入分册目录 `docs/plan/agent-multi-intent-p1.plan/`：

| 分册 | 内容 | 原行范围 | 行数 |
| --- | --- | --- | --- |
| [01-逐任务实施.md](./agent-multi-intent-p1.plan/01-逐任务实施.md) | 任务 6/7/4/9/12/13/8/10 逐任务实施（重点文件与实况行号、RED/GREEN、含任务 4/7/8 外部调研标注、风险与回滚） | L138-376 | 239 |

分册正文与原文件逐字一致（仅切分、不改写）。§1 总架构、§3 变更清单、§4 验收标准中指向逐任务细节处均回链本分册。

## 3. 变更清单汇总表（阶段 8 交付核对用）

> 分册回链：逐任务重点文件 / 测试 / 文档同步明细见 [01-逐任务实施.md](./agent-multi-intent-p1.plan/01-逐任务实施.md)；本表仅作阶段 8 交付核对汇总。

| 任务 | 新建文件 | 修改文件 | 新增测试文件 | 文档同步 |
| --- | --- | --- | --- | --- |
| 6 | `src/shared/ai/intentRecord.ts`、`src/main/ai/agent/chainTracking.ts` | `agentSessionDao.ts`、`shared/ai.ts`、`subtaskOrchestrator.ts`、`agentLoop.ts`、`agentTaskWorker.ts` | `tests/main/db/agentSessionIntentJson.test.ts`、`tests/main/ai/chainTracking.test.ts` | `database.md`、`ai-agent.md` |
| 7 | `src/main/ai/agent/chainReport.ts` | `subtaskOrchestrator.ts`、`agentLoop.ts`、`agentToolExecutor.ts`、`getTaskActivity.ts` | `tests/main/ai/chainReport.test.ts` | `agent-message-storage.md` |
| 4 | `src/main/ai/intentTiering.ts` | `agentLoop.ts`、`agentContext.ts`、`kbSearch.ts` | `tests/main/ai/intentRouterTiered.test.ts` | `ai-agent.md` |
| 9 | — | `toolTypes.ts`、`agentContext.ts`、`subtaskOrchestrator.ts`、`searchKBHandler.ts`、`kbSearch.ts`（+shared kb 类型 1 行） | `tests/main/ai/kbIntentBridge.test.ts` | `knowledge.md`、`ai-agent.md` |
| 12 | — | `subtaskOrchestrator.ts`、`agentContext.ts`、`agentToolExecutor.ts`、`agentLoop.ts`、`BatchConfirmCard.tsx`、`intentRecord.ts` | `tests/main/ai/subtaskConfirmResume.test.ts` | `02-diff-cards.md` |
| 13 | — | `shared/ai/config.ts`、`ipc/shared.ts`、`agentContext.ts`、`agentToolExecutor.ts`、`agentLoop.ts`、`confirmMatrix.ts`、`agentToolSelector.ts` | `tests/main/ai/writeModeConsumption.test.ts` | `ai-agent.md`、`agent-tool-runtime.md` |
| 8 | `src/main/ai/agent/subtaskScheduler.ts` | `subtaskOrchestrator.ts`、`agentLoop.ts` | `tests/main/ai/subtaskParallel.test.ts` | `agent-tool-runtime.md`、`ipc.md` |
| 10 | — | `intentRouter.ts`、`queryPlanner.ts`（仅注释） | — | `ai-agent.md`、`knowledge.md` |
| 全程 | — | `docs/plan/agent-multi-intent.status.md`（每任务勾选+记录）、`docs/testing/agent-multi-intent/agent-multi-intent.tdd.md`（每任务追加证据） | — | — |

**合计**：新建 **13**（src 5 + 测试 8）；修改约 **27**（src/渲染约 17、文档约 10）；去重后约 **40 个文件**（`subtaskOrchestrator/agentLoop/agentContext/agentToolExecutor/ai-agent.md` 被多任务先后触达，按提交累计约 50 文件次）。

## 4. 验收标准汇总（阶段 8 交付核对用）

> 分册回链：逐任务实施口径与风险回滚见 [01-逐任务实施.md](./agent-multi-intent-p1.plan/01-逐任务实施.md)；本节为验收标准汇总。

**总门禁（每任务提交前）**：`npm run typecheck` 0 错 + `npm run test` 全绿（基线 4696 例，既有测试零改动）+ `npm run lint` 0 error（108 warning 基线）+ `npx playwright test` 与 31 例既有失败同数同名零新增；agent 模块不在覆盖率白名单，不看覆盖率。

**逐任务验收（源文档验收小节 + Q17-24 裁定合并）**
- **任务 6**：DAO/追踪测试全绿（写读往返、状态跃迁、deps 归一、坏 JSON 降级、重试不落盘、入队/出队现语义、快照回滚）；`database.md` + `ai-agent.md` 同步；**零加列零迁移改动**（`src/main/db/index.ts` diff 必须为空）。
- **任务 7**：合并规则测试三类（全成功/部分失败/补偿触发）+ 同文件链序 + getTaskActivity 透出；`agent-message-storage.md` 同步；force 失败停 `waiting_interaction` 有测试。
- **任务 4**：`intentRouterTiered.test.ts` 降级链用例（小模型失败/超时回规则）+ **三调用点回归**（agentContext 主调用/技能推断、kbSearch 同步规则）+ 缓存共享断言；`ai-agent.md` 同步。
- **任务 9**：桥接测试三类（透传/优先级/冲突）+ 检索一次 + `kbSearch.test` isFallthrough 既有断言零改动；`knowledge.md` + `ai-agent.md` 同步。
- **任务 12**：暂停/恢复/部分拒绝测试 + staleness 按项 + 级联入报告；`02-diff-cards.md` 同步；复用 waiting_interaction 不新增状态。
- **任务 13**：`concurrencyDefs.test.ts`、`docTools.test.ts` 既有断言零改动全绿 + 新增 auto/manual 用例 + 遗留问题 3 修复测试 + 收敛交叉断言；`ai-agent.md` 写控制 + `agent-tool-runtime.md` §14.5 同步。
- **任务 8**：并行三类测试（依赖满足才出队/互斥防覆盖/分支失败策略）+ 上限 2 + 幂等键/乐观锁 + 串行等价回归；`agent-tool-runtime.md` §15 + `ipc.md` 同步；零 DB 改动。
- **任务 10**：2 篇文档交叉引用落地 + 2 处头注释 + typecheck/全量 test 零破坏；独立 docs 提交。
- **全程**：TDD strict 证据（RED→GREEN）续写 `docs/testing/agent-multi-intent/agent-multi-intent.tdd.md`；status.md 阶段 3~8 勾选；提交信息严格 `type(scope): message` 英文、每任务一个。

**P0 遗留问题衔接**
- 遗留 3（非链态无交互拒写不可达）：**在任务 13 解决**（caller 侧无交互补 skip + 新测试；不改 confirmSkipSet 契约）——status.md 对应条目标注「已解决 @任务13」。
- 遗留 1/2/4/5/6：不在本八任务范围，**不解决**（维持 status.md 现记录；遗留 5「write_batch 非内容型写回滚粒度」在任务 12 文档同步时交叉引用 `agent-tool-runtime.md` §14.3 如实记录，不扩大承诺）。
