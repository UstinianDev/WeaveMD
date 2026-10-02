---
name: project-multi-intent-p1-task10-boundary
description: 任务 10 两套意图系统交叉引用+边界注释已交付（87e9c63）——P1 八任务全部完成；不建共享常量文件的裁定
metadata:
  type: project
---

任务 10（两套意图系统文档交叉引用与边界固化，L1）已完成，提交 `87e9c63`
（本地 main 未推送，2026-10-02）。**P1 八任务（6/7/4/9/12/13/8/10）全部完成**，
status.md 阶段 3~5 已勾选；阶段 6~8 全程交付核对仍待办。

**Why:** 计划 §2 任务 10 有一处二选一裁定，未来有人提议「抽共享常量统一两套意图枚举」时须拒绝：

- **不建共享常量/边界文件** —— 两套意图类型已分处 `@shared/ai/agent.ts`（`IntentName`，
  任务意图）与 `@shared/ai/kb.ts`（`QueryIntentType`，检索策略意图），物理隔离已成立，
  新建边界文件属过度设计。边界只用**文档交叉引用 + 文件头注释**固化：
  `intentRouter.ts` 头注释「任务意图域，禁 import queryPlanner」，
  `queryPlanner.ts` 头注释对称声明；`ai-agent.md` 意图路由节与 `knowledge.md`
  「桥接不合并」小节互链并写明优先级（任务意图定工具集、检索策略意图定 KB 检索、
  冲突以 Agent 为准）。历史裁定出处 `docs/requirements/agent-memory-optimize-2.req.md:41`
  （只引用不改）。

**How to apply:** 若后续重构想合并两套 `classifyIntent` 或建 shared 意图常量，先回看
本裁定与 Q21；改动前须重新过裁定，不能静默合并。门禁实录：typecheck 0 / 全量
205 文件 4781 绿 / lint 108（0 error）。

相关：[[project-multi-intent-p1-task8-parallel]]（上一任务）、
[[project-multi-intent-p1-commit-discipline]]（status/req/plan/agent-memory 不入库）、
[[agent-multi-intent-p1-progress]]（P1 总进度索引）。
