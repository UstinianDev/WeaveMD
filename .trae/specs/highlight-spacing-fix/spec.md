# 高亮动画段落间距收缩修复 + 底部空白区域扩展 Spec

## Why
点击目录标题时，编辑主区对应标题的动态高亮动画会触发段落间距收缩——因为 `.editor-block-highlight` 的 `margin: 0 -6px` 将上下 margin 强制设为 0，覆盖了块原有的垂直间距。动画结束后 class 移除，间距复原，造成视觉抖动。同时底部空白区域仍不足以让最后几个标题滚动到检测线位置。

## What Changes
- 修复 `.editor-block-highlight` CSS：仅影响水平方向 margin/padding，不覆盖垂直间距
- 将编辑主区底部 padding 从固定 400px 改为动态 `50vh`，确保最后几个标题能滚动到检测线

## Impact
- Affected code: `src/render/styles/globals.css`、`src/render/components/Editor/EditorScrollContainer.tsx`

## MODIFIED Requirements
### Requirement: 高亮动画不应影响布局
高亮动画 class 仅修改背景色和水平方向 padding/margin，不得覆盖块的垂直 margin/padding。

#### Scenario: 点击目录标题
- **WHEN** 用户点击目录标题
- **THEN** 对应标题出现紫色渐隐高亮
- **AND** 该标题及后续内容的段落间距保持不变（无收缩抖动）

### Requirement: 底部空白区域足够大
编辑主区底部 padding 应为动态值（`50vh`），确保文档最后几个标题能滚动到检测线位置。

#### Scenario: 滚动到底部
- **WHEN** 用户滚动到编辑主区底部
- **THEN** 最后几个标题能到达检测线（视口 1/4 处）
- **AND** 目录高亮正确指向最后可见标题
