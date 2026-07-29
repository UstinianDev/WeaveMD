# Outline UI Optimization Spec

## Why
目录面板字体过小不便于阅读，宽度固定无法适配不同文档结构，编辑器滚动条过细（6px）难以点击选中。需要优化目录可读性、增加可拖拽宽度调整、替换细滚动条为更宽的滑块样式。

## What Changes
- 目录标题字体适当增大（H1: text-lg, H2: text-base, H3: text-sm）
- 目录面板宽度从固定 `w-1/4` 改为可拖拽调整（默认 280px，范围 200-500px）
- 目录面板与编辑器滚动条宽度从 6px 增大到 10px，并优化滑块样式（圆角 + 悬停加粗）
- 目录面板添加自定义滚动条样式（区别于全局滚动条）
- 拖拽过程中添加视觉反馈（边框高亮）

## Impact
- Affected code: `OutlinePanel.tsx`, `MainPage.tsx`, `uiStore.ts`, `globals.css`
- Affected specs: outline-navigation (布局部分需更新)

## ADDED Requirements

### Requirement: Resizable Outline Panel
The system SHALL allow the user to dynamically resize the outline panel width by dragging a handle on the panel's right border.

#### Scenario: Drag to resize
- **WHEN** user presses mouse on the outline panel's right border drag handle
- **AND** drags horizontally
- **THEN** outline panel width adjusts in real-time, constrained to 200-500px range
- **AND** editor area width adjusts accordingly to fill remaining space

#### Scenario: Persistence
- **WHEN** user resizes the outline panel
- **THEN** the new width persists across page reloads via uiStore

### Requirement: Thicker Scrollbar Slider
The system SHALL display a wider scrollbar (10px) with rounded thumb for the editor scroll container and outline panel, replacing the current 6px thin scrollbar.

#### Scenario: Scrollbar visibility
- **WHEN** content overflows in the editor area or outline panel
- **THEN** a 10px wide scrollbar track with a rounded, semi-transparent thumb is displayed
- **AND** hovering the thumb increases its visibility

## MODIFIED Requirements

### Requirement: Outline Panel Typography
目录标题字体级别调整为：H1 `text-lg font-semibold`，H2 `text-base font-medium`，H3 `text-sm`，提升可读性。

### Requirement: Outline Panel Layout
目录面板宽度从固定 `w-1/4` 改为受控的动态像素宽度（`outlineWidth`），由 uiStore 管理。
