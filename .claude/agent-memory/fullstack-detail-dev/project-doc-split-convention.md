---
name: doc-split-convention
description: 超 400 行文档拆分的用户裁定——分册正文零增行（无拆分头），回链只放主文档
metadata:
  type: project
---

超长文档渐进式拆分：**阈值 400 行**（用户裁定，2026-10-03 执行）。分册文件只放逐字正文，**不加拆分头/标题行**（回链开销 0）；索引与回链全部写在主文档（头部索引表 + §1/§3/§4 处的「分册回链」引用行）。

**Why:** 完成标准要求「分册行数和 ≈ 原正文行数（±2 行回链开销）」，加拆分头会超容差；既有 `editor-v2-progress/` 分册带 preamble 的做法与该容差冲突。

**How to apply:** 后续拆分用 `sed -n 'N,Mp'` 按行号提取（执行前用 `grep -n "^#"` 锚定章节标题微调边界），自检用 `git show HEAD:原文件` 重建后 `diff` 证明逐字一致。已按此拆分：`docs/testing/agent-multi-intent.tdd.md`（6 分册）+ `docs/plan/agent-multi-intent-p1.plan.md`（1 分册），提交 `0bacd4d`。
