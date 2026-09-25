---
name: doc-pipeline-b1-done
description: doc-pipeline B1 已完成（7056dcf+5fbae50）；liteparse 实测 API 为 LiteParse、默认 OCR 慢、xlsx 合并格残留值等解析层关键事实
metadata:
  type: project
---

doc-pipeline 批次 **B1 于 2026-09-25 完成**：commit `7056dcf`（代码）+ `5fbae50`（文档），
证据在 `docs/testing/doc-pipeline-b1.tdd.md`，状态在 `docs/plan/doc-pipeline.status.md`。
下一任务 **B2**（一-1/一-2/一-3 上传接线，composer 真实调 `KB_PARSE_DOCUMENT` 在 B2 才接）。

**Why（解析层实测事实，重探成本高）：**
- `@llamaindex/liteparse` 运行时只导出 `LiteParse/default/searchItems`，`LlamaParseReader.loadDataAsContent`
  **不存在**（旧代码一直是运行时 fallback 兜底）；且默认 OCR 会被触发（单页 ~6.2s），`ocrEnabled:false`
  后 native 文本提取 18ms——本期无 OCR 决策基线要求必须显式关。
- `xlsx` 的 `sheet_to_json` 对合并区覆盖格会**原样输出陈旧残留值**（往返写保留），且默认 `blankrows:false`
  丢空行会让 `!merges` 行号错位——须 `blankrows:true` 先应用合并再剔空行。
- `html-to-docx` 可在测试里当 docx fixture 生成器（`HTMLtoDOCX(html)`，第三参传 `null` 会抛错，无
  `exportBody` 选项）；mammoth 表格头行也会降级成 `<td>`。

**How to apply:** B2+ 批次改解析/上传链路时直接沿用这些事实，不重新探测；xlsm/xlsb 永不在白名单（决策基线 7 格式）。
相关：[[e2e-baseline-known-failures]]
