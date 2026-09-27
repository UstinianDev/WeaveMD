---
name: doc-pipeline-remedial-done
description: remedial 遗留修复批次完成记录——9 项修复 commit 清单、三开放点裁定语义、vitest fs mock 不生效/负载 flaky 等实操坑
metadata:
  type: project
---

# doc-pipeline 遗留修复批次（remedial）完成（2026-09-27）

分支 `feat/doc-pipeline`，11 个新 commit（aca71fd 蓝图 → 925fe20..d6a7bef 分项 fix → 503a7fe 补测 → e6bdb6e docs）。诊断蓝图 `docs/plan/doc-pipeline.remedial.diagnosis.md`，证据 `docs/testing/doc-pipeline-remedial.tdd.md`，status 已追加「遗留修复批次」小节，plan §3 数据变更点 8→9（+D8 `ai_config.vision_override`）。未推送远程。

**Why:** 三开放点裁定为 L4/关键语义，后续批次改动这些链路前必须先核对裁定，避免重开已裁定问题。

**How to apply:**
- R3 裁定语义：`ToolCtx.attachmentEgressAllowed`（= allowSend ∨ 勾选授权）+ `resolveAttachmentTarget` 双检——**本会话附件恒放行（豁免）、跨会话恒拦**（外发闸只决定拦截报因，不放行跨会话）；矩阵 8 格锁定在 docTools.test。字段名是 `attachmentEgressAllowed`（任务书 "ToolCtx.egession" 为同义简写）。
- R7=消息级级联收在 `deleteMessagesAfter`（db/ai 内聚，非 handler）；R8=会话删除先 list 后删行再逐 id `removeParsedAttachment`。
- BugB 三态：NULL=自动 / 1=强制开 / 0=强制关；未知模型 supportsVision 乐观 true（**旧测试「未知保守 false」已按裁定改写**）；降级上屏走 `IAttachmentMeta.error`（气泡 parseStatus=error 才显示，仅设 error 字段不显示）。

## 实操坑（后续批次直接复用）

- **vitest `vi.mock('fs')` 覆盖不到 `agentMedia` 的 existsSync**（实测 'fs'/'node:fs' 双 mock 均不生效，test 文件自己的 import 却被 mock）——图片注入测试用 **os.tmpdir 真实临时文件**，勿再尝试 fs mock。
- **vitest 硬门槛**：`npm run lint` 作用域仅 `src/`；测试文件单独 eslint 会报存量 require-yield/no-require-imports（disable 注释规则名不匹配），勿误判为回归。
- **负载 flaky 两条**：`cacheMonitor getStats 10万次<50ms`、`ab-test djb2>MD5`——全量跑高负载时间歇失败、单跑全绿；复合门禁口径 = 全量剔除二者（`--exclude 'tests/{benchmarks/ab-test,main/ai/cacheMonitor}.test.ts'`，**--exclude 只收单值，用 brace glob**）+ 二者单跑。
- **aiDao FakeDb 的 stmtCache 跨测试泄漏**：`cachedPrepare` 按 SQL 缓存 statement，测试里 override `prepare` 影响不到已缓存语句——要改行为用 harness 注入钩子（如 `setMessageTarget`），不要重写 prepare。
- E2E 基线恒为 **31 failed/1 skipped/101 passed**，逐 spec 构成：ai-agent-panel 4 / drag 5 / table 7 / feedback 5 / float-toolbar 2 / thematic 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1。
- 覆盖率口径：v8 `--coverage.include` 白名单 + `--coverage.reportOnFailure=true`（否则失败跑无报告）；db/index.ts 的 runMigrations DDL 在 vitest 恒 0 覆盖（真库 smoke 脚本职责），聚合数被其拖低属既有口径。

关联：[[doc-pipeline-b11-done]]、[[doc-pipeline-b6-done]]
