# WeaveMD 目录交互优化 - Product Requirement Document

## Overview

- **Summary**: 实现 Outline 目录与编辑主区的双向交互：点击目录标题可跳转至编辑区对应位置；收起目录时编辑区自动居中占满空间。
- **Purpose**: 提升文档导航体验，让用户在长文档中快速定位内容，并在专注写作时最大化编辑区域。
- **Target Users**: 使用 Markdown 编辑器进行长文档写作的知识工作者、开发者。

## Goals

- 实现点击目录 n 级标题 → 编辑主区平滑滚动到对应标题位置
- 实现点击 Collapse outline 收起目录 → 编辑主区自动居中扩展
- 保持现有双模式架构（Normal Mode / Source Code Mode）兼容性
- 支持多级别标题（H1-H6）导航

## Non-Goals (Out of Scope)

- 不在 Source Code Mode 下实现行号跳转（Monaco 编辑器原生支持 Ctrl+G 跳行）
- 不实现目录项的拖拽排序功能
- 不实现目录项的实时高亮跟随（当前聚焦标题在目录中的高亮）
- 不修改 Block Tree 数据结构的核心逻辑

## Background & Context

### Current State

1. **OutlinePanel.tsx**: 已实现目录渲染，支持点击标题回调 `onNavigateToLine(lineNumber)`，支持单条展开/折叠，支持整体 `collapsed` 收起状态
2. **MainPage.tsx**: `handleNavigateToLine` 为空实现（TODO），侧边栏固定 `w-1/4` 宽度
3. **EditorScrollContainer.tsx**: 作为可滚动视口，渲染 Block Tree，但未暴露滚动到指定 block 的接口
4. **markdown.ts**: `extractOutline()` 提取标题时记录 `lineNumber`（Markdown 原始行号）
5. **blockTree.ts**: BlockNode 包含 `sourceLines: string[]`，可通过累加行数映射回原始行号
6. **uiStore.ts**: 已有 `isSidebarOpen` 控制侧边栏显隐，无 outline 折叠状态

### Technical Landscape

- React 18 + TypeScript
- 容器级 contentEditable 架构
- Zustand 状态管理
- Block Tree 不可变数据结构

## Functional Requirements

- **FR-1**: 点击目录中任意 n 级标题，编辑主区应滚动到该标题对应的 block 位置
- **FR-2**: 点击 Collapse outline 按钮收起目录后，编辑主区自动居中扩展（侧边栏宽度变为 0）
- **FR-3**: 展开目录时，编辑主区恢复为原来的布局（侧边栏占 1/4 宽度）
- **FR-4**: 多次快速点击不同标题，每次都应正确滚动到对应位置（防抖处理）
- **FR-5**: 空文档（无标题）时，目录收起/展开功能仍正常工作

## Non-Functional Requirements

- **NFR-1**: 点击目录到滚动完成的响应时间 < 200ms（不包含动画过渡）
- **NFR-2**: 滚动动画平滑，时长 150-300ms，使用 ease-out 缓动
- **NFR-3**: 代码变更不影响现有 Normal Mode / Source Code Mode 切换功能
- **NFR-4**: 新功能代码通过 ESLint 检查和现有单元测试

## Constraints

- **Technical**: 必须兼容现有 Block Tree 架构，不修改 BlockNode 数据结构
- **Technical**: 滚动定位基于 DOM 查询（`data-block-id` 属性），不引入新依赖
- **Business**: 保持 UI/UX 一致性，不改变现有交互模式
- **Dependencies**: 依赖 `getAllBlocksInOrder()` 的块遍历顺序

## Assumptions

- Block Tree 中每个 block 的 `sourceLines` 按文档顺序排列，可通过累加行数计算原始行号
- Heading block 的 `sourceLines[0]` 以 `#` 开头（已被 Markdown 检测器保证）
- DOM 中每个 block 都有 `data-block-id` 属性（由 BlockRenderer/HeadingBlock 保证）
- 用户在 Normal Mode 下使用目录导航（Source Code Mode 下目录导航行为可弱化）

## Acceptance Criteria

### AC-1: 目录点击导航

- **Given**: 编辑器处于 Normal Mode，文档包含至少一个 H1 标题
- **When**: 用户点击目录中的 H1 标题
- **Then**: 编辑主区平滑滚动到该标题所在 block，标题出现在视口顶部附近（scroll-margin-top: 24px）
- **Verification**: `programmatic`（通过 DOM scrollTop 验证）
- **Notes**: 滚动结束后无白屏或闪退

### AC-2: 多级标题导航

- **Given**: 编辑器处于 Normal Mode，文档包含 H1、H2、H3 多级标题
- **When**: 用户依次点击 H1、H2、H3 标题
- **Then**: 每次都正确滚动到对应 block 位置，标题内容可见
- **Verification**: `programmatic`

### AC-3: 收起目录后编辑区居中

- **Given**: 目录处于展开状态，编辑主区显示为 3/4 宽度
- **When**: 用户点击 Collapse outline 按钮
- **Then**: 侧边栏折叠为窄条（w-8），编辑主区自动扩展居中（maxWidth: 860px 保持，两侧留白增加）
- **Verification**: `human-judgment`
- **Notes**: 视觉上编辑区应居中显示在页面主体区域

### AC-4: 展开目录恢复布局

- **Given**: 目录处于收起状态
- **When**: 用户点击 Expand outline 按钮
- **Then**: 侧边栏恢复为原始宽度（w-1/4），编辑主区恢复为 3/4 宽度
- **Verification**: `human-judgment`

### AC-5: 空文档兼容

- **Given**: 新创建的空白文档（无标题）
- **When**: 用户展开/收起目录
- **Then**: 编辑主区布局正确调整，无异常行为
- **Verification**: `programmatic`

### AC-6: Source Code Mode 兼容

- **Given**: 编辑器处于 Source Code Mode
- **When**: 用户点击目录标题
- **Then**: 行为合理（可选择滚动 Monaco 编辑器或保持当前行为）
- **Verification**: `human-judgment`

## Open Questions

- [ ] Source Code Mode 下目录导航是否需要实现？Monaco 有原生 `revealLineInCenterIfOutsideViewport` 方法
- [ ] 滚动定位后是否需要将光标放置到目标 block 开始位置？
- [ ] 目录收起状态是否需要持久化到 localStorage？
