# WeaveMD 目录交互优化 - Implementation Plan

## [ ] Task 1: 实现 lineNumber → blockId 映射函数
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在 `blockTree.ts` 中添加 `findBlockByLineNumber(tree, targetLine)` 函数
  - 遍历 BlockTree 的 blocks（按文档顺序），累加每个 block 的 sourceLines 行数，计算每个 block 的起止行号范围
  - 返回包含目标行号的 blockId
  - 处理边界情况：目标行号在文档前/后范围外
- **Acceptance Criteria Addressed**: AC-1, AC-2
- **Test Requirements**:
  - `programmatic` TR-1.1: 给定包含 H1、H2、段落的 BlockTree，调用 `findBlockByLineNumber` 返回正确的 blockId
  - `programmatic` TR-1.2: 目标行号在 block 边界时（如 H1 标题行号），返回该 block
  - `programmatic` TR-1.3: 目标行号超出文档范围时，返回 null
  - `programmatic` TR-1.4: 空 BlockTree 调用返回 null
- **Notes**: sourceLines 中每个元素代表一行，包括标题标记行

## [ ] Task 2: 为 EditorScrollContainer 添加滚动到 block 的能力
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `EditorScrollContainer`，通过 `useImperativeHandle` + `forwardRef` 暴露 `scrollToBlock(blockId: string)` 方法
  - 实现滚动逻辑：查找 `[data-block-id="${blockId}"]` 元素，调用 `scrollIntoView` 或直接设置容器 `scrollTop`
  - 滚动目标：将目标 block 定位到视口顶部（考虑 scroll-margin-top: 24px）
  - 添加平滑滚动动画（CSS scroll-behavior: smooth 或 JS 动画）
- **Acceptance Criteria Addressed**: AC-1, AC-2
- **Test Requirements**:
  - `programmatic` TR-2.1: 调用 `scrollToBlock` 后，目标 block 的 DOM 元素在视口内可见
  - `programmatic` TR-2.2: 传入不存在的 blockId 不报错，静默返回
  - `human-judgement` TR-2.3: 滚动动画平滑自然，无跳跃感
- **Notes**: 注意保留容器级 contentEditable 的 forwardRef 兼容性

## [ ] Task 3: EditorView 暴露滚动接口
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 修改 `EditorView`，接收 `onScrollToBlock` 回调 props 或通过 ref 暴露滚动方法
  - 将滚动调用转发给内部的 `EditorScrollContainer`
  - Source Code Mode 下可选择适配（调用 Monaco 的 `revealLineInCenterIfOutsideViewport`）
- **Acceptance Criteria Addressed**: AC-1, AC-6
- **Test Requirements**:
  - `programmatic` TR-3.1: EditorView 在 Normal Mode 下能正确将滚动请求转发给 EditorScrollContainer
  - `human-judgement` TR-3.2: Source Code Mode 下点击目录行为合理（可接受的降级处理）

## [ ] Task 4: 实现 MainPage 的 handleNavigateToLine
- **Priority**: high
- **Depends On**: Task 1, Task 3
- **Description**: 
  - 在 `MainPage.tsx` 中实现 `handleNavigateToLine(lineNumber)`
  - 步骤：通过 `editorStore.content` 获取当前 BlockTree → 调用 `findBlockByLineNumber` → 调用 EditorView 的 `scrollToBlock`
  - 需要获取 BlockTree 的方式：可以从 `editorStore` 获取或通过 `blockTreeRef`
  - 添加 50ms 防抖，避免快速连续点击
- **Acceptance Criteria Addressed**: AC-1, AC-2
- **Test Requirements**:
  - `programmatic` TR-4.1: 模拟点击目录标题，编辑器滚动到对应位置
  - `programmatic` TR-4.2: 快速连续点击不同标题，每次滚动正确
  - `programmatic` TR-4.3: 空文档时点击目录不报错

## [ ] Task 5: 将 OutlinePanel 折叠状态提升到父组件
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `OutlinePanel`：将内部 `collapsed` 状态改为受控 props（`collapsed` + `onToggleCollapse`）
  - 在 `uiStore` 中添加 `isOutlineCollapsed` 状态和 `toggleOutlineCollapse` 方法
  - OutlinePanel 从 uiStore 读取 collapsed 状态，调用 toggle 方法
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-5.1: OutlinePanel 收起/展开按钮正确触发 uiStore 状态变更
  - `human-judgement` TR-5.2: 目录收起/展开视觉效果正确

## [ ] Task 6: 更新 MainPage 布局响应目录折叠
- **Priority**: high
- **Depends On**: Task 5
- **Description**: 
  - 修改 `MainPage.tsx`：读取 `isOutlineCollapsed` 状态
  - 目录展开时：侧边栏 `w-1/4`，编辑器 `flex-1`
  - 目录收起时：侧边栏 `w-8`（仅显示展开按钮），编辑器 `flex-1`（自动扩展）
  - 编辑器内容区 `maxWidth: 860px` 保持不变，通过两侧留白实现居中
  - 过渡动画：宽度变化添加 transition 效果
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5
- **Test Requirements**:
  - `programmatic` TR-6.1: 目录收起后侧边栏宽度变为 w-8，编辑器自动扩展
  - `programmatic` TR-6.2: 目录展开后恢复原始布局
  - `human-judgement` TR-6.3: 编辑器内容在页面主体区域视觉居中
  - `programmatic` TR-6.4: 空文档时布局切换正常

## [ ] Task 7: 集成测试与验证
- **Priority**: high
- **Depends On**: Task 1-6
- **Description**: 
  - 编写集成测试：模拟用户点击目录 → 验证编辑器滚动行为
  - 运行全量测试套件确保无回归
  - 手动验证：启动 dev server，测试完整交互流程
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
- **Test Requirements**:
  - `programmatic` TR-7.1: `npm run lint` 通过
  - `programmatic` TR-7.2: `npm run test` 全部通过
  - `human-judgement` TR-7.3: 手动测试所有 Acceptance Criteria
