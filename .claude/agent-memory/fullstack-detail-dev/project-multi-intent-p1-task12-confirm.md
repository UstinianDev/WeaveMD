---
name: project-multi-intent-p1-task12-confirm
description: 任务 12（子任务级确认/暂停恢复/级联）交付要点与三处易踩坑：worker E2E 的 DONE 走 persistAndSend、return await 才落 ERROR catch、annotateSerialWrites 自动串行导致级联范围
metadata:
  type: project
---

任务 12 已交付：本地 main 提交 `7fa9eb5`（未推送），测试 `tests/main/ai/subtaskConfirmResume.test.ts`（6 例）+ `tests/components/BatchConfirmCard.test.tsx`（3 例）。

**Why:** 任务 13/8/10 会继续碰 agentLoop 收口、确认矩阵与链报告，下列坑会重复踩。

**How to apply:**
- **worker E2E 的 DONE 口径**：`deps.db + sessionId + mainWindow` 齐备时 `createSend` 把 `AI_STREAM_DONE` 改走 `persistAndSend(eventType='done')`，electron `webContents.send` 收不到；`AI_SUBTASK_DONE` 无 eventType 映射仍走 electron。测试断单次 DONE 要用「electron done + persistAndSend('done')」双口径，且别把 `handleTaskSuccess` 的 `persistAndSend(channel)`（arg[4] = 'ai:stream:done'）算进去。
- **`return finalizeChainRun(...)` 的 reject 不落外层 try/catch**（裸 return 不 await）→ 取消类 reject 不会发 `AI_STREAM_ERROR`。链收口 try 内调用点已改 `return await`；新增收口调用点必须同样处理，try 外 pre-loop 点没有 catch（reject 直达 worker handleTaskError，不锁死）。
- **`normalizeTaskPlan.annotateSerialWrites` 给每对相邻写子任务自动加 `serial_after`** → 任何两写链天然有依赖；任务 12 级联（`cascadeSkipDependents` 按 `buildDepsMap` 传递闭包）因此会把「链中跳过首个写子任务」放大为后续写全部 `skipped_dependency` 剪枝。已据此改写 `chainReport.test.ts` 任务 7 ③（Q22 取代旧语义，计划风险条已预告 deps 仅来源于 preconditions/serial_after）。写链相关新测试要预设这个依赖形状。
- 报告级联呈现走 `ChainReportTask.cascade?` 加法字段（缺省不产出键 → 既有 `toEqual` 等价）；`BatchConfirmCard` 原样渲染 `q.text`，主进程侧文案前缀（stale 警告）无需渲染层改动。

相关：[[project-multi-intent-report-redlines]]、[[project-multi-intent-p1-commit-discipline]]
