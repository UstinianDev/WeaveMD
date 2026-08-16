# ph6-b2-main — 第 6 期批次 2：主进程迁移 + DAO + IPC + 消费修正

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 依赖批次 1（A 已就绪）

## 范围（plan.md §1 组 B，可独立并跑）

- `src/main/db/index.ts`：`runMigrations` DDL exec 后追加 `database.exec(KB_CONFIG_ALTER_SQL)`；导出 `KB_CONFIG_ALTER_SQL`（6 条幂等 `ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ... DEFAULT ...`，见 plan.md §2）
- `src/main/db/ai.ts`：`AiConfigRow`/`AiConfigDbRow`/`mapConfigRow`（NULL 默认兜底，用 shared DEFAULT_KB_SETTINGS）/`AiConfigUpdate` 增 6 KB 字段；`upsertAiConfig` UPDATE + INSERT **两处补 KB 列**（沿用 `update.x ?? existing.x` 保留语义）
- `src/main/ai/ipc.ts`：新增 `KB_GET_SETTINGS`/`KB_SET_SETTINGS` 处理器（userId 隔离；getSettings 无配置返默认 success:true；setSettings 写后回读）；`KB_STATUS` probe 改用持久化 host/model（空值兜底 DEFAULT_KB_SETTINGS）；`AGENT_RUN` searchKb 以持久化 kbSettings 为默认兜底合并（payload 显式字段 > 持久化 > kbSearch 内置默认）；`embeddingProbeHost()/Model()` 若仅一处引用可内联删除
- 测试：`tests/main/db/migrations.test.ts`（**新**，in-memory better-sqlite3 三态：新库/既有库/重复执行，见 plan.md §2.2）；`tests/main/db/aiDao.test.ts`（改，KB 字段 SQL 断言 + mapConfigRow 兜底）；`tests/main/ai/ipc.test.ts`（改，KB_GET/SET_SETTINGS 注册 + user_id 隔离 + KB_STATUS 探针用持久化 host + AGENT_RUN 兜底/部分合并）

## 关键实现点

- 迁移放 DDL 之后、`getAiConfig` 调用前；ALTER 逐列一条带 IF NOT EXISTS 且全带 DEFAULT
- `upsertAiConfig` UPDATE 沿用「只改传的字段」语义
- 测试隔离：FakeDatabase mock（vi.mock better-sqlite3 + db/index）；迁移测试用 `new Database(':memory:')`（不需要 Electron，vitest 可跑）

## 铁律

- 铁律一：本批无写路径（只持久化用户设置）；铁律二：不新增外发
- SECURITY：SQL 全参数化、IPC user_id 隔离、无 dangerouslySetInnerHTML、无 any

## 门禁

- `npm run typecheck` 0 error | `npm run test` 全绿 | `npm run lint` 0 error
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
