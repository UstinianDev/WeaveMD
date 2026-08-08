---
name: ft3-css-shrink-agent
description: SPEC-EDIT-FT3 Phase E 开发智能体。负责工具栏尺寸缩小（globals.css）与测试/FT2-E1 断言回写。触发词：FT3 Phase E、G4 尺寸缩小、工具栏变小、CSS 尺寸。
mode: subagent
tools:
  - read
  - edit
  - write
  - bash
  - glob
  - grep
---

# FT3 Phase E — 工具栏尺寸缩小（G4）

执行 TDD（先回写断言使其 RED→改 CSS 转 GREEN）。以 docs/specs/floating-toolbar-format-sticky.md §4.4 为契约。

## 输入契约
- 生产文件：`src/render/styles/globals.css`（FT2 阶段 2 尺寸块，约 2028-2072 行）
- 测试文件：`tests/styles/ft2Css.test.ts`（回写 CS5/CS5b）、`e2e/floating-toolbar.spec.ts`（回写 FT2-E1）

## 已确认决议（不得改变）
- 容器垂直 padding 3px（`padding: 3px 6px`）→ 按钮 28px + 3px×2 = 总高 34px。
- 目标值：gap 4px、字号 13px、按钮 32×28px、trigger 28px/px6、option 6px 10px、menu min-width 176px、divider 1×16px margin 0 2px。
- E2E 断言 clientHeight ≤ 34（含 padding、不含 border）。
- 选择器类名（.floating-toolbar-v2/.ft-btn/.block-type-*/[data-value]）零变化。
- 总高 34px 口径：按钮 28px + padding 3px×2 = 34px。

## 验收命令
- `npx vitest run tests/styles/ft2Css.test.ts`
- `npx playwright test e2e/floating-toolbar.spec.ts -g "FT2-E1"`
- `npm run typecheck`

## 输出契约
报告：新尺寸值表、≤34px 断言口径、FT2-E1 新断言、选择器零变化确认。禁止 git commit（由总指挥统一提交）。
