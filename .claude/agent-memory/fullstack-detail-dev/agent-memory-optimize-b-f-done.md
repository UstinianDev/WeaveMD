---
name: agent-memory-optimize-b-f-done
description: agent-memory-optimize 批 B B-f(P0-7) knowledgeClarify 补测试完成情况与该模块三个口径坑
metadata:
  type: project
---

devflow agent-memory-optimize 批 B 步骤 B-f（P0-7）已完成：新建 `tests/main/ai/knowledgeClarify.test.ts`（28 例），源文件 `src/main/ai/knowledge/knowledgeClarify.ts` 严格零改动，行覆盖 95.88% / 分支 95.34% / 函数 100%，`tests/main/ai/` 全量 44 文件 982 例绿。

**Why:** P0-7 的硬验收是「只补测试、源文件 diff 为空」；该模块此前零测试，历史澄清门控实际在 `queryPlanner.ts:432`，本文件无 `history` 引用（方向文档原述有误，plan §2.3 已修正）。

**How to apply:** 后续若有人提议给 knowledgeClarify 加 history 参数或改模板，先核对 P0-7 验收；三个易踩口径：
1. 模板占位符是 `「」`，方向文档写的 `『』` 是错的，测试已锁死；
2. `needsClarification` 阈值 0.5 与 `generateClarifyQuestions` 兜底阈值 0.6 **相互独立**（0.5~0.6 区间会「有问题但不需澄清」），属既有行为，别当成 bug 去"修"；
3. `buildClarificationContext` 的 `idx===1` 兜底分支与空 options 分支经公开 API 不可达（只会产出 text/choice），覆盖不到属预期，不要为凑覆盖率改源码。

相关：[[project_devflow_parallel_subagents]]
