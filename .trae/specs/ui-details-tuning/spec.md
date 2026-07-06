# WeaveMD - UI 细节调优 PRD

## Overview
- **Summary**: 对 WeaveMD 编辑器的两个 UI 细节进行调优，包括浮动工具栏位置调整和目录面板右侧边缘线与编辑器序号间距调整。
- **Purpose**: 优化用户编辑体验，让界面布局更加紧凑和美观。
- **Target Users**: 所有使用 WeaveMD 编辑器的用户。

## Goals
- 缩小浮动工具栏与所选内容的垂直间距
- 缩小目录右侧边缘线与编辑器行号的间距并保持固定（不受目录宽度调整影响）

## Non-Goals (Out of Scope)
- 不修改浮动工具栏的功能和样式
- 不修改目录面板的其他布局和功能
- 不修改编辑器的核心功能

## Background & Context
- 当前浮动工具栏位于选中文本上方 50px 处，间距较大
- 当前目录右侧边缘线与编辑器行号间距为 16px（pl-4），需要缩小为固定值
- 目录宽度可调整，但调整后间距应保持不变

## Functional Requirements
- **FR-1**: 浮动工具栏与选中文本的垂直间距从 50px 缩小
- **FR-2**: 目录右侧边缘线与编辑器行号的间距从 16px 缩小为固定值
- **FR-3**: 调整目录宽度时，目录右侧边缘线与编辑器行号的间距保持不变

## Non-Functional Requirements
- **NFR-1**: 保持界面的美观和一致性
- **NFR-2**: 不影响编辑器的性能
- **NFR-3**: 所有功能正常工作

## Constraints
- **Technical**: 使用现有的 React + TailwindCSS 技术栈
- **Business**: 保持与现有设计系统的一致性
- **Dependencies**: 无外部依赖

## Assumptions
- 当前 16px 的间距（pl-4）过大，用户希望更紧凑
- 浮动工具栏 50px 的距离可以进一步缩小以获得更好的用户体验

## Acceptance Criteria

### AC-1: 浮动工具栏间距缩小
- **Given**: 用户在编辑器中选中文本
- **When**: 浮动工具栏出现
- **Then**: 工具栏与选中文本的垂直间距小于当前 50px
- **Verification**: `human-judgment`

### AC-2: 目录右侧边缘线与行号间距缩小
- **Given**: 目录面板打开且编辑器中有内容
- **When**: 用户查看界面
- **Then**: 目录右侧边缘线与编辑器行号最左侧的间距小于当前 16px
- **Verification**: `human-judgment`

### AC-3: 间距在目录宽度调整时保持固定
- **Given**: 目录面板打开且编辑器中有内容
- **When**: 用户拖拽调整目录宽度
- **Then**: 目录右侧边缘线与编辑器行号最左侧的间距始终保持固定不变
- **Verification**: `human-judgment`

## Open Questions
- 无
