---
name: agent-memory-a3-done
description: agent-memory-optimize-2 A3（classifyIntent 接 searchKB 主管线）交付要点与三个非显然坑（hasReference 裸拉丁字母、P0-6 逐值锁 expandedQueries、coverage json 口径）
metadata:
  type: project
---

# A3 完成（agent-memory-optimize-2 子批 A）

**状态（2026-09-29）**：A3 已实现并过门禁，**未提交**（并行子代理共享工作树，等待统一提交）。
改动仅 4 个自有文件：`src/main/ai/knowledge/queryPlanner.ts`(+59)、`src/main/ai/tools/searchKBHandler.ts`(+29/-6)、
`tests/main/ai/queryPlannerEnhanced.test.ts`(+60)、`tests/main/ai/searchKBHandler.test.ts`(+113)。
下一任务：Gate A（A1/A2/A4 由并行子代理负责）。

**Why:** 记录本任务的非显然约束，避免后续批次（B/C 或回归）重复踩。
**How to apply:** 再动 searchKB / queryPlanner / expandedQueries 时先读这里的三条坑。

## 设计取舍（已落地，改前先看）

- 新纯函数 `expandByIntent(query, intents, history?)` 放 **queryPlanner.ts**（紧邻 expandQuery/classifyIntent，可单测，
  handler 保持薄）；只返回**增量**（不含入参 query），去重 + 上限 6 条（防 kbSearch UNION ALL 过大）。
- 意图映射：`comparison`/`procedure` 复用 `expandQuery`；**`fact`/`summary` 一律不扩展**（最小召回口径）；
  `follow_up` = 从 history 解实体后**替换查询中剩余指代词**（与 P0-6 改写叠加、不覆盖主 query）。
- handler 侧新增 `mergeExpandedQueries(base, additions)`：两者皆空返回 `undefined`（保持改前"不传 expandedQueries"语义）。
- `buildMinimalUnderstanding` 改为 **export**（漏参修复的唯一可测出口——澄清上下文字符串不含 intent，公开 handler 路径测不到）。

## 三个坑

1. **`classifyIntent` 的 hasReference 字符类是裸拉丁字母**：`/[它这那this that it上面刚才之前]/i` 含 `t/h/i/s` 与空格，
   有历史时任何含拉丁字母的查询（如 `FTS5 分词器怎么配置`）都会被判 `follow_up`。
   → 意图扩展必须另用**真实指代词**正则（`FOLLOW_UP_PRONOUN_RE`，CJK + `\bthis\b` 等），否则会拿历史实体替换出垃圾扩展。
2. **P0-6 既有断言对 `expandedQueries` 是 `toEqual([...])` 逐值锁**（searchKBHandler.test L87/L161），
   且 `toBeUndefined` 锁 L96/L108/L120。任何新扩展只要命中这些用例的意图就会红。
   → 靠"改写后 query 无指代词 → fact → 不扩展"自然规避；新增用例必须自造 comparison/procedure/follow_up 输入。
3. **覆盖率取证口径**：`--coverage.include='path'` 要空格形式；默认 reporter 不落 `coverage-final.json`，
   要加 `--coverage.reporter=json --coverage.reportsDirectory=.tmp-xxx`（用完 `rm -rf`，`vitest.config.ts` 禁改）。

相关：[[project_devflow_parallel_subagents]]、[[project_fullsuite_flaky_perf_tests]]、[[agent-memory-b-d-done]]
