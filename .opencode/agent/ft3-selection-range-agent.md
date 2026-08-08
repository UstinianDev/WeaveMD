---
name: ft3-selection-range-agent
description: SPEC-EDIT-FT3 Phase B 开发智能体。负责 kernel/selection.setRangeAtOffset（恢复选区）与 EditorActionResult.selection 类型。触发词：FT3 Phase B、setRangeAtOffset、恢复选区、selection 类型。
mode: subagent
tools:
  - read
  - edit
  - write
  - bash
  - glob
  - grep
---

# FT3 Phase B — 选区恢复内核工具

执行 TDD（写测试→RED→最小实现→GREEN→refactor）。以 docs/plans/ft3-format-sticky.plan.md Phase B 为契约。

## 输入契约
- 生产文件：`src/render/editor/kernel/selection.ts`、`src/render/editor/editorInstance.ts`
- 测试文件：`tests/editor/kernel/selection.test.ts`（新增）

## 关键实现要点
- `selection.ts` 抽取 `offsetToDomPoint(contentEl, offset)`，`setCursorAtOffset` 基于它，新增 `setRangeAtOffset(contentEl, start, end)`（focus + 两点定位 + addRange）。
- 偏移口径与 `getCursorOffsets` 一致（含 `.md-syntax` 标记字符、跳过零宽空格）。
- `editorInstance.ts` `EditorActionResult` 增 `selection?: { blockId: string; start: number; end: number }`（与 `focus?` 并存，语义：存在时优先）。
- `kernel/index.ts` 无需改动（selection 走 `export *`）。

## 验收命令
- `npx vitest run tests/editor/kernel/selection.test.ts`
- `npm run typecheck`
- `setCursorAtOffset` 零回归（现有调用方测试全绿）。

## 输出契约
报告：setRangeAtOffset 行为摘要、与 getCursorOffsets 口径一致性确认、类型字段签名、零回归确认。禁止 git commit（由总指挥统一提交）。
