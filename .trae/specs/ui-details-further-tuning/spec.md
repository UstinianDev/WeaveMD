# UI 细节进一步调优 - Product Requirement Document

## Overview

- **Summary**: 对 WeaveMD 编辑器的浮动工具栏位置和目录与编辑器间距进行进一步微调
- **Purpose**: 解决选中第一行内容时浮动工具栏位置过高的问题，并进一步缩小目录与编辑器行号之间的间距
- **Target Users**: WeaveMD 编辑器的日常用户

## Goals

- 将浮动工具栏与选中文本的间距缩小到更小的值
- 将目录右侧边缘线与编辑器行号最左侧的间距进一步缩小
- 确保调整目录宽度时间距保持固定

## Non-Goals (Out of Scope)

- 不修改浮动工具栏的功能
- 不修改目录的布局结构
- 不修改编辑器的核心功能

## Background & Context

- 之前已将浮动工具栏间距从 50px 调整为 35px，但选中第一行时位置仍然过高
- 之前已将目录与编辑器间距从 16px 调整为 4px，需要进一步缩小
- 使用 React 18 + TypeScript + TailwindCSS 技术栈

## Functional Requirements

- **FR-1**: 调整浮动工具栏定位计算，使其与选中文本的间距更小
- **FR-2**: 进一步缩小目录右侧边缘线与编辑器行号之间的间距

## Non-Functional Requirements

- **NFR-1**: 调整目录宽度时间距保持固定不变
- **NFR-2**: 浮动工具栏在选中任何位置（包括第一行）时都能正确显示
- **NFR-3**: 保持现有 UI 的整体视觉风格一致性

## Constraints

- **Technical**: 使用现有的 React + TailwindCSS 技术栈
- **Business**: 保持与现有设计系统的一致性
- **Dependencies**: 依赖现有的浮动工具栏和目录组件

## Assumptions

- 调整间距不会影响其他功能的正常使用
- 用户期望更紧凑的 UI 布局

## Acceptance Criteria

### AC-1: 浮动工具栏间距缩小

- **Given**: 用户在编辑器中选中文本
- **When**: 选中文本（包括第一行）
- **Then**: 浮动工具栏出现在选中文本上方，间距明显小于之前的 35px
- **Verification**: `human-judgment`
- **Notes**: 视觉上检查工具栏与选中文本的间距

### AC-2: 目录与编辑器间距进一步缩小

- **Given**: 目录面板已打开
- **When**: 查看目录右侧边缘线与编辑器行号之间的间距
- **Then**: 间距明显小于之前的 4px，且保持固定
- **Verification**: `human-judgment`
- **Notes**: 视觉上检查间距，同时拖动调整目录宽度验证间距保持固定

## Open Questions

- 无
