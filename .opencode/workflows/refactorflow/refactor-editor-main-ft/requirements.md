# 重构需求文档：refactor-editor-main-ft

> 工作流：RefactorFlow | 日期：2026-08-09
> 需求来源：grilling 共识（Q1–Q8）

## 1. 重构目标

对编辑主区（`src/render/components/Editor/v2/`）与浮动工具栏（`FloatingToolbar.tsx`）相关代码做结构性重构，消除主要坏味道：

1. **重复代码**：`clamp`、零宽空格剥离（3 处）、父链容器解析（5 处）、空段落后置（4 处）、行内标记表两处硬编码、3 处几乎相同的工具栏按钮 JSX。
2. **过长/过度嵌套函数**：`formatCtrl.formatRange`（113 行）、`ContentBlock.handleKeyDown`（59 行）、`convertCtrl.exitListItem`（63 行）、`enterCtrl.handleEnter`（63 行）等。
3. **命名不清**：`FloatingToolbar` `kind:'fade'` 语义、`applyAction` 名称泛化、`getContentArea` 返回值与命名不符等。
4. **上帝组件/上帝文件**：`EditorV2.tsx`（397 行，拆 4 个 hook）、`FloatingToolbar.tsx`（580 行，纯函数下沉 kernel）、`ContentBlock.tsx`（288 行）。
5. **可提取公共逻辑**：变更管线统一、`ToolbarButton` 子组件、`useRafThrottle` hook、`getContainerContext`、`ensureParagraphAfter` 等。

## 2. 重构范围

### 范围内（允许修改）

- `src/render/components/Editor/v2/`：`EditorV2.tsx`、`FloatingToolbar.tsx`、`BlockRenderer.tsx`、`EditorScrollContainer.tsx`、`useCrossBlockDragSelection.ts`、`useOutlineNavigation.ts`、`types.ts`
- `src/render/components/Editor/v2/blocks/`：`ContentBlock.tsx`、`LeafBlock.tsx`、`CodeBlock.tsx`、`ListItemBlock.tsx`、`BlockquoteBlock.tsx`
- `src/render/editor/controllers/`：`formatCtrl.ts`、`convertCtrl.ts`、`enterCtrl.ts`、`inputCtrl.ts`、`backspaceCtrl.ts`、`listCtrl.ts`、`clickCtrl.ts`

### 范围内但限制（kernel 仅允许"新增导出/移动已有函数"，不改既有函数行为）

- `src/render/editor/kernel/syntaxType.ts`（下沉 `sameSyntaxType`/一致性判定时复用已存在实现）
- `src/render/editor/kernel/selection.ts`（统一零宽剥离时导出已有 `stripZeroWidth`）

### 范围外（不得改动）

- `src/render/editor/kernel/` 其余文件（`blockTree.ts`、`inlineLexer.ts`、`inlineRenderer.ts`、`inlineStrip.ts`、`markdownToState.ts`、`stateToMarkdown.ts`、`markdownSyntax.ts`、`outline.ts`、`katex.ts`、`types.ts`、`index.ts`）
- `src/render/editor/editorInstance.ts`（宿主）
- 认证/设置/导航/数据层/其余组件

## 3. 行为保持约束

- **外部行为严格不变**：渲染输出、编辑器交互（输入/回车/退格/格式化/转换/拖选/光标恢复）、浮动工具栏显示逻辑不得变化。
- 纯重构：不修复范围外 bug，不新增功能；`getContentArea` 命名疑义等**列入遗留清单**，本次不修改行为。

## 4. 成功标准

1. 重构前建立测试基线（`npm test` 全绿）。
2. 每个原子重构单元完成后 `npm test` 保持全绿。
3. 完成后：`npm test` 全绿、`npm run typecheck` 0 error、`npm run lint` 无 error。
4. 坏味道消除（见 §1 五项）经代码审查确认。
5. 交付总结含改动文件、测试结果、审查结论、剩余风险、遗留问题。

## 5. 假设 / 约束

- **优先级顺序**：重复代码/公共逻辑抽取（低风险高收益）→ 过长函数拆分 → 上帝组件拆分 → 命名修正。
- **kernel 边界**：只新增导出/移动已存在函数，不改 kernel 既有函数体。
- **测试策略**：以现有测试为基线，重构后全绿即可；不新增测试（覆盖空白列入遗留清单）。
- **提交粒度**：每完成一个原子重构单元（测试全绿）即创建本地提交，符合仓库风格；不推送远程。
- **文档同步**：仅当代码接口/文件路径变更影响 `docs/modules/04-编辑主区-Editor.md` 描述时同步相关小节。

## 6. 未决问题 / 遗留清单

- `EditorScrollContainer.getContentArea` 返回滚动容器却命名"内容区"——行为疑义，本次不改，留待后续核实。
- `BlockRenderer.tsx`、`LeafBlock.tsx`、`CodeBlock.tsx`、`ListItemBlock.tsx`、`BlockquoteBlock.tsx`、`EditorScrollContainer.tsx`、`useOutlineNavigation.ts` 无直接单测（重构后建议补，本次不做）。
- `syntaxType.test.ts` 直接 import 组件层函数（测试边界渗透），列入遗留。
