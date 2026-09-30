---
name: agent-memory-optimize-2-b2-done
description: agent-memory-optimize-2 子批 B2（Ledger/Views/Policy）完成状态、三条本批裁定落地与 fake 引擎/工具调用坑
metadata:
  type: project
---

# agent-memory-optimize-2 B2（Ledger / Views / Policy）完成

**状态（2026-09-30）**：门禁五项全绿、TDD RED→GREEN→6 处变异全红后复绿、改动行覆盖 99.8%/84.4% 分支。
**未提交**（总指挥要求本批不 git add/commit）。下一任务 **B4**（分层 Prompt，接 getActiveProfile 画像层）。
相关记忆：[[agent-memory-optimize-2-b1-done]]（DAO 底座）、[[agent-memory-optimize-2-b3-done]]（迁移 DDL）。

## 本批交付
- `src/main/db/agentMemory.ts` 追加：closeMemory 幂等闸 + `parseMemoryStamp`/`memoryNowStamp` +
  三 Views（getActiveProfile / getRecentEntities / getActiveTopics）
- `src/main/ai/agent/memoryPolicy.ts` 新建：evictStale / mergeConflicts / runMemoryPolicy +
  `MEMORY_EVICT_MAX_AGE_DAYS = 90`
- 测试：`tests/main/db/agentMemoryDao.test.ts` 15→24 例、`tests/main/ai/memoryPolicy.test.ts` 新建 14 例

## 非文档化的裁定落地（改前先看这里）
1. **closeMemory 幂等闸**：`WHERE ... AND valid_to IS NULL` 已加，重复 close 返回 false 且不覆盖原关闭时间。
2. **mergeConflicts 里 manual 败者不关闭**：红线「manual 恒免于任何自动驱逐/合并覆盖」按绝对解释执行 ——
   同组若有多条 manual 会并存，留给 C3 用户显式删除。若总指挥要求「组内只留一条」，需改这一处。
3. **runMemoryPolicy 顺序固定为先 merge 后 evict**（有测试锁）：merge 关掉的败者退出 active，
   两类计数不重叠；先 evict 会让超龄败者计入 evicted 且可能筛掉冲突组的「最新」候选。
4. **衰减窗口 90 天是无实测数据的保守值**，注释已标「待实测校准」，不要对外声称有数据支撑。

## 坑
- **不能跨 `.test.ts` import**（vitest 会把被导入文件的 describe 重复注册到当前文件）→
  `memoryPolicy.test.ts` 自持了一份精简 fake 引擎，不与 `agentMemoryDao.test.ts` 共享。
- **fake 引擎不扩展**（总指挥裁定）：Views 的「近 N 天」与聚合全在 TS 侧做，SQL 只用
  `user_id = ?` / `kind = ?` / `valid_to IS NULL`；写新查询时别为了省事加 `>=`/`GROUP BY`。
- **时间口径统一**：`written_at` 是 `datetime('now')` 的 `YYYY-MM-DD HH:MM:SS` UTC，
  必须走 `parseMemoryStamp`（自己 `Date.parse` 不带 Z 会按本地时区解析，边界用例必错）。
- **工具调用坑**：本环境偶发在单次回复末尾多吐一个空参数的 `<invoke>`，整批调用被判
  InputValidationError 且**已成功的那次也不生效** → Write/Edit 一次只发一个调用，改用
  `cat > file << 'EOF'` 建长文件更稳。
