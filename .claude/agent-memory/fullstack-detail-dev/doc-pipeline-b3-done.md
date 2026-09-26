---
name: doc-pipeline-b3-done
description: B3（一-4 附件持久化）完成于 2026-09-26，commit d55002b，下一任务 B4；含真库迁移验证工作流与门禁坑
metadata:
  type: project
---

# doc-pipeline B3 完成（2026-09-26）

- **commit `d55002b`**（feat/doc-pipeline，32 文件）；证据 `docs/testing/doc-pipeline-b3.tdd.md`，状态已写入 `docs/plan/doc-pipeline.status.md`。
- **下一任务 B4**（四-3 批量导入通道：importDirAsKb 扩 7 格式 + 先 parseDocument 再入索引 + parsed_attachments.id 关联，依赖 B3 的 DAO）。

**Why:** 计划 §1.1 依赖链 B3 → B4；B4 要复用本批次新建的 `src/main/db/attachments.ts` DAO 与 `parseDocument` 先行约束。
**How to apply:** 开 B4 前先读 status.md 的 B3 小节与 TDD §8（决策记录：thumb 仅存活态、emitAgent 单参兼容、改写路由不带附件）。

## 操作性事实（跨批次复用）

- **vitest 无法实例化 better-sqlite3**（系统 Node ABI 127 vs 模块 125，`new Database()` 抛 ERR_DLOPEN_FAILED）→ 真库迁移三断言走 `npx electron scripts/attachments-migration-smoke.cjs`（退出码 0 为准）；迁移 DDL 已改为**从 `db/index.ts` 源码正则抽取**（防漂移），但固定断言（10/9 列、DEFAULT 值）在源码结构变化时需同步脚本。
- **E2E 基线 31 failed 构成**（每批次比对用）：ai-agent-panel 4（A2/A3/A4/①整块高亮）+ drag-selection-markers 5 + editor-table 7 + feedback 5 + floating-toolbar 2 + thematic-break 2 + exit-behavior 2 + editor 1 + image-resize 1 + recent-history-restore 1 + welcome-doc 1；skipped=feedback 真 SMTP 手工验收。
- `tests/benchmarks/ab-test.test.ts`（djb2 vs MD5 性能对比）在全量并行跑时偶发 1 failed —— 负载 flaky，单独重跑即绿，非回归信号（B2/B3 均复现）。
- AIPanelComposer 既有断言用 `toHaveBeenCalledWith('text')` 单参形式 —— 给 sendAgentMessage 加可选参时，包装层必须无附件走单参调用（B3 首跑 6 failed 的根因）。
