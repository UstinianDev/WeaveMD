# Outline UI 细调优化 - 产品需求文档

## Overview

- **Summary**: 对目录面板进行视觉优化，增大字体和行间距以提升可读性，移除最大宽度限制以允许用户在宽屏环境下充分利用空间。
- **Purpose**: 提升文档大纲的阅读体验和灵活性，解决目录字体偏小、间距过密、宽度受限的问题。
- **Target Users**: 所有使用 WeaveMD 编辑器的用户，特别是在宽屏显示器上工作的开发者和写作者。

## Goals

- 增大目录字体尺寸，使各级标题更易辨识
- 增加目录标题行间距，提升视觉舒适度
- 移除目录最大宽度限制，允许拖拽至任意宽度
- 确保编辑主区随目录宽度变化自动调整

## Non-Goals (Out of Scope)

- 不改变目录的层级结构和导航逻辑
- 不修改动态高亮功能
- 不调整滚动条样式
- 不涉及暗色/亮色主题适配

## Background & Context

- 当前目录字体：H1=text-lg(18px), H2=text-base(16px), H3=text-sm(14px)
- 当前行间距：py-0.5(2px)，过密影响阅读
- 当前宽度限制：最小200px，最大500px
- 编辑区已使用 flex-1 布局，能自适应目录宽度变化

## Functional Requirements

### FR-1: 目录字体增大

- H1 标题字体从 text-lg(18px) 增大到 text-xl(20px)
- H2 标题字体从 text-base(16px) 增大到 text-lg(18px)
- H3 标题字体从 text-sm(14px) 增大到 text-base(16px)
- 保持字体粗细层级：H1(font-bold), H2(font-semibold), H3(font-medium)

### FR-2: 目录行间距增大

- 每个目录标题项的上下间距从 py-0.5(2px) 增大到 py-1.5(6px)
- 确保标题间有足够视觉分隔

### FR-3: 移除最大宽度限制

- 移除 setOutlineWidth 中的 Math.min(500, ...) 限制
- 仅保留最小宽度 200px
- 用户可拖拽目录至任意宽度（包括整个应用宽度）

### FR-4: 编辑区自适应

- 编辑主区在目录宽度变化时自动调整（已通过 flex-1 实现）
- 拖拽过程中无布局抖动或闪烁

## Non-Functional Requirements

### NFR-1: 视觉一致性

- 字体增大后确保不与容器边界冲突
- 行间距增大后确保滚动流畅

### NFR-2: 响应性能

- 宽度拖拽过程中响应流畅，无明显卡顿
- 字体和间距变化不影响渲染性能

## Constraints

- **Technical**: 必须使用 TailwindCSS 工具类
- **Dependencies**: 依赖 uiStore 的 outlineWidth 状态管理

## Assumptions

- 用户使用标准桌面显示器（1366x768 及以上）
- 目录最小宽度 200px 为合理下限
- 字体增大不会导致在小宽度下内容截断

## Acceptance Criteria

### AC-1: 字体大小调整

- **Given**: 目录面板已展开
- **When**: 查看不同层级的标题
- **Then**: H1 显示为 text-xl(20px) font-bold, H2 显示为 text-lg(18px) font-semibold, H3 显示为 text-base(16px) font-medium
- **Verification**: `programmatic`

### AC-2: 行间距增大

- **Given**: 目录面板已展开
- **When**: 查看目录列表
- **Then**: 每个标题项有 py-1.5(6px) 的上下内边距
- **Verification**: `programmatic`

### AC-3: 无最大宽度限制

- **Given**: 用户拖拽目录右边缘
- **When**: 向右拖拽超过 500px
- **Then**: 目录宽度继续增加，不受 500px 限制
- **Verification**: `programmatic`

### AC-4: 编辑区自适应

- **Given**: 目录宽度变化
- **When**: 拖拽调整目录宽度
- **Then**: 编辑主区自动调整宽度，填满剩余空间
- **Verification**: `human-judgment`

### AC-5: 构建验证通过

- **Given**: 代码修改完成
- **When**: 运行 npm run typecheck, lint, test
- **Then**: 所有检查通过
- **Verification**: `programmatic`

## Open Questions

- 无
