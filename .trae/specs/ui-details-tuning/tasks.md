# WeaveMD - UI 细节调优实现计划

## [x] Task 1: 调整浮动工具栏垂直间距

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 FloatingToolbar.tsx 中的 top 计算逻辑
  - 将当前的 top: startCoords.top - 50 调整为更小的值
- **Acceptance Criteria Addressed**: [AC-1]
- **Test Requirements**:
  - `human-judgement` TR-1.1: 选中文本时，浮动工具栏与选中文本的垂直间距明显缩小
  - `human-judgement` TR-1.2: 工具栏仍然完全可见且不会遮挡选中文本
- **Notes**: 建议调整为 startCoords.top - 40 或更小值，根据视觉效果调整

## [x] Task 2: 调整目录右侧边缘线与编辑器行号间距

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 MainPage.tsx 中的编辑器容器 padding
  - 将当前的 pl-4 (16px) 缩小为更小的固定值
- **Acceptance Criteria Addressed**: [AC-2, AC-3]
- **Test Requirements**:
  - `human-judgement` TR-2.1: 目录右侧边缘线与编辑器行号的间距明显缩小
  - `human-judgement` TR-2.2: 调整目录宽度时，该间距保持不变
- **Notes**: 建议调整为 4px (pl-1) 或 8px (pl-2)，根据视觉效果调整
