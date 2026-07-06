# UI 细节进一步调优 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: 进一步缩小浮动工具栏与选中文本的间距

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 FloatingToolbar.tsx 中的定位计算，将间距从 35px 进一步缩小到更合适的值
  - 测试选中第一行文本时工具栏的位置是否合理
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `human-judgment` TR-1.1: 选中第一行文本时，浮动工具栏位置不会过高
  - `human-judgment` TR-1.2: 选中其他行文本时，浮动工具栏位置合适
- **Notes**: 建议尝试将间距从 35px 调整到 25px 左右

## [x] Task 2: 进一步缩小目录右侧边缘线与编辑器行号的间距

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 MainPage.tsx 中的编辑器容器 padding，将间距从 4px 进一步缩小到更小的值
  - 确保调整目录宽度时间距保持固定
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `human-judgment` TR-2.1: 目录右侧边缘线与编辑器行号间距进一步缩小
  - `human-judgment` TR-2.2: 拖动调整目录宽度时，间距保持固定不变
- **Notes**: 建议尝试将间距从 4px 调整到 2px 或 0px
