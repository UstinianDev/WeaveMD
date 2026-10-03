---
name: devflow-batch-parallel-subagents
description: devflow 批次由多个子代理并行改同一工作树——typecheck/门禁报错须先归属到自己负责的文件，不能直接当作自身失败
metadata:
  type: project
---

devflow「agent-memory-optimize」等批次按步骤拆给多个子代理**并行**改同一份 `D:\software\WeaveMD` 工作树（例：A-b-2 改 `intentRouter.ts`，同时另一子代理在改 `agentContext.ts` / `agentContext.test.ts`）。

**Why:** 批次内步骤被设计为「可并行」（见 `docs/plan/*.plan.md` §1 表格），子代理收到的指令明确限定「只准动这些文件」，因此运行全量门禁时必然看到别人在途的编译错误/失败用例。

**How to apply:**
- `npm run typecheck` 报错时，先按路径判断是否属于自己负责的文件；属于自己 → 必须修；属于并行代理 → 记为「非本步引入」并在报告中说明，不要动它。
- 同理 `npx vitest run tests/main/ai/` 若出现非自己文件的失败，先用 `git diff --name-only` 归属再下结论。
- 只跑自己文件的 RED/GREEN 时，用 `git stash push -- <自己的单个文件>` 临时回退源码取证，再 `git stash pop` 恢复（pathspec 限定，不会误伤并行改动）。
- 相关：（同一仓库多批并行的既有经验）。
