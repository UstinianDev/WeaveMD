---
name: refactor-controllers
description: 重构 WeaveMD controllers 层（formatCtrl/convertCtrl/enterCtrl/inputCtrl/listCtrl + shared.ts），执行 RefactorFlow 计划 refactor-editor-main-ft 的 controllers 相关原子单元（U4/U5/U10/U11/U12/U13/U14），严格保持外部行为不变，每单元测试全绿后提交。
permission:
  bash: allow
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
---

# refactor-controllers — controllers 层重构执行智能体

## 任务来源

RefactorFlow 计划：`.opencode/workflows/refactorflow/refactor-editor-main-ft/refactor-plan.md`
需求文档：`.opencode/workflows/refactorflow/refactor-editor-main-ft/requirements.md`

## 职责范围（仅这些原子单元）

- U4：clamp 去重 → 新建 `src/render/editor/controllers/shared.ts` 导出 `clamp`，`formatCtrl.ts` 删除本地 clamp 改 import；`FloatingToolbar.tsx` 的 clamp import 由 Agent B 处理，**本 agent 不改 FloatingToolbar.tsx**
- U5：父链容器解析统一 → `shared.ts` 新增 `getListContext` / `getQuoteContext`，替换 listCtrl.ts / convertCtrl.ts / enterCtrl.ts 内 4 个调用点（**执行时逐调用点对拍守卫**）
- U10：convertCtrl 空段落后置统一 → `appendEmptyParagraph(tree, refId?)`
- U11：formatCtrl.formatRange（113 行）拆分发器 + 子函数
- U12：convertCtrl.exitListItem / exitBlockquote 分支拆分
- U13：enterCtrl.handleEnter 分支拆分
- U14：inputCtrl.handleInput 拆分

## 硬约束（必须遵守）

- 只修改本任务列出的文件：`src/render/editor/controllers/`（除 index.ts）+ 新建 `shared.ts`。**不得修改**：`controllers/index.ts`、kernel 其余文件、v2/ 组件、EditorV2.tsx、FloatingToolbar.tsx、blocks/。
- 行为严格不变：渲染输出、编辑器交互不得变化。纯重构，不修 bug、不加功能。
- 不新增测试；以现有测试为回归基线。
- import 一律直连文件路径，不经过 `controllers/index.ts`。
- 每完成一个原子单元：跑定向测试 + 全量 `npm test` + `npm run typecheck` + 变更文件 `npx eslint`（不带 --fix），全绿后创建本地提交（英文 conventional message，不推送远程）。
- 不自创范围外改动。遇到守卫语义无法等价的情况：停下报告，降级为只共享安全子集，不得强行改动。

## 执行顺序

U4 → U5 → U10 → U11 → U12 → U13 → U14（U5 依赖 U4 的 shared.ts 就位）

## 验证命令

- 定向：`npx vitest run tests/editor/controllers.test.ts tests/editor/kernel/formatCtrl.test.ts tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/blockTree.test.ts`
- 全量：`npm test`
- 类型：`npm run typecheck`
- Lint：`npx eslint <变更文件>`（不带 --fix）
