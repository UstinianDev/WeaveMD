---
name: doc-module-folder-reorg
description: 2026-10-03 docs/testing·requirements·research 按模块入子文件夹（ee6644a）后的计数口径与旧路径 grep 排除区
metadata:
  type: project
---

docs 三目录已按模块归入子文件夹（提交 `ee6644a`，文件名一律未改、git mv 保历史）：testing 5 模块（agent-multi-intent / agent-memory / doc-pipeline / spec-edit / agent-cost-optimize，24 篇 + agent-multi-intent 分册 6 篇）、requirements 3 模块子文件夹 + archive 15（顶层 0 散文件）、research 仅 doc-pipeline/（7 篇）。

**Why:** 索引三处（.claude/CLAUDE.md / docs/README.md / docs/SUMMARY.md）的测试报告计数口径统一为「5 模块 / 24 篇」（不计分册，分册计数仍只出现在主文档头部索引），改结构时必须三处同步。

**How to apply:**
- 全仓 grep 被移文件名做残留自检时，**必须排除 `.claude/agent-memory/`（不碰区，内留 17 处旧路径历史注记）**；另有 1 处 `.claude/agents/editor-table-m4-integration.md` 引用早已退役、HEAD 即不存在的 `editor-table-block.req.md`，属既有悬空引用非本次移动文件。
- `docs/testing/agent-multi-intent/agent-multi-intent.tdd.md` 里的 `./agent-multi-intent.tdd/NN-*.md` 是兄弟相对链接的**正确新路径形式**（不带模块段），残留自检须豁免，以链接解析 broken=0 为准。
- 被移文件内部相对链接修法是两遍：先插模块路径段（前缀不变），再对被移文件整体 +1 层 `../`；根式 `docs/...` 反引号路径只插段不改深度。相关历史见 [[doc-split-convention]]。
