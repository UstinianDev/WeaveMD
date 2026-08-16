# editor-table-m4-integration — 集成 + 往返 E2E + 门禁（依赖 M1+M2）

角色：testing-quality-agent | 分支 feat/ai-agent-ph3-ph4 | 需求 T4/T5/T6

## 前置依赖

- **M1/M2 已完成**：`tableCodec.ts` + `TableBlock.tsx` + `onTableEdit` 接线 + 组件单测全绿。
  先读 `docs/plan/editor-table-block.plan.md` §1.6~1.8 + `docs/requirements/editor-table-block.req.md` T4/T5/T6。

## 范围

- `e2e/editor-table.spec.ts`（**新**）：Playwright 真实 Chromium。
  - 编辑单元格 → 序列化文本为规范 md（`| 值 |` 结构、`|` 转义）。
  - 增列/删列/增行/删行 → DOM 行数/列数与文本同步。
  - 往返重解析：编辑后 `stateToMarkdown(markdownToState(编辑后text))` 等价（列数/内容一致）。
  - `|` 输入自动转义；Enter/Tab 跨格导航光标位置。
  - 只读约束：表格外壳/分隔行不可编辑。
- **撤销回归**：Ctrl+Z 回退单元格编辑与增删行列。
- 门禁全量：`npm run typecheck` 0 | `npm run test` 全绿 | `npm run lint` 0 error |
  `npm run build` 成功 | `npx playwright test` 全绿（新增 editor-table + 既有 24/24 不回归）。
- 核对 `docs/plan/editor-table-block.plan.md` 变更清单 vs 实际 diff：**计划外改动一律报告**（不改内核/工具栏）。

## 关键实现点

- 仿现有 `e2e/ai-agent-panel.spec.ts` 的 mockApi + vite server 启动范式。
- E2E 表格编辑需真实 contenteditable：用 `page.click`/`fill` 到 td 内，断言外层 block text 变化。
- 若发现 M1/M2 缺陷：修复代码后重新跑对应单测，不得跳过。
- 任务外阻塞（MSI 图标、drag-selection 5 RED）**不处理**，仅确认不回归。

## 门禁

- 全量门禁全绿（见上）；只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}，
  附 E2E 用例清单与门禁逐项结果、变更清单核对结论。