# 最终细节调优 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: 进一步缩小浮动工具栏与选中文本的间距

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 FloatingToolbar.tsx，将间距从 25px 进一步缩小
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - human-judgment: 验证选中第一行时工具栏位置合适
  - human-judgment: 验证选中其他行时工具栏位置合适
- **Notes**: 建议尝试 20px 间距

## [x] Task 2: 进一步缩小目录右侧边缘线与编辑器行号的间距

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 MainPage.tsx，将间距从 2px 进一步缩小
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - human-judgment: 验证间距进一步缩小
  - human-judgment: 验证调整目录宽度时间距保持固定
- **Notes**: 建议尝试 0px 或 1px 间距

## [x] Task 3: 在 UI Store 中添加预览模式状态

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 uiStore.ts 中添加 isPreviewMode 状态及切换方法
  - 持久化预览模式设置
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - human-judgment: 验证状态管理正确
  - human-judgment: 验证设置持久化有效

## [x] Task 4: 扩展 Markdown 服务，添加渲染 HTML 功能

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 markdown.ts 中添加 renderMarkdownToHtml 函数
  - 使用 rehype-stringify 将 Markdown 渲染为 HTML
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - programmatic: 测试 Markdown 渲染函数
  - human-judgment: 验证渲染效果正确

## [x] Task 5: 创建 Markdown 预览组件

- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - 创建 MarkdownPreview.tsx 组件
  - 实现安全的 HTML 渲染
  - 添加针对深色/浅色主题的样式
  - 支持代码高亮
- **Acceptance Criteria Addressed**: AC-4, AC-5
- **Test Requirements**:
  - human-judgment: 验证预览样式美观
  - human-judgment: 验证主题适配正确

## [x] Task 6: 修改 MainPage 布局，支持预览模式

- **Priority**: high
- **Depends On**: Task 3, Task 5
- **Description**:
  - 修改 MainPage.tsx，根据预览模式切换布局
  - 实现双栏布局（编辑器 + 预览）
  - 保持现有单栏布局为默认
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - human-judgment: 验证布局切换正确
  - human-judgment: 验证双栏布局美观

## [x] Task 7: 在顶部栏添加预览模式切换按钮

- **Priority**: medium
- **Depends On**: Task 3
- **Description**:
  - 修改 TopBar.tsx，添加预览切换按钮
  - 添加国际化支持
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - human-judgment: 验证按钮功能正常
  - human-judgment: 验证国际化显示正确

## [/] Task 8: 添加预览样式到全局 CSS

- **Priority**: medium
- **Depends On**: Task 5
- **Description**:
  - 在 globals.css 中添加 Markdown 预览样式
  - 针对深色/浅色主题分别定义样式
  - 确保代码块、表格等元素样式美观
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - human-judgment: 验证预览样式美观
  - human-judgment: 验证主题适配正确
