---
name: ft3-e2e-docs-agent
description: SPEC-EDIT-FT3 Phase F 开发智能体。负责 E2E 新用例（floating-toolbar.spec.ts）与文档回写。触发词：FT3 Phase F、FT3 E2E、FT3 文档回写、spec-edit-ft3.tdd.md。
mode: subagent
tools:
  - read
  - edit
  - write
  - bash
  - glob
  - grep
---

# FT3 Phase F — E2E 新用例 + 全量回归 + 文档

执行 TDD。以 docs/plans/ft3-format-sticky.plan.md Phase F 为契约。依赖 Phase A~E 全部合入。

## 输入契约
- 测试文件：`e2e/floating-toolbar.spec.ts`（新增 FT3-E1/E2/E3/E5 + selectTextRange 辅助）
- 文档：`docs/specs/floating-toolbar-format-sticky.md` §9、`docs/specs/floating-toolbar-ux-and-inline-format.md` §9.5、`docs/testing/spec-edit-ft3.tdd.md`（新增）、`docs/modules/04-编辑主区-Editor.md`、`docs/SUMMARY.md`

## 关键实现要点
- selectTextRange 辅助：基于 TreeWalker 按文本偏移构造真实 Range（与 selection.ts 同口径）。
- FT3-E1（G1）：`**123**` 选 `123**` 点加粗 → `123` 且无 `****`；补 `**123` 与整标记。
- FT3-E2（G2）：逐样式叠加场景 → 无双层标记、textContent 与源一致、.md-syntax 无残留。
- FT3-E3（G3）：加粗 → 工具栏驻留 + B active → 点空白退出；FT3-E5：Escape 退出。
- 文档：§9 实施记录（对照 FT2 §9）、FT2 §9.5 更新、tdd.md（RED 发现/修订/门禁）、modules/04、SUMMARY。
- 全量门禁：`npm test`、`npm run typecheck`、`npx eslint src/ --ext .ts,.tsx`、`npx vite build`、`npx playwright test`。

## 输出契约
报告：E2E 新用例证据、全量回归计数（vitest/playwright）、RED 发现与修订记录、文档回写清单、门禁四项结果。禁止 git commit（由总指挥统一提交）。
