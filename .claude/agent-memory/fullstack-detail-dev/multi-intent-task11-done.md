---
name: multi-intent-task11-done
description: agent-multi-intent P0 任务 11（intent×tool 确认矩阵）已交付于 4422ac9，P0 五任务收官；含 RED 占位 stub 归因法、回滚粒度限制、链收口单点化改造与 4686 基线
metadata:
  type: project
---

agent-multi-intent P0 **最后一个任务 11 已完成并提交（本地 main `4422ac9`，未推送）**，
P0 五任务（1/2/3/5/11）全部交付：`confirmMatrix.ts`（`confirmTierFor` 三档 + `confirmSkipSet`
skip-set 派生 + `writeToolsByTier` 提示词数据源）/ `checkForceConfirmTools` 按档分派 /
`confirmWriteBatch` 链末一次 `write_batch` 汇总确认（拒绝项 `rollbackToSnapshot`）/
`finalizeChainRun` 统一 8 处链收口 / `BatchConfirmCard` + i18n `ai.batchConfirm.*` /
测试 91+8 例。测试基线 **4686 例**；接续 [[multi-intent-task5-done]]。

**Why:** 后续 P1（任务 4/6/7/9/12/13）会动同一批文件（agentLoop/agentToolExecutor/
写控制），下面是本任务「按直觉会改错」的钉死口径与坑。

**How to apply:**
1. **RED 占位 stub 归因法（比任务 5 的字面量法多一步）**：vitest/vite 会把**动态
   `import()` 也静态解析**——测试里 `import('@main/ai/新模块')` 在文件不存在时会让
   **整个测试文件收集失败**（既有用例陪葬）。正确姿势：先写测试 → 首轮 RED 是整文件
   失败 → **立刻建「签名齐全但行为撒谎」的 stub**（本任务 `confirmTierFor` 恒 `'none'`，
   违反 fail-closed）→ 二轮 RED 才有逐条归因且既有用例保持绿。
2. **RED 即绿的用例要标注为回归钉**：force 卡 yes/no、batch 单意图 preview、无交互拒
   force 这 4 例在改动前就成立（旧 `FORCE_CONFIRM_TOOLS` 语义），是「任务 11 不得削弱」
   的钉子，不是实现提前完成。
3. **回滚粒度限制（已文档化，勿「顺手修好」）**：`rollbackToSnapshot` 只 `UPDATE files
   SET content`（会话级 .md 内容回滚），不撤销 create/rename/move——所以混合勾选下
   已接受项必须**回滚后重执行**，且仅 `editLocalFile` 受内容回滚影响（重执行白名单 =
   它一个）；非内容型写拒绝无法撤销是**已记录的 P0 限制**（agent-tool-runtime §14.3）。
   要真逐项撤销需给 agentSnapshot 加按文件/按操作的补偿能力——属 P1，别在 P1 动手前
   改 `rollbackToSnapshot` 语义。
4. **链态唯一开关 = `Array.isArray(ctx.writeBatch)`**（`startSubtaskChain` 置 `[]`、
   `confirmWriteBatch` 入口清空）：skip-set 派生、batch 收集、汇总确认三处共用它，
   不要引入第二个 `subtaskChain` 判定（`processStreamingToolRound` 拿不到 chain 变量）。
5. **`checkForceConfirmTools` 判定顺序不能换**：先 `FORCE_CONFIRM_TOOLS`→force、
   再 `WRITE_TOOLS`→batch、再「已登记非写 23 项 ∩ 合法 intent」→none、兜底 batch。
   漏掉第 3 步会把 `ask_question_card`/`memory_write`/`runSkill` 误拦成 batch（既有
   链测试/记忆口径全炸）；`ctx.intent` 在既有 7 例 makeCtx 里不存在，但只读安全工具
   永远进不到该函数（writableTcs 分区挡住了）——给 ctx 加 intent 时别动 makeCtx 基座。
6. **链收口单点化**：`finalizeChainRun` = restoreChainIntent → confirmWriteBatch →
   appendChainNote → finalizeRun，**8 处链收口全部收敛到它**（gate 前定义防 TDZ，同
   任务 5 教训）；写批次为空时零交互，既有链测试逐字节等价。新增链收口点必须走它。
7. 提示词红线第三次验证：`## 写入规则`（471-476）在 sha256 基线内**不可动**——一致性
   测试改为「正文 ↔ 矩阵双向断言」+ 新独立段 `buildWriteBatchNoticeSegment`（参数注入
   矩阵拆分结果）。P1 任务 13（auto 档消费点）动提示词同理。
8. playwright 基线不变：31 failed / 1 skipped / 104 passed（7.1m）；比较法升级：套件
   零增删时**总量恒等**，拿到 passed/skipped 即可推 failed，不必再 stash 对比
   （本次 AIPanelSession/i18n 改动经此验证零新增）。
