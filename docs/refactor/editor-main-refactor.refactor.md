# REFACTOR-EDITOR-MAIN：编辑主区重构报告（浮动工具栏 + 插入图片）

> 档位：M（标准重构）| 日期：2026-08-12 | 状态：已完成（零行为变更）
> 需求：[REQ-EDITOR-MAIN-REFACTOR](../requirements/editor-main-refactor.req.md)
> 计划：[PLAN-EDITOR-MAIN-REFACTOR](../plan/editor-main-refactor.plan.md)
> 审查：git-diff-reviewer 无 Critical、无影响行为的 Warning（已处理可选清理项）

---

## 1. 前后对比

| 文件 | 重构前 | 重构后 | 说明 |
| ---- | ------ | ------ | ---- |
| `FloatingToolbar.tsx` | 882 行 God Component（文本工具栏+图片工具栏+纯函数+样式混杂） | 539 行（文本工具栏 + 弹层编排 + 图片工具栏挂载点） | 图片专属逻辑清空 |
| `ImageToolbar.tsx` | —（不存在） | 新增 ~320 行 | 图片工具栏子组件 |
| `toolbarState.ts` | —（不存在） | 新增 ~130 行 | 纯函数（无 React 依赖） |
| `ToolbarButton.tsx` | —（不存在） | 新增 ~60 行 | 共享按钮（消除重复） |
| `ImageEditTool.tsx` | 22 处内联 style | 1 处内联（position:fixed 动态锚定），其余 `.ie-*` 类 | 符合 CONVENTIONS「禁止内联 style」 |
| `globals.css` | — | 新增 `.ft-toolbar` / `.it-toolbar` / `.ie-*` / `.block-type-option--current` 等类 | 语义等价内联样式 |

## 2. 应用的重构模式

- **Extract Class**：`FloatingToolbar`（文本工具栏）→ 拆出 `ImageToolbar`（图片工具栏子组件）——消除 God Component。
- **Extract Method（模块级）**：纯函数 `computeToolbarState` / `selectionSyntaxTypesConsistent` / `syntaxTypeToOption` / `nearestContentSpan` → `toolbarState.ts`（无 React 依赖，可独立测试）。
- **消除重复（DRY）**：`ToolbarButton` 在两组件重复 → 提取共享组件 `ToolbarButton.tsx`。
- **Move Method（样式）**：内联 style → CSS 类（`.it-toolbar` / `.ie-*` / `.ft-toolbar`），对齐 CONVENTIONS「禁止内联 style」。
- **State 归属划分**：`anchorRect`/`editImage`/`editImagePrefill`/`editImagePosition` → ImageToolbar；`visible`/`position`/`selection`/`insertModal` → FloatingToolbar。

## 3. 关键决策与风险处理

| 决策 | 依据 |
| ---- | ---- |
| ImageToolbar 弹层态经 `onModalStateChange(open)` 上抛 | 风险 A：FloatingToolbar 的 `isModalOpen` 守卫需感知 ImageEditTool 开合，防止点击弹层内误关工具栏 |
| `ToolbarButton` active/hover 内联保留 | FloatingToolbarV2 测试断言 `style.color === 'var(--accent)'`，迁移为 CSS 类会破坏零断言修改 |
| `toolbarHeight` state（初始 40 fallback） | 修复 E7 回归：ImageToolbar 首次挂载 ref=null 用 fallback 40，滚动后 ref 绑定用实际高度 36 → before/after 锚定偏移 4px。state 在真实浏览器读实际高度、jsdom（offsetHeight=0）保持 fallback，兼容 ImageToolbarV2 锚定断言 |

## 4. 每步测试结果

| 步骤 | 内容 | 验证命令 | 结果 |
| ---- | ---- | -------- | ---- |
| Step 0 | 基线 | `npx vitest run` + typecheck | 41 文件 / 724 全绿 |
| Step 1 | 提取纯函数 toolbarState.ts | vitest FloatingToolbarV2 + tsc | 47 通过 + 0 错 |
| Step 2 | 提取 ImageToolbar 组件 | vitest ImageToolbarV2 + FloatingToolbarV2 + tsc | 59 通过 + 0 错 |
| Step 3-4 | 图片侧样式 → CSS 类 | vitest ImageToolbarV2 + ImageEditTool + lint | 33 通过 + 0 error |
| Step 5-6 | 文本侧样式 + 共享 ToolbarButton + 清理 | vitest 全量 + tsc + lint + vite build | 724 全绿 + 0 错 + 0 error + build 通过 |
| 审查修复 | 简化恒真分支 + unmount cleanup | vitest 3 文件 80 通过 | ✓ |
| E7 回归修复 | `toolbarHeight` state | vitest ImageToolbarV2(59) + E7 | 59 单测 + E7 通过 |

## 5. 行为验证

- **全量门禁**：vitest **41 文件 / 724 测试全绿**（与基线一致，断言零修改）、tsc 0 错、eslint 0 error（8 warnings 既有）、vite build 编译通过。
- **E2E**：56 通过 / 5 失败。5 个失败均为 `drag-selection-markers.spec.ts` 的**既有已知 RED**（FT4 复现阶段，测试头标注"预期当前 RED"，已用 stash 验证重构前同样失败）。
- **E2E 回归修复**：LINK-IMAGE-E7（Bug B 滚动重锚定）在重构后短暂失败（ImageToolbar 首次挂载 ref=null 用 fallback 40 导致 before/after 锚定偏移 4px），已通过 `toolbarHeight` state 修复并复验通过。
- **DOM 契约**：`.floating-toolbar-v2` / `.block-type-*` / `.ft-divider` / `[data-testid="image-toolbar"]` / `[data-testid="image-edit-tool"]` 等全部保留；`syntaxTypeToOption` / `selectionSyntaxTypesConsistent` 经 re-export 保持从 FloatingToolbar 可导入（FloatingToolbarV2 测试零改动）。

## 6. 剩余风险与遗留

| 项 | 说明 |
| ---- | ---- |
| `npm run build` 的 electron-builder 阶段 | 被运行中 Electron 进程持有的 `better_sqlite3.node` 文件锁阻塞（EBUSY/EPERM）。**环境阻塞，非代码问题**（重构仅涉及 render 层 + CSS，不涉 main 进程 SQLite 代码）。需关闭占用进程后重跑 `npm run build` 完成打包验证 |
| `drag-selection-markers` 5 个既有 RED | 本次重构**不处理**（FT4 Phase 0 复现测试，注释明确"当前 RED 本阶段只写复现"），列为此前已知技术债 |
