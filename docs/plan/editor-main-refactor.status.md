# STATUS: editor-main-refactor（编辑主区重构）

> 档位：M（标准重构）| 分类：重构（零行为变更）| 日期：2026-08-12 | **状态：已完成**

## 阶段 0：分级 ✅

- 分类：重构；跨模块：渲染层 4 组件 + globals.css（不涉数据/API/权限/内核）
- 定档 **M**：1~3 功能模块，完整阶段，跳过强制技术调研

## 阶段 1：需求对齐 ✅

- 决策点（用户确认）：① 拆 ImageToolbar + toolbarState 纯函数分离；② 内联样式提取 CSS 类；③ 范围含 InsertUrlModal
- 需求文档：`docs/requirements/editor-main-refactor.req.md`

## 基线（阶段 0 记录）✅

- vitest 41 文件 / **724** 全绿；tsc 0 错；eslint 0 error / 8 warnings（既有）

## 阶段 2：规划 ✅

- 计划：`docs/plan/editor-main-refactor.plan.md`（Plan 智能体产出，7 步执行顺序）

## 阶段 4：重构 ✅

- 交付：FloatingToolbar 882→539 行；新增 ImageToolbar.tsx / toolbarState.ts / ToolbarButton.tsx；ImageEditTool 22 处内联→.ie-* 类；globals.css 新增工具类
- 报告：`docs/refactor/editor-main-refactor.refactor.md`

## 阶段 5：代码审查 ✅

- git-diff-reviewer：无 Critical、无影响行为 Warning；已处理可选清理（恒真分支简化、unmount cleanup）

## 阶段 6：全量测试 ✅（除 build 环境锁）

| 门禁 | 结果 |
| ---- | ---- |
| vitest | **41 文件 / 724 测试全绿**（断言零修改） |
| tsc | 0 错误 |
| eslint | 0 error / 8 warnings（既有） |
| vite build | 编译通过（render/main/preload） |
| E2E | 56 通过 / 5 失败（5 个 drag-selection-markers 为既有已知 RED，stash 已验证重构前同样失败） |
| npm run build（electron-builder） | **环境阻塞**：运行中 Electron 进程锁定 better_sqlite3.node（EBUSY/EPERM），与代码无关 |

- **回归修复**：LINK-IMAGE-E7（Bug B 滚动重锚定）重构后曾失败（ImageToolbar 首次挂载 ref=null 用 fallback 40 vs 实际 36 → 4px 锚定偏移），经 `toolbarHeight` state 修复并复验通过。

## 阶段 7：合规核对 ✅

- CONVENTIONS：命名 PascalCase/camelCase ✓；内联 style 已大部分提取（剩余 ToolbarButton active 色 + ImageEditTool position 为有意保留）✓；无 any ✓
- SECURITY：不涉安全变更 ✓
- 文档：重构报告 + status 已更新；需求/计划/状态三件套齐全 ✓

## 阶段 8：交付（见交付核对）✅

## 遗留

1. `npm run build` electron-builder：需用户关闭占用 better_sqlite3.node 的进程后重跑（环境性，非代码）
2. `drag-selection-markers` 5 个既有 RED：本次重构不处理（FT4 复现测试，注释明确"当前 RED"）
