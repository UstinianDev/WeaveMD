---
name: ft3-toolbar-wiring-agent
description: SPEC-EDIT-FT3 Phase C+D 开发智能体。负责恢复选区接线（EditorV2/ContentBlock/types）与工具栏驻留（FloatingToolbar）。触发词：FT3 Phase C、FT3 Phase D、工具栏驻留、恢复选区接线、sticky。
mode: subagent
tools:
  - read
  - edit
  - write
  - bash
  - glob
  - grep
---

# FT3 Phase C+D — 恢复选区接线 + 工具栏驻留

执行 TDD（写测试→RED→最小实现→GREEN→refactor）。以 docs/plans/ft3-format-sticky.plan.md Phase C、Phase D 为契约。依赖 Phase A/B 已合入（formatRange 返回 selection、setRangeAtOffset 已存在）。

## 输入契约
- 生产文件：`src/render/components/Editor/v2/types.ts`、`src/render/components/Editor/v2/EditorV2.tsx`、`src/render/components/Editor/v2/blocks/ContentBlock.tsx`、`src/render/components/Editor/v2/FloatingToolbar.tsx`
- 测试文件：`tests/components/contentBlockRestore.test.tsx`（新增）、`tests/components/floatingToolbarV2.test.tsx`（扩展）、`tests/components/editorV2StickyFormat.test.tsx`（新增）

## 关键实现要点
- types.ts：`BlockHandlers.onFormat`/`onClearFormat` 增第 6 参 `restoreSelection?: boolean`；新增 `getPendingRange?: () => { start: number; end: number } | null`。
- EditorV2：`pendingRangeRef`；`applyAction` 检测 `result.selection` → 立即或 pending 恢复选区；onFormat/onClearFormat 透传 `restoreSelection`；handlers 增 getPendingRange。
- ContentBlock：props 增 `getPendingRange?`，在无依赖 useLayoutEffect 中消费恢复选区（LeafBlock 已 `{...handlers}` 展开，无需穿透）。
- FloatingToolbar：handleFormat/handleClearFormat 移除强隐、置 sticky、传 restoreSelection=true；handleBlockChange 维持退出；新增 stickyRef/suppressSelectionRef + document mousedown(capture)/keydown(Escape) 监听 + flushSelection 顶部 suppress 消费。
- 非 sticky 的普通选中「跟随」行为不变；点击工具栏外/滚动/Escape/键入退出。

## 验收命令
- `npx vitest run tests/components/contentBlockRestore.test.tsx tests/components/floatingToolbarV2.test.tsx tests/components/editorV2StickyFormat.test.tsx tests/components/editorV2Format.test.tsx`
- `npm run typecheck`
- `npx eslint src/render/components/Editor/v2/FloatingToolbar.tsx src/render/components/Editor/v2/EditorV2.tsx src/render/components/Editor/v2/blocks/ContentBlock.tsx src/render/components/Editor/v2/types.ts`

## 输出契约
报告：强隐移除点清单、sticky 状态机（置位/清理点）、监听与清理、suppress 竞态说明、集成用例证据（加粗→驻留→active→点击空白退出）。禁止 git commit（由总指挥统一提交）。
