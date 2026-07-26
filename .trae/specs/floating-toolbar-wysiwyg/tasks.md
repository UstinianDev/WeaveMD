# WeaveMD - 浮动工具栏 WYSIWYG 实现计划

## [/] Task 1: 创建 WYSIWYG 浮动工具栏组件

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 创建新的 FloatingToolbarWYSIWYG 组件，支持非源码模式下的文本选择检测
  - 实现选择检测逻辑，判断是否跨多个块
  - 实现工具栏定位逻辑
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-9
- **Test Requirements**:
  - `human-judgment` TR-1.1: 浮动工具栏在非源码模式下选中文本时显示
  - `human-judgment` TR-1.2: 浮动工具栏在源码模式下不显示
  - `human-judgment` TR-1.3: 跨块选择时不显示浮动工具栏
- **Notes**: 需要监听 document 的 selectionchange 事件

## [ ] Task 2: 实现结构转换功能

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 在浮动工具栏中添加结构下拉菜单
  - 实现段落类型转换逻辑（正文↔标题↔列表↔代码块↔引用）
  - 调用 blockTree 的 updateBlockType 函数
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `human-judgment` TR-2.1: 点击结构下拉菜单显示所有选项
  - `human-judgment` TR-2.2: 选择结构选项后段落类型正确转换
- **Notes**: 需要确认 blockTree 是否有 updateBlockType 函数，如果没有需要添加

## [ ] Task 3: 实现文本格式化功能

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 实现粗体、斜体、下划线、高亮、代码格式化
  - 在选中的文本前后添加相应的 Markdown 语法
  - 支持 toggle（如果已格式化则移除格式）
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `human-judgment` TR-3.1: 点击格式化按钮后文本正确格式化
  - `human-judgment` TR-3.2: 再次点击同一按钮可移除格式
- **Notes**: 需要在段落的 sourceLines 中修改文本

## [ ] Task 4: 实现超链接功能

- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 实现添加超链接功能
  - 将选中的文本转换为 [text](url) 格式
  - 选中 url 部分便于编辑
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `human-judgment` TR-4.1: 点击超链接按钮后文本转换为链接格式
  - `human-judgment` TR-4.2: url 部分被选中便于编辑
- **Notes**: 需要处理光标位置

## [ ] Task 5: 实现评论功能

- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 实现评论功能，使用 Markdown 脚注或引用语法
  - 在选中位置插入评论标记
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `human-judgment` TR-5.1: 点击评论按钮后插入评论标记
- **Notes**: 需要确定评论的具体语法格式

## [ ] Task 6: 实现 MD 源码显示功能

- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 实现 MD 源码显示功能
  - 点击按钮后显示当前段落的 Markdown 源码
  - 点击其他位置恢复富文本格式
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `human-judgment` TR-6.1: 点击 MD 源码按钮后显示源码
  - `human-judgment` TR-6.2: 点击其他位置恢复富文本格式
- **Notes**: 需要使用现有的 mdSourceBlockId 机制

## [ ] Task 7: 在 EditorView 中集成浮动工具栏

- **Priority**: high
- **Depends On**: Task 1-6
- **Description**:
  - 在 EditorView 中渲染 FloatingToolbarWYSIWYG 组件
  - 传递必要的 props（blockTree, content, updateContent 等）
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-9
- **Test Requirements**:
  - `human-judgment` TR-7.1: 浮动工具栏在非源码模式下正常显示
  - `human-judgment` TR-7.2: 所有功能按钮正常工作
- **Notes**: 需要确保在源码模式下不渲染

## [ ] Task 8: 更新文档

- **Priority**: low
- **Depends On**: Task 7
- **Description**:
  - 更新 .claude/CLAUDE.md 中的架构说明
  - 更新 docs/modules/04-编辑主区-Editor.md 中的功能说明
- **Acceptance Criteria Addressed**: 文档更新
- **Test Requirements**:
  - `human-judgment` TR-8.1: 文档内容准确反映新功能
- **Notes**: 内容保持简洁
