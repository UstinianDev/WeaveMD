---
name: agent-memory-optimize-2-b1-done
description: agent-memory-optimize 第二批 B1（agent_memory DAO）于 2026-09-30 交付，未提交；含 fake 内存 SQL 引擎测试做法与 upsert manual 恒赢口径
metadata:
  type: project
---

# agent-memory-optimize-2 B1 完成（2026-09-30）

- **交付**：`src/main/db/agentMemory.ts`（新建 DAO）+ `tests/main/db/agentMemoryDao.test.ts`（新建，15 例）。
  **未 git add / 未提交 / 未推送**；`src/main/db/index.ts` 零改动（B3 冻结）、无迁移改动、`docs/` 未改（总指挥统一更新）。
- **下一任务**：B2（Ledger/Views/Policy 追加到同一 DAO + `src/main/ai/agent/memoryPolicy.ts`），随后 B4。

**Why:** Gate B 顺序为 B3 → B1 → B2 → B4；B2 的 Views/Policy 直接建在 B1 的查询函数之上。
**How to apply:** 开 B2/C1 前先看本文件「对外契约」小节，别重新猜字段名与语义。

## 对外契约（B2/C1 消费时按此）

- 导出类型字段是 **camelCase**：`AgentMemoryRow { id, userId, kind, subject, content, source, conversationId, fingerprint, validFrom, validTo, writtenAt }`
  （列 `valid_to` → 字段 `validTo`，与 `AiConfigRow` / `ParsedAttachmentRecord` 同风格；别按 DDL 的 snake 名去点字段）。
- 所有函数 **db 作为第一参数**（`BetterSqlite3Database`），不走 `getDatabase()`——测试直接注入 fake。
- `upsertMemory` 三条规则按字面实现：同 user+kind+subject 存在 `source='manual'` 的 active 行 → **恒赢，返回该行 id 且零写入**
  （含 manual→manual 改写也不落库；manual 变更路径 = C3 物理删除后重写）；否则同 kind+subject+fingerprint active 行 → 关旧插新；无重复 → 直插。
  **同 subject 不同 fingerprint 的并存行 B1 不清洗**（时间新者赢归 C2 memoryWriter）。
- `closeMemory` 只 UPDATE `valid_to`（不含 `valid_to IS NULL` 幂等闸）；`deleteMemory` 是唯一物理 DELETE 点（C3 用）。
- 列表排序统一 `ORDER BY id ASC`（追加序）；`getActiveBySubject`/`getActiveByFingerprint` 是 `id DESC LIMIT 1`（取最新）。

## 操作性事实（跨批次复用）

- **vitest 仍无法实例化 better-sqlite3** → 本批 fake 升级为「按 SQL 文本解析条件的最小内存引擎」（写在测试文件内）：
  WHERE 只认 `col = ?` / `col IS [NOT] NULL`，出现字面量即抛错；每次调用校验 `?` 个数 === 参数个数；
  SELECT 缺 WHERE 直接抛错。这样 DAO 漏写 `user_id = ?` 或拼接值，隔离/参数化断言必然变红。
- 该文件做过 4 次变异验证（丢 user_id 过滤 / 丢 user_id 且同步改参数 / 删 manual 恒赢闸 / closeMemory 改 DELETE），
  分别红 14、2、1、5 例，还原后 15 例全绿——**变异是这套 fake 不自证的唯一手段，改 fake 时要重跑一遍**。
- 门禁实测：typecheck 无输出、eslint `--quiet` exit 0（全量 106 warning 均为既有）、vite build 13.46s 通过、
  全量 vitest `169 文件：1 failed / 168 passed`，`4057 例：1 failed / 4056 passed`（失败为
  `cacheMonitor.test.ts` 50.122ms < 50ms，既知负载 flaky，单跑 37 passed；`ab-test.test.ts` 单跑 22 passed）、覆盖 `agentMemory.ts` 100% stmts/branch/funcs/lines（`.tmp-cov-b1` 已删）。

关联：[[agent-memory-optimize-2-b3-done]]、[[project_fullsuite_flaky_perf_tests]]、[[doc-pipeline-b3-done]]
