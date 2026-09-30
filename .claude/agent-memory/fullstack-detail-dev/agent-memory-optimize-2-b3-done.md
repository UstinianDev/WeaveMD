---
name: agent-memory-optimize-2-b3-done
description: agent-memory-optimize 第二批 B3（L4 迁移）完成情况、门禁实测与三个实施坑（CRLF 比对、多语句 exec 拆分、DDL 行尾注释）
metadata:
  type: project
---

# agent-memory-optimize-2 子批 B · B3 完成（2026-09-29）

**交付**（仅 3 个文件，未 commit、未动 docs/）：
- `src/main/db/index.ts` — 36 行纯新增、0 删除、恰好 2 个 hunk：`runMigrations` 末尾一处 `addAgentMemoryTables(database);` 调用 + 文件末尾新增 `export function addAgentMemoryTables`（单块 `database.exec`，Q6=B 单表 11 列 + 3 索引，双时间 valid_from/valid_to/written_at，无 created_at、无 FTS/VIEW/预留列）
- `tests/main/db/migrations.test.ts` — +276 行 0 删除，新增 1 个 describe 4 例（态1 空库首建 / 态2 旧库升级含数据行留存 / 态3 重复执行 / anti-drift 源码 DDL + runMigrations 接线比对）
- `scripts/agent-memory-migration-smoke.cjs` — 新建，四态真库冒烟，`npx electron scripts/agent-memory-migration-smoke.cjs` 退出码 0

**门禁实测**：typecheck exit 0 / vitest 全量 168 文件 4042 例全绿（跑了两轮，既知 flaky ab-test djb2、cacheMonitor getStats 本轮均通过未复现）/ eslint `0 errors, 106 warnings` / vite build exit 0。E2E 未跑（Gate B 由总指挥统一跑）。

**Why:** B3 是子批 B 的 L4 前置，B1（DAO）/B2（Ledger·Views·Policy）都依赖该表结构与幂等语义。
**How to apply:** 后续 B1/B2 只能读写 `agent_memory`，不得再加列（要加列走 `addColumnIfMissing` 幂等补）；提交时 `git diff -- src/main/db/index.ts` 必须仍是「仅新增函数 + 一处调用」。

## 三个实施坑（下次做迁移时直接避开）

1. **源码 DDL 比对必须归一化换行**：`src/` 是 CRLF，`readFileSync` 抽出的 DDL 带 `\r\n`，而运行期模板串经 vite 转换后是 LF → `toBe()` 直接炸。比对前统一 `s.replace(/\r\n/g,'\n').trim()`。
2. **`database.exec` 一整块含多语句**：FakeDb 的 `exec` 若只匹配块首 `CREATE TABLE` 就 return，后面的 `CREATE INDEX` 全部丢失（索引断言会得到 `[]`）。必须按括号深度为 0 的分号拆成多语句再逐条处理。
3. **DDL 行尾 `--` 注释会毁掉列名解析**：`kind TEXT NOT NULL,   -- 'profile' | 'fact'` 逗号在注释前 → 下一段以 `--` 开头，`split(/,/) 后 first token` 变成 `--`。解析前先 `replace(/--[^\n]*/g,'')`（抽括号体也要先剥，避免注释里的括号干扰深度计数）。

## TDD 证据
- RED：仅加测试时 `4 failed | 22 passed (26)`（`addAgentMemoryTables is not a function` + anti-drift 源码未找到）
- GREEN：`26 passed (26)`
- 变异复核 ①删 DDL 的 `valid_to` 行 → `3 failed`；②删 `runMigrations` 内调用 → anti-drift 接线断言 `1 failed`；还原后复绿
- 覆盖率（CLI `--coverage.include`，临时 reportsDirectory 已 rm）：新函数 732+ 行全部覆盖，未覆盖语句止于 719；**唯一未覆盖的改动行是 `runMigrations` 内的调用行**（本仓无任何单测调用 `runMigrations`，属既有格局，非遗漏）
