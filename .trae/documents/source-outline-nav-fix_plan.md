# 源码模式目录导航偏移问题修复计划

## 问题分析

### 现象
源码模式下，点击目录标题（如 "2.3 上线前企业标准化预检流程"），编辑器跳转到错误位置（如 "# 2. 项目初始化"）。

### 根因
**索引映射不一致**：
- `OutlinePanel` 的 `buildHeadingIndexMap` 使用**树结构的深度优先遍历**构建索引
- `SourceCodeEditor` 的 `findHeadingLineNumbers` 使用**文档线性扫描**构建索引
- 当文档中 H1、H2、H3 混排时，两个索引系统产生错位

### 解决方案（最小修改）
保持 `headingIndex` 接口不变，在 EditorView 的 Source Code Mode 分支中使用 `extractOutline` 将 `headingIndex` 正确转换为 `lineNumber`。

## 修改计划

### 1. 修改 EditorView 组件（核心修复）
**文件**: `src/render/components/Editor/EditorView.tsx`

- 导入 `extractOutline` 函数
- Source Code Mode 导航分支：使用 `extractOutline(content)` 获取大纲，按深度优先顺序找到第 `headingIndex` 个标题的 `lineNumber`
- 调用 `sourceEditorHandleRef.current?.scrollToLine(lineNumber)` 替代 `scrollToHeading(headingIndex)`

### 2. 修改 SourceCodeEditor 组件
**文件**: `src/render/components/Editor/SourceCodeEditor.tsx`

- 将 `SourceCodeEditorHandle.scrollToHeading(headingIndex)` 改为 `scrollToLine(lineNumber: number)`
- 直接使用传入的 `lineNumber` 调用 `editor.revealPositionInCenterIfOutsideViewport`
- 修改 `getActiveHeadingIndex` 改为 `getNearestHeadingLineNumber`，返回最近标题的 `lineNumber`
- `onActiveHeadingChange` 回调改为传递 `lineNumber`

### 3. 修改 EditorView 的 active heading 处理
- `onActiveHeadingChange` 现在接收 `lineNumber`
- Normal Mode 仍接收 `headingIndex`（保持不变）
- 需要区分两种模式的回调参数

## 影响文件
1. `src/render/components/Editor/EditorView.tsx`（核心修复）
2. `src/render/components/Editor/SourceCodeEditor.tsx`（接口调整）

## 验证标准
- [ ] 源码模式下点击目录标题，编辑器正确跳转到对应位置
- [ ] Normal 模式下点击目录标题，编辑器正确跳转到对应位置
- [ ] 动态高亮正常工作
- [ ] TypeScript 类型检查通过
- [ ] ESLint 检查通过
