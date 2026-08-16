# AI 代理面板 — 第 7 期体验重构（需求记录）

> 模块：docs/modules/11-AI代理面板-Agent.md | 状态：已对齐 2026-08-15（待新开聊天框实现）
> 上一里程碑：第 6 期已交付（KB 参数持久化 + stretch editBlocks），门禁全绿
> 范围：AI 面板体验重构 7 条（编辑主区集成 / 面板体验 / 视觉）+ 追加 1 条选区改写不一致 bug（A4）
> 铁律不变：① AI 无直接落盘——写路径必经「红删绿增预览 → 用户确认 → updateContent 可撤销」；
>   ② 联网/笔记外发必知情同意（allowNetwork/allowSend 分层闸）

## 1. 背景与目标

第 5/6 期交付了块级改写与 editBlocks 工具，但**用户实际使用体验断裂**：

- Agent 对话面板感知不到编辑主区文档，既不能直接改写当前文档，也做不到「从 0 到 1 写整篇」；
- 编辑器侧「AI 改写」入口在**混合语法类型**选中时整个浮动工具栏消失；
- 点「AI 改写」打开面板后编辑器选区即丢失，用户不知道改的是哪一段；
- 面板 `/` `@` 无任何补全提示，功能「看不见摸不着」；
- 「代理」命名生硬，Chat/Agent 双 Tab 割裂，界面字号小、间距失衡。

目标：把 AI 面板从「功能堆砌」重构成「统一、可达、可感知」的辅助创作体验。

## 2. 需求清单与验收标准

### 领域一：编辑主区集成

#### A1 · Agent 感知当前文档 + 从 0 到 1 写整篇

- **A1a 文档上下文注入**：Agent（智能体）会话的每次 `AGENT_RUN` 自动携带当前编辑器文档 markdown 快照（`editorStore.content`），让 LLM 真正看到文档内容才能优化/改写。
  - 根因（第 6 期遗留）：`editBlocks` schema 只收 `{block_ops:[{block_id,new_content}]}`，`currentDocument` 只存主进程 toolCtx 不注入 LLM messages——LLM 看不到文档原文与 block_id。
  - 修复方向：把当前文档（或编号块列表 `buildNumberedBlockList`）注入 system prompt / 首轮 user 消息；`@` 协议与选区协议已有片段导出，Agent 对话补齐「整篇可见」。
- **A1b 意图识别补词**：rewrite 意图关键词补「优化 / 整理 / 美化 / 改进」等（`intentRouter.ts` rewrite 关键词列表）——用户说「帮我优化这篇文档」不得落 chat fallback。
- **A1c 从 0 到 1 写整篇**：Agent 产整篇 markdown → 复用第 5 期预览确认管线（红删绿增 → 确认 → `updateContent` 可撤销）；**未打开文档时禁用写入**（提示先打开）。
  - 说明：与 editBlocks「定向块」不同，整篇写入 = document scope 全量替换 proposal。

验收：
- 编辑器打开文档 → Agent 面板说「帮我优化这篇文档」→ 命中 rewrite 意图 → 回复基于真实文档内容给出优化建议/改写。
- 空文档打开 → 说「帮我从 0 到 1 写一篇关于 X 的文档」→ 产整篇 markdown → 预览确认 → 写入当前文档、可一次撤销。
- 未打开任何文档 → 写文档诉求给出引导提示，不产生空写。

#### A2 · 混合语法类型选中弹「AI 改写」，左键松开后才出现

- 现状：跨块选区语法类型不一致 → 整个浮动工具栏隐藏（`toolbarState.ts computeToolbarState` 跨块 `selectionSyntaxTypesConsistent` 失败 → `hide`）。
- 目标：混合类型选中时**至少显示「AI 改写」按钮**（可附块类型信息）；行内格式按钮隐藏/禁用（跨块混合格式语义模糊）。
- 触发时机：**mouseup 后**才出现（现状 `FloatingToolbar.tsx:351-368` mouseup flush 逻辑已存在，仅混合类型被 hide 拦截；保持该语义）。

验收：
- 选中「标题 + 正文 + 列表」多行混合 → 松开鼠标后弹出工具栏，含「AI 改写」，无行内格式按钮。
- 单击/未选中不弹；鼠标拖选过程中不弹。

#### A3 · 选区保持（点 AI 改写、面板输入框获焦后选中不丢）

- 现状：`handleRewriteClick` → `startSelectionRewrite` → 面板 composer textarea 获焦即 blur 编辑器选区，选中高亮瞬间消失，用户不知道改的是哪段。
- 方案：改写模式下编辑器用**持久高亮**标记被改写范围（非真实 selection，纯 CSS 标记，面板聚焦也可见），改写完成/取消/清除后移除。
  - 复用 SelectionRef（`startSelectionRewrite` 已存 `{md, sel}`），渲染层按 `sel` 的叶序下标 + offset 定位高亮区间。

验收：
- 选中一段 → 点「AI 改写」→ 面板打开且**编辑器内该段仍可见高亮** → 在面板输入指令/聚焦输入框，高亮不消失 → 取消改写后高亮清除。
- 确认应用后高亮清除，编辑器跳转到改写后内容。

#### A4 · 【追加】选区改写「改的内容与选中的不一致」（bug）

**现象**：用户实测「AI 改写」后，被替换的文档内容与最初选中的内容不一致（替换到错误块）。

**根因（已定位，2026-08-15）**：SelectionRef 的叶子下标取自 **DOM 序**，而替换应用在 **markdownToState 解析的叶序**，两者在含容器块的文档中错位：

1. `readDocumentSelection`（`src/render/editor/rewrite/selectionExport.ts:75-78`）用 `document.querySelectorAll('[data-block-id]')` 的 `findIndex` 求叶子下标——**该选择器会命中容器块**：`list-block` 容器 div（`BlockRenderer.tsx:40`）、引用容器（`BlockquoteBlock.tsx:23`）、代码块（`CodeBlock.tsx:49`）等均带 `data-block-id`。
2. `proposeSelectionRewrite`（`src/render/editor/rewrite/blockEdit.ts:76-81`）用 `markdownToState(content)` 重解析后 `documentOrderLeaves`（只取叶子）的下标做替换——**叶序不含容器块**。
3. 因此文档含列表/引用/代码块等容器节点时，DOM 序下标比叶序偏大，替换落到错误块。

**触发条件**：文档含「列表 / 引用 / 代码块 / 表格 / 图片」等非纯文本叶子，且选区跨块。

**修复方向**：`readDocumentSelection` 拿到 DOM `blockId` 后，用同一份 `content` 调 `markdownToState` 解析一次，在该树的叶子列表中定位 `blockId` 的**叶序下标**写入 SelectionRef（`_content` 参数当前被忽略，正好启用）。同会话 content 不变 → 后续 `proposeSelectionRewrite` 再次解析叶序一致，下标对齐。注意跨解析 id 漂移（每次 markdownToState 新树随机 id）——只借用「当前解析树的叶序」，不跨解析存 blockId 作键。

**新增测试**：`selectionExport` 含列表/引用容器场景的叶序下标计算；`proposeSelectionRewrite` 含容器文档的替换正确性（选中列表项跨到正文 → 仅该区间变）。

### 领域二：面板体验

#### B1 · `/` 与 `@` 自动补全提示

- 现状：`@ + 描述` 是手写协议（`AgentTab.tsx handleSend`），无补全 UI；`/` 完全没实现。
- 目标：composer 输入 `/` 或 `@` 弹出补全菜单：
  - `/`（运行技能）：列出 3 个内置 skill + 用户扩展 skill（`skillLoader` 的 `CORE_SKILLS` + `userData/skills/`）名称；选择后作为指令发送（Agent 端触发 runSkill 意图）。
  - `@`（引用）：列出「当前文档（整篇改写）」「知识库文档（检索范围限定）」两类；选择后注入对应协议前缀。
- 键盘导航：↑/↓ 选择、Enter 确认、Esc 关闭、点击外部关闭；菜单在输入框上方。

验收：
- 输入 `/` 弹出技能列表并可选；输入 `@` 弹出引用目标并可选；Esc/外部点击关闭。
- 选择后送入的消息能被现有 `@` 协议 / agent 意图正确消费。

#### B2 · 命名「代理」→「智能体」

- 范围：**只改 UI 文案 + i18n**（`ai.tab.agent` =「智能体」等）；代码标识符 `agent`/`AgentTab`/`agentLoop` 等不动（避免大规模改名）。
- 涉及：`src/render/i18n/zh-CN.json`、`zh-TW.json`（en.json 同步为「Agent」或「Assistant」按现状），`AgentTab.tsx` 内硬编码展示文案（如会话 chip 兜底名）。

验收：界面任何对用户展示处不再出现「代理」，统一「智能体」。

#### B3 · 双 Tab → 统一单面板 + composer 上下拉模式选择

- 现状：`AIAgentPanel.tsx` 头部 Chat/Agent 两个 Tab 按钮，`ChatTab`/`AgentTab` 两套独立 UI。
- 目标：合并为**单一统一面板**（一套消息流 + 一套 composer），composer 上方加「对话 / 智能体」**下拉选择**（类通用 AI 工具输入框模式切换）。
- 会话隔离：**保留 `mode` 字段隔离**（SQLite 已按 chat/agent 分域）——下拉切换即切换 mode 域会话列表；各模式专属控件（如 Agent 的「依照知识库创作」开关、KB 设置、压缩、工具轨迹）仅在智能体模式显示。

验收：
- 面板无 Tab 割裂；下拉切换「对话 / 智能体」时消息与会话列表随 mode 域切换。
- 智能体模式保留其专属控件；对话模式保持纯对话。

### 领域三：视觉

#### C1 · frontend-design + impeccable-skill 美化

- 痛点：字小（多处 `text-xs` 12px / `text-sm` 14px）、输入框旁间距过大（composer `px-3 py-3 space-y-2`）、整体视觉简陋。
- 方向（授权自主发挥，沿用现有 CSS 变量体系）：加大正文字号、收紧输入框周边距、统一圆角/间距节奏、强化消息气泡与工具轨迹层次、符合现代 AI 工具呼吸感。
- 用 `frontend-design` 分析 + `impeccable-skill` 打磨。

验收：面板文字可读性提升（≥13px 主体）、间距协调、与编辑主区视觉语言一致；无布局回归（宽度 clamp 260~520 保留）。

## 3. 已对齐问题清单（grill-me 2026-08-15）

| # | 决策 | 结论 |
|---|------|------|
| Q1 | 「代理→智能体」范围 | 只改 UI 文案 + i18n；代码标识符不动 |
| Q2 | 双栏合并后会话隔离 | 保留 `mode` 隔离，下拉切换即切换 mode 域会话 |
| Q3 | 混合类型工具栏形态 | 仅显示「AI 改写」（+块类型信息），行内格式按钮隐藏 |
| Q4 | 从 0 到 1 写文档写入目标 | 始终写当前打开文档；未打开时禁用写入并引导 |
| Q5 | `/` 与 `@` 语义 | `/` 列技能（runSkill）；`@` 列「当前文档 / 知识库文档」 |
| Q6 | 选区保持方案 | 改写模式持久 CSS 高亮标记改写范围（非真实 selection） |
| Q7 | 美化自由度 | 授权 frontend-design + impeccable-skill 自主发挥（沿用 CSS 变量） |
| Q8 | 产物文档 | 本文件 `docs/requirements/ai-agent-panel-ph7.req.md`，7 条全列，新开聊天框实现 |
| 追加 | A4 改写不一致 | 根因 = DOM 序下标（含容器块）vs markdownToState 叶序下标错位；修复 = readDocumentSelection 用 content 解析树求叶序下标 |

## 4. 技术约束（沿用，不重复询问）

- 铁律一：AI 无直接落盘——所有写路径（选区/整篇/Agent 工具）必经「预览 → 用户确认 → `editorStore.updateContent`（入 undo 栈可撤销）」；主进程只产 LLM 文本/只读工具。
- 铁律二：联网 / 笔记外发必知情同意（改写 = 联网，触发前 `needsConsent(...,'chat')`；KB 外发 `allowSend`）。
- 跨解析 id 漂移：blockId 不跨 markdownToState 解析作定位键，一律用文档序叶序下标（A4 修复后下标空间统一为叶序）。
- 安全渲染：`renderAIMarkdownSafe`（HAST→React 白名单，无 dangerouslySetInnerHTML）。
- i18n：en/zh-CN/zh-TW 键集一致。
- 质量门禁：tsc + vitest + lint(0 error) + vite build + Playwright 全绿。

## 5. 关联文件

| 领域 | 文件 |
|------|------|
| A1 | `src/main/ai/agentLoop.ts`（toolsForIntent）、`src/main/ai/toolRegistry.ts`（editBlocks schema/注入）、`src/main/ai/intentRouter.ts`（rewrite 关键词）、`src/render/stores/agentStore.ts`（sendAgentMessage 载荷）、`src/main/ai/ipc.ts`（AGENT_RUN 归一，currentDocument 空串勿过滤） |
| A2 | `src/render/components/Editor/v2/toolbarState.ts`（computeToolbarState 混合类型显示）、`FloatingToolbar.tsx`（工具栏形态/按钮组） |
| A3 | `src/render/stores/rewriteStore.ts`（selectionContext）、`src/render/components/Editor/v2/EditorV2.tsx`（高亮渲染层） |
| A4 | `src/render/editor/rewrite/selectionExport.ts`（readDocumentSelection 下标）、`src/render/editor/rewrite/blockEdit.ts`（proposeSelectionRewrite） |
| B1 | `src/render/components/AIAgent/AgentTab.tsx`（composer）、`src/main/ai/skillLoader.ts`（技能清单）、补全弹层组件 |
| B2 | `src/render/i18n/zh-CN.json` / `zh-TW.json` / `en.json`、`AgentTab.tsx` |
| B3 | `src/render/components/AIAgent/AIAgentPanel.tsx`、`ChatTab.tsx`、`AgentTab.tsx`（合并）、`src/render/stores/agentStore.ts`（activeTab→mode） |
| C1 | `src/render/components/AIAgent/*`、`src/render/styles/globals.css` |

## 6. 风险与开放项

| 项 | 影响 | 缓解 |
|----|------|------|
| A4 下标修复回归 | 破坏第 5 期已有改写 | 新增含列表/引用容器测试 + 回归选区改写用例（Playwright） |
| A3 持久高亮与编辑器渲染耦合 | 高亮渲染侵入块渲染 | 高亮作为独立 overlay/类名标记，不入 contentEditable 内容；随改写状态清除 |
| B3 合并改动面大（两个 Tab→一） | 回归范围广 | 保留 mode 域会话逻辑，仅合并渲染壳；Playwright 覆盖双模式切换 |
| B1 补全菜单键盘/焦点 | 体验细节 | 仿现有下拉（块类型菜单）交互与样式 |
| C1 视觉改动 | 测试快照/布局回归 | 改动集中在面板组件，e2e 用语义选择器不依赖像素 |

## 7. 实现指引（新开聊天框时）

1. 建议按领域分批：A4（bug，最优先）→ A1 → A2+A3 → B1 → B2 → B3 → C1；C1 最后做（基础功能稳定后美化）。
2. 每批 TDD strict：先写失败测试（含 A4 列表容器场景、B3 模式切换、B1 补全），再实现，门禁全绿后提交。
3. 完成同步更新 `docs/modules/11-AI代理面板-Agent.md` §7 分期 + `docs/plan/ai-agent-panel.status.md`。
