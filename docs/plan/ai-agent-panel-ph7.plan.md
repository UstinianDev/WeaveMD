# AI 代理面板 — 第 7 期体验重构 实施计划

> 源码核验基准：分支 `feat/ai-agent-ph3-ph4`，HEAD `6440dcd`（第 6 期已交付）
> 需求：docs/requirements/ai-agent-panel-ph7.req.md（已对齐，7 条 + A4 bug）
> 铁律（所有写路径必须满足，逐批验收复核）：
> ① AI 无直接落盘——写路径必经「红删绿增预览 → 用户确认 → `editorStore.updateContent`（入 undo 栈）」
> ② 联网/笔记外发必知情同意（`needsConsent(...,'chat')` / `allowSend` 分层闸）
> ③ 跨解析 id 漂移：blockId 不跨 `markdownToState` 解析作定位键，一律用**文档序叶序下标**

---

## 0. 现状核验与关键 ground truth 结论（已读代码确认）

### 0.1 A4 根因（已确认）
- `src/render/editor/rewrite/selectionExport.ts:31` `documentOrderLeaves` 用 `getAllBlocksInOrder(tree).filter(isLeafBlockType)` —— **只含叶子**。
- `selectionExport.ts:75` `readDocumentSelection` 用 `document.querySelectorAll('[data-block-id]')` 的 `findIndex` 求叶子下标 —— **`data-block-id` 同时挂在容器 div 与叶子 content span 上**：
  - 容器 div：`BlockRenderer.tsx:40`（`list-block` 包裹 div）、`CodeBlock.tsx:49`、`BlockquoteBlock.tsx:23`
  - 叶子 content 元素：`LeafBlock.tsx:52/64`、`ListItemBlock.tsx:33`、`ContentBlock.tsx:369`
  - 因此选中含列表/引用/代码块的选区时，DOM 序下标比叶序下标偏大 → 替换落错块（A4 现象）。
- `blockEdit.ts:76` `proposeSelectionRewrite` 用 `markdownToState(content)` 重解析后 `documentOrderLeaves` 下标 —— 与 DOM 序不一致，正是错位源。
- **测试漏洞**：`tests/render/edges/selectionExport.test.ts:101`「DOM 序与文档序一致」用例只挂段落叶子内容 span，**未挂容器 div**，故未暴露 A4。须新增含容器的 DOM 场景用例。

### 0.2 A1a 现状
- `agentLoop.ts:35-43` `AgentReqPayload.currentDocument?` 已存在；`agentLoop.ts:178-185` `toolCtx.currentDocument` 已注入 toolCtx（供 editBlocks）。
- **缺口**：`runAgentFlow` 内 messages 组装（`agentLoop.ts:206-213`）只含 history/当前，**未把 currentDocument 注入 system prompt / 首轮 user 消息** → LLM 看不到文档原文 → 这就是 A1a「当前文档未真正注入 LLM」根因。
- `ipc.ts:505-511` AGENT_RUN 归一已透传 `currentDocument`（非空才传）。`agentStore.ts:408` 渲染侧已随 `runAgent` 载荷注入 `useEditorStore.getState().content`。

### 0.3 A1c 现状
- `rewriteStore.ts:119-153` `startDocumentRewrite` 走 document scope（buildNumberedBlockList → proposeDocumentRewrite JSON 协议）。
- 空文档时 `buildNumberedBlockList('')` 返回 `[]`，`proposeDocumentRewrite` 的 JSON 块映射协议失效 → 需要「整篇替换」模式。
- 「文档是否打开」判定点：`editorStore.currentFile !== null`（`editorStore.ts:9/27`）。未开文档禁用写入的判定落点：store 层兜底 + 面板入口引导。

### 0.4 A2 现状与解法
- `toolbarState.ts:109-113` `computeToolbarState` 跨块时 `selectionSyntaxTypesConsistent` 失败即 `hide`。
- FloatingToolbar 触发机制已在：`FloatingToolbar.tsx:351-368` mousedown 隐藏 + mouseup `flushNow()`。仅混合类型被 hide 拦截。
- 解法：跨块混合类型时改为 `kind:'show'`（携带 `mixedSyntax:true`），FloatingToolbar 渲染仅「AI 改写」+ 块类型提示，隐藏行内格式按钮。

### 0.5 A3 现状
- `rewriteStore.ts:29-32` `SelectionContext { md, sel }` 即 SelectionRef 已存。
- `EditorV2.tsx` 无高亮注入；块树由 ContentBlock/LeafBlock 渲染。
- 解法：纯 CSS 类名 overlay，不入 contentEditable 内容，按 `sel.startLeafIndex/endLeafIndex + offset` 定位。

### 0.6 B1 技能清单来源
- `skillLoader.ts:38-77` `CORE_SKILLS`（3 个）+ `loadSkills(dir)` 读 `userData/skills/`。**无渲染侧 IPC 通道**——需新增 `ai:skills:list`（主进程 → 渲染）。

### 0.7 B3 会话隔离
- `agentStore.ts` `activeMode: ConversationMode`（'chat' | 'agent'）已存在；SQLite 按 mode 分域。合并后下拉切换即改 `activeMode`，会话列表/消息/发送函数按 mode 走已可隔离。

### 0.8 i18n 现有键
- `ai.tab.agent` =「代理」（zh-CN）、`ai.tab.chat` =「对话」。无「智能体」键。`ai.rewrite.atHint` =「@ + 描述改写文档」。

---

## 1. 批次拆分

### 批次 ① —— A4 选区改写错位 bug（最优先，独立，先于一切）

#### 1.1.1 变更清单

**`src/render/editor/rewrite/selectionExport.ts`**
- `readDocumentSelection(_content: string)`：启用 `_content` 参数（当前被忽略）。
  - 拿到 `startBlockId/endBlockId` 后，不再用 `document.querySelectorAll('[data-block-id]')` 求 `findIndex`（含容器块，A4 根因）。
  - 改为：`const tree = markdownToState(_content)` → `const leaves = documentOrderLeaves(tree)`（leaf-only）→ 在该叶子数组中 `indexWhere(b => b.id === startBlockId)`；同理 end。
  - **跨解析 id 漂移约束**：此处只用「当前解析树」的叶序下标；blockId 只在当前树内查找；若 `_content` 与 DOM 实际内容不一致导致 blockId 找不到 → 返回 `null`（保守禁用）。不跨解析存 blockId。
  - 保持 `startBlockId/endBlockId` 写入 SelectionRef（供 UX/高亮用），但下标一律来自解析树叶序。
  - 文件顶部注释更新：下标源从「DOM 序」改为「markdownToState 叶序」，与 `proposeSelectionRewrite` 对齐。
- 注意：DOM content span 的 id 与 `markdownToState(content)` 生成的树的叶子 id 一致（渲染层 id 源自内核 `block.id`）→ 对齐成立。若 DOM 与 `_content` 失同步（未保存的编辑），findIndex 找不到即返回 null 保守禁用，**不产生错误替换**。

**`tests/render/edges/selectionExport.test.ts`（新增用例）**
- 新增「含容器块 DOM 场景」helper：生成带 `data-block-id` 的容器 div（如 `list-block`/`blockquote`），内部挂叶子 content span（`ListItemBlock`/`ContentBlock`）。
- 用例 A（核心回归）：content = 含一个列表块 + 普通正文，DOM 挂「list-block 容器 div + 列表项叶子 + 正文叶子」，选中「列表项→正文」跨块 → 断言 `startLeafIndex` = 列表项在 `documentOrderLeaves` 中的真实叶序下标（< DOM 序下标），证明修复前会偏大。
- 用例 B：code-block 容器场景 + 其后正文，选区命中 → 叶序下标正确。
- 用例 C：`_content` 与 DOM 失同步（DOM 挂的 blockId 在 `markdownToState(_content)` 树中不存在）→ 返回 `null`（保守禁用，不错误替换）。

**`tests/render/edges/blockEdit.test.ts`（新增用例）**
- 用例 A（核心）：content 含列表/引用容器，构造 `SelectionRef`（叶序下标，选中「列表项 → 跨到正文」），`proposeSelectionRewrite` 断言**仅该区间被替换、区间外字节不变**。
- 用例 B：引用容器 + 选区跨到引用内 → 仅区间内变。

**`e2e/ai-agent-panel.spec.ts`（新增回归用例，mock 不上网）**
- 用例「含列表文档选区改写落正确块」：注入含列表+正文的多块文档；真实 DOM 选区选中「列表项 → 正文」跨块区域；触 AI 改写；断言预览红删绿增**只覆盖选中区间**（`[data-type="del"]` 含选中文本、**不含**区间外块文本）；应用后列表项被改写、区间外正文块保持原样。

#### 1.1.2 测试清单（先写失败测试 RED）
- `tests/render/edges/selectionExport.test.ts`：+3 用例（含容器叶序下标 ×2、失同步保守 null ×1）
- `tests/render/edges/blockEdit.test.ts`：+2 用例（含列表容器选区替换、含引用容器替换）
- `e2e/ai-agent-panel.spec.ts`：+1 用例（含列表文档选区改写落正确块，先 RED 复现 A4）

#### 1.1.3 验收标准（细化断言）
- selectionExport/blockEdit 新用例全绿；原有旧断言改语义为「叶序下标」后仍绿。
- Playwright：含列表文档跨块选区改写后，被替换块与选中区间一致（区间外字节零改动）。
- 门禁全绿后提交。

#### 1.1.4 步骤（RED→GREEN→门禁→提交）
1. 写 selectionExport + blockEdit 失败用例（此时 `readDocumentSelection` 仍用 DOM 序，容器用例断言失败 → RED）。
2. 改 `selectionExport.ts`（启用 `_content`、markdownToState 求叶序下标）。
3. `tests/render/edges/*` 全绿（GREEN）。
4. e2e 追加含列表改写回归用例。
5. 全量门禁 → 提交 `feat(ai): fix phase-7 A4 leaf-index selection rewrite mismatch`。

---

### 批次 ② —— A1（文档上下文注入 + 意图补词 + 从 0 到 1 整篇）

> 依赖批次①的叶序下标空间（SelectionRef/编号块列表下标一致），故排在①之后。

#### 1.2.1 A1a 文档上下文注入 LLM

**`src/main/ai/agentLoop.ts`**
- `runAgentFlow` 组装 messages 处（`agentLoop.ts:206-213` 后、主循环前）注入 currentDocument。
- 注入落点方案（**system prompt**，非首轮 user 消息插入）：
  - 在 `llmMessages` 前新增一条 `{ role:'system', content: buildDocumentContext(payload.currentDocument) }`（若存在且非空）。
  - `buildDocumentContext(doc)`：返回 `以下为当前编辑文档内容（只读，供改写/优化参考）：\n\n${doc}`。
- 长度截断策略：**复用 `contextManager` 的 `estimateTokens`**——注入前若 `estimateTokens(doc) > 5000`（约 2 万字符），截取 `slice(0, 20000)` 并在尾部追加 `\n[文档过长已截断…]`。不做二次 LLM 压缩（currentDocument 是当前快照，非历史）。
- **与 editBlocks 工具联动**：已有 `toolsForIntent` 在 rewrite 意图 + currentDocument 存在时提供 editBlocks。注入 system 上下文后，LLM 既见文档原文也能调 editBlocks → 保证两者输入同一份 `currentDocument`。
- 测试注入点：`tests/main/ai/agentLoop.test.ts` 新增「当前文档注入 system」用例——mock LLM 断言收到的首条 message role=system 且含文档内容；「文档超长截断」用例；「无 currentDocument」用例——不注入。

**`src/main/ai/intentRouter.ts`**
- `RULES` rewrite 关键词补词（`intentRouter.ts:18-21`）：新增「优化 / 整理 / 美化 / 改进 / 润一润 / 优化一下 / 整理一下 / 美化一下 / 改进一下 / optimize / improve / refine / clean up」等，与 `create` 规则错开，保持 rewrite 优先级在前。
- 测试：`tests/main/ai/intentRouter.test.ts` 新增「帮我优化这篇文档」→ intent='rewrite' 且非 chat fallback。

#### 1.2.2 A1c 从 0 到 1 写整篇

**`src/render/editor/rewrite/blockEdit.ts`**
- 新增 `proposeFullDocumentRewrite(content: string, replyText: string): RewriteProposal`：
  - 整篇替换 = document scope 全量 proposal：`originalMd = content`（可能是空串），`rewrittenMd = replyText.trim()`。
  - 空文档（`content === ''`）时：`buildNumberedBlockList` 为空、proposeDocumentRewrite JSON 协议失效 → 走本函数（文档为空直接整篇写）。
  - 有内容不为空也可走本函数（用户明确要整篇换）。
  - 校验：`rewrittenMd === content` → `unchanged:true`（空文档且回复空 → 无变化）。
  - **铁律一**：只算不写，返回 proposal，绝不自 updateContent。
- 复用第 5 期预览→确认→updateContent 管线：`RewriteProposal` 形状已兼容，`RewritePreviewCard` 直接可用。

**`src/render/stores/rewriteStore.ts`**
- 新增 `runFullDocumentRewrite(instruction: string): Promise<void>`：
  - 铁律二：`needsConsent(config, consent, 'chat')` 闸（改写=联网）。
  - 发送 `ai.rewritePreview({ scope:'document', instruction, numberedBlocks: [] })`（复用 `AI_REWRITE_PREVIEW` 通道）。
  - 收 `{text}` → `proposeFullDocumentRewrite(content, text)` → `set({ pendingRewrite: proposal })`。
  - 空文档 + 空回复 → `no-change`。
- **文档未打开禁用写入判定点**：`runFullDocumentRewrite` 入口校验 `useEditorStore.getState().currentFile === null` → `set({ rewriteError: 'no-document' })` 并返回（不写、不调 IPC）。
- 面板入口（composer 整篇写）的 UI 引导见批次③/⑥；本轮先在 store 层兜底。

**`src/main/ai/rewrite.ts`**
- 核实 `buildRewriteMessages` 对 document scope + 空 numberedBlocks 的处理——空 numberedBlocks 时 system 提示「目标文档为空，请直接生成一篇完整 Markdown 文档」。若已处理无需改；否则补分支。

**`tests/render/stores/rewriteStore.test.ts`**
- 「空文档整篇写」：`runFullDocumentRewrite` → mock rewritePreview 返回整篇 md → `pendingRewrite.originalMd===''`、`rewrittenMd`=整篇；确认 `applyRewrite` → `updateContent(整篇)` 入 undo。
- 「未打开文档」：`currentFile=null` 时 `runFullDocumentRewrite` 不调 IPC、置 `rewriteError='no-document'`。
- 「空文档+空回复」→ no-change。「stale」：原文非空 → 预览后改文档 → `applyRewrite` 拒写。

**`tests/render/edges/blockEdit.test.ts`**
- `proposeFullDocumentRewrite` 用例：空文档+完整 md → rewrittenMd=md；原文非空+新 md → 整篇换；同文本 → unchanged。

**`e2e/ai-agent-panel.spec.ts`**
- 用例「从 0 到 1 写整篇」：新建空文档 → composer 输入整篇写诉求 → 预览卡 → 应用 → 编辑器 content=整篇 → 一次 Ctrl+Z 还原空。
- 用例「未打开文档给引导」：不开文档 → 触发整篇 → 不产生空写、出现 no-document 引导。

#### 1.2.3 步骤
1. RED：intentRouter + agentLoop（system 注入/截断）+ blockEdit（proposeFullDocumentRewrite）+ rewriteStore（整篇/未打开/no-change）失败用例。
2. GREEN：改 intentRouter、agentLoop、blockEdit、rewriteStore、rewrite.ts（空 numberedBlocks 分支）。
3. e2e 追加整篇/未打开用例。
4. 全量门禁 → 提交 `feat(ai): add phase-7 A1 current-doc context + full-document write`。

---

### 批次 ③ —— A2（混合类型工具栏）+ A3（选区保持持久高亮）

> 依赖批次①叶序下标空间。

#### 1.3.1 A2 变更清单

**`src/render/components/Editor/v2/toolbarState.ts`**
- `SelectionState` 增 `mixedSyntax?: boolean`。
- `computeToolbarState`：跨块且 `selectionSyntaxTypesConsistent` 失败时**不再 return `{kind:'hide'}`**，改 return `{ kind:'show', selection:{ blockId, start, end, anchorText, inLink, mixedSyntax:true }, position }`（继续用原有 rect 定位）。同块仍走原逻辑（mixedSyntax 缺省 false）。

**`src/render/components/Editor/v2/FloatingToolbar.tsx`**
- `handleRewriteClick` 不变（readDocumentSelection→startSelectionRewrite）。
- 渲染：`selection.mixedSyntax` 为真时，隐藏行内格式按钮组 + 块类型下拉，**仅保留「AI 改写」**（可附 i18n 提示 `ai.rewrite.mixedHint`）。
- 保持 mouseup 触发语义不动（FloatingToolbar.tsx:351-368 不碰）。

**测试**
- `tests/components/FloatingToolbarV2.test.tsx`（或等价）：混合类型显示状态含 AI 改写、无行内格式按钮；单击/折叠仍 delay-hide / hide。

#### 1.3.2 A3 变更清单

**新增 `src/render/editor/rewrite/highlight.ts`（纯函数）**
- `buildHighlightRanges(content, sel) => Array<{start, end, leafId}>`：按叶序下标 + offset 映射到当前解析树的叶节点（按 leaf 文本 `slice(首 offset / 尾 offset)` 落 range），返回可被 DOM 渲染消费的结构。
- 失同步/定位失败 → 返回空数组（不阻断面板）。

**`src/render/components/Editor/v2/EditorV2.tsx`**
- 从 `useRewriteStore` 读 `selectionContext?.sel`（改写模式下非空）。
- 纯 CSS overlay：编辑器容器内渲染 `<div class="rewrite-highlight">`，按叶序下标 + offset 定位（`range.getBoundingClientRect()` 得矩形 → 绝对定位半透明高亮）。
- **不进 contentEditable 内容**，`pointer-events:none`。
- 清除：改写完成/取消/状态清空时 selectionContext 置 null → 高亮消失（随 rewriteStore 状态驱动）。

**`src/render/styles/globals.css`**
- `.rewrite-highlight { position:absolute; background: color-mix(in srgb, var(--accent) 18%, transparent); outline: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); pointer-events:none; border-radius: 3px; z-index: 60; }`

**测试**
- `tests/render/editor/rewrite/highlight.test.ts`（纯函数单测）：同叶/跨叶/容器叶定位。
- e2e「选区保持高亮」：选中一段 → AI 改写 → 面板打开且编辑器内该段仍有 `.rewrite-highlight` 可见 → 面板聚焦/输入高亮不消失 → 应用后高亮清除。

#### 1.3.3 步骤
1. RED：toolbarState 混合类型 show 用例 + FloatingToolbarV2 渲染用例；highlight.ts 纯函数用例。
2. GREEN：改 toolbarState、FloatingToolbar、新增 highlight.ts、EditorV2 挂 overlay、globals.css 样式。
3. e2e：A2 混合类型、A3 高亮保持/清除用例。
4. 全量门禁 → 提交 `feat(ai): add phase-7 A2 mixed toolbar + A3 persistent selection highlight`。

---

### 批次 ④ —— B1（`/` 与 `@` 自动补全）

> 独立小批。

#### 1.4.1 变更清单

**技能清单数据源（主进程 → 渲染）**
- 新增 IPC 通道 `AGENT_SKILLS_LIST`（`src/shared/constants.ts`）。
- `src/main/ai/skillLoader.ts` 增导出 `listSkillsForUi(userDataSkillsDir?)`：返回 `[{name, description}]`（CORE_SKILLS + userData 扩展，不含 instructions/argsSchema）。
- `src/main/ai/ipc.ts` 注册 `AGENT_SKILLS_LIST`：userData 路径从 `app.getPath('userData')` 取；校验 userId。
- `src/main/preload.ts` + `weaveMDBridge.ts` 补 `ai.listSkills`。

**补全组件 `src/render/components/AIAgent/CompletionMenu.tsx`（新增）**
- props：`open`、`trigger`（'/' | '@'）、`items`（`{label, description?, value, insertText}`）、`activeIndex`、选中/关闭回调。
- 渲染在 composer textarea 上方（绝对定位），列表项含键盘高亮态。
- 键盘导航：`↑/↓` 移动（循环）、`Enter` 选中、`Esc` 关闭、点击外部关闭。
- 交互与样式仿现有块类型菜单。

**`src/render/components/AIAgent/AgentTab.tsx`（composer 集成）**
- 检测输入中的激活前缀：光标所在 token 以 `/` 开头 → 技能补全；以 `@` 开头 → 引用补全（多词按过滤）。
- `/` 项来源：`window.weaveMD.ai.listSkills(userId)`；选中 → 插入 `/技能名 `。
- `@` 项：静态两类「当前文档（整篇改写）」「知识库文档（检索限定）」；选中「当前文档」→ 插入 `@文档 `（走现有 document scope 分流）；「知识库」→ 插入 `@知识库 `（映射 kbQa 意图）。
- `handleSend` 增加：token `^/[a-z_]+ ` → 剥前缀后作为指令走 `sendAgentMessage`（runSkill 意图）。

#### 1.4.2 测试清单
- `tests/main/ai/skillLoader.test.ts`：`listSkillsForUi` 返回名称+描述，用户扩展并入。
- `tests/main/ai/ipc.test.ts`：`AGENT_SKILLS_LIST` handler 返回技能清单。
- `tests/render/components/AIAgent/CompletionMenu.test.tsx`：键盘 ↑/↓/Enter/Esc、点击外部关闭、打开/关闭渲染。
- `tests/render/components/AIAgent/AgentTab.test.tsx`：输入 `/` 弹技能菜单、`@` 弹引用菜单、选中注入前缀、Enter 提交走对应协议分支。
- `e2e/ai-agent-panel.spec.ts`：输入 `@` 弹补全并可选（当前文档），Esc 关闭；输入 `/` 弹技能列表（mock listSkills）。

#### 1.4.3 步骤
1. RED：skillLoader/ipc/CompletionMenu/AgentTab 用例。
2. GREEN：constants/preload/bridge/ipc/skillLoader + CompletionMenu + AgentTab composer 集成 + i18n（`ai.completion.*` 键三文件）。
3. e2e 补全用例。
4. 门禁 → 提交 `feat(ai): add phase-7 B1 slash-at autocomplete menu`。

---

### 批次 ⑤ —— B2（命名「代理」→「智能体」）

> 独立小批（纯 i18n + 硬编码文案）。

#### 1.5.1 变更清单
- `src/render/i18n/zh-CN.json`：`ai.tab.agent`「代理」→「智能体」；含「代理」的其他展示键同步；新增 `ai.agent.agentLabel: "智能体"`（会话 chip 兜底名用）。
- `src/render/i18n/zh-TW.json`：同键同步「智能体」。
- `src/render/i18n/en.json`：`ai.tab.agent` 保持「Agent」。
- `src/render/components/AIAgent/AgentTab.tsx` 等：会话 chip 兜底名及硬编码「代理」字面量替换为 i18n。
- 代码标识符（agent/AgentTab/agentLoop/mode:'agent' 等）**不动**（需求 Q1 已对齐）。

#### 1.5.2 测试
- 三文件键集一致（新增键三文件同步）。
- 组件测试断言渲染「智能体」而非「代理」；e2e 定位器同步（若用「代理」）。

#### 1.5.3 步骤：改 i18n + 硬编码 → 测试 → 门禁 → 提交 `feat(ai): rename agent label to 智能体 (phase-7 B2)`。

---

### 批次 ⑥ —— B3（双 Tab → 单面板 + composer 上下拉模式选择）

> 依赖批次⑤新增的文案（「智能体」/「对话」）。合并改动面大，单独串行。

#### 1.6.1 变更清单

**核心设计：保留 `activeMode` 域隔离，合并渲染壳**
- `agentStore.ts` 已具备 `activeMode`/`toggleMode`/`loadConversations(mode)`/`loadConversation(id, mode)`/`sendMessage`(chat)/`sendAgentMessage`(agent)/`newChat`，会话按 mode 分域。合并后**沿用单数组 + mode 域切换时 reload**：
  - `toggleMode(mode)`：`set({ activeMode: mode, ... })` + 触发 `loadConversations(mode)` + `newChat()`。
  - 会话列表/消息 data 同源（store 已按当前 mode 载入），切换时 store 刷新 → 消息/列表随 mode 域隔离。
- **渲染壳合并**：`AIAgentPanel.tsx` 去掉头部 Chat/Agent 双 Tab 按钮，改：
  - 头部保留面板标题。
  - **composer 上方加模式下拉**：「对话」= mode 'chat'、「智能体」= mode 'agent'（i18n `ai.tab.chat` / `ai.tab.agent`）。
- **各模式专属控件归属**：
  - chat：仅消息流 + composer，隐藏 KB 开关/压缩/KB 设置/工具轨迹/意图卡。
  - agent：显示 KB 开关（`useKnowledgeBase`）、压缩、KB 设置、ToolCallTrace、IntentCard、agentBackendHint、RewritePreviewCard、`@`/`/` 补全。
  - 通过 `activeMode==='agent'` 条件渲染；composer 与消息列表共用一套。
- **实现取向（控制回归面）**：壳层统一（共用消息区 + 共用 composer + 模式下拉），ChatTab/AgentTab 内部渲染段保留作为按 mode 分支引用，不做大规模重构。
- `tests/setup.ts` mock 补 `ai.listSkills`（批次④）。

#### 1.6.2 测试
- `tests/render/components/AIAgent/AIAgentPanel.test.tsx`：无 Tab 按钮、有模式下拉；下拉切 chat/agent → 触发 store 域切换。
- `AgentTab.test.tsx` / `ChatTab.test.tsx`：各模式专属控件仅在对应模式显示。
- `tests/render/stores/agentStore.test.ts`：`toggleMode` 后切 mode 域会话隔离、切换不串号。
- `e2e`：单面板切换双模式，消息/会话随 mode 域切换；agent 模式保专属控件、chat 保持纯对话。

#### 1.6.3 步骤
1. RED：AIAgentPanel 单下拉无 Tab、mode 切换域隔离、专属控件归属用例。
2. GREEN：AIAgentPanel 壳合并 + 共用 composer/消息区 + 模式下拉 + 专属控件条件渲染。
3. e2e 双模式切换用例。
4. 门禁 → 提交 `feat(ai): merge chat-agent into single panel with mode dropdown (phase-7 B3)`。

---

### 批次 ⑦ —— C1（frontend-design + impeccable-skill 视觉美化）【最后】

#### 1.7.1 变更清单
- `src/render/components/AIAgent/*`（面板壳、消息/气泡、composer、下拉、补全菜单、Trace/KB 设置控件）视觉统一：
  - 正文字号：`text-xs(12px)/text-sm(14px)` 主体 → 主消息 ≥13px。
  - 输入框：`px-3 py-3 space-y-2` → 收紧 `px-2.5 py-2 space-y-1.5`，圆角统一，focus 边框 `var(--accent)`。
  - 圆角/间距节奏统一；消息气泡与工具轨迹层次强化。
  - 沿用 CSS 变量体系（`--accent`/`--border-color`/`bg-bg-*`/`text-text-*`），无硬编码色。
  - 宽度保留 clamp 260~520。
- `src/render/styles/globals.css`：`.rewrite-highlight` 融入；composer/浮动工具栏视觉 token 微调。
- 用 `frontend-design` 分析 → `impeccable-skill` 打磨后再改。**授权自主发挥，禁改交互行为**（只改样式）。

#### 1.7.2 测试
- e2e 用语义选择器（不依赖像素）；全量回归确保元素可点（pointer-events/overflow）。
- typecheck/vitest 全绿（纯样式应零破坏）。

#### 1.7.3 步骤
1. `frontend-design` 分析 → 记录痛点清单。
2. `impeccable-skill` 打磨 → 逐文件改样式。
3. 全量门禁 + e2e 语义回归 → 提交 `feat(ai): polish ai agent panel visuals (phase-7 C1)`。

---

## 2. 批间依赖与并行性评估

| 批 | 依赖 | 可并行对象 | 主要文件域 |
|---|---|---|---|
| ① A4 | 无（最先） | 独立，先于一切 | editor/rewrite/* + e2e |
| ② A1 | ①叶序下标空间 | 不可与①并行（同 selectionExport/blockEdit） | main/ai/* + rewriteStore + intentRouter |
| ③ A2+A3 | ①叶序下标空间 | ②③ 交集小但共 touch rewriteStore/blockEdit | Editor/v2/* + highlight |
| ④ B1 | 无 | ④⑤ 共 touch AgentTab/i18n，冲突面大 | AIAgent/* + skillLoader IPC |
| ⑤ B2 | 无 | 同上 | i18n 三文件 + 硬编码文案 |
| ⑥ B3 | ⑤文案、③④的 composer/控件稳定 | 不可并行（合并壳，冲突大片） | AIAgentPanel/ChatTab/AgentTab 壳 |
| ⑦ C1 | ②③④⑥ UI 稳定 | 独立但最后 | AIAgent/* 样式 + globals.css |

- **总指挥裁定**：**串行推进 7 批**（每批 TDD strict、门禁全绿、提交后再下一批）——②③ 共 touch rewriteStore/blockEdit、④⑤ 共 touch AgentTab/i18n，并行冲突面大于收益；⑦ 最后。

---

## 3. 风险与对策

| 风险 | 影响 | 对策（落实点） |
|---|---|---|
| A4 下标修复回归（破坏第 5 期既有改写） | 高 | 新增含列表/引用/代码块容器的 selectionExport + blockEdit 用例（批次①）；回归 Playwright 含列表改写用例；`readDocumentSelection` 失同步 → 返回 null 保守禁用 |
| 跨解析 id 漂移（blockId 每次 markdownToState 随机） | 中 | 批次①只借当前解析树叶序，不跨解析存 blockId 作键；A3 highlight 定位也用叶序下标映射当前 DOM id（瞬时，非持久键） |
| A3 高亮与编辑器渲染耦合（侵入 contentEditable） | 中 | 高亮为独立 overlay（`.rewrite-highlight` + pointer-events:none），绝不写入块文本；随 rewriteStore.selectionContext 生命周期清除 |
| A1a 长文档注入超上下文 | 中 | 注入 system，复用 `estimateTokens` 截断至 ~20k 字符 + 截断标记 |
| A1c 整篇写误覆盖已打开非空文档 | 高 | 铁律一：整篇也走预览确认（只产 proposal）；`applyRewrite` stale 校验；未打开文档（`currentFile===null`）入口拒写 + no-document 引导 |
| B3 合并回归面广（两 Tab → 一壳） | 高 | 保留 store mode 域逻辑（`activeMode` + loadConversations(mode)），仅合并渲染壳；Playwright 覆盖双模式切换 |
| B1 补全菜单键盘/焦点细节 | 低 | 仿既有块类型菜单交互与样式；测试断言 ↑↓/Enter/Esc/外部点击 |
| C1 视觉改动致快照/布局回归 | 中 | 改动集中在面板组件；e2e 用语义选择器不依赖像素；保持 clamp 260~520、元素可点 |
| 铁律一/二落实点 | 高 | ① 每批复核：主进程 AI 文件零写盘、`rewrite.ts` 只产 {text}、唯一写入点 `applyRewrite→updateContent` 入 undo；② 改写/联网触发前 `needsConsent(...,'chat')`、KB 外发 `allowSend` |
| IPC userId 弱校验（既有低优） | 低 | 沿用既有模式；新通道 `AGENT_SKILLS_LIST` 也按 userId 过滤 |

---

## 4. 门禁与提交策略

- **每批门禁（全绿才提交）**：
  - `typecheck`：0 error
  - `vitest`：全量通过（基线 90 files / 1261 tests，随批递增）
  - `eslint`：0 error（8 warning 均既有文件，不新增）
  - `vite build`：编译通过（electron-builder 打包失败为既有 icon.png 缺失，非本任务，不阻塞）
  - **Playwright `ai-agent-panel.spec.ts` 全绿**（既有 14 + 各批新增；drag-selection 5 RED 为他功能既有失败，不修不阻塞）
- **i18n 一致性**：每批若加键，en/zh-CN/zh-TW 三文件同步补齐，键集一致。
- **提交信息格式**：`feat(ai): <批次说明>`，末尾带 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **分支策略**：沿用当前 `feat/ai-agent-ph3-ph4`，批内工作区顺次推进、逐批提交；不推送远程。
- **文档同步**（全批完成后）：更新 `docs/modules/11-AI代理面板-Agent.md` §7 + `docs/plan/ai-agent-panel.status.md` + SUMMARY/CLAUDE.md AI 节。
- **铁律复核**（每批合规核对）：AI 无直接落盘 / 联网外发知情同意 / 无 dangerouslySetInnerHTML / 无 any / 无明文密钥、无跨解析 blockId 作键。
