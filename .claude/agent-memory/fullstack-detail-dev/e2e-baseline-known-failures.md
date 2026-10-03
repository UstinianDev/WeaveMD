---
name: e2e-baseline-known-failures
description: 本仓 Playwright 全量基线恒为 31 failed / 104 passed / 1 skipped —— 是已裁定的接受态；判 E2E 门禁要比对失败集合，不能要求全绿
metadata:
  type: project
---

WeaveMD `npx playwright test` 的**既有基线：31 failed / 104 passed / 1 skipped**（2026-10-04 在 `main` 实测；早期分支上为 97 passed / 129 条，之后新增了 e2e 用例）。

**Why:** 这是前序任务（agent-cost-optimize，2026-09-24，commit e223f78 起）就存在的接受态，不是回归。
失败含已裁定保留项（`ai-agent-panel` 选区改写 4 条、`floating-toolbar:222`、`drag-selection-markers` 5 条标题自带「当前 RED」）
以及 `editor-table` / `feedback` / `thematic-break` / `image-resize` 等存量失败。

**How to apply:**
- 判「E2E 有没有被改坏」→ **比对失败集合**（按 `spec:line:col › 标题` 取集合后 diff），不是看 exit code 或失败数；
  不宣称全绿、不删不改这些测试。
- 快速判无关：改动只落在 Electron 主进程（`src/main/**`）时可直接判无关 —— E2E 是 renderer-only
  （`vite.test.config.ts` 不含 vite-plugin-electron），且渲染层对 `@main` 的引用**全是 `import type`**。
- 需要严格证据时：`git stash push -- src/` → 跑 → `git stash pop`，两次失败集合做 diff（约 8 分钟）。
- 若总数变化，先用反证法定位：把本批次触及的渲染层文件 `git checkout HEAD~1 -- <files>` 重跑失败子集对比。
