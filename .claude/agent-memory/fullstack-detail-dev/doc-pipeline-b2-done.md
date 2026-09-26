---
name: doc-pipeline-b2-done
description: B2（一-1/一-2/一-3 上传接线）已交付 commit da7ceaa；关键坑——DIALOG_OPEN_FILE 是 file.open 与 dialog.openFile 共享通道，改契约必须查全部消费方
metadata:
  type: project
---

doc-pipeline B2 于 2026-09-26 完成，commit `da7ceaa`（feat/doc-pipeline 分支）；下一任务 B3（一-4 持久化）。TDD 证据 `docs/testing/doc-pipeline-b2.tdd.md`，进度 `docs/plan/doc-pipeline.status.md`。

**Why:** B2 执行中发现计划与源文档均未披露的耦合——preload `file.open`（:300）与 `dialog.openFile`（:331）共用 `DIALOG_OPEN_FILE` 单一 IPC 通道；按计划字面直接改死 paths 契约会破坏编辑器「打开文件」（期望 `{path,name,content}`），vitest/E2E 都测不到（E2E 的 file.open 是 spec 内独立 mock）。最终以 `{upload:true}` 参数区分双模式并补 2 条回归锁定用例。

**How to apply:** 后续批次（B3/B4/B11）改动任何 IPC 通道契约前，先 grep 该通道常量的**全部** invoke 点（preload 内可能多键共用一个通道）与 bridge mock、e2e mock 三处消费方；E2E renderer-only 不经 preload，共享通道回归只能靠主进程单测锁定。另：`tests/benchmarks/ab-test.test.ts` 是负载敏感 flaky（djb2 vs MD5 计时对比），全量 vitest 出现它 1 failed 时单独重跑确认即可，不是回归；`npm run lint` 范围仅 `src/`（e2e/ 不在门禁内）。
