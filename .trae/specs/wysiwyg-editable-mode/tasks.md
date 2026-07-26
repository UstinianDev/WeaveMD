# WeaveMD - WYSIWYG 可编辑模式实现计划

## [x] Task 1: 设计编辑状态管理接口

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 BlockRenderer 和 EditorScrollContainer 中添加 onBlockContentChange 回调
  - 定义块内容变更的接口类型
- **Acceptance Criteria Addressed**: [AC-1, AC-2]
- **Test Requirements**:
  - `programmatic` TR-1.1: 类型定义正确，编译通过
  - `human-judgement` TR-1.2: 接口设计合理，回调参数包含 blockId 和新内容

## [x] Task 2: 修改 ParagraphBlock 组件支持 contentEditable

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 将 ParagraphBlock 改为可编辑模式，添加 contentEditable 属性
  - 实现 onChange 事件处理，将编辑内容传递给父组件
  - 处理失焦时触发内容同步
- **Acceptance Criteria Addressed**: [AC-1, AC-3]
- **Test Requirements**:
  - `programmatic` TR-2.1: 段落块渲染时包含 contentEditable 属性
  - `human-judgement` TR-2.2: 点击段落可输入文字，失焦后内容更新

## [x] Task 3: 修改 HeadingBlock 组件支持 contentEditable

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 将 HeadingBlock 改为可编辑模式，添加 contentEditable 属性
  - 实现 onChange 事件处理，将编辑内容传递给父组件
  - 处理失焦时触发内容同步
- **Acceptance Criteria Addressed**: [AC-2, AC-3]
- **Test Requirements**:
  - `programmatic` TR-3.1: 标题块渲染时包含 contentEditable 属性
  - `human-judgement` TR-3.2: 点击标题可输入文字，失焦后内容更新

## [x] Task 4: 实现 EditorScrollContainer 的内容变更处理

- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - 在 EditorScrollContainer 中实现 onBlockContentChange 处理逻辑
  - 更新 blockTree 中对应块的 sourceLines
  - 调用 serializeBlockTree 并更新 editorStore
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-3]
- **Test Requirements**:
  - `programmatic` TR-4.1: 编辑段落/标题后，editorStore.content 正确更新
  - `human-judgement` TR-4.2: 编辑后切换到源码模式，内容一致

## [x] Task 5: 确保其他块保持只读

- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 确认 CodeFenceBlock、BlockquoteBlock、ListItemBlock、TableBlock 保持只读
  - 添加注释明确这些块的编辑方式（通过源码模式）
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `human-judgement` TR-5.1: 代码块、引用块、列表项、表格无法直接编辑

## [x] Task 6: 验证快捷键兼容性

- **Priority**: medium
- **Depends On**: Task 4
- **Description**:
  - 测试 Ctrl+S、Ctrl+Z/Y、Ctrl+F、Ctrl+\` 在编辑状态下的行为
  - 确保快捷键不被 contentEditable 捕获
- **Acceptance Criteria Addressed**: [AC-5]
- **Test Requirements**:
  - `human-judgement` TR-6.1: 所有快捷键在编辑状态下正常工作

## [x] Task 7: 运行测试和类型检查

- **Priority**: high
- **Depends On**: All previous tasks
- **Description**:
  - 运行 `npm run test` 确保测试通过
  - 运行 `npm run typecheck` 确保类型正确
  - 运行 `npm run lint` 确保代码风格正确
- **Acceptance Criteria Addressed**: [所有 AC]
- **Test Requirements**:
  - `programmatic` TR-7.1: 所有测试通过
  - `programmatic` TR-7.2: 类型检查通过
  - `programmatic` TR-7.3: lint 检查通过
