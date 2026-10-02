---
name: project-multi-intent-p1-task8-parallel
description: 任务 8 依赖图并行调度已交付（cd61099）——启用信号/轮次基址两处计划外设计及其原因（任务 10 已收尾，P1 全完成）
metadata:
  type: project
---

任务 8（依赖图并行调度与冲突防护）已完成，提交 `cd61099`（本地 main 未推送，2026-10-02）。
P1 后续：任务 10 已完成（`87e9c63`），P1 八任务全收口。门禁实录：typecheck 0 / 全量 205 文件
4781 绿 / lint 108（0 error）/ 新 `tests/main/ai/subtaskParallel.test.ts` 13 例。

**Why:** 两处计划外设计是守住红线的必要偏离，未来动并行代码前必须理解其动机：

1. **启用信号 `deps.subtaskParallel`（worker 注入 true）** —— Q24/计划只给了
   `SUBTASK_PARALLEL_LIMIT` 回滚旋钮，但任何「自动启用」都会破坏「既有链测试零改动」
   红线：既有链测试大量使用双读/无依赖计划（如 subtaskSequence PLAN2、三读计划），
   一旦自动并行，其顺序步进 LLM mock（runLlmSteps 全局步序）与消息序断言必然碎。
   **How to apply:** 改动链执行行为前，先问「flow() 直调的链测试（无 flag）会不会被波及」；
   只有 worker buildAgentLoopDeps 路径带 flag（仅 subtaskConfirmResume ①② worker E2E 触达）。

2. **工具轮 id 轮次基址方案** —— `roundBase = 已消耗轮次 + 波内序号×SUBTASK_ROUND_STRIDE(1000)`。
   单支在飞时基址=已消耗轮次 → `call_${round}_${index}` 与串行**逐字一致**，这是
   subtaskConfirmResume worker E2E 硬编码 `call_0_0/call_1_0/call_2_0` 交互答案键不失配的
   唯一原因（曾考虑的 toolCallIdTag 方案会让这些键全碎，已放弃）。
   **How to apply:** 任何「串行等价」需求优先考虑能否复用该基址推导，别动生成 id 拼接函数。

**关键口径速查**（详版在 `docs/specs/ai-agent/agent-tool-runtime.md` §15 + TDD 任务 8 章 §4）：
分支不推 `ai:stream:chunk`（波次 flush 按队列序补发）；并行分支失败不弹 subtask_failed 卡
（Q19 报告合并；串行链 Q12 交互不变）；重试单点 = `runScheduledLoop`（总闸 1 复用）；
交互串行化 = `BranchInteractionGate`（parked → 在飞支到子任务边界 → FIFO 走真实回调）。

**已知 flaky 第三次记录**：`tests/benchmarks/ab-test.test.ts`「djb2 faster than MD5」
全量负载下计时断言偶红，单跑必绿——与改动无关，勿当回归追查。

相关：[[project-multi-intent-p1-commit-discipline]]（status/req/plan/agent-memory 不入库）、
[[project-multi-intent-report-redlines]]（Q19 报告/卡点红线）、
[[agent-multi-intent-p1-progress]]（P1 总进度索引）。
