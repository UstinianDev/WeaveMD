# Markdown 块语法退出边界规范（Block Exit Rules）

> 规范编号：SPEC-EDIT-EXIT | 版本：v1.0 | 状态：已实现（含测试）| 更新：2026-08-05
> 关联需求：REQUIREMENTS.md EDIT-11（结构转换）、EDIT-06（段落操作）
> 关联模块：docs/modules/04-编辑主区-Editor.md

---

## 1. 功能概述

本规范定义六种 Markdown 块语法在编辑器中"退出语法、变回正文（paragraph）"的边界条件。
目标是让用户能够以自然、可预测的键盘操作从结构化块回到普通段落，且不丢失已有内容：

| 语法形态（输入）           | 渲染形态（Normal Mode）                  | 退出条件（变回正文）                        |
| -------------------------- | ---------------------------------------- | ------------------------------------------- |
| `#` ×n + 空格 + 内容       | 标题文本（无可见 `#`）                   | 删除 `#` 与内容之间的空格（`#` 紧贴内容）   |
| `-`/`*`/`+` + 空格 + 内容  | `•` 圆点 + 内容（圆点不可选中）          | 光标在内容开头按 Backspace；空块按 Enter    |
| 数字 `.` + 空格 + 内容     | `数字.` + 内容（数字不可选中）           | 光标在内容开头按 Backspace；空块按 Enter    |
| `- [ ]` + 空格 + 内容      | `⭕` 复选框 + 内容（复选框不可选中）     | 光标在内容开头按 Backspace；空块按 Enter    |
| ` ``` ` + 语言              | 代码块卡片（textarea 输入区）            | 输入区无内容时按 Backspace                  |
| `>` + 空格 + 内容           | 左侧绿色竖线 + 内容（竖线不可选中）      | 无内容时按 Backspace 或 Enter               |

## 2. 两阶段模型

块语法从输入到提交经历两个阶段，退出条件在不同阶段语义不同：

### 2.1 阶段一：pending 灰化（未提交）

用户输入前缀（如 `# `）但尚未按 Enter 时，前缀通过 `.md-prefix-gray` 直接包裹为灰色样式，
块类型仍为 paragraph，仅记录 `pendingTypeChange`。此阶段**任意删除前缀字符**（`#`、`-`、
`1.`、`- [ ]`、` ``` `、`>` 或分隔空格）都会使前缀检测失败，自动清除 pending 并变回正文，
剩余字符原样保留（例如 `#内容` 即普通文本）。

实现位置：`EditorView.handleBlockInput` 的 `hadPending && !hasPrefix` 分支。

### 2.2 阶段二：已提交渲染

Enter（或工具栏）提交后，块类型变为 heading / list / blockquote / code-fence，DOM 中
语法符号被隐藏（标题无 `#`、列表显示装饰符号、引用显示竖线）。此阶段退出依赖
Backspace / Enter 等显式操作，规则见第 3 节。

## 3. 各类型退出规则（已提交阶段）

### 3.1 标题（heading）

- **渲染**：`#` 前缀被剥离，仅显示内容；字号按 headingLevel 分级。
- **退出条件 A（pending 阶段）**：删除 `#` 与内容之间的空格，使 `#` 紧贴内容，
  `detectMarkdownLine` 返回 null → 清除 pending，块保持为正文。
- **退出条件 B（已提交）**：光标位于标题内容开头按 Backspace → 转换为正文，
  光标保持在开头，内容不变；再次 Backspace 则按正文规则删除。
- **空标题块**：Backspace / Enter 均先撤销标题语法（变空正文块），不删除块本身。
- **退格链（2026-08-06）**：删光标题内容后继续 Backspace：首次撤销标题语法（变空正文块，
  焦点保持在新段落）；再次 Backspace 合并进上一行（光标跳回上一行内容末尾）。

### 3.2 无序列表（unordered-list-item）

- **渲染**：`•` 圆点为装饰 span（`select-none`），不可选中、不可编辑。
- **退出条件**：光标位于 `span.block-content` 内容起点（忽略装饰与零宽空格）按 Backspace
  → 转换为正文，`- ` 前缀消失，内容不变，光标保持在开头。
- **空列表块**：Backspace 撤销圆点变空正文块；Enter 转换为正文并插入新的空段落。
- **退格链（2026-08-06）**：降级后若段落前是另一个列表项，继续 Backspace 会把当前段落
  文本合并进前一个列表项内容（光标跳回上一行），可继续删除上一行。

### 3.3 有序列表（ordered-list-item）

- **渲染**：`数字.` 为装饰 span，不可选中；`orderedIndex` 保留编号。
- **退出条件**：同 3.2；转换后 `orderedIndex` 清空。
- **末尾空项退格（2026-08-06 修复）**：删除末尾空列表项时**退出整个列表**——
  删除该空项、在列表后追加空段落，光标移到左边缘（不再停留在上一项缩进内）；
  中间空项退格仅移除该项并把光标移到下一项内容开头。

### 3.4 任务列表（task-list-item）

- **渲染**：`⭕` 复选框为装饰 span，不可选中；`checked` 状态显示 ✓/空。
- **退出条件**：同 3.2；转换后 `checked` 清空。

### 3.5 代码块（code-fence）

- **渲染**：语言选择器 + 复制按钮 + textarea 输入区（Normal Mode 内独立编辑路径，
  不经过 contentEditable 前缀检测）。
- **创建（2026-08-06 修复）**：` ```lang `（尾随空格）即时转换，或 ` ```lang ` 后按 Enter
  提交；围栏未被提前消费，语言正确捕获。转换后自动在代码块**下方补一个空段落**，
  保证可继续输入其他内容。输入反引号时不做 autoPair 成对补齐。
- **空内容退出（2026-08-06 修订，2026-08-12 补充）**：代码块内容为空时——**含纯空白/换行**，
  即视觉为空（删光内容后残留的 `\n` 也视为空，`trim()` 判空）：
  - **Backspace → 一键删除代码块**（光标移到前一块末尾；无前块则下一块开头；唯一块转空段落）。
  - **Enter → 退出代码块**（保留代码块，光标移到下一个内容块，即自动补的空段落）。
  内容非空（`trim()` 后非空）时 Enter 为代码内换行、Backspace 为正常删除字符。
- **代码块后空段落（2026-08-06 修订）**：**受 Backspace 保护**——代码块存在时，其后空行
  按 Backspace 不删除、不并入代码块（作为退出/分隔行）；只有先一键删除代码块本身，
  该空行才恢复为普通段落（可正常合并删除）。

### 3.6 引用（blockquote）

- **渲染**：左侧绿色竖线（`border-l`），不可选中。
- **退出条件**：光标在内容开头按 Backspace → 转换为正文；**空引用行按 Enter 同样退出**
  （2026-08-06 修复，对齐列表空项回车行为）。
- **末尾空行（2026-08-06 修复）**：删除引用末尾空行时，空段落移到**引用之后**（光标在
  引用下方，对齐列表末尾空项行为），引用本身保留。

## 4. 按键优先级（Backspace 分发顺序）

容器 `handleKeyDown` 对 Backspace 按以下优先级决策（同一时刻只命中一条）：

1. `protectedAfterCodeFence` 段落：拦截全部 Backspace（保留现有保护语义）。
2. 非 paragraph / 非 code-fence 结构块且光标在内容起点：**转换为正文**（无论内容是否为空）。
3. paragraph 空块且光标在起点：**删除块**（合并语义，保留现有行为）。
4. 其余情况：交给浏览器默认行为（删除字符或合并）。

代码块不参与上述容器分发，其空内容 Backspace 在 textarea 内独立处理（3.5）。

## 5. 潜在问题分析

| # | 问题 | 影响 | 处置 |
| - | ---- | ---- | ---- |
| P1 | 列表块 `isAtContentStart` 只检查 anchor 是否为 contentSpan 的直接文本节点；内容以 strong/em/a 开头或光标在零宽空格后时误判，Backspace 无法转正文 | 格式化内容开头的列表块无法退出 | 本次修复：改用 Range 计算到内容起点的文本长度 |
| P2 | 空结构块（标题/列表/引用）Backspace 当前直接删除整个块，与"撤销语法"语义不符 | 用户一次 Backspace 丢失整个块 | 本次修复：改为先转换正文 |
| P3 | 代码块空内容 Backspace 无任何处理（textarea `stopPropagation`） | 空代码块无法撤销 | 本次实现 |
| P4 | `handleBlockDelete` 删除块后不恢复光标 | 删除后焦点丢失/位置漂移 | 本次修复：焦点迁移到前块末尾 |
| P5 | `handleBlockConvertToParagraph` 转换后光标置于内容末尾 | 与"撤销前缀"直觉不符（应保持在开头） | 本次修复：光标保持在内容起点 |
| P6 | 任务列表复选框无点击切换逻辑（渲染"可打勾"但无交互） | 与需求"⭕(可打勾)"描述有出入 | 记录为后续任务，不在本规范范围 |
| P7 | 代码块后的段落有 `protectedAfterCodeFence` 保护，Backspace 被完全拦截 | 空代码块位于文档中部时，其后的段落 Backspace 无响应（属既有保护语义） | 保留现状，文档记录 |
| P8 | pending 阶段删除前缀不进入 undo 栈 | 撤销无法恢复已删除的前缀字符 | 与现有"逐字输入不进 undo"一致，接受 |

## 6. 实现方案

### 6.1 改动文件

| 文件 | 改动 |
| ---- | ---- |
| `src/render/components/Editor/EditorScrollContainer.tsx` | 修复 `isAtContentStart`；抽取 `resolveBackspaceAction` 纯函数并调整 Backspace 分发顺序 |
| `src/render/components/Editor/blocks/CodeFenceBlock.tsx` | textarea 空内容 Backspace 触发 `onDeleteBlock` |
| `src/render/components/Editor/BlockRenderer.tsx` | 透传 `onDeleteBlock` |
| `src/render/components/Editor/EditorView.tsx` | `handleBlockDelete` 增加焦点迁移；`handleBlockConvertToParagraph` 光标保持在起点；新增唯一代码块转空段落处理 |
| `tests/` | 补充 Backspace 决策、代码块空退、行检测测试 |

### 6.2 风险等级

L3（编辑器核心交互逻辑修改）。已由用户授权自主实现；改动集中在 Normal Mode
Backspace/Enter 分发与光标管理，不影响数据模型与序列化格式。

### 6.3 验收标准

- 六种块类型均可按第 3 节规则退出为正文，内容不丢失。
- 空结构块 Backspace 先撤销语法、再删除块（两次操作）。
- 代码块空内容 Backspace 可撤销；唯一代码块转为空正文块。
- 删除/转换后光标位置正确。
- 新增测试通过，`tsc --noEmit` 无错误。

## 7. 实现记录与测试结果

### 7.1 已实现（2026-08-05）

- `resolveBackspaceAction` 纯函数统一定义容器 Backspace 分发优先级；代码块被显式排除，
  由其 textarea 独立处理。
- 空结构块（标题/列表/引用）Backspace 由"删除块"改为"撤销语法转正文"（规范 4 节顺序 2/3）。
- 代码块 textarea 空内容 Backspace → 撤销代码块；唯一代码块转为空正文块。
- `handleBlockDelete` 删除后光标迁移到前块末尾（无前块则后块开头），修复删除后焦点丢失。
- `handleBlockConvertToParagraph` 转换后光标保持在内容起点。
- 列表块 `isAtContentStart` 改为 Range 文本长度判定，兼容格式化节点开头与零宽空格。

### 7.2 测试结果

- 新增 `tests/components/editorScrollContainerExitRules.test.ts`（6 例）：覆盖 protected、
  结构块转换、空段落删除、浏览器默认、代码块排除。
- `tests/components/CodeFenceBlock.test.tsx` 新增 2 例：空 textarea Backspace 触发
  `onDeleteBlock`；非空 textarea 不触发。
- 全量 `vitest run`：16 个文件 / 189 个测试全部通过。
- `tsc --noEmit`：无错误。
- ESLint：本次改动 0 error；遗留 1 个既有 warning（`EditorView` handleBlockEnter 依赖数组
  缺 `getPrefixLength`，该回调为空依赖稳定函数，无实际影响，留待后续清理）。
