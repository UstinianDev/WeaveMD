---
name: better-sqlite3-add-column-incompat
description: 项目锁定时 better-sqlite3（sqlite3.49.2）拒绝 ALTER TABLE ADD COLUMN IF NOT EXISTS；幂等加列需运行期 PRAGMA 探测守卫
metadata:
  type: project
---

# better-sqlite3 不支持 `ADD COLUMN IF NOT EXISTS`

项目锁定的 `better-sqlite3@11.10.0`（自带 sqlite 3.49.2，source 2025-05-07）对
`ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ...` 报 `near "EXISTS": syntax error`，
尽管 `CREATE TABLE IF NOT EXISTS` 正常。经 `npx electron`（Electron 运行时，ABI 匹配）实证。

**Why:** 这是第 6 期合规核对（H1 真库三态 smoke）由 `scripts/kb-migration-smoke.cjs` 暴露的
生产阻断：`runMigrations` 每次启动 `database.exec(KB_CONFIG_ALTER_SQL)`，若沿用 `IF NOT EXISTS`
会在 init 抛错致应用无法启动。老的 `migrations.test.ts` 用正则在假内存 schema 上"跑"，掩盖了这一点。

**How to apply:** 本项目内任何幂等加列迁移，不要用 `ADD COLUMN IF NOT EXISTS`。改用
「运行期 `SELECT 1 FROM pragma_table_info('<tbl>') WHERE name=?` 探测缺失列 + 逐列
原生 `ALTER TABLE t ADD COLUMN <ddl>`」，幂等由守卫保证。参考实现 `src/main/db/index.ts`
的 `addAiConfigKbColumns`；真库验证走 `scripts/kb-migration-smoke.cjs`（Electron 运行时）。
KB 6 列：kb_top_k INTEGER 5 / kb_fuse REAL 0.5 / kb_threshold REAL 0.6 / kb_pinned_weight REAL 1.5 /
kb_embedding_host TEXT 'http://localhost:11434' / kb_embedding_model TEXT 'nomic-embed-text'。
相关：[[fts5-cjk-unicode61]]（FTS5 smoke 模式同源自 scripts/*.cjs Electron 真验）。
