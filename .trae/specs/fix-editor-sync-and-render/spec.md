# WeaveMD 编辑器同步与实时渲染修复 - Product Requirement Document

## Overview

- **Summary**: 修复 WeaveMD 编辑器中两个核心问题：1) 非源码模式下新增内容（如新段落）无法保存到源码模式的同步机制缺陷；2) 非源码模式下 Markdown 语法无法实时渲染为富文本的体验问题。
- **Purpose**: 参照 MarkText/marktex 的编辑实现原理，实现完善的内容状态同步机制和 Markdown 实时渲染功能，确保编辑器在双模式之间切换时数据完整性，并提供流畅的 WYSIWYG 编辑体验。
- **Target Users**: 所有使用 WeaveMD 的内容创作者、开发者和知识工作者，他们依赖稳定可靠的 Markdown 编辑体验。

## Goals

- 修复在 Normal Mode 下通过 Enter 创建新段落并添加内容后，切换至 Source Code Mode 内容丢失的问题
- 实现 Markdown 语法（如 `# 标题`、`- 列表`、`> 引用`等）在输入时实时检测并自动渲染为富文本
- 建立健壮的内容同步机制，确保 Normal Mode ↔ Source Code Mode 切换时所有编辑变更完整保留
- 保证光标位置在实时渲染过程中不发生跳动或丢失

## Non-Goals (Out of Scope)

- 不改变编辑器的整体双模式架构
- 不引入新的 Markdown 解析引擎（继续使用 unified/remark/rehype 管线）
- 不重构 Block Tree 数据结构
- 不改变浮动工具栏、Minimap 等现有功能的行为
- 不涉及导出功能的修改

## Background & Context

### 现有架构

WeaveMD 采用 Block Tree 架构实现 WYSIWYG 编辑：

- **Normal Mode**: Block Tree 渲染为可编辑富文本组件，通过 `contentEditable` 实现直接编辑
- **Source Code Mode**: 全屏 Monaco 编辑器编辑原始 markdown
- **状态管理**: Zustand stores（editorStore、uiStore）
- **数据流**: 用户编辑 → DOM 变更 → blur/enter 事件 → handleBlockContentChange → BlockTree 更新 → syncTreeToStore → editorStore.updateContent

### 已识别的根因分析

#### 问题一：内容同步缺陷

**根因**: `handleBlockEnter` 函数在处理 Enter 键创建新段落时，未同步更新当前块（用户正在编辑的块）的内容到 BlockTree。

具体流程分析：

1. 用户在段落 A 中输入文本 → DOM 更新，但 BlockTree 中 A 的 `sourceLines` 保持旧值
2. 用户按下 Enter → `handleBlockEnter(blockId)` 被调用
3. 函数读取 DOM 获取当前文本内容（`getBlockTextContent`），但在普通分支（无 Markdown 类型转换）中，仅将该文本用于检测，未更新当前块的 `sourceLines`
4. 函数创建新空块 B 并序列化整个树 → 块 A 使用旧的 `sourceLines`，丢失用户刚输入的内容
5. `syncTreeToStore` 将错误的序列化结果写入 editorStore

#### 问题二：Markdown 渲染不实时

**根因**: 当前 Markdown 语法检测仅在 `onBlur` 事件和 Enter 键时触发，无法在用户输入过程中实时响应。

具体流程分析：

1. 用户在段落中输入 `# Hello` → DOM 文本变为 `# Hello`
2. `onBlur` 尚未触发（用户仍在输入），BlockTree 中该块的 `sourceLines` 仍为旧值
3. 用户按 Enter 或点击其他位置 → `onBlur` 触发 → `handleBlockContentChange` 检测到 Markdown 语法 → 更新块类型
4. 渲染完成，但用户体验是"延迟渲染"而非"实时渲染"

## Functional Requirements

- **FR-1**: 在 Normal Mode 中，用户按下 Enter 创建新段落时，当前段落的最新文本内容必须同步到 BlockTree 的 `sourceLines`，确保序列化时数据完整
- **FR-2**: 在 Normal Mode 中，用户在段落中输入 Markdown 语法（如 `# `、`## `、`- `、`1. `、`> `、`- [x] `等），系统必须在输入过程中实时检测并自动将该段落转换为对应的块类型（heading、list-item、blockquote、task-list-item 等）
- **FR-3**: 实时渲染过程中，光标位置必须保持在用户预期的位置，不能出现跳动、丢失或跳到段落开头的情况
- **FR-4**: Normal Mode 中进行的任何编辑操作（文本修改、段落新增、格式转换等），在切换到 Source Code Mode 后必须完整保留
- **FR-5**: Source Code Mode 中编辑的内容，切换回 Normal Mode 后必须完整保留并正确渲染
- **FR-6**: 已保存的 Markdown 语法块（如 heading、list-item、blockquote）在用户继续编辑其内容时，类型不应频繁切换回 paragraph 再切回来

## Non-Functional Requirements

- **NFR-1**: 实时渲染的响应时间应小于 100ms（从输入到块类型更新完成），确保编辑流畅无延迟
- **NFR-2**: 所有现有测试（185 个）必须继续通过
- **NFR-3**: 代码修改应遵循现有的不可变数据模式（所有 BlockTree 操作返回新对象）
- **NFR-4**: 修改后的代码应与现有的 IME（输入法）处理逻辑兼容，不引入中文/日文输入问题

## Constraints

- **Technical**:
  - 继续使用 React 18 + TypeScript + Zustand
  - 继续使用 BlockTree 不可变数据结构
  - contentEditable 机制作为 Normal Mode 的编辑基础
  - 光标管理使用 DOM Selection API
- **Dependencies**:
  - `detectMarkdownLine` 函数（lineMarkdown.ts）用于检测 Markdown 语法
  - `buildSourceLinesFromContent` 函数（EditorView.tsx）用于从纯文本构建 sourceLines
  - `buildBlockTree` / `serializeBlockTree` 用于 BlockTree 序列化

## Assumptions

- 用户主要使用键盘输入进行 Markdown 编辑
- Markdown 语法检测基于行首模式（`^#`、`^-` 等），与现有 `detectMarkdownLine` 一致
- 块类型转换仅在 Markdown 语法出现在行首时触发（如用户全选删除后重新输入）
- 段落（paragraph）是默认类型，用户输入 Markdown 前缀后可转换为其他类型
- 实时渲染时，仅在检测到 Markdown 语法变化时更新块类型，避免频繁重渲染

## Acceptance Criteria

### AC-1: Enter 创建新段落时内容不丢失

- **Given**: 用户在 Normal Mode 下有一个段落块 A，内容为 "Hello World"
- **When**: 用户在段末尾按下 Enter 创建新段落 B
- **Then**: 切换到 Source Code Mode，应看到 "Hello World" 完整保留在 A 中，B 为空段落
- **Verification**: `programmatic`
- **Notes**: 需验证 handleBlockEnter 正确同步当前块内容

### AC-2: 实时 Markdown 渲染

- **Given**: 用户在 Normal Mode 下有一个空段落
- **When**: 用户输入 `# Hello`（以 `# ` 开头）
- **Then**: 系统立即将该段落转换为 H1 标题块，显示为加粗大字号的 "Hello"（不含 `# ` 前缀）
- **Verification**: `programmatic`
- **Notes**: 光标应在 "Hello" 文字内部，不丢失位置

### AC-3: 列表实时渲染

- **Given**: 用户在 Normal Mode 下有一个空段落
- **When**: 用户输入 `- 列表项`（以 `- ` 开头）
- **Then**: 系统立即将该段落转换为无序列表项块，显示为带项目符号的 "列表项"
- **Verification**: `programmatic`

### AC-4: 任务列表实时渲染

- **Given**: 用户在 Normal Mode 下有一个空段落
- **When**: 用户输入 `- [x] 任务项`（以 `- [x] ` 开头）
- **Then**: 系统立即将该段落转换为已勾选的任务列表项块
- **Verification**: `programmatic`

### AC-5: 引用块实时渲染

- **Given**: 用户在 Normal Mode 下有一个空段落
- **When**: 用户输入 `> 引用内容`（以 `> ` 开头）
- **Then**: 系统立即将该段落转换为引用块
- **Verification**: `programmatic`

### AC-6: 有序列表实时渲染

- **Given**: 用户在 Normal Mode 下有一个空段落
- **When**: 用户输入 `1. 第一项`（以 `1. ` 开头）
- **Then**: 系统立即将该段落转换为有序列表项块
- **Verification**: `programmatic`

### AC-7: 双模式切换内容完整性

- **Given**: 用户在 Normal Mode 下进行了多次编辑（修改段落 A、新增段落 B 并添加内容、将段落 C 转为标题）
- **When**: 用户切换到 Source Code Mode
- **Then**: Source Code Mode 中显示的 markdown 内容与 Normal Mode 中的所有编辑完全一致
- **Verification**: `programmatic`

### AC-8: 实时渲染时光标位置正确

- **Given**: 用户正在输入 Markdown 语法触发实时渲染
- **When**: 块类型发生转换
- **Then**: 光标保持在用户正在编辑的文字位置，不跳到段落开头或末尾
- **Verification**: `human-judgment`
- **Notes**: 评测者需实际测试确认光标位置正确

### AC-9: 非 Markdown 文本正常编辑不受影响

- **Given**: 用户在普通段落中输入纯文本（无 Markdown 前缀）
- **When**: 用户输入或修改内容
- **Then**: 块类型保持为 paragraph，内容正常编辑，无异常闪烁或类型切换
- **Verification**: `programmatic`

### AC-10: 现有测试全部通过

- **Given**: 代码修改完成
- **When**: 运行 `npm run test`
- **Then**: 所有 185 个测试全部通过，无新增失败
- **Verification**: `programmatic`

## Open Questions

- [ ] 实时渲染是否需要支持在段落中间修改 Markdown 语法（如用户在段落中间删除 `# ` 前缀后应自动转回 paragraph）？假设只在行首输入时触发
- [ ] 光标在实时渲染后的精确定位方式：是基于字符偏移重新定位，还是基于 DOM 节点恢复？需要验证最佳方案
- [ ] 是否需要添加实时渲染的防抖机制（如 50ms 延迟）以避免快速输入时的性能问题？
