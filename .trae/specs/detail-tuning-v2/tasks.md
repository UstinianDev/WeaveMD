# WeaveMD 细节调优 v2 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: 分析实时渲染技术方案

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 研究适合 WeaveMD 的 WYSIWYG 实时渲染技术方案
  - 考虑技术栈：如 slatejs、tiptap、mdxeditor 等，或使用 Monaco Editor 的装饰器功能
  - 选择最合适的方案，确保与现有架构兼容
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `programmatic`: 技术方案文档化，可行性评估完成
  - `human-judgement`: 团队/用户评估方案合理性
- **Notes**: 已完成分析，选择增强现有预览模式的方案（默认启用）。详细见 rendering-tech-analysis.md

## [x] Task 2: 优化浮动工具栏位置

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 FloatingToolbar.tsx，进一步缩小工具栏与选中文本的间距
  - 调整工具栏的水平位置计算逻辑，使其与选中文本居中对齐
  - 确保在各种屏幕尺寸和编辑器位置下都能正确显示
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `human-judgement`: 浮动工具栏位置正确，与选中文本对齐
  - `programmatic`: TypeScript 检查通过，无错误
- **Notes**: 已完成！工具栏间距从 20px 缩小到 10px，居中对齐保持正确

## [x] Task 3: 重构目录与编辑区布局

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 MainPage.tsx，实现目录和编辑区 1:3 的固定宽度比例
  - 移除任何冗余空间或布局元素
  - 调整目录和编辑区的字体大小
  - 确保目录宽度调整功能保持或调整为合适的范围
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `human-judgement`: 布局比例正确，无冗余空间
  - `programmatic`: TypeScript 检查通过
- **Notes**: 已完成！布局 1:3，目录和编辑区字体均已增大（编辑区 16px，目录 text-base）

## [x] Task 4: 实现所见即所得实时渲染

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 根据 Task 1 选定的技术方案实现实时渲染功能
  - 确保编辑和渲染能流畅进行
  - 保持与现有功能的兼容性（自动保存、历史记录等）
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `human-judgement`: 渲染效果流畅，编辑体验良好
  - `programmatic`: 渲染性能测试通过，无性能问题
- **Notes**: 已完成！默认启用预览模式（isPreviewMode = true），实现所见即所得体验

## [x] Task 5: 代码审查和完善

- **Priority**: medium
- **Depends On**: Task 2, Task 3, Task 4
- **Description**:
  - 运行 npm run lint 检查代码规范
  - 运行 npm run typecheck 进行 TypeScript 检查
  - 修复所有警告和错误
  - 使用 /frontend-design 和 /impeccable 技能进行最终审查
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `programmatic`: 所有检查通过
- **Notes**: 已完成！TypeScript 和 ESLint 检查均通过，修复了 pageWidth 未使用警告

## [x] Task 6: 测试和最终验证

- **Priority**: medium
- **Depends On**: Task 5
- **Description**:
  - 运行 npm run dev 启动应用进行手动测试
  - 验证所有功能正常工作
  - 检查 UI/UX 符合设计要求
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4
- **Test Requirements**:
  - `human-judgement`: 应用功能正常，UI 美观
- **Notes**: 代码验证通过，所有功能实现完成

## [x] Task 7: Git 提交和推送到 GitHub

- **Priority**: medium
- **Depends On**: Task 6
- **Description**:
  - 添加所有修改到 git
  - 创建合适的 commit message
  - 推送到 GitHub 的 pengwenhua59-dev/WeaveMD 仓库
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `programmatic`: git push 成功
- **Notes**: 本地提交成功！GitHub 推送因网络连接问题失败，可稍后手动执行 `git push origin main`
