# 最终细节调优 - Product Requirement Document

## Overview
- **Summary**: 对 WeaveMD 进行最终细节调优，包括进一步缩小浮动工具栏和目录间距，并新增实时预览功能
- **Purpose**: 提升用户编辑体验，提供更紧凑的界面布局和实时 Markdown 预览功能
- **Target Users**: WeaveMD 编辑器的日常用户

## Goals
- 将浮动工具栏与选中文本的间距进一步缩小到更合适的值
- 将目录右侧边缘线与编辑器行号最左侧的间距进一步缩小
- 新增 Markdown 实时自动渲染预览功能
- 保持调整目录宽度时间距固定不变

## Non-Goals (Out of Scope)
- 不修改编辑器的核心功能
- 不添加其他复杂的编辑功能

## Background & Context
- 之前已将浮动工具栏间距调整为 25px，目录间距调整为 2px
- 项目已有 Markdown 解析服务（markdown.ts），使用 unified、remark-parse、remark-gfm
- 使用 React 18 + TypeScript + TailwindCSS + Electron + Zustand 技术栈

## Functional Requirements
- **FR-1**: 进一步调整浮动工具栏定位计算，使其与选中文本间距更小
- **FR-2**: 进一步缩小目录右侧边缘线与编辑器行号间距
- **FR-3**: 新增 Markdown 实时预览组件，支持编辑器与预览双栏布局
- **FR-4**: 在 UI Store 中添加预览模式切换状态
- **FR-5**: 实现 Markdown 到 HTML 的实时渲染
- **FR-6**: 在顶部栏添加预览模式切换按钮

## Non-Functional Requirements
- **NFR-1**: 预览渲染性能优秀，延迟小于 300ms
- **NFR-2**: 预览样式与应用主题保持一致
- **NFR-3**: 目录宽度调整时，编辑器与目录间距保持固定
- **NFR-4**: 支持深色/浅色主题的预览样式

## Constraints
- **Technical**: 使用现有的 unified、remark-parse、remark-gfm 等依赖
- **Business**: 保持与现有设计系统的一致性

## Assumptions
- 用户希望有更紧凑的界面布局
- 实时预览功能将提升编辑体验

## Acceptance Criteria

### AC-1: 浮动工具栏间距进一步缩小
- **Given**: 用户在编辑器中选中文本
- **When**: 选中任意文本（包括第一行）
- **Then**: 浮动工具栏与选中文本间距更小，视觉更紧凑
- **Verification**: human-judgment

### AC-2: 目录与编辑器间距进一步缩小
- **Given**: 目录面板已打开
- **When**: 查看目录与编辑器之间的间距
- **Then**: 间距进一步缩小，布局更紧凑
- **Verification**: human-judgment

### AC-3: 实时预览功能可用
- **Given**: 用户已打开一个 Markdown 文件
- **When**: 点击顶部栏的预览切换按钮
- **Then**: 界面切换为双栏布局，左侧为编辑器，右侧为实时预览
- **Verification**: human-judgment

### AC-4: 预览内容实时更新
- **Given**: 预览模式已开启
- **When**: 用户在编辑器中输入内容
- **Then**: 预览区域内容实时更新（延迟约 300ms）
- **Verification**: human-judgment

### AC-5: 预览支持主题切换
- **Given**: 预览模式已开启
- **When**: 切换应用主题（深色/浅色）
- **Then**: 预览区域样式相应更新，保持良好可读性
- **Verification**: human-judgment

## Open Questions
- 无
