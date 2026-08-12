# REQ-EDITOR-MAIN-REFACTOR：编辑主区重构（浮动工具栏 + 插入图片）

> 状态：已对齐 | 版本：v1.0 | 日期：2026-08-12
> 档位：**M（标准重构）** | 分类：重构（纯重构，零行为变更）
> 硬约束：**不改变当前现有功能**；验收以重构前后全量门禁一致为准。
> 关联规范：[SPEC-EDIT-FT](./floating-toolbar-refactor.md)、[SPEC-EDITOR-V2](./editor-v2-architecture.md)、
> [SPEC-REFACTOR-EDITOR](./editor-refactor-technical-debt.md)、CONVENTIONS.md（禁止内联 style）

---

## 1. 背景与目标

编辑主区 v2 已稳定交付（六条退出规则、浮动工具栏、跨块拖选、图片 K1~K7 等）。
进入质量维护期后，渲染层存在三处结构性坏味道，影响可读性与可测试性：

| # | 坏味道 | 位置 | 影响 |
| - | ------ | ---- | ---- |
| 1 | **God Component**：一个组件同时承载文本工具栏、图片工具栏、块类型下拉、两个弹层、4 类 DOM 事件监听、20+ 个 state/ref/callback | `FloatingToolbar.tsx`（882 行） | 职责混杂，单文件过大，新增功能/修 bug 需理解全部状态机 |
| 2 | **图片专属逻辑散落在文本工具栏组件内**：anchorRect 滚动重锚定、handleEditImage、editImagePrefill、handleInsertImageClick 等约 200 行图片逻辑与文本格式逻辑耦合 | `FloatingToolbar.tsx` | 图片功能无法独立测试/复用；文本工具栏逻辑被图片分支污染 |
| 3 | **大量内联 style 违反 CONVENTIONS.md「禁止内联 style」** | `ImageEditTool.tsx`（22 处）、`FloatingToolbar.tsx`（11 处） | 样式与逻辑混杂，无法走 CSS 变量/类复用，暗色主题维护成本高 |

**本次只做结构重构，不改变**：块树数据模型、Markdown 双向转换、七类交互控制器、
图片/格式内核函数（formatCtrl/imageBlock）、撤销重做、自动保存、查找替换、大纲导航
等既有能力。**不新增任何功能、不改任何外部行为**。

---

## 2. 范围

### 2.1 在范围内（渲染层 UI 组织）

| 文件 | 改动 | 风险 |
| ---- | ---- | ---- |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | ① 提取图片工具栏为独立子组件 `ImageToolbar.tsx`；② 提取纯函数 `computeToolbarState` 及判定逻辑到 `toolbarState.ts`；③ 内联样式 11 处提取为 CSS 类；④ 保留 `syntaxTypeToOption` / `selectionSyntaxTypesConsistent` re-export 维持测试兼容 | 中 |
| `src/render/components/Editor/v2/ImageToolbar.tsx`（**新增**） | 图片工具栏子组件：anchorRect 重锚定、修改/内联/对齐/移除、滚动跟随；**保留全部 data-testid 与 CSS 类名** | 中 |
| `src/render/components/Editor/v2/toolbarState.ts`（**新增**） | `computeToolbarState`、`ToolbarState` 类型、`SelectionState` 等纯函数/类型（无 React 依赖） | 低 |
| `src/render/components/Editor/v2/ImageEditTool.tsx` | 内联样式 22 处提取为 CSS 类（`.ie-*` 前缀），结构不变 | 低 |
| `src/render/components/Editor/v2/InsertUrlModal.tsx` | 已用 CSS 类；仅做结构清理（如无重复则不动） | 低 |
| `src/render/components/Editor/v2/EditorV2.tsx` | 接线调整（FloatingToolbar 拆分后 prop 透传保持） | 低 |
| `src/render/styles/globals.css` | 新增 ImageToolbar / ImageEditTool 工具类（语义等价内联样式） | 低 |

### 2.2 不在范围内

- 内核：`kernel/`（blockTree/markdownToState/stateToMarkdown/inlineRenderer/syntaxType/imageBlock 等）
- 控制器：`controllers/`（formatCtrl/convertCtrl/enterCtrl 等）
- 行为修正：不改任何判定逻辑、触发规则、焦点恢复、DOM 结构
- 数据/API/权限/迁移：不涉及

---

## 3. 关键决策点（已与用户确认）

| # | 决策 | 选择 |
| - | ---- | ---- |
| 1 | FloatingToolbar 拆分方案 | **拆 ImageToolbar 独立组件 + 纯函数分离到 toolbarState.ts**；文本工具栏保留在 FloatingToolbar |
| 2 | 内联样式处理 | **提取为 CSS 类**（globals.css），保证视觉零变化 |
| 3 | 范围是否含 InsertUrlModal | **包含**（结构清理；其样式已合规） |

---

## 4. 拆分设计

```
src/render/components/Editor/v2/
├─ FloatingToolbar.tsx   ← 文本工具栏 + 弹层编排 + 图片工具栏挂载点（拆分后 ~300 行）
├─ ImageToolbar.tsx      ← 图片工具栏子组件（新文件）
├─ toolbarState.ts       ← 纯函数：computeToolbarState / ToolbarState / SelectionState（新文件）
├─ ImageEditTool.tsx     ← 图片编辑弹层（内联样式 → CSS 类）
├─ InsertUrlModal.tsx    ← 链接弹层（结构清理）
└─ types.ts              ← 类型/常量（不动，测试依赖其导出）
```

### 4.1 ImageToolbar 组件边界

从 FloatingToolbar 迁出的图片专属逻辑：
- `anchorRect` 状态 + 同步 effect + 滚动重锚定（scroll 事件中的图片跟随分支）
- `handleEditImage` / `handleEditConfirm` / `handleEditCancel`
- `editImagePrefill`（tokenizeInline 预填）
- `editImagePosition`（弹层锚定）
- 图片工具栏 JSX（6 按钮 + divider + ImageEditTool 挂载点）
- 图片点击外部关闭 / Escape 关闭的 guard 分支

保持不变的接口：`ImageSelection` 类型、全部 `data-testid`、`.floating-toolbar-v2` 类名、
`onCloseImage` 回调、`window.weaveMD?.dialog.pickImage` 透传。

### 4.2 FloatingToolbar 保留职责

- 文本选区监听（selectionchange / scroll / mousedown / keydown）
- 文本工具栏 JSX（块类型下拉 + 字符按钮 + 对象按钮 + 橡皮擦 + 解链）
- InsertUrlModal 挂载 + ImageToolbar 挂载
- 纯函数 re-export（`syntaxTypeToOption` / `selectionSyntaxTypesConsistent`）

### 4.3 兼容性保证（测试/e2e 零改动目标）

| 依赖方 | 依赖项 | 保持方式 |
| ------ | ------ | -------- |
| `FloatingToolbarV2.test.tsx` | `syntaxTypeToOption` / `selectionSyntaxTypesConsistent` 从 FloatingToolbar 导入 | FloatingToolbar `export { ... } from './toolbarState'` re-export |
| `FloatingToolbarV2.test.tsx` / `ImageToolbarV2.test.tsx` | `BLOCK_TYPE_OPTIONS` / `canConvertBlock` / `BlockTypeOption` / `ImageSelection` 从 types 导入 | types.ts 不动 |
| `ImageToolbarV2.test.tsx` | default FloatingToolbar 渲染图片工具栏 | FloatingToolbar 保持挂载 ImageToolbar 且行为一致 |
| `e2e/floating-toolbar.spec.ts` | `.floating-toolbar-v2` / `.block-type-trigger` / `.block-type-menu` / `[data-value]` / `[data-testid="image-toolbar"]` / `[data-testid="image-edit-tool"]` | 全部保留 |

> 若 re-export 不便，可更新测试导入路径（断言不变，仅改来源），由重构执行时按实际决定。

---

## 5. 验收标准

1. **行为不变**：重构前后所有测试全绿且断言零修改（除必要时测试导入路径）。
2. **门禁**：`npx vitest run`（基线 41 文件 / 724 测试）全绿、`tsc --noEmit` 0 错误、
   `eslint` 0 error（允许既有 8 warnings）、`vite build` 通过、`npx playwright test`（E2E）全绿。
3. **DOM 契约不变**：CSS 类名、data-testid、块类型下拉选择器不变。
4. **导出兼容**：`syntaxTypeToOption` / `selectionSyntaxTypesConsistent` 仍可从 FloatingToolbar 导入。
5. **无死代码**：拆分后无未使用的 state/ref/callback/函数残留。

---

## 6. 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| ImageToolbar 拆分后状态归属错误导致图片工具栏行为变化 | 先建测试基线（ImageToolbarV2 410 行 + e2e image 用例），拆分后同目标复跑；任何断言变化即回退该步 |
| 内联样式 → CSS 类出现视觉差异 | CSS 类逐条对照内联样式语义等价；e2e 视觉断言守护 |
| 事件监听移动导致 selectionchange 竞争回归 | 事件监听逻辑保持原顺序/原语义，仅变更所属组件归属 |
| 回退 | 改动集中于 v2 渲染层 4 个组件 + globals.css，可整体 revert |

---

## 7. 已对齐问题清单（阶段 1 输出）

- [x] 拆分方案（ImageToolbar + toolbarState + FloatingToolbar 文本工具栏）
- [x] 内联样式提取为 CSS 类
- [x] 范围含 InsertUrlModal
- [x] 兼容性策略（测试/e2e 零改动）
- [ ] 规划（阶段 2 产出实施计划后回填）
