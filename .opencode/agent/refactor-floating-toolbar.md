---
name: refactor-floating-toolbar
description: 重构 WeaveMD FloatingToolbar.tsx 及关联 kernel 导出/rafThrottle 工具，执行 RefactorFlow 计划 refactor-editor-main-ft 的 FloatingToolbar 相关原子单元（U2/U3/U6/U7/U8/U21），严格保持外部行为不变，每单元测试全绿后提交。
permission:
  bash: allow
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
---

# refactor-floating-toolbar — FloatingToolbar 重构执行智能体

## 任务来源

RefactorFlow 计划：`.opencode/workflows/refactorflow/refactor-editor-main-ft/refactor-plan.md`
需求文档：`.opencode/workflows/refactorflow/refactor-editor-main-ft/requirements.md`

## 职责范围（仅这些原子单元）

- U2：`kernel/syntaxType.ts` 的 `sameSyntaxType` 加 export（函数体不动），`FloatingToolbar.tsx` 删除本地副本改 import
- U3：`selectionSyntaxTypesConsistent` 简化（保留函数签名与 export 位置）
- U6：行内标记表统一 → `formatCtrl.ts` 的 `MARKERS` 加 export（本 agent 只加 export，不改 formatCtrl 其他），`FloatingToolbar.tsx` CHAR_BUTTONS activeTest 由 MARKERS 派生
- U7：`ToolbarButton` 子组件抽取（FloatingToolbar 模块内私有组件）
- U8：新建 `src/render/components/Editor/v2/rafThrottle.ts` 导出 `createRafThrottle`，`FloatingToolbar.tsx` 改用工厂
- U21：`kind:'fade'` → `kind:'delay-hide'`

## 硬约束（必须遵守）

- 只修改：`FloatingToolbar.tsx`、`kernel/syntaxType.ts`（仅加 export）、`kernel/selection.ts`（如涉及，仅加 export）、`formatCtrl.ts`（仅加 MARKERS export）、新建 `v2/rafThrottle.ts`。**不得修改**：EditorV2.tsx、blocks/、controllers 其余逻辑、controllers/index.ts、kernel 其余函数体。
- kernel 只允许"新增 export / 移动已有函数"，不改任何既有函数体。
- 行为严格不变：工具栏显隐、按钮 active 态、DOM 结构、事件时序不得变化。
- 不新增测试；以现有测试为回归基线。
- 每完成一个原子单元：跑定向测试 + 全量 `npm test` + `npm run typecheck` + 变更文件 `npx eslint`（不带 --fix），全绿后创建本地提交（英文 conventional message，不推送远程）。
- 不自创范围外改动。U8 的 rAF 工厂必须保持「已调度复用」与「flushNow 前置 cancel」语义。

## 执行顺序

U2 → U3 → U6 → U7 → U8 → U21（U3 依赖 U2 的导出）

## 验证命令

- 定向：`npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/editorV2StickyFormat.test.tsx tests/editor/kernel/syntaxType.test.ts tests/components/useCrossBlockDragSelection.test.ts`
- 全量：`npm test`
- 类型：`npm run typecheck`
- Lint：`npx eslint <变更文件>`（不带 --fix）
