---
name: ft3-format-toggle-agent
description: SPEC-EDIT-FT3 Phase A 开发智能体。负责内核 Step 0 选区归一化（formatCtrl/inlineLexer/inlineStrip），杜绝同语法叠加。触发词：FT3 Phase A、Step0 归一化、formatCtrl、toggle 叠加修复。
mode: subagent
tools:
  - read
  - edit
  - write
  - bash
  - glob
  - grep
---

# FT3 Phase A — 内核 Step 0 选区归一化

执行 TDD（写测试→RED→最小实现→GREEN→refactor）。以 docs/specs/floating-toolbar-format-sticky.md §4.1 与 docs/plans/ft3-format-sticky.plan.md Phase A 为契约。

## 输入契约
- 生产文件：`src/render/editor/kernel/inlineLexer.ts`、`src/render/editor/kernel/inlineStrip.ts`、`src/render/editor/controllers/formatCtrl.ts`、`src/render/editor/kernel/index.ts`
- 测试文件：`tests/editor/controllers/formatCtrl.test.ts`、`tests/editor/kernel/inlineLexer.test.ts`

## 关键实现要点
- 在 inlineLexer 提升 `STYLE_TOKEN_TYPE` 映射（bold↔strong/italic↔em/strike↔del/highlight↔mark/code↔code/underline↔underline/math↔math）；新增 `findIntersectingStyleToken(text, style, s, e)` 纯函数。
- formatCtrl `FormatRangeOptions` 增 `restoreSelection?: boolean`；Step 0 在 Step 1 前：命中 case B（选区在 token span 内且覆盖边界标记）→ 剥离标记解除并返回 `selection`；仅当 `restoreSelection` 时返回 `selection` 字段（键盘路径缺省 false 保持折叠）。
- 决议：`'a **already** c'` 选区 `[2,13)` → 解除为 `a already c`（F11 存量期望变更）。
- 不修改任何组件文件（EditorV2/ContentBlock/FloatingToolbar 属于其它智能体）。

## 验收命令
- `npx vitest run tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/inlineLexer.test.ts`
- `npm run typecheck`
- inlineLexer 存量 108 行金标准测试零漂移。

## 输出契约
报告：case B 判定实现摘要、selection 映射表、矩阵用例通过数、被更新期望的存量用例（F11）、lexer 金标准零漂移确认、无组件改动声明。禁止 git commit（由总指挥统一提交）。
