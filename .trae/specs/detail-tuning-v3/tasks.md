# WeaveMD 细节调优 V3 - 实现计划

## [/] Task 1: 浮动工具栏位置优化

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 FloatingToolbar.tsx 中的位置计算逻辑
  - 将垂直间距从 10px 调整为 5px
  - 将水平位置从居中对齐调整为靠右对齐（以选中文本右侧为参考）
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `human-judgment`: 验证工具栏位置是否符合要求
- **Notes**: 保持工具栏的完整功能不变，仅调整位置计算

## [x] Task 2: 移除预览模式相关代码

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 从 uiStore.ts 中移除 isPreviewMode 状态及相关方法
  - 从 MainPage.tsx 中移除双栏布局逻辑，统一为单一 EditorView
  - 从 TopBar.tsx 中移除预览模式切换按钮（如存在）
  - 更新相关类型定义和文档
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `programmatic`: 运行 TypeScript 类型检查和 ESLint
  - `human-judgment`: 验证界面无预览模式相关元素
- **Notes**: 确保 MarkdownPreview 组件可能被移除或保留但不再使用

## [x] Task 3: 实现 Markdown 区块检测逻辑

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 创建一个新的服务模块 `src/render/services/markdownBlockDetector.ts`
  - 实现区块类型检测函数：识别标题、强调、列表、引用、代码、链接等区块
  - 实现区块边界检测函数：确定当前光标所在区块的开始和结束位置
  - 编写单元测试验证检测逻辑
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `programmatic`: 运行单元测试验证检测逻辑
  - `human-judgment`: 测试各种区块类型的识别准确性
- **Notes**: 需要处理复杂的嵌套情况，以最内层语法为优先

## [x] Task 4: 实现 Monaco Editor Decorations 管理

- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - 在 EditorView.tsx 中集成区块检测器
  - 创建装饰器管理模块，控制语法标记的显示/隐藏
  - 实现光标位置变化时的装饰器更新逻辑
  - 使用 Monaco Editor 的 Decorations API 来隐藏/显示语法标记
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5
- **Test Requirements**:
  - `programmatic`: 验证装饰器正确应用和移除
  - `human-judgment`: 测试语法标记的显示/隐藏交互
- **Notes**: 隐藏语法标记时使用透明或极小字体的装饰器

## [ ] Task 5: 优化渲染和样式

- **Priority**: medium
- **Depends On**: Task 4
- **Description**:
  - 确保无语法标记时的美化渲染效果正确
  - 调整编辑器样式，确保隐藏语法标记后的视觉效果美观
  - 测试各种 Markdown 元素的渲染效果
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `human-judgment`: 验证渲染效果美观
- **Notes**: 参考 Typora 或类似产品的视觉效果

## [ ] Task 6: 全面功能测试和回归验证

- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 4, Task 5
- **Description**:
  - 测试所有现有功能是否正常工作
  - 运行完整的测试套件
  - 进行手动回归测试
  - 验证性能满足要求
- **Acceptance Criteria Addressed**: AC-6, AC-5
- **Test Requirements**:
  - `programmatic`: 运行完整测试套件和代码检查
  - `human-judgment`: 全面手动测试
- **Notes**: 特别注意自动保存、快捷键、浮动工具栏等核心功能

## [ ] Task 7: 代码规范检查和 Git 提交

- **Priority**: medium
- **Depends On**: Task 6
- **Description**:
  - 运行 `npm run dev` 检查代码规范
  - 确保所有 TypeScript 类型正确
  - 整理和提交所有更改
  - 准备推送到 GitHub
- **Acceptance Criteria Addressed**: 实现注意事项
- **Test Requirements**:
  - `programmatic`: 通过所有代码规范检查
- **Notes**: 按照项目规范进行提交
