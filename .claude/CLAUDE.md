# WeaveMD — CLAUDE.md

> 精简版：仅保留当前主线所需信息。深层设计见 `docs/`（[SUMMARY.md](../docs/SUMMARY.md) 为索引，
> `specs/` 为编辑主区实现记录）。

## Build / Test

- `npm run dev` — Vite + Electron (HMR)
- `npm run build` — Vite build + electron-builder
- `npm run lint` / `npm run typecheck` / `npm run test` — ESLint / tsc --noEmit / Vitest
- `npx playwright test` — 真实 Chromium E2E（自动启动 renderer-only vite server）
- 质量门禁：tsc + vitest + eslint(0 error) + vite build + E2E 全绿才算完成

## 目录结构（要点）

- `src/main/` — Electron 主进程：window、ipc-handlers、db（better-sqlite3）
- `src/render/editor/` — **编辑主区 v2 内核（React-free）**：`kernel/`（块树、双向转换、
  行内渲染、选区）+ `controllers/`（七类交互）
- `src/render/components/Editor/v2/` — v2 渲染层：EditorV2（宿主）、`blocks/`
  （ContentBlock 是唯一 contentEditable）、FloatingToolbar（文本工具栏）+
  ImageToolbar（图片工具栏）+ toolbarState（纯函数）
- `src/render/components/Editor/` — EditorView 薄编排器（v2 唯一）
- `src/render/stores/ services/ styles/` — Zustand / markdown 服务 / globals.css
- `src/main/ai/` — AI 主进程服务（**第1/2/3/4/5期均已交付**：llmClient/consent/secureConfig/ipc +
  embeddingClient / kbIndexer / kbSearch / intentRouter / contextManager / toolRegistry /
  skillLoader / agentLoop / rewrite（改写薄 LLM 代理，第5期）；`mcpManager` 真 MCP 进程管理延期）
- `src/render/components/AIAgent/` — AI 面板（**第1/2/3/4/5期均已交付**：AIAgentPanel/ChatTab/AgentTab/
  ConsentOverlay + ToolCallTrace/IntentCard/MarkdownMessage/KnowledgeBaseSettings/RewritePreviewCard（第5期））
- `src/render/editor/rewrite/` — 改写块逻辑（第5期）：selectionExport.ts（DOM 选区→SelectionRef+片段）/
  blockEdit.ts（proposal 计算，只算不写）；`src/render/stores/rewriteStore.ts` 改写状态机；
  `src/render/filters/rewriteDiff.ts` 行级红删绿增 diff
- `docs/` — REQUIREMENTS / TECH_STACK / SUMMARY / modules/ / specs/

## 规范

- 中文交流；代码/标识符英文；React 18 + TS strict；Zustand v4；Tailwind
- 文档优先：改代码前先同步需求/技术文档，完成后更新进度与验证记录
- 命名：组件 PascalCase，函数/文件 camelCase；不用 `any`
- 标题字号：H1 26/700、H2 22/600、H3 18/600、H4 16/500、正文 14/400
- 行前缀解析统一走 `src/render/services/lineMarkdown.ts`（含 U+00A0 分隔）

## 编辑主区 v2（当前主线，架构照搬 marktext/muya）

- 仅叶子块内容 span（`ContentBlock`）可编辑；不可变块树 + 无损双向转换（往返不变式）
- 行内语法标记保留在 DOM（`span.md-syntax`），`textContent` 与源一致
- 前缀即时转换（`# `/`- `/`1. `/`- [ ] `/`> `/` ```lang `），退格在内容起点降级
  （六条退出规则：docs/specs/markdown-block-exit-rules.md）
- 语法外观对齐 marktext（spec 13.7）：标题 `#`×n 光标提示、深灰列表 marker、
  圆形任务复选框、引用绿色竖线，语法符号全部不可选中；类名勿用 `list-item`
  （Tailwind 工具类冲突，用 `list-item-block`）
- 退出/退格链（spec 13.9 / 13.11）：空列表项退格退出列表；空代码块退格一键删除、
  回车退出（保留）；代码块后空行 Backspace 受保护（删除代码块后可删）；删光标题
  内容后连续退格光标跳回上一行
- 代码块尾随保护空行持久化（SPEC-EDIT-CBTP）：`markdownToState` 解析期若整树最后
  叶子为 code-block 自动补尾随空段落，重载/模式切换后不丢失；文本输出不变
- 浮动工具栏（SPEC-EDIT-FT v1.0）：选区触发且**仅单一语法类型显示**（h1+h2 不显示）；
  自定义块类型下拉（正文/H1-H6/代码块/引用/三类列表，`canConvertBlock` 矩阵置灰，
  `syntaxTypeToOption` 映射）——纯函数 `selectionSyntaxTypesConsistent` / `resolveSyntaxType`
  均在 kernel/syntaxType.ts 与 toolbarState.ts（FloatingToolbar re-export），组件测试直接覆盖
- 行内格式（SPEC-EDIT-FT2）：inlineLexer + 双形态 toggle（加粗两次回原文，永不产生 `****`）+
  橡皮擦；叠加收敛（SPEC-EDIT-FT3）：Step 0 选区归一化 + 跨 token 拆分解除 + 跨风格三连 `***`
  渲染/剥离；相邻混合强调（SPEC-EDIT-FT4）：close run 拆分（`**12*3***`）+ open 三连拆分
  （`***12*3**`）均解析为 strong 内嵌 em，渲染无字面残体（详情见
  specs/floating-toolbar-ux-and-inline-format.md / format-sticky.md）
- 原生拖拽移动选区已禁用：EditorV2 根容器 `onDragStart` preventDefault（含标记选区不被拖走）；
  跨块拖选走 `useCrossBlockDragSelection`（mousedown/mousemove），不受影响
- 跨块鼠标拖选（spec 13.13）：rAF 节流 + 反向显式交换端点 + 非内容区回退 + mouseup
  末帧兜底/3 帧重放（`useCrossBlockDragSelection.ts`）；Backspace/Delete 走
  `deleteLeafRange` 块树级删除；**注意**：Chromium 对跨编辑宿主 Selection.toString()
  只返回 anchor 块内文本（Range 边界保留跨块），拖选验证须用块 id + Backspace 而非文本
- 拖选闪烁优化（SPEC-EDIT-DSF）：`lastAppliedRangeRef` 端点级变化检测（端点全等跳过
  重建，静止不再 selection 风暴）；`FloatingToolbar` selectionchange 改 rAF 合并
  （渲染 ≤ 每帧一次）；`resolveSyntaxTypesInRange` 边枚举边比对短路 + 500 叶上限
- 焦点恢复：`applyAction` 树未变时立即恢复；降级转换焦点用新块 id
- 图片（K3~K7）：工具栏「图片」直选（`dialog.pickImage` 系统文件框，取消 no-op）；
  `image-block` 原子块（`kernel/imageBlock.ts`，`<div align>` 包裹对齐）+ 点击选中 →
  图片工具栏（修改图片/内联图片/居左/居中/居右/移除，行内图对齐/内联置灰）；本地图走
  `media://` 协议（`src/main/media-protocol.ts`，**非 standard scheme**——盘符编码进 host
  不被 Chromium 规范化拒绝，修复完整 app 本地图加载失败）
- 图片缩放（R1~R3）：选中图片显示 `.image-resize-box` 四角手柄，拖拽直改 `<img style.width>`
  （DOM-only），提交独立图 `setImageWidth` / 行内图写 `BlockWidthMap`；宽度落点在 `<img>` 自身
  （`applyImgWidth`，非外层 div），小图可放大、无溢出；等比例拖拽 = 主轴向符号 × √(dx²+dy²)
- 跨块选区替换（2026-08-13）：字符输入/粘贴跨块选区时浏览器原生只改 DOM，`onInput` 仅同步
  焦点块模型 → 其余块"复活"。ContentBlock 原生 `beforeinput`/`onPaste` 拦截 → `replaceLeafRange`
  （blockTree.ts）块树级删除+插入收敛单块
- **v1 回退路径已退役（2026-08-06）**：v2 为唯一路径，`__EDITOR_V2__` 开关已移除，
  v1 组件/服务/测试已删除（EditorView 1920 行重写为薄编排器）

## 关键文件

- `src/render/editor/kernel/` — blockTree / markdownToState / stateToMarkdown /
  inlineRenderer / outline / selection / syntaxType（resolveSyntaxType）/ imageBlock
- `src/main/media-protocol.ts` — media:// 本地图协议（decodeMediaUrl + registerMediaProtocol，
  非 standard scheme）
- `src/render/services/saveCurrentDraft.ts` — 切换/关闭前统一保存前置（flushEditorDraft +
  dirty 落盘），FileTreePanel 与 Navbar 共用
- `src/render/editor/controllers/` — input / enter / backspace / convert / click / list / format
- `src/render/editor/editorInstance.ts` — 内核宿主（内容加载、markdown 同步）
- `src/render/components/Editor/v2/EditorV2.tsx` — v2 入口（状态、事件路由、焦点恢复、撤销）
- `src/render/components/Editor/v2/blocks/ContentBlock.tsx` — 唯一 contentEditable 表面
- `src/render/components/Editor/v2/FloatingToolbar.tsx` — 文本浮动工具栏（SPEC-REFACTOR 拆出
  ImageToolbar 图片工具栏 / toolbarState 纯函数 / ToolbarButton 共享按钮）
- `src/render/components/Editor/v2/ImageResizeBox.tsx` + `resizeMath.ts` — 图片四角缩放
  （纯算术下沉 resizeMath；`imageAnchor.ts` 提供 findImageEl/readImageRect 共享查询）
- `src/render/components/Editor/v2/modalConstants.ts` — 弹层共享常量（EMPTY_URL_MESSAGE）
- `src/render/components/Editor/EditorView.tsx` — 薄编排器（v2 唯一）
- `docs/modules/11-AI代理面板-Agent.md` — AI 代理面板 + 知识库导入设计（第1/2期基建+Chat、
  第3/4期知识库+Agent 均交付；需求 AGT-01~19 / KB-01~05 见 REQUIREMENTS 3.7/3.8）

## AI 代理面板与知识库（2026-08-15：第 1/2/3/4/5 期均已交付；第 6 期 KB 参数持久化 + stretch editBlocks 均已交付）

- 右侧 AI 面板（导航栏「AI」按钮开合），Chat（纯对话）/ Agent（辅助创作）双智能体
- 铁律一：**AI 无直接落盘能力**——第 5 期块级改写已交付，写路径=「红删绿增预览 → 用户确认 →
  `editorStore.updateContent(rewrittenMd)` 入 undo 栈一次可撤销」；主进程只产 LLM 文本（薄代理 rewrite.ts），
  块级替换在渲染侧 blockEdit.ts（只算不写）；Agent 工具全部只读/仅产 proposal（listFiles/readFile/searchKB/runSkill
  + editBlocks，第6期 stretch 仅产 proposal 不落盘）
- 铁律二：**联网 / 笔记外发必须用户知情同意**（首次弹同意页，consent 分层：联网闸
  allowNetwork + KB 外发闸 allowSend）；key 用 safeStorage 加密存 SQLite，网络全走
  主进程、密钥不落渲染进程
- 块级改写（第 5 期）：选区触发（FloatingToolbar「AI 改写」→ 面板 composer 描述）+ 面板 @ 兜底
  （AgentTab `@ + 描述`，编号块协议 `[{block_index,new_content}]`，定位失败拒应用）；定向块编辑协议
  内部统一 `EditBlockOp[]`；红删绿增预览（rewriteDiff 行级 LCS + RewritePreviewCard，复用
  renderAIMarkdownSafe 无 dangerouslySetInnerHTML）；stale 校验（确认时 content===原文，不一致拒应用）
- 知识库 = 账号内全部笔记 + 导入文档（md/txt）：kb DAO + FTS5 虚拟表 `kb_chunks_fts`
  （CJK 前缀匹配注意）+ embeddingClient（nomic-embed-text 未装降级仅 FTS5）+ kbIndexer
  （保存防抖重嵌入/删除清理）；双路召回（FTS5 BM25 + 向量余弦 0.5/0.5）+ 拒答 0.6 +
  出处可跳转 + 置顶 ×1.5；**KB 参数（topK/fuse/threshold/置顶权重/embedding host+model）第 6 期已持久化
  到 ai_config**（kb:get/setSettings IPC，agentStore.init 拉取 + setKbSettings async；KB_STATUS 探针与
  AGENT_RUN 检索兜底均消费持久化值）
- Agent 能力：toolRegistry/agentLoop（≤6 轮函数调用循环，仅 remote 可靠，ollama 降级纯 chat）/
  skillLoader（3 内置 + 用户扩展 SKILL.md）/intentRouter（6 类 + 候选提问卡片）/
  contextManager（/4 估算 + 80% 压缩）；渲染端 AgentTab + ToolCallTrace + IntentCard +
  MarkdownMessage（HAST→React 安全富文本，无 dangerouslySetInnerHTML）
- 延期不交付：真 MCP server 管理（fetchContext7/fetchFirecrawl）、GitHub 自取 writing-shape；
  门禁全绿见 docs/plan/ai-agent-panel.status.md（第 6 期：typecheck 0 | vitest 90/1261 | lint 0 | Playwright 14/14 | 真库迁移 smoke 0）

## 已知限制（详见 spec 13.x）

- v2 Normal 无查找高亮；撤销/重做后光标回到重建树首块；段落级 MD Source 视图未迁移
