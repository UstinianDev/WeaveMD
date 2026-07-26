# WeaveMD - WYSIWYG 可编辑模式 PRD

## Overview

- **Summary**: 将当前非源码模式（Normal Mode）从只读富文本改为可编辑的所见即所得（WYSIWYG）模式，模仿 MarkText 的编辑体验
- **Purpose**: 让用户能够直接在渲染后的富文本视图中编辑内容，无需切换到源码模式，提升编辑效率和用户体验
- **Target Users**: 所有使用 WeaveMD 的知识工作者、开发者和内容创作者

## Goals

- [ ] Normal Mode 下段落和标题支持直接编辑
- [ ] 编辑内容实时同步到 editorStore
- [ ] 保持当前双模式架构不变（Normal Mode 和 Source Code Mode）
- [ ] 保持现有的 Minimap、Find & Replace 等功能正常工作

## Non-Goals (Out of Scope)

- [ ] 不改变源码模式（Source Code Mode）的行为
- [ ] 不新增块级操作（如块类型转换、拖拽排序等）
- [ ] 不新增多光标编辑功能
- [ ] 不新增格式工具栏（加粗、斜体等快捷操作）
- [ ] 不修改数据库存储层

## Background & Context

- 当前 Normal Mode 使用 `dangerouslySetInnerHTML` 渲染只读 HTML，用户必须切换到 Source Code Mode 才能编辑
- MarkText 使用 Muya 引擎实现真正的 WYSIWYG 编辑，用户可以直接在渲染视图中编辑
- 我们需要在保持现有架构的基础上，为段落和标题块添加 `contentEditable` 支持

## Functional Requirements

- **FR-1**: ParagraphBlock 组件支持 contentEditable 编辑
- **FR-2**: HeadingBlock 组件支持 contentEditable 编辑
- **FR-3**: 编辑内容通过 onChange 事件实时同步到 editorStore
- **FR-4**: 编辑完成后（失焦或回车）触发重新渲染，保持视图与内容一致
- **FR-5**: 其他块类型（代码块、引用、列表、表格）保持只读状态

## Non-Functional Requirements

- **NFR-1**: 编辑响应延迟 < 100ms
- **NFR-2**: 编辑时不影响其他块的渲染和交互
- **NFR-3**: 保持与现有快捷键（Ctrl+S、Ctrl+Z/Y、Ctrl+F、Ctrl+\`）的兼容性

## Constraints

- **Technical**: React 18 + TypeScript、TailwindCSS、Zustand
- **Dependencies**: 基于现有 blockTree 和 editorStore 架构
- **Architecture**: 保持双模式架构，只修改 Normal Mode 的渲染组件

## Assumptions

- [ ] 用户主要编辑段落和标题内容
- [ ] 其他块类型（代码、引用、列表、表格）的编辑仍通过源码模式完成
- [ ] 使用 contentEditable 是实现简单 WYSIWYG 的最直接方式

## Acceptance Criteria

### AC-1: 段落块可编辑

- **Given**: 用户处于 Normal Mode，文档包含段落内容
- **When**: 用户点击段落文本并输入新内容
- **Then**: 段落内容实时更新，editorStore 的 content 同步变化
- **Verification**: `programmatic`

### AC-2: 标题块可编辑

- **Given**: 用户处于 Normal Mode，文档包含标题内容
- **When**: 用户点击标题文本并输入新内容
- **Then**: 标题内容实时更新，editorStore 的 content 同步变化
- **Verification**: `programmatic`

### AC-3: 编辑后重新渲染

- **Given**: 用户在 Normal Mode 编辑了段落或标题
- **When**: 用户失焦或按下回车
- **Then**: 块重新渲染为格式化的富文本，Markdown 源码正确更新
- **Verification**: `human-judgment`

### AC-4: 其他块保持只读

- **Given**: 用户处于 Normal Mode，文档包含代码块、引用、列表等
- **When**: 用户尝试编辑这些块
- **Then**: 这些块保持只读状态，无法直接编辑
- **Verification**: `human-judgment`

### AC-5: 快捷键兼容性

- **Given**: 用户在 Normal Mode 编辑内容
- **When**: 用户按下 Ctrl+S、Ctrl+Z/Y、Ctrl+F、Ctrl+\`
- **Then**: 快捷键功能正常工作，不受编辑状态影响
- **Verification**: `human-judgment`

## Open Questions

- [ ] 是否需要支持 Enter 键创建新段落？（当前先不实现，保持简单）
- [ ] 是否需要处理撤销/重做时的编辑状态同步？（依赖现有 undo/redo 机制）
