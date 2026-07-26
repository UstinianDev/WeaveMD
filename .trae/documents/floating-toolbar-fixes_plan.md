# 浮动工具栏问题修复计划

## 问题分析

### 问题一：浮动工具栏选中后松开左键消失

**原因**：`FloatingToolbarWYSIWYG.tsx` 中的 `handleClickOutside` 事件监听器会在用户松开鼠标左键时触发（因为点击了工具栏外部），导致工具栏被隐藏。

**修复方案**：修改 `handleClickOutside`，只有当选择被取消（selection.collapsed）时才隐藏工具栏。

### 问题二：内容选择后出现橙色边框，不能跨框选择

**原因**：
1. 每个 block 都是独立的 `contentEditable` 元素，浏览器默认会显示焦点边框（outline）
2. 跨 block 选择时，由于每个 block 都是独立的 contentEditable，浏览器限制了选择范围

**修复方案**：
1. 添加 CSS 样式移除 contentEditable 元素的 outline
2. 将 contentEditable 属性从单个 block 移到父容器（EditorScrollContainer），允许跨 block 选择

### 问题三：代码块内文本无法编辑

**原因**：`CodeFenceBlock.tsx` 使用 `dangerouslySetInnerHTML` 渲染代码，没有设置 contentEditable。

**修复方案**：为代码块内容区域添加 contentEditable 属性，或使用 textarea 替代。

## 文件修改清单

### 1. `src/render/components/Editor/FloatingToolbarWYSIWYG.tsx`
- 修改 `handleClickOutside` 函数，检查选择状态

### 2. `src/render/components/Editor/blocks/ParagraphBlock.tsx`
- 添加 `outline: none` 样式

### 3. `src/render/components/Editor/blocks/HeadingBlock.tsx`
- 添加 `outline: none` 样式

### 4. `src/render/components/Editor/EditorScrollContainer.tsx`
- 将 contentEditable 移到父容器，允许跨 block 选择

### 5. `src/render/components/Editor/blocks/CodeFenceBlock.tsx`
- 添加 contentEditable 属性

## 修复步骤

### 步骤一：修复浮动工具栏消失问题
修改 `handleClickOutside`，只有当选择被取消时才隐藏工具栏。

### 步骤二：修复橙色边框问题
在 ParagraphBlock 和 HeadingBlock 中添加 `outline: none` 样式。

### 步骤三：修复跨 block 选择问题
将 contentEditable 从单个 block 移到 EditorScrollContainer 的父容器。

### 步骤四：修复代码块编辑问题
为代码块内容区域添加 contentEditable 属性。

### 步骤五：验证修复
运行 typecheck 和 tests 确保修复正确。

## 风险处理

1. **跨 block 选择可能影响段落增删逻辑**：需要确保 Enter 和 Backspace 事件处理仍然正常工作
2. **代码块编辑可能导致语法高亮丢失**：需要确保编辑后的内容能够重新渲染
3. **contentEditable 移到父容器可能导致事件冒泡问题**：需要确保事件处理正确

## 依赖考虑

- 修复不涉及新的依赖
- 需要确保与现有 undo/redo 机制兼容
