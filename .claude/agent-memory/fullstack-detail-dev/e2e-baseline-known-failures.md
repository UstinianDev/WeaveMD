---
name: e2e-baseline-known-failures
description: feat/doc-pipeline 分支 E2E 基线为 31 failed/97 passed/1 skipped（129 条），是前序任务已裁定的接受态，验收时对照基线而非要求全绿
metadata:
  type: project
---

WeaveMD `feat/doc-pipeline` 分支的 Playwright 全量基线：**31 failed / 1 skipped / 97 passed（129 条）**。

**Why:** 前序任务 agent-cost-optimize（2026-09-24，commit e223f78）收尾时即为同数字，五门禁按此状态记绿；
失败含已裁定保留项（ai-agent-panel 选区改写 4 条、floating-toolbar:222、drag-selection-markers 5 条标题自带「当前 RED」），
以及 editor-table/feedback/thematic-break/image-resize 等存量失败。

**How to apply:** 任何批次跑 E2E 门禁时，把「31f/97p/1s + 失败集合不扩大」当作通过判据，不宣称全绿、不删不改这些测试。
若总数变化，先用反证法定位：把本批次触及的渲染层文件 `git checkout HEAD~1 -- <files>` 重跑失败子集对比（B1 曾用此法证明 feedback/thematic 7 条与批次无关）。
相关：[[doc-pipeline-b1-done]]
