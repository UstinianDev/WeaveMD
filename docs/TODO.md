# TODO

> 最后更新：2026-09-15

## 已完成

### perf-agent-arch（2026-09-15）

| 类别 | 任务 | 说明 |
|------|------|------|
| 架构 | 工具调用时机前置 | 系统提示增加"先调工具→拿到结果→再输出文本"规则 |
| 架构 | Checkpoint 真增量写入 | 跳过每轮 DB read+JSON.parse，用内存已有消息直接构建 |
| 清理 | 动态 import 静态化 | agentStore 8 处 await import(fileTreeStore) 改静态 import |
| 清理 | 压缩路径死代码删除 | 删除 oldMessageCount/newTokenCount/compressionRatio |
| 清理 | JSON 往返消除 | agentEventStore BatchEventItem 同时存 payload 对象引用 |
| 功能 | 文件树根文件夹垃圾桶 | 仅从文件树移除导入文件夹，不删磁盘文件 |

### agent-ux-optimize（2026-09-14）

L 级 UX 优化，7 子任务 + 触发路径修复 + UI 美化，全量交付。

| 类别 | 任务 | 说明 |
|------|------|------|
| 核心 | DiffSummaryCard 统一 diff 卡片 | 三种来源 discriminated union type，单卡片承载所有 diff 场景 |
| 核心 | QuestionCard 向导式重构 | 单题向导 + 进度圆点 + ABCD 选项 + shake 错误动画 |
| 核心 | Clarification Rules 注入 | 澄清规则注入 Agent 系统提示，规范 Agent 提问行为 |
| 核心 | 技术文档索引 | react / tailwindcss / zustand 最新文档注入 Agent 上下文 |
| 核心 | KB 澄清与 Agent 联动 | buildClarificationContext 分轮策略 + searchKBHandler 注入 |
| 核心 | Delete 强制确认 | 双层防线：前端 confirm + Agent 二次确认 |
| 核心 | DiffSummaryCard 写控制集成 | 写模式 auto/manual 适配 + MD5 staleness 检测 |
| 路径修复 | editLocalFile diff 预览 | 触发路径修复，确保编辑后正确弹出 diff 预览 |
| 路径修复 | ask_question_card 铁律强化 | 文本扫描器 + needsClarification 判断 + 铁律加固 |
| 路径修复 | chat 意图 ask_question_card | chat 意图下正确触发提问卡片 |
| 路径修复 | ask_question_card 去重 | 跨轮 + 同轮两层去重，防止重复提问 |
| UI | Diff 卡片摘要化 + DetailModal | Portal 全应用居中挂载 + 尺寸扩大 + 同名文件合并 |
| UI | QuestionCard 美化 | 加粗蓝色标题 + ABCD 标签 + 去除提示文字 |
| UI | Agent 回复去 emoji | 系统提示词禁止 emoji，回复更专业 |
| UI | Diff 卡片持久化 | 应用/废弃后卡片保留 + 流式期间延迟显示 |
| UI | Staleness 修复 | editLocalFile / createFile 豁免 staleness 检测 |

### 四模块全局重构（2026-09-13）

L 级重型重构，8 阶段全部完成。详见 [重构进度文档](./plan/refactor-export-editor-outline-navbar.status.md)。

| 阶段 | 范围 | 核心 |
|------|------|------|
| P0 | 模式切换 | 4 hooks 抽取 + 快捷键合并 + store 净化 + 死代码清理 |
| P1 | 目录区 | headingFromBlock / buildHeadingTree 迁入 kernel；FileTreeRow / ToolbarIconButton 去重 |
| P2 | 编辑主区 | blockTree 裂解 (blockDetection.ts) + formatCtrl 裂解 (imageFormatCtrl.ts) |
| P3 | 导出 | 3 个 MIME 映射合并为 mediaMime.ts；魔法值常量化；路径解析合并 |
| Gate | 审查/连通性 | code-review 0 critical + 19/19 链路 + eslint/lint/tsc 全绿 |

### Bug 修复与体验优化（2026-09-11 ~ 2026-09-12）

| 日期 | 任务 | 类型 |
|------|------|------|
| 09-12 | 导出图片修复（offscreen 渲染 + 3x 缩放 + 高清导出） | Bug 修复 |
| 09-12 | URL 查询修复（Agent 系统提示词优化，强制调用 web_search） | Bug 修复 |
| 09-12 | 视图切换修复（删除冗余 ViewMenu + scrollTop 保持） | Bug 修复 |
| 09-12 | 上下键跨块导航（ArrowUp/ArrowDown 跨语法类型跳转） | 功能修复 |
| 09-12 | 保存功能修复（文件树刷新 + 编辑器同步） | Bug 修复 |
| 09-11 | Outline 数据源统一为 v2 块树 | 功能优化 |
| 09-11 | Agent 输出标题自动编号（h1 中文/h2 阿拉伯/h3 层级/h4 带圈） | 新功能 |
| 09-11 | Composer /@ 标签化（TipTap + chip + 自动补全） | 重构 |
| 09-11 | 执行过程折叠重构 + 消息内联编辑 + 流式缓冲竞态修复 + 上下文延续修复 | Agent 优化 |

### Agent/KB 架构演进（2026-09-07 ~ 2026-09-10）

| 日期 | 里程碑 | 要点 |
|------|------|------|
| 09-10 | Agent/KB 代码重构 | agentLoop 拆分 (agentPromptBuilder/agentToolSelector/agentKbPreloader) + kbSearch 缓存提取 + tokenEstimator 共享 |
| 09-09 | Agent 优化 v4 | deleteLocalFile 文件树刷新 + editLocalFile 编辑器同步 + web_search 意图路由优化 + QuestionCard 美化 |
| 09-08 | AI 优化方案 | IPC 通道名修复 + deleteLocalFile 工具 + QuestionCard 底部面板 + 系统通知 + i18n |
| 09-07 | Agent 优化 v3 | 搜索持久化 + 动态轮次 + 多文件 Diff (IPatchProposal + PatchPreviewCard) |
| 09-07 | AI Agent 优化 30/30 | 重试状态重置/历史污染/提示词精简 + 轮次压缩/动态工具 + Schema 压缩/上下文压缩/KB 缓存 + Agentic RAG/HyDE |

### 历史里程碑（2026-08-06 ~ 2026-08-31）

| 日期 | 里程碑 |
|------|------|
| 08-31 | 性能优化：Agent 执行流程 DB 优化 8 项 + KB 搜索优化 5 项 + 写控制/前端优化 4 项 |
| 08-29 | UI 美化：字体统一、工具栏毛玻璃、Composer 标签、Material Design Icons + AI 性能 v2 |
| 08-25~27 | 知识库 Notus 对齐 R1~R12：Embedding 多提供商、RRF 混合检索、查询理解、jieba 分词等 |
| 08-24~25 | 写控制与任务安全 R1~R7：写模式切换、版本对比、交互暂停/恢复、事件持久化、草稿恢复 |
| 08-24 | Notus Agent 克隆 Phase 1-5：Session 状态机、Checkpoint/Resume、任务队列、死循环检测 |
| 08-14~16 | AI 代理面板 7 期交付：基建 + Chat + 知识库 + Agent + 块级改写 + KB 参数 + 体验重构 |
| 08-06~19 | 编辑主区 v2：块树内核、前缀即时转换、浮动工具栏、跨块拖选、可编辑表格块、media:// 协议 |
| 更早 | 认证系统、文件管理、8 格式导出、三语言国际化、深色主题、Frameless 窗口 |

## 进行中

（无）

## 待开发

| 优先级 | 任务 | 说明 |
|------|------|------|
| 🔲 | v2 Normal 查找高亮 | 编辑模式查找结果高亮，替代 Monaco 查找 |
| 🔲 | 撤销/重做后光标定位优化 | 当前光标回到重建树首块，需恢复到操作位置 |
| 🔲 | 段落级 MD Source 视图迁移 | v2 编辑器迁移 Monaco Source 视图 |
| 🔲 | 真 MCP server 管理 | 外部 MCP server 注册与生命周期管理 |
| 🔲 | pdf/docx 知识库导入 | 非 Markdown 格式文档直接导入知识库 |
| 🔲 | Web Worker JSON.parse | AgentWorkflowCard 大 JSON 异步解析（worker 基础设施已就绪） |

## 已知问题

| 问题 | 影响范围 |
|------|------|
| v2 Normal 模式无查找高亮 | 编辑主区（Normal 模式） |
| 撤销/重做后光标回到重建树首块 | 编辑主区（撤销/重做操作） |
| 5 个既有 E2E 红（drag-selection-markers.spec.ts） | E2E 测试套件 |
| 段落级 MD Source 视图未迁移 | 编辑主区（Source 模式） |