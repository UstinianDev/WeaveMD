# Typora 式一体化实时 Markdown 编辑器 Spec

## Why
当前代码虽然已经移除了双栏预览，但现有方案仍主要停留在“语法显隐”层，缺少 Typora 式单界面实时排版的完整交互定义。需要重新校正目标，明确 WeaveMD 应以单一编辑画布承载 Markdown 输入、块级激活编辑和离块自动排版渲染，避免再次回到预览模式思路。

## What Changes
- 新建单界面实时富文本编辑规格，明确“源文本模型不变、显示态按块渲染”的核心原则
- 定义块级生命周期：进入区块显示完整 Markdown 源语法，离开区块或完成输入后切换为排版态
- 扩展区块范围，从单纯语法显隐提升为标题、段落、列表、任务列表、引用、代码块、表格等块级排版体验
- 明确保留 Monaco Editor、Zustand、现有文件存储与历史记录能力
- **BREAKING** 完全禁止任何预览模式入口、双栏预览布局和预览状态持久化逻辑

## Impact
- Affected specs: 编辑器主交互、Markdown 渲染链、顶部栏操作、浮动工具栏、主题样式、测试与验收
- Affected code: `src/render/pages/MainPage.tsx`、`src/render/components/Editor/EditorView.tsx`、`src/render/components/Navbar/TopBar.tsx`、`src/render/components/Editor/FloatingToolbar.tsx`、`src/render/stores/uiStore.ts`、`src/render/services/markdownBlockDetector.ts`、`src/render/services/markdown.ts`、`src/render/styles/globals.css`

## ADDED Requirements
### Requirement: 单界面实时排版编辑
系统 SHALL 提供单一编辑画布，不再通过独立预览面板展示 Markdown 排版结果。

#### Scenario: 打开编辑器
- **WHEN** 用户打开一个 Markdown 文件
- **THEN** 主界面只显示一个编辑画布，用户直接在画布中输入和查看排版结果

### Requirement: 块级激活与离块渲染
系统 SHALL 以 Markdown 区块为单位维护“编辑态”和“排版态”两种显示状态。

#### Scenario: 光标进入区块
- **WHEN** 光标进入某个标题、段落、列表项、任务项、引用块、代码块或表格单元所在区块
- **THEN** 当前区块显示完整原始 Markdown 语法，便于直接编辑

#### Scenario: 光标离开区块
- **WHEN** 光标移动到其他区块、编辑器失焦，或用户完成当前区块输入并切换到下一块
- **THEN** 原区块隐藏 Markdown 控制符并恢复为排版态

### Requirement: 块完成后的自动排版反馈
系统 SHALL 在用户完成当前块后自动展示该块的排版结果，而不要求用户手动切换模式。

#### Scenario: 回车进入下一块
- **WHEN** 用户在标题、段落、列表项、引用或任务项中完成输入并按下 `Enter` 进入下一块
- **THEN** 已完成的上一块立即以对应排版样式显示，新光标所在块保持编辑态

#### Scenario: 鼠标或键盘切换区块
- **WHEN** 用户通过点击、方向键或大纲导航切换到其他区块
- **THEN** 离开的区块自动进入排版态，目标区块进入编辑态

### Requirement: 排版态视觉层级
系统 SHALL 在排版态下提供接近 Typora 的层级化样式，让标题、正文、列表、引用、代码块和表格具备清晰的视觉差异。

#### Scenario: 查看非激活区块
- **WHEN** 用户浏览未被激活的 Markdown 内容
- **THEN** 标题字号和间距具有明显层级，任务列表已完成项带删除线，引用块和代码块具有独立样式，表格具备表头和边框视觉

### Requirement: 原始内容模型保持不变
系统 SHALL 仅改变显示状态，不改变底层 Markdown 正文内容与存储格式。

#### Scenario: 保存文件
- **WHEN** 用户保存或自动保存文档
- **THEN** 落盘内容仍是标准 Markdown 源文本，不写入额外富文本标记

### Requirement: 文档行号清理
系统 SHALL 在排版态中完全过滤正文左侧裸数字行号，避免其作为正文内容被渲染。

#### Scenario: 文档包含每行序号
- **WHEN** 编辑器加载包含左侧行号的 Markdown 文本
- **THEN** 排版态不展示这些文档行号，且原始文本内容不被静默改写

## MODIFIED Requirements
### Requirement: 编辑器主工作流
系统 SHALL 以“单界面实时编辑 + 块级自动排版”为主工作流，而不是“源码编辑 + 独立预览”双流程。

#### Scenario: 用户持续写作
- **WHEN** 用户连续输入多个 Markdown 区块
- **THEN** 每次只聚焦当前块的源语法编辑，其余块以排版态呈现，用户无需切换视图

### Requirement: 浮动工具栏定位
系统 SHALL 保持浮动工具栏存在，但其定位和可见性必须适配单界面排版编辑场景。

#### Scenario: 选中文本
- **WHEN** 用户在当前激活块中选中文本
- **THEN** 浮动工具栏以靠近选区且偏右的位置显示，不遮挡当前排版内容

## REMOVED Requirements
### Requirement: 预览模式与预览状态
**Reason**: 预览模式与 Typora 式一体化编辑目标冲突，会把用户重新带回编辑态与预览态分离的旧交互。
**Migration**: 移除 `TopBar` 中的预览切换入口、`uiStore` 中的预览状态、`MainPage` 中的双栏预览布局，以及所有依赖 `MarkdownPreview` 的主流程逻辑。
