# WeaveMD - 浮动工具栏 WYSIWYG 功能 PRD

## Overview
- **Summary**: 在非源码模式下实现浮动工具栏，选中文本时显示，提供格式化、结构转换、超链接、评论和 MD 源码显示等功能。
- **Purpose**: 提升用户在非源码模式下的编辑效率，无需切换到源码模式即可进行格式化操作。
- **Target Users**: 所有 WeaveMD 用户，特别是习惯所见即所得编辑方式的用户。

## Goals
- 实现非源码模式下的浮动工具栏
- 支持文本选择检测和多块选择过滤
- 提供完整的格式化功能（结构转换、粗体、斜体、下划线、高亮、代码、超链接、评论、MD源码）
- 源码模式下不显示浮动工具栏

## Non-Goals (Out of Scope)
- 不实现侧边栏导航功能
- 不实现快速插入菜单（@触发）
- 不实现块操作菜单（点击块图标）
- 不修改现有双模式架构

## Background & Context
- 当前 WeaveMD 已有一个 FloatingToolbar 组件，但仅在 Monaco 编辑器（源码模式）中工作
- 非源码模式已支持 WYSIWYG 编辑（段落/标题可编辑、Enter 创建段落、Backspace 删除段落、Ctrl+Z/Y 撤销重做）
- 需要扩展 FloatingToolbar 以支持非源码模式下的富文本选择

## Functional Requirements
- **FR-1**: 浮动工具栏仅在非源码模式下显示，源码模式下不显示
- **FR-2**: 浮动工具栏仅在选择富文本时显示，选择内容跨多个块时不显示
- **FR-3**: 浮动工具栏包含结构下拉菜单（正文、一级标题、二级标题、三级标题、其他标题、有序列表、无序列表、任务、代码块、引用）
- **FR-4**: 浮动工具栏包含粗体、斜体、下划线、高亮、代码格式化按钮
- **FR-5**: 浮动工具栏包含添加超链接按钮
- **FR-6**: 浮动工具栏包含评论按钮（对选中内容添加评论）
- **FR-7**: 浮动工具栏包含 MD 源码显示按钮（显示所选段落的 markdown 源码）
- **FR-8**: 点击文档其他位置时，浮动工具栏自动隐藏

## Non-Functional Requirements
- **NFR-1**: 浮动工具栏定位准确，出现在选中文本上方
- **NFR-2**: 浮动工具栏响应速度快，无明显延迟
- **NFR-3**: 浮动工具栏样式与现有主题一致

## Constraints
- **Technical**: React 18 + TypeScript + TailwindCSS，基于现有 blockTree 架构
- **Dependencies**: 现有 blockTree 服务、editorStore、uiStore

## Assumptions
- 用户已熟悉 Markdown 语法
- 用户使用鼠标或触摸板进行文本选择
- 现有 contentEditable 块组件支持文本选择

## Acceptance Criteria

### AC-1: 浮动工具栏在非源码模式下显示
- **Given**: 用户处于非源码模式，选中一段文本
- **When**: 文本选择发生
- **Then**: 浮动工具栏出现在选中文本上方
- **Verification**: `human-judgment`

### AC-2: 浮动工具栏在源码模式下不显示
- **Given**: 用户处于源码模式，选中一段文本
- **When**: 文本选择发生
- **Then**: 浮动工具栏不显示
- **Verification**: `human-judgment`

### AC-3: 跨块选择时不显示浮动工具栏
- **Given**: 用户选中跨多个块的内容（标题+正文、不同段落下的正文等）
- **When**: 文本选择发生
- **Then**: 浮动工具栏不显示
- **Verification**: `human-judgment`

### AC-4: 结构转换功能
- **Given**: 用户选中一段文本，浮动工具栏显示
- **When**: 用户点击结构下拉菜单并选择一个选项
- **Then**: 当前段落类型转换为所选类型
- **Verification**: `human-judgment`

### AC-5: 格式化功能（粗体、斜体、下划线、高亮、代码）
- **Given**: 用户选中一段文本，浮动工具栏显示
- **When**: 用户点击格式化按钮
- **Then**: 选中的文本应用相应的 Markdown 格式化
- **Verification**: `human-judgment`

### AC-6: 添加超链接功能
- **Given**: 用户选中一段文本，浮动工具栏显示
- **When**: 用户点击超链接按钮
- **Then**: 选中的文本转换为 Markdown 链接格式 [text](url)，并选中 url 部分便于编辑
- **Verification**: `human-judgment`

### AC-7: 评论功能
- **Given**: 用户选中一段文本，浮动工具栏显示
- **When**: 用户点击评论按钮
- **Then**: 在选中位置插入评论标记
- **Verification**: `human-judgment`

### AC-8: MD 源码显示功能
- **Given**: 用户选中一段文本，浮动工具栏显示
- **When**: 用户点击 MD 源码按钮
- **Then**: 当前段落切换为显示 Markdown 源码
- **When**: 用户点击文档其他位置
- **Then**: 自动恢复为富文本格式
- **Verification**: `human-judgment`

### AC-9: 点击外部隐藏浮动工具栏
- **Given**: 浮动工具栏正在显示
- **When**: 用户点击文档其他位置
- **Then**: 浮动工具栏隐藏
- **Verification**: `human-judgment`

## Open Questions
- [ ] 评论功能的具体实现方式（使用何种 Markdown 语法）
- [ ] MD 源码显示的具体交互方式
