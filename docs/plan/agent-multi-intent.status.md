# agent-multi-intent — 任务状态

> 来源：`C:\Users\lenovo\Desktop\优化方向\智能创作Agent-多意图识别-优化方向.md`
> 创建：2026-10-01

## 分级结果

- **分类**：功能开发（能力缺失补齐，非调优）
- **档位**：**L（重型）**
  - 跨模块：意图路由 / agent 主循环 / 任务队列 / DB Schema / 写控制 / 渲染层卡片
  - 涉数据迁移（`agent_task_queue` 加列）、新增依赖（zod）、多阶段多天
- **裁剪路径**：全部阶段 + TDD strict + 强制技术调研与规划
- **施工范围（本次裁剪）**：按文档铁律 P0 → P1 → P2 顺序；本次先交付 **P0 主线（任务 1、2、3、5、11）**，形成首个可交付后再续 P1/P2。范围确认见需求对齐记录。

## 技术栈陷阱（全文适用）

1. 未安装 `@anthropic-ai/sdk`，Anthropic 接入是裸 fetch（`anthropicClient.ts:241-258`），查 SDK 文档只作类型参考。
2. 未安装 `zod`，结构化输出需新增依赖（v4 `toJSONSchema`, draft-07）——**新增依赖须用户批准**。
3. agent 模块不在覆盖率白名单，验收以新增测试文件 + `npm run typecheck` + `npm run test` 为准。

## 阶段进度

- [x] 阶段 0：分级（L，见上）
- [x] 阶段 1：需求对齐（grill-me 一轮 Q1~Q14，2026-10-01 用户裁定「全部按推荐」）
- [x] 阶段 2：技术调研 + 规划完成（计划 §6 已并入调研结论）
- [x] Q15/Q16 开工批准（2026-10-01）：Q15=A 复用现有卡片模式；Q16=按计划开工
- [ ] 阶段 3~5：实现（按级 TDD strict）— 任务1 ✅ `38edc57` / 任务2 ✅ `a6b2348` / 任务3 ✅ `850d615` / 任务5 ✅ `d9c4682` / 任务11 ✅ `4422ac9`
- [x] 阶段 6：全量测试 + 连通性验证（2026-10-02：五项门禁全 PASS 零回归——tsc 0 错 / 196 文件 4686 例全绿 /
      lint 0 error（108 warning 基线）/ build size gate PASSED / playwright 31 failed 与基线同数同名零新增；
      连通性 7 链无 ❌，报告 `docs/plan/agent-multi-intent.connectivity.md`）
- [x] 阶段 7：合规核对（2026-10-02：PASS，无必须修正项；对照 CLAUDE.md/CONVENTIONS/SECURITY/Q1~Q16/全局红线逐条核对，
      12 项清单全 PASS；建议项 3 条见「遗留问题」）
- [x] 阶段 8：交付核对（2026-10-02：e739016..HEAD 共 **6 提交**（5 任务 + 1 修复 `03d60b3`），43 files +6763/-149；
      `src/main/db/` 零改动（无迁移风险）；43 个改动文件逐一对应计划 §2 清单 + 计划外零改动；
      修复提交门禁 typecheck 0 错 / 4696 例全绿 / lint 0 error；过程文档（plan/status/connectivity/req）随末次 docs 提交入库）

## 阶段 8 核对结论

- **变更清单核对**：计划 §2 全部交付，计划外改动为零（唯一追加 fix `03d60b3` 属阶段 6.5 连通性必修项，已授权口径内）。
- **P0 范围**：任务 1/2/3/5/11 全部完成；P1（4/6/7/9/12/13）、P2（8/10）按 Q1 裁定挂起，见「遗留问题」。
- **验证覆盖**：typecheck / 单测 4696 / lint / build / playwright 五项全绿零回归 + 连通性 7 链 + 合规 12 项 PASS + TDD 证据报告 667 行。
- **未验证项（如实声明）**：多意图链路无真实 LLM/真实 UI 的 E2E（仅 mock 单测与组件测试）；未在真实模型上实测拆分质量。

## 遗留问题（阶段 6.5/7 产出）

1. **连通性 ⚠️⑥（本轮修复中）**：`confirmSkipSet` 仅遍历 `WRITE_TOOLS`，未登记写类工具在流式路径绕过矩阵 fail-closed——防御性 fix 提交补全（现有 30 工具行为零变化）。
2. **连通性 ⚠️②③（遗留，非本批回归）**：追问卡 QuestionCard 无跳过按钮（空答丢弃分支 UI 不可达，取消走 supersede 语义可达）；任务取消时渲染侧不清 `pendingInteraction`（卡片残留但可提交自清，不死锁）——均为既有 R3 模式复用。
3. **合规建议 2（P1 任务 13 关联）**：~~非链态流路径「无交互拒全部写档」不可达（`confirmSkipSet(intent,false)` 不含 batch，写工具直接执行）~~ **已解决 @任务13**（2026-10-02）：`agentLoop.computeRoundSkipSet` caller 侧无交互补 skip（`confirmSkipSet` 本体与输出逐字节不变），流式 + 延迟重发两路径均路由 `checkForceConfirmTools` 拒写；测试 `writeModeConsumption.test.ts` ④ 钉死（红→绿）。
4. **合规建议 3**：任务 3 追问矩阵实际新建 `clarificationMatrix.test.ts` 而非挂 `agentContext.test.ts`（红线优先，已在任务 3 记录），计划文档已回填本偏差。
5. **write_batch 回滚粒度**：非内容型写（createFile/renameFile 等）拒绝后无法经 `rollbackToSnapshot` 撤销（会话级 .md 内容快照）——已在 `agent-tool-runtime.md` §14.3 如实记录，P1 若需真逐项撤销须先过裁定。
6. **`subtask_done`/`write_batch`/`intent_split` 无 E2E 覆盖**（主进程链路由单测覆盖，渲染卡经组件测试/类型检查）。

## 任务执行记录

- **任务1 ✅ 提交 `38edc57`**（8 files +918/-26）：TDD RED 22 例（import 解析失败）→ GREEN 51 例（新 22 + memory 既有 29 零改动）；
  门禁 typecheck 0 错 / test 4529 绿 + 1 既知 flaky（ab-test，单跑 22 绿复核）/ lint 0 错与基线一致 / build size gate PASSED。
  **裁定**：围栏语义按计划 §6.2 实施约束执行——`parseStructuredJson` 骨架剥围栏+截取 {..} 容错，
  非法用例测「围栏包裹拒绝文本/残缺 JSON 抛错」；即围栏包裹的**合法**计划通过。§4.2「围栏为非法」原表述按此收窄解释（解析端兜底优于前端拒绝）。

- **任务2 ✅ 提交 `a6b2348`**（23 files +2088/-26，本地 main 未推送）：TDD RED/GREEN 五阶段（预检门 9 例 / taskPlanner 12 例 /
  agentContext 追加 5 例 + 独立 agentLoopSplit 7 例 / SplitConfirmCard 7 例，合计新增 41 例）；
  门禁 typecheck 0 错 / test 193 文件 4570 例全绿 / lint 0 错（108 warning 与基线一致）/
  playwright 31 例失败经 stash 基线对比确认全部为 HEAD 既有失败（集合一致，零新增）。
  **实施偏差（红线优先，已写入 `docs/specs/ai-agent/agent-prompt-context.md` §11.4）**：
  计划 §2 要求原地改写 `agentPromptBuilder.ts:428/:479` 自然语言拆分行——实测该两行被
  `agentPromptBuilder.test.ts` sha256 基线与 `agentContext.test.ts` 全文断言钉死（红线 1「gate 关路径
  逐字节等价」），故改为：基础提示词**逐字节不动**，结构化拆分指令段以**独立 system 消息**在链启动
  （拆分确认通过后）注入，降级直通路径与改动前消息序列完全一致。
  **另一实现要点**：vitest factory mock 缺导出时访问即抛错（`tests/_probe.test.ts` 实测），
  故 gate 经 `intentRouter` 命名空间 + try/catch **fail-closed** 调用，`agentLoop.test.ts` 旧 mock 零改动。

- **任务3 ✅ 提交 `850d615`**（6 files +852/-21，本地 main 未推送）：TDD RED 4 红 2 钉
（②③④⑥ 行为红 / ①⑤ 回归钉即绿）→ GREEN 6/6；回归 9 文件 284 例全绿（含
  `agentPromptBuilder` sha256 基线、`agentLoopSplit` 任务 2 链）；
  门禁 typecheck 0 错 / test 194 文件 4576 例全绿（ab-test flaky 本跑未触发）/
  lint 0 错（108 warning 基线一致）/ 无 UI 改动 playwright 按任务口径跳过。
  **实施偏差（红线优先，同任务 2 先例）**：计划要求就地扩 `clarificationPrefix`
  （:396-401）与「分轮澄清策略」（:430-450）——实测两处被 sha256 基线逐字钉死且 Q10
  要求单意图低置信路径行为不变，改为新增 `buildSubtaskClarificationSegment` 独立
  system 消息在链内追加；**测试选址偏差**：追问矩阵未挂 `agentContext.test.ts`
  （②③⑤ 链级用例需改其顶层 mock 基座，触既有测试零改动红线），新建独立
  `clarificationMatrix.test.ts`（intentRouter 用真实实现）。

- **任务5 ✅ 提交 `d9c4682`**（12 files +1811/-134，本地 main 未推送）：TDD strict：新建
  `tests/main/ai/subtaskSequence.test.ts` 11 例 RED
  （10 行为红 + supersede 回归钉即绿）→ GREEN 11/11；回归 11 文件 306 例零改动全绿
  （agentLoopSplit/clarificationMatrix/agentLoop/agentPromptBuilder sha256 等）；
  门禁 typecheck 0 错 / test 195 文件 4587 例全绿 / lint 0 错（108 warning 基线一致）/
  playwright 与 31 例既有失败基线比对（见 TDD 报告）。
  交付：per-subtask detector + `subtaskTotalRoundsCap = 2×getRoundsForIntent(primaryIntent)`
  双闸 / `baseMessages` 快照重建 + 500 字摘要注入 / `isChainInterrupted` 边界安全点 /
  LLM 失败重试 1 次 → `subtask_failed` 交互（reject 走 AI_STREAM_ERROR 收口不锁死）/
  `subtask_done` 流事件（constants+shared+preload+agentStore+AgentTab 通路）/
  `hasPendingForConversation` 只读查询；文档 `agent-tool-runtime.md` §13 + TDD 报告任务 5 章。
  **实施口径说明**：① DB 落库仍为链末单条 assistant（与任务 2 `agentLoopSplit` 断言一致），
  `subtask_done` 仅渲染侧落显（live 分泡、DB 全量，内容等价）；② 「system 提示重建」实现为
  快照重建（拆分段/指令/摘要逐子任务重注入 + intent/tools 重建），多意图链恒 Agent 提示
  （gate 开即 `useAgentPrompt=true`），未按子任务重跑 `buildAgentSystemPrompt`（体验无差异，
  sha256 基线不动）；③ 子任务预算耗尽 = 安全点停链收口（与单意图轮次上限语义对齐）；
  ④ 失败重试覆盖链路径 LLM 调用失败，工具确认/追问交互取消沿用既有语义不进重试。

- **任务11 ✅ 提交 `4422ac9`**（17 files +1037/-73，本地 main 未推送）：TDD strict：
  `confirmMatrix.test.ts` 91 例 + `agentToolExecutor.test.ts` 新 describe 8 例 RED
  （首轮动态 import 缺文件被 vite 静态解析致整文件收集失败 → 补签名占位 stub 二轮归因：
  53 红/53 绿，其中既有 7 例全绿、4 例为现行为回归钉即绿）→ GREEN 106/106；回归 13 文件
  416 例零改动全绿；门禁 typecheck 0 错 / test 196 文件 4686 例全绿 / lint 0 错（108 warning
  基线一致）/ playwright 104 passed+1 skipped 与 31 例既有失败基线同数（零新增）。
  交付：`confirmMatrix.ts` 三档矩阵（force=delete×2 恒强卡 / batch=WRITE_TOOLS 其余 5 /
  none=已登记非写 23 项含 memory_write 现口径；未知 intent、未登记工具 → batch fail-closed）+
  `checkForceConfirmTools` 按档分派（无交互 force/batch 一律拒写，只扩不缩；batch 单意图保持
  preview 现状；链态执行+收集）+ `confirmWriteBatch` 链末一次 `write_batch` 汇总确认
  （拒绝项 `rollbackToSnapshot` + 已接受 `editLocalFile` 回滚后重执行）+ `finalizeChainRun`
  统一 8 处链收口 + skip-set 矩阵派生 `confirmSkipSet`（非链 ≡ FORCE_CONFIRM_TOOLS）+
  `BatchConfirmCard` + `AIPanelSession` 分派 + i18n `ai.batchConfirm.*` 三语 +
  `agent-tool-runtime.md` §14 + `ai-agent.md` 写控制改写。
  **实施偏差（红线优先，同任务 2/3 先例）**：计划 §2 要求原地改写 `agentPromptBuilder:471-476`
  写入规则——该段被 sha256 基线钉死，改为正文逐字不动 + 一致性测试钉死对应关系（删除行点名
  == 矩阵 force 集合），链特有口径走新独立段 `buildWriteBatchNoticeSegment`（工具名单由
  `writeToolsByTier()` 注入，结构上不可分叉）。
  **粒度限制（如实记录）**：`rollbackToSnapshot` 为会话级 .md 内容回滚，非内容型写
  （createFile/createFolder/renameFile/moveFile）拒绝后无法经快照回滚撤销——已写入
  `agent-tool-runtime.md` §14.3 与 `ai-agent.md` 写控制。

- **任务6 ✅ 提交 `1bb52b5`**（12 files +1242/-5，P1 首任务，本地 main 未推送）：TDD strict：
  RED 首轮两文件 `2 failed / 4 failed | 1 passed (5)`（chainTracking 整文件 import 解析失败 0 test +
  DAO 3 红缺 `saveIntentJson/getIntentJson`；fake DB `NOT IN ( SELECT` 白空格缺陷二轮修复后归因
  `3 failed | 2 passed`——2 绿 = 入队/出队幂等 + 快照回滚回归钉即预期绿）→ GREEN **13/13**（新 5+8）；
  回归 6 文件 171 例零改动全绿（subtaskSequence/agentLoopSplit/agentLoop/clarificationMatrix/
  agentToolExecutor/confirmMatrix）；门禁 typecheck 0 错 / test **198 文件 4709 例全绿**
  （基线 4696+13）/ lint 0 错（108 warning 基线一致，新文件零 warning）/
  **`git diff src/main/db/index.ts` 空（零加列零迁移）**；playwright 按任务 3 先例跳过（未触 src/render/）。
  交付：`shared/ai/intentRecord.ts`（`AgentIntentJson` v1 + `SubtaskRunStatus` 七态 + `buildDepsMap`
  serial_after 归一）+ `chainTracking.ts`（createChainTracker / emitChainRecord 吞错仅日志 /
  finalizeChainRecord 补 outcome）+ `agentSessionDao.saveIntentJson/getIntentJson`（UPDATE 仅一列、
  容错读降级 null）+ orchestrator 四点全量推送 + `AgentLoopDeps.onChainRecordUpdate?`（可选，
  未注入零行为变化）+ worker 回调 try/catch + 文档 `database.md`「其他表索引」行 /
  `ai-agent.md`「子任务链追踪」小节 / TDD 报告任务 6 章。
  **实施口径**：outcome=stopped 产点在 `stopChain`、`finalize` 仅补 finished 缺省（GREEN 首跑红即此
  缺口）；`failed` 生产点预留任务 7；`getIntentJson` 返回 `unknown`（计划 `unknown | null` 在 TS 归一）。

- **任务7 ✅ 提交 `4fcd6a2`**（9 files +1300/-26，本地 main 未推送）：TDD strict：
  RED 首轮整文件收集失败 `1 failed | no tests`（缺 `chainReport` 模块，vite 静态解析，
  任务 6/11 同款首轮形态）→ GREEN 中间轮 `7 passed | 1 failed`（归因 = `normalizeTaskPlan`
  Q7 同对象写合并把测试计划两写并成一条，计划对象改不同后即通）→ 末轮 **8/8**；
  回归 9 文件 266 例零改动全绿（subtaskSequence 链正文 toBe ×4 / agentLoopSplit ×2 /
  clarificationMatrix ×1 / 确认矩阵 / confirmWriteBatch 返回值钉 / chainTracking /
  agentLoop / agentPromptBuilder sha256 / agentSessionIntentJson）；
  门禁 typecheck 0 错 / test **199 文件 4717 例全绿**（基线 4709+8）/
  lint 0 错（108 warning 基线一致，新文件零 warning）/ **`git diff src/main/db/index.ts` 空**；
  playwright 按任务 3 先例跳过（未触 src/render/）。
  交付：`chainReport.ts`（buildChainReport 链序三态 + renderReportSegment 逐项汇报 +
  shouldRenderReport 条件渲染护栏）+ tracker `setReport`（report 随最终快照落 intent_json）+
  orchestrator 写批次 subtaskId 边界/收口归属标注 + `handleSubtaskFailure({skipRetry})`
  force 停等（复用 `subtask_failed` → waiting_interaction，不重试不推进）+ 用户选停止
  → `outcome='failed'`（任务 6 遗留产点闭环）+ `confirmWriteBatch` 第三参 sink
  `{rejectedIds,acceptedIds,items}` + agentLoop 工具轮后信号消费与收口报告管线
  （仍单次 DONE、intent=primaryIntent）+ `get_task_activity` SELECT `+s.intent_json`
  透出 `subtasks?/report?`（加法式 + 坏 JSON 降级）+ 文档 `agent-message-storage.md` §8 +
  TDD 报告任务 7 章。
  **实施口径（红线优先两处，详见 TDD §5）**：① `confirmWriteBatch` 返回值保持 `string`
  （既有 `toBe('')`/`toContain('回滚')` 钉死），结构化数据走可选第三参 sink——计划
  「返回值扩展」按红线 5 改写；② 报告段**条件渲染**（非 ok 或有产物才追加）——计划
  「仅链态且有子任务」会破坏 6 处既有链正文 toBe 全文断言，全成功用例以带写产物链构造。
  另：force 失败信号走返回值管线（ToolRoundResult），计划清单外零文件改动（未加 AgentContext 字段）。

- **任务4 ✅ 三层意图路由分层**（2026-10-02 重派执行，本地 main 未推送，提交 `d2b3168`
  `feat(agent): add tiered intent routing with rule baseline and shared TTL cache`）：TDD strict：
  RED 首轮整文件收集失败 `1 failed | no tests`（缺 `intentTiering` 模块，vite 静态解析，
  任务 6/7 同款首轮形态）→ GREEN **19/19**；
  门禁 typecheck 0 错 / test **200 文件 4736 例全绿**（基线 4717+19，连续两轮；
  期间一次 1 failed 未复现、无 FAIL 记录，判既有 flaky）/ lint 0 错（108 warning
  与基线持平，新文件零 warning）/ playwright 跳过（未触 src/render/）。
  重点回归分批全绿：kbSearch 44 + agentContext 80 + intentRouter + 新 19 = 169；
  agentLoop 31 + agentLoopSplit 7 + subtaskSequence 11 + chainReport 8 + clarificationMatrix 6 = 63。
  交付：`intentTiering.ts`（`classifyIntentShared` 只读 shared / `prefetchIntentTiered`
  1.5s deadline tier2 + lazy opts 工厂 / `__resetIntentTierCacheForTest`；TTL 10s、容量 200 LRU、
  key=sha256(hasHistory|input)）+ agentLoop prepare 前预取（整体 fail-closed）+
  agentContext 主分类/技能推断 + kbSearch isFallthrough 三调用点接线（namespace + 缺导出回落）+
  `intentRouterTiered.test.ts` 19 例 + `ai-agent.md`「三层意图路由分层」小节 + TDD 报告任务 4 章。
  **实施口径（偏差三处，详见 TDD §4）**：① 缓存只写 tier2 成功结果、shared 只读 miss 即规则
  （否则破坏 `agentContext.test:568` classifyIntent 计数断言）；② 预取缺省写双键
  （agentLoop 预取时 hasHistory 未算出，判定用 false 超集口径）；③ tier2 严格
  `protocol==='openai'` 才触发（anthropic 打 OpenAI 端点必败，且是既有测试零污染护栏）。

- **任务9 ✅ Agent 意图透传 KB 检索**（2026-10-02，本地 main 未推送，提交 `7d1f8f4`
  `feat(agent): bridge agent intent into KB search with per-subtask single retrieval`）：TDD strict：
  RED `npx vitest run tests/main/ai/kbIntentBridge.test.ts` → **5 failed | 2 passed**（失败面 = ①透传三例
  + ③冲突 + ④检索一次；通过面 = ②优先级/⑤回归，即既有行为锚点）→ GREEN **7/7**；
  门禁 typecheck 0 错 / test **201 文件 4743 例全绿**（基线 4736+7）/ lint 0 错（108 warning
  与基线持平）/ playwright 跳过（未触 src/render/）。
  重点回归分批全绿：kbSearch+queryPlannerEnhanced+searchKBHandler+agentKbPreloader = 161；
  agentLoop+agentLoopSplit+subtaskSequence+chainTracking = 57。
  交付：`kbIntentBridge.test.ts` 7 例（透传/优先级/冲突/检索一次/回归五组）+
  `ToolCtx.agentIntent` + agentContext 主 intent 注入 + `applySubtaskContext` 子任务切换同步与
  kbQa 单槽预载 + `searchKBHandler`/`kbSearch`/`shared kb.ts` 诊断透传 + 三文档
  （knowledge.md「桥接不合并」小节 / ai-agent.md 透传口径 / TDD 报告任务 9 章）。
  **实施口径（计划清单外三处，详见 TDD §4）**：① `agentTaskWorker` searchKb 闭包重建 opts
  补 `agentIntent` 透传（D1 hadPronounRef 同款丢参坑，不补则生产链路静默丢弃）；
  ② `agentKbPreloader` wrapper 模糊未命中先 `await preloadPromise` 再重扫（首访与在飞预载
  竞态兜底，否则「检索恰一次」spy 计 2）；③ `applySubtaskContext` 对 `ctx.toolCtx` 判空
  （chainTracking 测试面部分构造 ctx，硬写抛 TypeError）。预载 query 断言用
  `extractCoreTokens(object)`（S11 停用词剥离）。

- **任务12 ✅ 子任务级确认与暂停/恢复**（2026-10-02，本地 main 未推送，提交 `7fa9eb5`
  `feat(agent): subtask-scoped confirmation staleness and cascade skip on reject`）：TDD strict：
  RED `npx vitest run tests/main/ai/subtaskConfirmResume.test.ts` → 首轮 **6 failed**（含断言口径
  修正前的 ①② worker E2E DONE 口径）→ 末轮真实 RED **4 failed | 2 passed**（失败面 = ③级联状态 /
  ④传递闭包 / ⑤stale 前缀 / ⑥ERROR 收口；通过面 = ①② P0 暂停恢复原语的 worker 级新增覆盖）→
  GREEN **6/6** + 组件测试 `BatchConfirmCard.test.tsx` 3/3（补建，原无）；
  门禁 typecheck 0 错 / test **203 文件 4752 例全绿**（基线 4743+9）/ lint 0 错（108 warning
  与基线持平）/ playwright 跳过（未触 src/render/ 源码，BatchConfirmCard 零改动）。
  重点回归分批全绿：agentToolExecutor+confirmMatrix+subtaskSequence+agentLoopSplit+chainReport+
  chainTracking+clarificationMatrix+新文件 = 162。
  交付：`subtaskConfirmResume.test.ts` 6 例（worker E2E 暂停/恢复 + flow 级部分拒绝/级联/staleness/取消）
  + `BatchConfirmCard.test.tsx` 3 例 + `applySubtaskContext` 写 `ctx.currentSubtaskId/Index` +
  `cascadeSkipDependents`（deps 传递闭包）+ tracker `markSkippedDependency`/`markDependencyRejected` +
  `WriteBatchItem.subtaskIndex/originalContentHash` + `confirmWriteBatch` 逐项复检与 stale 前缀 +
  sink `+cascadeSkippedIds/+staleIds` + `finalizeChainRun` 级联标注 + `ChainReportTask.cascade?`
  条件行 + 三文档（02-diff-cards §7.6.1~7.6.3 / agent-tool-runtime §14.3 交叉引用 / TDD 任务 12 章）。
  **实施口径（偏差如实，详见 TDD 任务 12 章 §4）**：① **既有测试改动 1 处**——`chainReport.test.ts`
  任务 7 ③「跳过后 s2 继续」→「级联收口」（Q22 语义取代：`annotateSerialWrites` 自动 serial_after
  使相邻写互为依赖，链中跳过 → 后继 `skipped_dependency` 不再执行；计划风险条已预告该归一来源）；
  6 处既有 toBe 全文锚点零改动全绿；② 链收口 try 内 8 个调用点改 `return await finalizeChainRun`——
  裸 return 的 reject 不落 try/catch，取消批次确认时不会发 `AI_STREAM_ERROR`（RED ⑥ 归因）；
  ③ worker E2E DONE 计数按 `persistAndSend(eventType='done')`（persistDeps 齐备时 createSend 改道）；
  ④ 链末级联**只标注不回滚后继产物**（Q22 落地解释，回滚粒度限制沿 §14.3 如实记录不扩大承诺）。

- **任务8 ✅ 依赖图并行调度与冲突防护**（2026-10-02，本地 main 未推送，提交 `cd61099`，
  8 files +2544/-5）：TDD strict —— RED `subtaskParallel.test.ts` import 解析失败 + typecheck
  TS2353（实现前实录）→ GREEN 13 例（四组：①依赖出队/双读在飞≤2 + 集成会合点 ②互斥四则
  （两写同对象/一写一读同对象串行、无交集并行、幂等键、旧 epoch stale）③失败策略
  （A 败 B 成进报告、单次 DONE、不可重试零退避 LLM 恰 1 次、总闸 attempts[0,1]）④上限常量
  + limit=1 串行等价）。新建 `subtaskScheduler.ts`（纯调度器 + runScheduledLoop 波次驱动）；
  `subtaskOrchestrator.ts` 接调度器（BranchContext / runParallelChain / runParallelClarification /
  BranchInteractionGate 交互串行化）；`agentLoop.ts` 抽 `runSubtaskSegment` 分支轮次段
  （仅链态分支调用，gate 关路径与串行主循环零移动零改写）；`agentTaskWorker` 注入启用信号。
  **门禁**：typecheck 0 错 / test 205 文件 **4781 全绿**（基线 4768 + 新 13；既有 6 组链测试
  零改动，worker E2E ①② 硬编码 `call_0_0` 答案键全绿）/ lint 108（0 error 基线持平）/
  playwright 跳过（不触 `src/render/`，沿任务 4/9/12/13 先例）；ab-test 计时断言首跑抖动
  单跑 22 绿、复跑全量 4781 全绿（任务 13 已记录的同一 flaky）。
  **偏离记录（红线对齐）**：① **零 DB 改动**——不加 `parent_id`、`agentTaskDao` 出队不动、
  `maxConcurrent` 维持 1（计划「明确不做」项照办，并行仅限链内子任务，依赖走 intent_json.deps）；
  ② **计划外新增启用信号 `deps.subtaskParallel`**（生产 worker 注入 true）——Q24/计划只给
  `SUBTASK_PARALLEL_LIMIT` 回滚旋钮，但自动启用会破坏「既有链测试零改动」红线（双读计划即
  并行就绪），故加显式信号，缺省串行零行为变化；③ 工具轮 id 走轮次基址方案
  （单支在飞基址=已消耗轮次 → 与串行逐字一致，并发支 ±1000 错开），未改共享 id 生成器；
  ④ 分支不推 `ai:stream:chunk`，波次 flush 按队列序补发（渲染 appendAssistant 口径不变）；
  ⑤ 并行分支失败不弹 subtask_failed 卡（Q19 报告合并路径；串行链 Q12 交互原样）；
  ⑥ 重试单点 = runScheduledLoop（总闸常量同值复用）。详见 TDD 任务 8 章 §4 与
  `agent-tool-runtime.md` §15。

## 已批准偏离

- devflow 前端组件 Aceternity UI 强制条款 → 偏离，改用项目自研卡片模式（IntentCard/QuestionCard 同构 + Tailwind 自定义色板）。
  理由：项目设计系统更严格（CLAUDE.md 自定义色板、AIAgent 卡片体系），源任务文档也指定复用现有卡片。Q15=A 批准。

## 索引

- 需求文档：`docs/requirements/agent-multi-intent/agent-multi-intent.req.md`（已建，含 Q1~Q14 裁定）
- 实施计划：`docs/plan/agent-multi-intent.plan.md`（已建，行号核对 + 变更清单 + 调研结论）

## 外部索引记录

- 2026-10-01 未走 docs-mcp 索引（network 地区受限），改由调研智能体用 llms-full.txt / Azure / blog 交叉取证；
  来源与结论见计划 §6：Anthropic structured-outputs、Azure/OpenAI structured outputs、
  Anthropic《Building effective agents》、tool-use handle-tool-calls / parallel-tool-use。

## P1/P2 扩展阶段（2026-10-02 启动）

- 裁定：Q17~Q24 已锁定（见需求文档 §6），范围 = 剩余 8 任务，顺序 6→7→4→9→12→13→8→10
- [x] 阶段 1：P1 需求对齐（Q17~Q24 一轮对齐，用户裁定「全部按推荐」）
- [x] 阶段 2：规划 `docs/plan/agent-multi-intent-p1.plan.md` 已落盘（§0 行号核对 47 处偏差）+ 任务 4/7/8 外部调研已并入计划
- [x] 阶段 3~5：实现 — **P1 八任务全部完成**（任务 6 ✅ `1bb52b5` / 任务 7 ✅ `4fcd6a2` / 任务 4 ✅ `d2b3168`（首派卡死已闭环）/ 任务 9 ✅ `7d1f8f4` / 任务 12 ✅ `7fa9eb5` / 任务 13 ✅ `1587976`（write_mode 消费点 + confirmMatrix 权威收敛；遗留问题 3 已解决 @任务13）/ 任务 8 ✅ `cd61099`（依赖图并行调度，见下方执行记录）/ 任务 10 ✅ `87e9c63`（两套意图系统交叉引用 + 边界注释，见下方执行记录））
- [ ] 阶段 6~8：门禁 / 连通性 / 合规 / 交付（各任务门禁已逐任务过；全程交付核对待办）

### 任务10 ✅ 两套意图系统文档交叉引用与边界固化（2026-10-02，L1 纯文档+注释，提交 `87e9c63`，本地 main 未推送）

- 5 files +39/-0：`ai-agent.md` 意图路由节加「另一套意图系统」交叉引用（链 knowledge.md 桥接小节 + 优先级：任务意图定工具集、检索策略意图定 KB 检索、冲突以 Agent 为准、禁止互相 import/物理合并）；`knowledge.md` 对称交叉引用 + 历史记录指引 `docs/requirements/agent-memory/agent-memory-optimize-2.req.md:41`（该文件未改）；`intentRouter.ts` / `queryPlanner.ts` 文件头各 +1 行域边界注释。
- 计划裁定照办：**不建共享常量文件**（两套类型已分处 `@shared/ai/agent.ts` 与 `@shared/ai/kb.ts`，物理隔离成立）。
- 门禁：typecheck 0 错 / test 205 文件 4781 例全绿（与任务 8 终态持平）/ lint 0 error 108 warning 持平；证据见 TDD 任务 10 章。

### P1 续做入口（2026-10-02 暂停）—— **P1 全部完成，无后续任务**

1. 读 `docs/plan/agent-multi-intent-p1.plan.md` §0 行号实况表 + 各任务节（§2）；
2. ~~任务 4/6/7/8/9/10/12/13~~ **P1 八任务已全部完成**（见上方各执行记录）；
3. 任务 8 红线记录（gate 关路径不移动不改写、`agentLoop.test`/`agentPromptBuilder` sha256 零改动全绿、`SUBTASK_PARALLEL_LIMIT=2→1` 即退全串行）已随 `cd61099` 落地验证；
4. 任务 9 口径（`agentIntent` 只进 diagnostics 可选键、未接 shared 缓存）与任务 12/13 裁定（`confirmWriteBatch` sink、报告段条件渲染锚点）均已落地。

## P1 阶段 6~8 收尾记录（2026-10-03）

- [x] 阶段 6：全量门禁（HEAD 87e9c63）——typecheck 0 错 / 205 文件 4781 例全绿 / lint 0 error（108 基线）/ build size gate PASSED / playwright 31 failed 与基线同数同名零新增
- [x] 阶段 6.5：连通性 8 链报告 `docs/plan/agent-multi-intent-p1.connectivity.md`（7 ✅ + 1 ⚠️ 必修）；必修项（BranchInteractionGate vs cancelTask 条件性死锁）已修复 @ `43ab99c`（RED 实测 2 例 timeout 挂死 → GREEN 9/9）
- [x] 阶段 7：合规 PASS + 2 必修——① 裸 `.then`（subtaskScheduler:494）已修复 @ `43ab99c`；② 过程文档入库 = 本 docs 提交。要点核实：db/index.ts 与 agentTaskDao 零改动（write_mode 补列属审查范围前既有）、既有测试改动仅 chainReport 一例（Q22 语义取代）、零新依赖、12 项清单其余全 PASS
- [x] 阶段 8：交付核对——e6d06df..HEAD 共 10 提交（含用户 a5bff32 + P1 八任务 + 1 fix），源码+测试 33 文件全部对应计划 §3 变更清单，计划外改动为零（.claude/agent-memory/* 经用户 a5bff32 入库，非任务提交混入）；`src/main/db/index.ts`/`agentTaskDao.ts` diff 为空；`package.json` diff 为空；修复提交门禁 typecheck 0 / 4784 例 / lint 0 error
- **P1 八任务 + 连通性修复全部完成**；未验证项（如实声明）：多意图/并行链无真实 LLM E2E（mock 单测覆盖）；BranchInteractionGate 分支内交互场景无专项用例（机制在场 + 写闸兜底，任务 8 风险条已记）
