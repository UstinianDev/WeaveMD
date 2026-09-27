---
name: doc-pipeline-compliance-review
description: doc-pipeline 阶段 7 合规核对结论（commit 35180f7）——APPROVED WITH COMMENTS，E2E 31f 基线口径与 xlsx CVE 为主要备注
metadata:
  type: project
---

2026-09-27 完成 `feat/doc-pipeline` 对基线 `e223f78` 的合规核对，报告在 `docs/plan/doc-pipeline.compliance.md`（commit 35180f7）。

**Why:** 收尾需确认 29 任务/红线/范围外逐条达标；结论 = APPROVED WITH COMMENTS，无 Critical。

**How to apply:**
- 红线七项全过（allowSend 计算 agentContext.ts `!needsKbSendConsent` 未动、迁移纯追加零 DROP、无删测试、体积 99.16MB/368.96MB 过双口径门禁）。
- 收尾门禁措辞：E2E 只能记「基线 31 failed 零新增」，**不得写五项全绿**（req §3 字面矛盾待主会话裁定）。
- 待跟踪：`xlsx@0.18.5` 已知 CVE（修复版仅 SheetJS 官方源）；vitest 全量下 cacheMonitor:531 性能断言负载 flaky（单跑绿）；plan §3 数据变更点应从 6 回填为 8（D5b consent_granted、D7 structure_json）。
- 计划提及但零改动且有记录：FileTreePanel / vite.config.ts / tokenizer.ts / toolResultStorage（extract_table 走 agentToolExecutor:401 既有泛化落盘）。
