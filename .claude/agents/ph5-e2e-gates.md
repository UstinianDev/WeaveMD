# ph5-e2e-gates

> 第 5 期批次 5（E 收尾）：e2e 扩展 + 全量质量门禁 + 文档同步。依赖批次 1-4 全部落地。

- 职责：扩展 `e2e/ai-agent-panel.spec.ts`（mock `ai.rewritePreview`：选区→面板卡片→确认→编辑器 content 更新且可撤销；document @ scope；stale 拒绝；**不上网**）；跑全量门禁（typecheck / vitest / lint / vite build / playwright ai spec + 回归）；同步文档（模块 11 §4/§7、SUMMARY、CLAUDE.md 更新为「第 5 期已交付」、docs/plan/ai-agent-panel.status.md 阶段 3-8）。
- 门禁未过 → 停下向主指挥报告，不擅自放行。
- 铁律：无密钥、无 dangerouslySetInnerHTML、AI 无直接落盘（主进程只产 proposal 断言已在批次 2 覆盖，本批复核）。
- 返回结构化摘要 `{完成项, 测试证据, 未完成项, 风险}`。
