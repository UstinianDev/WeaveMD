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
3. **合规建议 2（P1 任务 13 关联）**：非链态流路径「无交互拒全部写档」不可达（`confirmSkipSet(intent,false)` 不含 batch，写工具直接执行）——相对基线无回退（单意图写本就不拦），P1 若要全量兑现需补拦截。
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

## 已批准偏离

- devflow 前端组件 Aceternity UI 强制条款 → 偏离，改用项目自研卡片模式（IntentCard/QuestionCard 同构 + Tailwind 自定义色板）。
  理由：项目设计系统更严格（CLAUDE.md 自定义色板、AIAgent 卡片体系），源任务文档也指定复用现有卡片。Q15=A 批准。

## 索引

- 需求文档：`docs/requirements/agent-multi-intent.req.md`（已建，含 Q1~Q14 裁定）
- 实施计划：`docs/plan/agent-multi-intent.plan.md`（已建，行号核对 + 变更清单 + 调研结论）

## 外部索引记录

- 2026-10-01 未走 docs-mcp 索引（network 地区受限），改由调研智能体用 llms-full.txt / Azure / blog 交叉取证；
  来源与结论见计划 §6：Anthropic structured-outputs、Azure/OpenAI structured outputs、
  Anthropic《Building effective agents》、tool-use handle-tool-calls / parallel-tool-use。
