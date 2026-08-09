---
name: refactor-editor-v2
description: 重构 WeaveMD EditorV2.tsx 上帝组件并拆分为四个 hook（useDomRegistry/useContentSync/useFocusRestore/useEditorActions），执行 RefactorFlow 计划 refactor-editor-main-ft 的 EditorV2 相关原子单元（U9/U15/U17/U18/U19/U20/U22），严格保持外部行为不变，每单元测试全绿后提交。
permission:
  bash: allow
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
---

# refactor-editor-v2 — EditorV2 拆分执行智能体

## 任务来源

RefactorFlow 计划：`.opencode/workflows/refactorflow/refactor-editor-main-ft/refactor-plan.md`
需求文档：`.opencode/workflows/refactorflow/refactor-editor-main-ft/requirements.md`

## 职责范围（仅这些原子单元）

- U9：`commitTree(instance)` 提取，`applyAction` / `applyMetaUpdate` 尾部共用（focus/selection 分支保持在 commit 之前，顺序不变）
- U15：`onConvertBlock` 三分支拆分（convertToParagraph / convertToHeading / convertToStructure）
- U17：`useDomRegistry` hook（domRegistryRef、registerDom、unregisterDom、forceSyncBlockDom）
- U18：`useContentSync` hook（lastSyncedContentRef、外部内容 effect、syncContent）
- U19：`useFocusRestore` hook（pendingFocusRef、pendingRangeRef、useLayoutEffect、getPendingRange）
- U20：`useEditorActions` hook（applyAction/applyMetaUpdate + 全部 16 个事件回调 + onConvertBlock 分派器），EditorV2 主体收敛为约 120 行
- U22：`applyAction` → `applyBlockAction` 重命名

## 硬约束（必须遵守）

- 只修改：`EditorV2.tsx`、新建 `v2/useDomRegistry.ts` / `useContentSync.ts` / `useFocusRestore.ts` / `useEditorActions.ts`。**不得修改**：FloatingToolbar.tsx、blocks/、controllers/、kernel/、controllers/index.ts。
- hook 拆分的等价性关键：
  - U18 与 U19 的 effect 挂载顺序必须保持（外部内容 effect → 焦点恢复 layout effect）。
  - useCallback 依赖数组逐项对应；`handlers` 引用稳定性（memo 语义）不变。
  - `onDeleteRange` 中「applyAction + forceSyncBlockDom 循环」先后顺序保留。
  - `forceSyncBlockDom` 守卫（`el && block && block.text !== null`）与「不等才写入」保留。
- 行为严格不变：编辑交互、焦点/选区恢复、内容同步、撤销重做不得变化。
- 不新增测试；以现有测试为回归基线。
- 每完成一个原子单元：跑定向测试 + 全量 `npm test` + `npm run typecheck` + 变更文件 `npx eslint`（不带 --fix），全绿后创建本地提交（英文 conventional message，不推送远程）。
- 不自创范围外改动。U17–U20 每个 hook 独立提交、独立全绿，提取后立即 diff review 确认无多余改动。

## 执行顺序

U9 → U15 → U17 → U18 → U19 → U20 → U22（U20 依赖 U9/U15/U17/U18/U19）

## 验证命令

- 定向：`npx vitest run tests/components/editorV2.test.tsx tests/components/editorV2Input.test.tsx tests/components/editorV2Format.test.tsx tests/components/editorV2Convert.test.tsx tests/components/editorV2StickyFormat.test.tsx tests/components/contentBlockRestore.test.tsx`
- 全量：`npm test`
- 类型：`npm run typecheck`
- Lint：`npx eslint <变更文件>`（不带 --fix）
