# Tasks

- [x] Task 1: 清理旧交互入口并固定单画布架构
  - [x] SubTask 1.1: 复核 `MainPage.tsx`、`TopBar.tsx`、`uiStore.ts`，删除所有预览模式残留入口和状态
  - [x] SubTask 1.2: 明确主工作区只保留一个编辑画布，同时保留大纲、历史面板和设置弹窗
  - [x] SubTask 1.3: 校准浮动工具栏在单画布场景下的位置基准与显示条件
  - [x] Validation: 手动确认界面不存在预览切换按钮、双栏布局和预览相关状态

- [x] Task 2: 定义块级编辑状态机与区块边界
  - [x] SubTask 2.1: 基于现有 `markdownBlockDetector.ts` 重构区块识别，明确标题、段落、列表、任务项、引用、代码块、表格等边界
  - [x] SubTask 2.2: 定义“当前激活块”“最近离开块”“连续输入块”的切换规则
  - [x] SubTask 2.3: 明确键盘、鼠标、失焦、大纲跳转等入口如何驱动块状态变化
  - [x] Validation: 用单元测试覆盖边界识别和块切换规则

- [x] Task 3: 在编辑器中落地 Typora 式块级显示切换
  - [x] SubTask 3.1: 重构 `EditorView.tsx`，让当前块显示完整 Markdown 源语法
  - [x] SubTask 3.2: 让非当前块自动隐藏控制符并应用对应排版样式
  - [x] SubTask 3.3: 处理回车换块、方向键跨块、点击切块、失焦恢复等关键交互
  - [x] Validation: 手动验证连续写作时，上一块会在离块后立即进入排版态

- [x] Task 4: 补齐排版态渲染与视觉层级
  - [x] SubTask 4.1: 在 `markdown.ts` 和相关样式中补齐排版态所需的结构信息
  - [x] SubTask 4.2: 在 `globals.css` 中落实标题层级、正文节奏、任务列表、引用块、代码块、表格、高亮与 HTML 注释样式
  - [x] SubTask 4.3: 确保文档左侧裸数字行号只在排版链路中被过滤，不直接篡改原始正文
  - [x] Validation: 用真实 Markdown 样例验证各类元素的视觉差异和深浅主题表现

- [x] Task 5: 兼容现有编辑能力与周边面板
  - [x] SubTask 5.1: 验证自动保存、撤销重做、快捷键、目录导航、历史面板在新交互下仍然可用
  - [x] SubTask 5.2: 确保浮动工具栏只作用于当前激活块，且不会因排版态切换产生错位
  - [x] SubTask 5.3: 处理空文档、新建文件、导入文件、长文档性能等边界场景
  - [x] Validation: 进行针对主流程的回归检查

- [x] Task 6: 完成测试、诊断与运行验证
  - [x] SubTask 6.1: 更新或新增 `markdownBlockDetector`、`markdown.ts`、`uiStore`、编辑器交互相关测试
  - [x] SubTask 6.2: 运行类型检查、测试、诊断工具并修复明显问题
  - [x] SubTask 6.3: 按要求执行 `npm run dev` 做最终审查，记录环境限制和人工验证结果
  - [x] Validation: 确认关键测试通过且无新增诊断错误

- [ ] Task 7: 整理交付并推送仓库
  - [x] SubTask 7.1: 复核规格文档与实现状态一致
  - [x] SubTask 7.2: 整理变更说明，准备 Git 提交
  - [ ] SubTask 7.3: 推送到 `pengwenhua59-dev/WeaveMD`
  - [ ] Validation: 确认远程仓库包含本次功能开发结果

- [x] Task 8: 补齐单画布排版态的真实渲染接入
  - [x] SubTask 8.1: 将现有 `markdown.ts` 渲染结果或等价渲染链路真正接入单画布非激活块显示，而不是只保留未接入的 `.markdown-preview` 样式
  - [x] SubTask 8.2: 补齐表格在非激活态下的表头、边框和对齐表现
  - [x] SubTask 8.3: 补齐正文段后距、`==高亮==`、行内代码、删除线、链接、HTML 注释等行内语义样式
  - [x] SubTask 8.4: 确保文档左侧裸数字行号过滤在当前单画布排版态中真实生效，并补齐对应运行态验证
  - [x] SubTask 8.5: 完成深色与浅色主题下排版态可读性复核
  - [x] Validation: 用当前主界面实际渲染结果验证排版态，而不是仅依赖 `renderMarkdownToHtml` 单元测试

- [x] Task 9: 补齐运行态回归与最终交付验证
  - [x] SubTask 9.1: 在实际运行界面中回归自动保存、撤销重做、快捷键、大纲导航、历史面板主流程
  - [x] SubTask 9.2: 用长文档验证块切换性能，以及连续写作时是否存在闪烁、错位或内容丢失
  - [x] SubTask 9.3: 在不受当前沙箱限制的环境执行 `npm run dev` / Electron 最终目检并记录结果
  - [x] SubTask 9.4: 基于验证结论更新交付状态后，再推进推送 GitHub
  - [x] Validation: 形成完整的运行态验证记录，并确认剩余未通过项全部关闭

# Task Dependencies

- Task 3 depends on Task 2
- Task 4 depends on Task 3
- Task 5 depends on Task 1, Task 3, and Task 4
- Task 6 depends on Task 2, Task 3, Task 4, and Task 5
- Task 7 depends on Task 6
- Task 8 depends on Task 6
- Task 9 depends on Task 6 and Task 8
