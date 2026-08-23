# AI面板+编辑主区+导航栏优化 — 需求文档

> 任务 slug: `ai-panel-editor-navbar-optimize`
> 创建时间: 2026-08-23
> 分级: **L级**（跨模块、多组件、UI重构）
> 参考项目: https://github.com/dnwwdwd/Notus

---

## 1. 需求总览

本次优化涉及三大模块：AI面板、编辑主区、顶部导航栏。核心目标是提升AI交互体验、简化模式切换、增强编辑器布局控制。

**约束**：未涉及的功能不可受影响。

---

## 2. AI面板需求

### 2.1 消息交互增强（REQ-AI-MSG）

**用户消息（右下对齐）**：
- 显示AI响应时间（实时记录，从发送到首token的时间）
- 复制按钮
- 编辑按钮（笔图标）：点击后进入编辑模式，可修改消息内容并重新发送

**AI消息（左下对齐）**：
- 显示AI响应时间（实时记录）
- 复制按钮
- 重试按钮：重新生成该条AI回复

**消息操作栏**：hover消息气泡时显示底部操作栏，包含上述按钮。

**影响文件**：
- `src/render/components/AIAgent/AIMessageBubble.tsx` — 新增操作栏
- `src/render/stores/agentStore.ts` — 消息结构新增 `responseTime` 字段
- `src/main/ai/ipc/chatHandlers.ts` / `agentHandlers.ts` — 返回响应时间

### 2.2 AI处理流程状态展示（REQ-AI-STATUS）

AI回答过程中展示完整的处理流程状态，不限制大模型输出。状态类型包括：

| 状态 | 说明 |
|------|------|
| 正在思考 | AI正在分析问题 |
| 工具调用 | 类似参考项目的 load_skill，展示调用的skills |
| 生成提问卡片 | 意图识别后的候选提问 |
| 等待回答 | 等待用户确认或输入 |
| 读取文件 | 工具调用 readFile |
| 用户已回答问题 | 用户回复了提问卡片 |
| 生成全文修订预览 | 改写流程进行中 |
| 修改批次已处理 | 改写批次完成 |

**工具调用展示**：参考Notus的load_skill样式，展示skill名称、参数、执行状态。

**改写流程特殊处理**：
- AI改写完成后输出："全文修订预览已生成，请在下方 diff 卡片中应用、废弃或回滚。"
- 在消息操作栏（复制/重试/时间）下方显示修订汇总卡片：
  - 格式：`n个文件修订（已应用k个，已回滚a个，已废弃b个）`
  - 点击"查看详情"→ 页面居中弹出详情面板：
    - 左侧栏：修改文件列表（文件名）
    - 右侧：diff预览
    - 操作：应用 / 废弃

**影响文件**：
- `src/render/components/AIAgent/AgentTab.tsx` — 状态展示
- `src/render/components/AIAgent/ToolCallTrace.tsx` — 工具调用展示增强
- `src/render/components/AIAgent/RewritePreviewCard.tsx` — 重构为多文件修订卡片
- 新增 `src/render/components/AIAgent/RewriteDetailModal.tsx` — 详情弹窗
- `src/render/stores/agentStore.ts` — 消息结构新增状态类型
- `src/render/stores/rewriteStore.ts` — 多文件修订状态管理

### 2.3 统一智能体模式（REQ-AI-MODE）

**删除Chat模式**：
- 删除 `activeMode` 的 `'chat'` 选项
- 统一为智能体模式（原agent模式）
- 删除composer中的模式切换下拉框

**Composer区域重构**：
- 删除模式下拉框
- 新增两个按钮：上传文件（📎回形针）、上传图片（🖼图片）
- 模型选择框移到发送按钮旁边
- 上下文圆环指示器稍微缩小
- 新增"自动应用修改/手动应用修改"左右滑动开关（在上传图片按钮右侧）
- 新增"联网搜索"按钮，点击弹出搜索引擎选项框：
  - Firecrawl
  - 智谱
  - Tavily
  - Exa

**影响文件**：
- `src/render/components/AIAgent/AIPanelComposer.tsx` — 重构composer
- `src/render/stores/agentStore.ts` — 删除chat模式相关逻辑
- `src/main/ai/ipc/chatHandlers.ts` — 可能需要合并到agent handlers

### 2.4 知识库设置重构（REQ-AI-KB）

**删除知识库选项**：从智能体功能中删除知识库开关，统一知识库为基于工作区内所有Markdown笔记的全文内容索引系统（除欢迎文档）。

**设置面板**：用户点击设置后，显示页面居中的设置面板（非侧栏），包含：

**模型配置模块**：
- 参考Notus添加Embedding模型配置
- 默认值：
  - Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - 模型名称: `text-embedding-v3`
  - API Key: 用户输入
- 是否启用多模态向量：滑动开关
- 测试Embedding按钮
- 保存Embedding按钮

**搜索配置模块**：参考Notus的搜索配置界面。

**影响文件**：
- `src/render/components/AIAgent/settings/` — 设置面板重构
- 新增 `src/render/components/AIAgent/settings/EmbeddingSettings.tsx`
- 新增 `src/render/components/AIAgent/settings/SearchSettings.tsx`
- `src/main/ai/` — 新增embedding相关IPC
- `src/render/stores/agentStore.ts` — KB设置重构

### 2.5 AI文件操作能力（REQ-AI-FILE）

AI智能体支持：
- 在工作区新建文件
- 新建文件夹
- 支持一切markdown语法编写
- 可编写多个文件
- 改写时通过提问卡片询问修改文件的路径

**影响文件**：
- `src/main/ai/toolRegistry.ts` — 新增写文件工具
- `src/main/ai/agentLoop.ts` — 工具调用循环扩展
- `src/render/components/AIAgent/IntentCard.tsx` — 提问卡片扩展

---

## 3. 编辑主区需求

### 3.1 删除浮动工具栏AI改写（REQ-EDIT-AI）

- 删除浮动工具栏中的"AI改写"按钮
- 删除混合选区时的AI改写按钮
- 保留所有其他浮动工具栏功能不变

**影响文件**：
- `src/render/components/Editor/v2/FloatingToolbar.tsx` — 删除AI改写按钮及相关逻辑

### 3.2 目录区侧栏固定宽度（REQ-EDIT-SIDEBAR）

- 侧栏宽度固定为页面宽度的1/5（20%）
- 不可拖拽调整宽度
- 可收缩（折叠态保持现有行为）

**影响文件**：
- `src/render/pages/MainPage.tsx` — 删除拖拽逻辑，固定宽度
- `src/render/stores/uiStore.ts` — 删除 `outlineWidth` 持久化，改为固定比例

---

## 4. 顶部导航栏需求

### 4.1 布局重构（REQ-NAV-LAYOUT）

**删除**：最左侧的实时账号显示（`@{username}`）

**左侧新增**：
- 收起/展开富文本编辑器按钮
- 收起/展开AI面板按钮（从右侧移到左侧）

**左侧组件左移**：删除账号显示后，靠左的组件（图标、菜单）往左移动。

**影响文件**：
- `src/render/components/Navbar/TopBar.tsx` — 布局重构

### 4.2 新建文件/文件夹面板（REQ-NAV-CREATE）

- 点击"新建文件"或"新建文件夹"后，显示页面居中的新建面板（非弹窗）
- 默认存储位置：固定根目录
- 用户可自行选择存储位置
- 填写文件/文件夹名称
- 文件后缀保持不变（.md）

**影响文件**：
- 新增 `src/render/components/Navbar/CreatePanel.tsx` — 居中新建面板
- `src/render/components/Navbar/FileMenu.tsx` — 触发方式修改

---

## 5. 已对齐问题清单

| # | 问题 | 对齐结果 |
|---|------|----------|
| Q1 | AI改写删除后，编辑器内如何触发改写？ | 仅通过AI面板的智能体模式触发，编辑器内不再有入口 |
| Q2 | 统一智能体模式后，原有chat会话数据如何处理？ | **直接删除**所有chat模式历史会话 |
| Q3 | 知识库删除开关后，是否所有笔记自动索引？ | 是，除欢迎文档外的所有工作区Markdown笔记自动全文索引 |
| Q4 | Embedding配置的多模态向量具体指什么？ | **图片向量化**：支持对笔记中的图片内容进行向量化索引（需要多模态Embedding模型） |
| Q5 | 联网搜索的四个引擎是否需要全部实现？ | **全部实现**：Firecrawl、智谱、Tavily、Exa四个搜索引擎完整集成 |
| Q6 | 新建面板的"固定根目录"是什么？ | 用户首次使用时的工作区根目录，或应用默认文档目录 |
| Q7 | AI写入文件是否需要确认？ | **需要确认**（对齐铁律一：AI无直接落盘，预览确认后才写入） |
| Q8 | 多文件修订详情面板中，应用/废弃是逐文件还是批量？ | 支持逐文件和批量操作 |

---

## 6. 验收标准

### AI面板
- [ ] 用户消息右下显示，有响应时间、复制、编辑按钮
- [ ] AI消息左下显示，有响应时间、复制、重试按钮
- [ ] AI处理流程状态完整展示（思考中、工具调用等）
- [ ] 改写完成后显示修订汇总卡片，可查看详情
- [ ] 详情面板居中显示，左侧文件列表、右侧diff、可应用/废弃
- [ ] 统一智能体模式，无Chat模式切换
- [ ] Composer包含：上传文件、上传图片、自动/手动应用开关、联网搜索、模型选择
- [ ] 设置面板居中显示，含Embedding配置和搜索配置
- [ ] AI支持新建文件/文件夹和多文件编写

### 编辑主区
- [ ] 浮动工具栏无AI改写按钮
- [ ] 目录区侧栏宽度固定为页面1/5，不可拖拽，可收缩

### 顶部导航栏
- [ ] 无账号显示，左侧组件左移
- [ ] 收起/展开编辑器和AI面板按钮在左侧
- [ ] 新建文件/文件夹使用居中面板

### 质量门禁
- [ ] `npm run typecheck` — 0 error
- [ ] `npm run test` — 全部通过
- [ ] `npm run lint` — 0 error
- [ ] `npm run build` — 成功
- [ ] `npx playwright test` — 全部通过
