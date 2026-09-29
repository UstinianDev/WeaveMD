---
name: agent-memory-b-d-done
description: agent-memory-optimize 批 B 的 B-d(P0-6 searchKB 代词改写接线) 已完成；记录回退收紧取舍与 vitest 覆盖率 CLI 坑
metadata:
  type: project
---

# agent-memory-optimize — B-d (P0-6) 完成记录

**Why:** 批 B 的 P0-6 要把早已存在但从未接线的 `resolveReferences` 接进 searchKB 主管线，并按 Q12 收紧回退策略。
**How to apply:** 后续 B-c（`agentContext.ts` 的 `toolCtx.history` 注入）是本项的上游依赖；B-c 未合入前 `ctx.history` 恒为 undefined，行为等同改前。

## 已交付（7 个文件，仅限 B-d 清单）

- `src/main/ai/toolTypes.ts` — `ToolCtx.history?: ConversationMessage[]`、`SearchKbFn.opts.expandedQueries?: string[]`
- `src/main/ai/knowledge/queryPlanner.ts` — 新增 `resolveReferencesDetailed()` 返回 `{query, resolved}`，`resolveReferences` 委托之；
  删除 `extractRecentTopic`「最近 3 条 user 硬拼 `${topic}的`」回退；`too_short` 加 history 门（`missing_subject` 不动）
- `src/main/ai/tools/searchKBHandler.ts` — 改写在 HyDE/`ctx.searchKb` 之前；`resolved` 时附 `expandedQueries:[原 query]`；
  `buildMinimalUnderstanding(query, res, history)` → `detectAmbiguities(query, history)`
- `src/main/ai/agent/agentTaskWorker.ts` — 内联 `searchKb` 包装器 opts 放宽并转发 `expandedQueries`
- `src/main/ai/agent/agentKbPreloader.ts` — `opts.expandedQueries?.length` 存在时绕过模糊预载缓存直调 `original`
- `tests/main/ai/searchKBHandler.test.ts`（新增 6 例）、`tests/main/ai/queryPlannerEnhanced.test.ts`（改 1 例 + 追加 2 组）

## 关键取舍（改这块前先看）

- **「改写结果仍含指代词」的判定对象是残余串而非整串**：残余 = `q.replace(PRONOUN_RE,'')`。
  若对整串判 `PRONOUN_RE`，实体本身以「上面提到的」开头的用例（`queryPlannerEnhanced.test.ts` 的
  「该组件支持哪些策略？」，计划要求**保持不变且绿**）会被误判为未消解而回退。
- `extractRecentTopic` **本体保留**（`extractEntityFromHistory` 的「该/上面提到的」分支仍在用），
  只删掉 `resolveReferences` 里那两处硬拼调用。
- `长度 < 2` 与 `residual 仍含指代词` 两道闸在现实输入下不可达（entity 提取正则恒 ≥2 字符）——
  按规格保留为防御分支，**不要为凑覆盖率去改源码**（与 B-f 结论一致）。
- Q12 有意回退：`queryPlannerEnhanced.test.ts` 的「它的」用例由 `toContain('WeaveMD')`
  改为恒等返回 + `resolved:false`，RED 实证为
  `expected 'WeaveMD项目的架构是怎样的的的主要模块有哪些？' to be '它的主要模块有哪些？'`。

## vitest 覆盖率 CLI 坑（本仓库）

- `vitest.config.ts` 的 `test.coverage.include` 写死了编辑器 5 个文件；CLI 覆盖必须用**空格形式**
  `--coverage.include "src/main/ai/knowledge/queryPlanner.ts"`（`--coverage.include=x` 等号形式不生效，
  报告仍走 config 的 include）。
- 多个子代理**并行跑 vitest 会抢 `coverage/.tmp`**，症状是 `ENOENT coverage-0.json` 或整表 0%。
  必须加 `--coverage.reportsDirectory=coverage/<自定义目录>` 隔离，跑完删掉。
- 实测口径：`queryPlanner.ts` 96.58% lines / 89.62% branch，`searchKBHandler.ts` 94.61% lines / 68.75% branch。
