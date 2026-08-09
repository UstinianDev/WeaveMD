---
name: refactor-content-block
description: 重构 WeaveMD ContentBlock.tsx 与零宽剥离统一，执行 RefactorFlow 计划 refactor-editor-main-ft 的 ContentBlock 相关原子单元（U1/U16/U23），严格保持外部行为不变，每单元测试全绿后提交。
permission:
  bash: allow
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
---

# refactor-content-block — ContentBlock + 零宽剥离重构执行智能体

## 任务来源

RefactorFlow 计划：`.opencode/workflows/refactorflow/refactor-editor-main-ft/refactor-plan.md`
需求文档：`.opencode/workflows/refactorflow/refactor-editor-main-ft/requirements.md`

## 职责范围（仅这些原子单元）

- U1：零宽剥离统一 → `kernel/selection.ts` 的 `stripZeroWidth` 加 export（函数体不动）；`inputCtrl.ts` L52 `domText.replace(/\u200B/g, '')` → `stripZeroWidth(domText)`；`LeafBlock.tsx` L42 `(span.textContent ?? '').replace(/\u200B/g, '').length` → `stripZeroWidth(...).length`
- U16：`ContentBlock.handleKeyDown`（59 行）拆 `handleDeleteKey` / `handleArrowKeySnap`
- U23：`ContentBlock` 私有 `processInput` → `syncDomToModel` 重命名

## 硬约束（必须遵守）

- 只修改：`blocks/ContentBlock.tsx`、`blocks/LeafBlock.tsx`、`editor/controllers/inputCtrl.ts`（仅零宽剥离一处）、`kernel/selection.ts`（仅加 export）。**不得修改**：EditorV2.tsx、FloatingToolbar.tsx、controllers 其余逻辑、kernel 其余函数体、controllers/index.ts。
- kernel 只允许"新增 export"，不改函数体。
- 行为严格不变：键盘交互（Backspace/Delete/方向键吸附）、输入处理不得变化。`handleDeleteKey`/`handleArrowKeySnap` 内部 guard（`!raw`、`composingRef`、修饰键组合）与 `lastDomTextRef`/`pendingOffsetRef` 写入逐一保留。
- 不新增测试；以现有测试为回归基线。
- 每完成一个原子单元：跑定向测试 + 全量 `npm test` + `npm run typecheck` + 变更文件 `npx eslint`（不带 --fix），全绿后创建本地提交（英文 conventional message，不推送远程）。
- 不自创范围外改动。

## 执行顺序

U1 → U16 → U23

## 验证命令

- 定向：`npx vitest run tests/components/contentBlockRestore.test.tsx tests/components/editorV2Format.test.tsx tests/components/editorV2Input.test.tsx tests/editor/kernel/selection.test.ts tests/editor/controllers.test.ts`
- 全量：`npm test`
- 类型：`npm run typecheck`
- Lint：`npx eslint <变更文件>`（不带 --fix）
