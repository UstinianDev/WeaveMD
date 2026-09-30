---
name: agent-memory-optimize-3-d7-done
description: D7 知识库 FTS 删除/更新触发器修复交付记录——smoke 脚本自持 SQL 副本、CRLF 行尾、导出迁移函数补覆盖
metadata:
  type: project
---

agent-memory-optimize-3 D7（2026-09-30）已完成且**未提交**：`kb_chunks_fts_ad` / `kb_documents_fts_ad` /
`kb_documents_fts_au` 三条触发器从 contentless 专用 `VALUES('delete',...)` 改为
`DELETE FROM <fts> WHERE rowid = old.rowid`；`ai` 触发器未动。

**Why:** 普通（非 contentless）fts5 表执行 `'delete'` 特殊命令必抛 `SQL logic error`，AFTER DELETE 抛错
→ 整条 DELETE 回滚 → `src/main/db/kb.ts` 5 处删除调用全不生效 + FTS 残留。属既有 bug，非第三批引入。

**How to apply:**
- `scripts/fts5-smoke.cjs` **自持一份 `FTS5_MIGRATION_SQL` 副本**，只改 src 时它不会红——D7 已在脚本内加
  「src 常量 vs 本地副本」漂移守卫，并让新增态直接 exec 从 src 运行期抽取的 SQL。后续改 FTS DDL 必须两处同步。
- 仓内 `.ts/.cjs` 是 **CRLF**（`core.autocrlf=true`）；Write 工具新建文件是 LF，要手工转 CRLF；
  用 node 脚本做变异/补丁时 pattern 必须带 `\r\n`，否则匹配不到（D7 白跑过一轮）。
- 迁移函数要进 vitest 覆盖率，就得 `export` + FakeDb 捕获 `exec`（D7 把 `addKbDocumentsFtsIndex` 导出了）；
  不导出时该函数整段 uncovered（index.ts 覆盖 41.65% → 47.41%，改动行 100%）。
- 变异验证里「src-only 改动」会被 smoke 的漂移守卫先拦住，要看真库语义红必须 src + 脚本副本一起改。

交付证据：新测试 `tests/main/db/kbFtsTriggerDelete.test.ts`（12 例）、smoke 追加删除/更新态（既有态仅
`FTS5_MIGRATION_SQL` 里 2 行同步）、六门禁全绿、全量 4430 例（`ab-test djb2` 两条已知 flaky 单跑 3 连绿）。
