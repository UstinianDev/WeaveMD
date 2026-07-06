# WeaveMD 细节调优 v2 - Product Requirement Document

## Overview

对 WeaveMD 应用进行第二次细节调优，优化浮动工具栏位置、重构目录与编辑区布局、实现所见即所得的实时渲染功能。

## Goals

- 调整浮动工具栏位置：进一步缩小间距，向右居中对齐
- 重构目录与编辑区布局：固定 1:3 比例，无冗余空间，增大字体
- 实现所见即所得的实时渲染：每编辑一行内容都自动渲染为预览形式
- 使用 /frontend-design 和 /impeccable 技能进行设计和实现
- 代码审查并推送到 GitHub 的 pengwenhua59-dev/WeaveMD 仓库

## Non-Goals (Out of Scope)

- 不改变整体应用架构
- 不添加新的编辑器功能（除渲染外）
- 不修改用户认证和文件存储系统
- 不实现完全的双栏编辑模式（使用原有的预览模式）

## Background & Context

WeaveMD 是基于 Electron + React 18 + TypeScript 的 Markdown 可视化笔记桌面应用，之前已经完成了多轮 UI 调优。当前需要：

1. 进一步优化浮动工具栏位置
2. 重构目录编辑区布局
3. 实现真正的所见即所得渲染

## Functional Requirements

- **FR-1**: 浮动工具栏位置优化 - 更靠近选中文本，向右居中对齐
- **FR-2**: 目录编辑区布局重构 - 固定 1:3 比例，无冗余空间
- **FR-3**: 目录和编辑区字体增大
- **FR-4**: 实现所见即所得渲染 - 每行编辑内容自动渲染为预览
- **FR-5**: 可选技术栈集成 - 如需要添加合适的实时渲染库

## Non-Functional Requirements

- **NFR-1**: 界面响应流畅，无明显卡顿
- **NFR-2**: 保持深色主题（#0F0F0F 背景，#7C3AED 强调色）
- **NFR-3**: 渲染性能良好，打字延迟不超过 100ms
- **NFR-4**: 所有修改符合现有代码风格和规范

## Constraints

- **Technical**: 使用现有 React + TypeScript + Electron 栈，可按需添加渲染库
- **Business**: 保持现有的用户数据和文件结构不变
- **Dependencies**: 依赖现有 Monaco Editor、zustand 等库

## Assumptions

- 用户已安装所有必要的依赖
- 现有应用功能正常运行
- 用户有 GitHub 仓库访问权限

## Acceptance Criteria

### AC-1: 浮动工具栏位置优化

- **Given**: 用户选中编辑器中的文本
- **When**: 浮动工具栏出现
- **Then**:
  - 工具栏与选中文本的间距进一步缩小（比之前更小）
  - 工具栏与选中文本水平居中对齐
- **Verification**: human-judgment

### AC-2: 目录编辑区布局重构

- **Given**: 用户打开应用并显示目录
- **When**: 查看主界面布局
- **Then**:
  - 目录占宽度的 1/4，编辑区占 3/4
  - 无任何冗余空间或多余区域
  - 目录和编辑区的字体都适当增大
- **Verification**: human-judgment

### AC-3: 所见即所得渲染

- **Given**: 用户正在编辑 Markdown 文件
- **When**: 用户输入/编辑内容
- **Then**: 内容以预览形式实时渲染，保持可编辑性
- **Verification**: human-judgment

### AC-4: 技术实现和提交

- **Given**: 所有功能开发完成
- **When**: 运行 npm run dev 审查，然后提交并推送
- **Then**:
  - 所有 TypeScript 和 ESLint 检查通过
  - 应用正常运行无错误
  - 代码成功推送到 GitHub 远程仓库
- **Verification**: programmatic

## Open Questions

- 实时渲染功能的具体实现方式（是否使用特定的 WYSIWYG 库？）
