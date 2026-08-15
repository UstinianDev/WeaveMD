# AI 代理面板 — 第 5 期块级改写（实施计划）

> ⚠️ **实现期架构修正（2026-08-15）**：原设计主进程 `blockEdit.ts` 用块树内核（markdownToState/stateToMarkdown/blockTree）
> 计算 proposal。但 main 进程经 vite-plugin-electron 单独打包，渲染内核链含 `katex.min.css` CSS 导入且 main→render 无先例，
> 主进程 import 内核有跨包耦合/打包风险。**裁定**：主进程改为**薄 LLM 代理**（`src/main/ai/rewrite.ts`：consent 闸 + 调 LLM
> 返回原始文本 `RewriteReply{text}`）；块级替换与 proposal 计算**移到渲染侧**（内核本来就在渲染侧，`blockEdit.ts` 放
> `src/render/editor/rewrite/`）。块 id 映射全部渲染内完成，SelectionRef 用文档序叶子下标（渲染侧从 DOM 序 + 本地解析算）。
> 需求/验收/铁律不变（主进程只产 LLM 文本、写入仍仅渲染侧确认后 `updateContent`）。批次/变更清单按下文修正后为准。

> 模块：docs/modules/11-AI代理面板-Agent.md §7 分期 | 需求：AGT-12/13/14/17（见 docs/requirements/ai-agent-panel-ph5.req.md）
> 范围：**选区触发改写（主）+ 面板 @ 兜底（共享管线）**；`editBlocks` agent 工具注册 = **stretch**（精力够才做）。
> 铁律一（硬，AI 无直接落盘）：主进程改写管线只产 proposal（原文 + 改写后文本 + `EditBlockOp[]`），**绝不写文件/编辑器**；写入仅在渲染侧用户确认后 `editorStore.updateContent(改写后整文)`（入 undo 栈，一次可撤销）。
> 铁律二：改写走 LLM = 联网，触发前校验服务端 consent（`needsConsent(...,'chat')` = `allowNetwork`）；本管线**不涉 KB 外发** → 不要求 `allowSend`。
> 活体验证：改写循环真验走远程 DeepSeek（`~/.weavemd-deepseek-key`）；E2E 全 mock 不上网。
> 上一里程碑：第 3+4 期（知识库 + Agent 能力）已交付，门禁全绿（docs/plan/ai-agent-panel.status.md 阶段 0-8）。

---

## 0. 技术调研结论（已读代码核实 + 主指挥修正）

| 项 | 结论 | 来源/依据 |
|----|------|-----------|
| 选区 → 跨进程块定位 | ⚠️ **关键修正**：渲染进程的 `blockId` 在主进程 `markdownToState(documentMarkdown)` 重建树后**不匹配**（重建生成全新 id）。修正：`SelectionRef` 用**文档序叶子下标**（startLeafIndex/endLeafIndex）+ 块内 UTF-16 offset 跨进程定位；同一 markdown → 主/渲染两端文档序叶子序列一致，下标天然对齐。渲染侧在触发同一 tick 内用 `markdownToState(content)` + `getAllBlocksInOrder`（blockTree.ts:200）算下标；主进程同样解析后按下标定位叶子 | markdownToState.ts / blockTree.ts:200 / ContentBlock.tsx:368 |
| 块内 offset 对齐 | `block.text` 与渲染文本 `textContent` 一致（CLAUDE.md 不变式「textContent 与源一致」），`getCrossBlockSelection` 的 offset 已排除零宽空格、按 UTF-16 → 主进程 `serializeBlock` 后 `slice` 对齐可靠 | CLAUDE.md 编辑主区不变式 / selection.ts:17 |
| 选区导出给 LLM | 主进程 `buildSelectionPrompt(documentMarkdown, sel, instruction)`：解析树 → 文档序叶子 → 首叶 `text.slice(0,startOffset)` / 尾叶 `slice(endOffset)` / 中间叶整块 → 拼装成选区片段（仅 LLM 看片段，全文只在主进程本地做替换，节省 token） | stateToMarkdown.ts serializeBlock |
| 改写回写「仅替换选区块区间」 | 主进程把 LLM 返回整段 md `markdownToState` 解析 → 文档序叶子 → 替换选区区间（`replaceBlock`/`removeBlock`/`insertBlockAfter`），区间外字节不变 → `stateToMarkdown` 得改写后整文 | blockTree.ts:415/449/354 / stateToMarkdown.ts:163 |
| 面板 @ 编号块协议 | 主进程 `buildNumberedBlockList`：解析树 → 文档序叶子 → 每叶 `{blockIndex, markdown}`；LLM 返回 `[{block_index,new_content}]`；`planDocumentBlockOps` 按下标映射校验（越界/不存在 → `locateFailed` 拒应用） | blockTree.ts:200 |
| 确认写入丢光标 | `useContentSync`（useContentSync.ts:35-40）外部 effect `setContent` 重建整树 → 光标丢。第 5 期**接受**（需求明确），best-effort：确认前 `getCrossBlockSelection`/`getCursorOffsets` 记光标，写入后尽力恢复 | useContentSync.ts |
| 预览 diff 渲染 | 渲染侧**行级 diff**（`diffLines` LCS）：相同行/删行（红）/增行（绿）；改写后整段复用 `renderAIMarkdownSafe`（aiMarkdown.tsx:322 HAST→React 白名单，**无 dangerouslySetInnerHTML**） | aiMarkdown.tsx:322 |
| 改写协议不依赖 function-calling | 独立一次性调用，`llmClient.streamChatCompletion` 纯对话（不传 tools）；选区路径 LLM 只输出改写后完整 md，面板 @ 路径输出 JSON 数组；无 tool_calls 回填 → 无 snake_case 契约风险（续轮 snake_case 仅 agentLoop 相关） | llmClient.ts:75 |
| consent 闸 | 改写=联网，复用 `needsConsent(config,consent,'chat')`（consent.ts:18）：remote 需 allowNetwork，ollama 本地不需。**不用** 'agent'/allowSend | consent.ts:18 |
| 主进程无写工具 | `toolRegistry.defineCoreTools()`（toolRegistry.ts:51）4 只读工具无 editBlocks；`WRITE_NAMES` 断言（toolRegistry.test.ts:15）断言「不含」——stretch 才改 | toolRegistry.ts |
| 选区读取契约 | 编辑器 `block-content` span 带 `data-block-id`（ContentBlock.tsx:368-369）；`nearestContentSpan`（selection.ts:132）+ `getCrossBlockSelection`（selection.ts:139）+ `getCursorOffsets`（selection.ts:17）现成；**同块选区** `getCrossBlockSelection` 返回 null（selection.ts:151）→ 需补同块分支（`nearestContentSpan` 同 span → `getCursorOffsets`） | selection.ts |
| 确认写入不新增 IPC | 确认是纯渲染操作：stale 校验本地比对 `editorStore.content===proposal.originalMd` + `updateContent(rewrittenMd)` 入 undo 栈；不需要主进程二次介入 → **只新增 1 条 invoke 通道** | editorStore.ts:42 |

> 关键取舍：
> - **触发入口**：主 = 编辑器 FloatingToolbar「AI 改写」（选区态时显示，读 DOM 选区 + `editorStore.content`）→ 开 AI 面板 + 预览卡片；兜底 = AgentTab composer `@ + 描述`（document scope 编号块协议）。两者写同一 `rewriteStore`，共享 `RewritePreviewCard`。
> - **确认写入走渲染侧**：`ai:rewrite:preview` 一次 invoke 返回 proposal；确认在渲染侧完成（stale 校验原子、`updateContent` 即 undo 入栈），不新增确认 IPC。
> - **渲染侧不做重复替换**：主进程已算好 `rewrittenMd`，渲染侧确认只 `updateContent(proposal.rewrittenMd)`，不重复实现选区替换（避免双源真值）。

---

## 1. 变更清单

> 类型标注：新增 / 修改 / 复用。每行 = 一个可 diff 核对点。按「可并行拆模块」分组。**stretch（editBlocks）单列 F，默认不做**。

### A. 共享与类型（地基，必须先于 B/D）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/shared/ai.ts（改） | 定向块编辑协议 + 改写载荷/返回类型（C2 已落地） | `EditBlockOp`；`SelectionRef`（文档序叶子下标 + 块内 offset）；`RewriteScope`；`RewriteBlockRef {blockIndex,blockId,markdown}`；`RewriteRequestPayload {userId,scope,instruction,selectionMarkdown?,numberedBlocks?}`；`RewriteReply {text}`（主进程返回 LLM 原始文本）；`RewriteProposal {originalMd,rewrittenMd,ops,locateFailed?,unchanged?}`（渲染侧构造） |
| src/shared/constants.ts（改） | 新增改写通道 | `IPC_CHANNELS` 增 `AI_REWRITE_PREVIEW:'ai:rewrite:preview'` |
| src/main/preload.ts（改） | 暴露 `ai.rewritePreview` | `WeaveMDApi['ai']` 增 `rewritePreview(payload:RewriteRequestPayload):Promise<IpcResponse<RewriteProposal>>` |

### B. 主进程改写管线（可独立并跑，依赖 A）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/main/ai/rewrite.ts（**新**，薄 LLM 代理） | consent 闸 + 调 LLM 返回原始文本（不解析 markdown、不计算 proposal） | `buildRewriteMessages(payload)`（selection→[{system,instruction},{user,selectionMarkdown}]；document→[{system,instruction+协议说明},{user,JSON(numberedBlocks)}]）；`llmRewrite(messages,config,apiKeyDec)`（streamChatCompletion 纯对话无 tools，累加 delta）；`runRewrite(event,payload,config,apiKeyEnc,controller):Promise<RewriteReply>`（consent 'chat' 闸 → scope 分支建 messages → LLM → `{text}`） |
| src/main/ai/ipc.ts（改） | 注册 `ai:rewrite:preview` | 复用 `getAiConfig`/`toIAIConfig`/`toIAIConsent`（ipc.ts:52/68）→ `needsConsent(config,consent,'chat')` 未授权返 `consent_required` → `runRewrite` → 错误规范化（AIErrorCode）→ `{success,data:RewriteReply}` |

### C. 渲染侧选区读取与触发（可独立并跑）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/render/editor/rewrite/selectionExport.ts（**新**） | DOM 选区 → SelectionRef + 选区片段导出（纯函数为主，DOM 读分离） | `readDocumentSelection(content): SelectionRef|null`：`window.getSelection()`；跨块 `getCrossBlockSelection()`；同块 `nearestContentSpan` 同 span → `getCursorOffsets`；折叠/空 → null；**DOM 序枚举 `[data-block-id]` 得文档序叶子下标**；再 `markdownToState(content)` 建本地树供片段导出。`exportSelectionMarkdown(content,sel):string`：首叶 `text.slice(0,startOffset)`/中间 `serializeBlock`/尾叶 `slice(endOffset)` 拼装（供 LLM 输入的选区片段） |
| src/render/editor/rewrite/blockEdit.ts（**新**） | 渲染侧 proposal 计算（用块树内核，不落盘） | `buildNumberedBlockList(content):RewriteBlockRef[]`（markdownToState→文档序叶子→{blockIndex,blockId,markdown}）；`proposeSelectionRewrite(content,sel,replyText):RewriteProposal`（LLM 返回 md 解析成块替换选区叶子区间→rewrittenMd+ops，区间外字节不变；改写==原文→unchanged）；`proposeDocumentRewrite(content,numberedBlocks,replyText):RewriteProposal`（容错 JSON 解析→block_index 映射→替换块；越界/不存在→locateFailed） |
| src/render/components/Editor/v2/FloatingToolbar.tsx（改） | 选区「AI 改写」触发 | `computeToolbarState` 选区态（toolbarState.ts:89）时显示「AI 改写」按钮 → `readDocumentSelection(editorStore.content)` → `rewriteStore.startSelectionRewrite(md,sel)` |
| src/render/components/AIAgent/AgentTab.tsx（改） | composer @ 兜底触发 + 嵌入预览卡片 | composer 识别 `@` + 描述 → `rewriteStore.startDocumentRewrite(editorStore.content, instruction)`；渲染 `<RewritePreviewCard/>` |

### D. 渲染侧预览 UI + store（依赖 C 触发）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/render/filters/rewriteDiff.ts（**新**，纯函数） | 红删绿增行级 diff | `diffLines(originalMd,rewrittenMd):Array<{type:'same'\|'del'\|'ins',line}>`（行级 LCS） |
| src/render/stores/rewriteStore.ts（**新**） | 改写状态机 | `pendingRewrite/rewriting/rewriteError/staleRejected`；`startSelectionRewrite(md,sel)`（consent 'chat' 闸 → 开 AI 面板 `uiStore.setAIPanelOpen(true)` → `ai.rewritePreview` → set pendingRewrite）；`startDocumentRewrite(md,instruction)`；`applyRewrite()`（校验 `editorStore.content===proposal.originalMd` → 不等 stale 提示重新生成；等则 `updateContent(proposal.rewrittenMd)` 入 undo + clear）；`clearRewrite()` |
| src/render/components/AIAgent/RewritePreviewCard.tsx（**新**） | 改写预览卡片 | 读 `rewriteStore.pendingRewrite`；`diffLines` 红删绿增（del 红/ins 绿/same 灰）+ 改写后整段 `renderAIMarkdownSafe` 展示；确认→`applyRewrite`；取消→`clearRewrite`；unchanged→「无变化」提示不弹卡片 |
| src/render/i18n/{en,zh-CN,zh-TW}.json（改） | 新增键 | `ai.rewrite.*`：trigger/previewConfirm/previewCancel/applied/noChange/staleRejected/failure/atHint |

### E. 测试（TDD strict）

| 文件 | 覆盖 |
|------|------|
| tests/main/ai/blockEdit.test.ts（**新**） | LLM mock（vi.mock llmClient hoisted）：selection 返改写整段 → `planSelectionReplace` 仅替换选区叶子区间（**区间外字节不变断言**、首尾 offset 截取）；document 返 JSON → 下标映射成功；越界/不存在 → locateFailed 不抛；改写==原文 → unchanged；consent 'chat' 拒绝 → 不进 llmChat |
| tests/main/ai/ipc.test.ts（改） | AI_REWRITE_PREVIEW 处理器注册；mock needsConsent('chat')；consent_required；user_id 归属（getAiConfig 按 userId） |
| tests/render/edges/selectionExport.test.ts（**新**） | readDocumentSelection：跨块/同块/折叠 null；blockId→叶子下标映射（与主进程解析一致性） |
| tests/render/filters/rewriteDiff.test.ts（**新**） | 行级 LCS：相同/纯删/纯增/混合/空串 |
| tests/render/stores/rewriteStore.test.ts（**新**） | startSelectionRewrite consent 闸未授权 → pendingConsent 不调 IPC；成功 → pendingRewrite；applyRewrite stale 拒绝不 updateContent / 通过则 updateContent 入 undo；开面板；clearRewrite |
| tests/render/components/AIAgent/RewritePreviewCard.test.tsx（**新**） | 红删绿增渲染（diffLines 产物）；确认/取消；unchanged 提示 |
| e2e/ai-agent-panel.spec.ts（改） | mock weaveMD.ai.rewritePreview → 选区→面板卡片→确认→编辑器 content 更新且可撤销；document @ scope；stale 拒绝。**不上网** |

### F. stretch — `editBlocks` agent 工具（默认不交付，精力够再并入）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/main/ai/toolRegistry.ts（改，stretch） | 注册 `editBlocks` 只读扩展 | `defineCoreTools` 追加 editBlocks（schema `{block_ops:[{block_id,new_content}]}`）；`executeTool` case 仅校验&返回 proposal（**不落盘**，铁律一） |
| src/main/ai/agentLoop.ts（改，stretch） | toolCtx 注入改写能力 | `ToolCtx` 增 `rewrite?`；`toolsForIntent` 命中 rewrite 意图提供 editBlocks |
| tests/main/ai/toolRegistry.test.ts（改，stretch） | WRITE_NAMES 断言改造 | 移除 `'editBlocks'` 出 WRITE_NAMES + 新增「仅产 proposal 不落盘」断言 |

> **判项**：stretch 完成才改 toolRegistry.test WRITE_NAMES；否则维持「无 editBlocks」断言（§7 stretch 验收各自独立）。

---

## 2. 数据模型与共享类型（已落地 src/shared/ai.ts，C2 修正后）

```ts
export interface EditBlockOp { blockId: string; newContent: string; }

/** 渲染侧内部：文档序叶子下标 + 块内 UTF-16 offset；blockId 仅供 UX。 */
export interface SelectionRef {
  startLeafIndex: number; startOffset: number;
  endLeafIndex: number; endOffset: number;
  startBlockId?: string; endBlockId?: string;
}

export type RewriteScope = 'selection' | 'document';

/** 编号块（document scope 渲染侧构造，供 LLM 输入）。 */
export interface RewriteBlockRef { blockIndex: number; blockId: string; markdown: string; }

/** AI_REWRITE_PREVIEW 请求载荷（主进程只读 LLM 输入，不解析 markdown）。 */
export interface RewriteRequestPayload {
  userId: string; scope: RewriteScope; instruction: string;
  selectionMarkdown?: string;        // scope:'selection'
  numberedBlocks?: RewriteBlockRef[]; // scope:'document'
}

/** 主进程返回：LLM 原始输出文本（selection=改写后 md；document=JSON 数组文本）。 */
export interface RewriteReply { text: string; }

/** 渲染侧构造的改写提案（不落盘；确认后才写入）。 */
export interface RewriteProposal {
  originalMd: string; rewrittenMd: string; ops: EditBlockOp[];
  locateFailed?: boolean; unchanged?: boolean;
}
```

> 无 DB 迁移，无新表/列；回滚 = 删类型定义与通道。

---

## 3. IPC 通道清单

沿用 `IpcResponse<T> {success,data?,message?,error?}`（shared/types.ts）信封。**一次性 invoke，不新增流推送事件**。

| 通道（IPC_CHANNELS） | 方向 | 请求 | 响应 data |
|----------------------|------|------|-----------|
| AI_REWRITE_PREVIEW:`ai:rewrite:preview` | invoke | RewriteRequestPayload | IpcResponse\<RewriteProposal\>；失败 `code ∈ AIErrorCode`（consent_required/config_incomplete/parse/network/http_*/timeout/aborted） |

> 不新增确认/写入 IPC——确认是纯渲染操作（stale 本地校验 + updateContent 入 undo 栈），避免多余主进程通道与二次校验窗口。abort：首版省略（一次性调用，超时由 llmClient timeout 贯穿）。

---

## 4. 主进程设计（C2：薄 LLM 代理）

### 4.1 rewrite.ts — 管线

```text
runRewrite(event, payload, config, apiKeyEnc, controller):
  1. needsConsent(config, consent, 'chat') → 未授权 return {code:'consent_required'}  （铁律二：联网闸）
  2. apiKey ← decryptApiKey(apiKeyEnc)（remote 才需；ollama 本地免 key）
  3. messages ← buildRewriteMessages(payload):
     selection: [{system: 改写指令模板}, {user: payload.selectionMarkdown}]     // LLM 输出改写后完整 md
     document:  [{system: 改写指令 + 「输出 JSON 数组 [{block_index,new_content}]」}, {user: JSON.stringify(payload.numberedBlocks)}]
  4. text := llmRewrite(messages, config, apiKeyDec)  // streamChatCompletion 纯对话无 tools，累加 delta
  5. return { text }   // 原始文本回渲染侧，proposal 由渲染侧 blockEdit.ts 计算
```

- **主进程零 markdown 解析、零 proposal 计算**：不 import 渲染内核，无跨包耦合。LLM 文本原样返回。
- **错误规范化**：`streamChatCompletion` throw 已带 `{code,message}`（llmClient.ts:65 makeError）→ 透传 AIErrorCode。改写后是否"无变化"由渲染侧比较判定（主进程不比较）。

### 4.2 ipc.ts 处理器（复用既有 helper）

```text
ipcMain.handle(IPC_CHANNELS.AI_REWRITE_PREVIEW, async (event, payload: RewriteRequestPayload) => {
  const row = getAiConfig(payload.userId);
  const config = row ? toIAIConfig(row) : 默认;
  const consent = row ? toIAIConsent(row) : 默认;
  if (needsConsent(config, consent, 'chat')) return { success:false, code:'consent_required', message:'Network consent required' };
  const controller = new AbortController();
  try { const reply = await runRewrite(event, payload, config, row?.apiKeyEnc ?? null, controller);
        return { success:true, data: reply }; }
  catch (err) { const code = err.code ?? 'network'; return { success:false, code, message: String(err) }; }
});
```

---

## 5. 渲染侧设计

### 5.1 selectionExport.ts（DOM 选区 → SelectionRef + 片段导出）

```ts
readDocumentSelection(content: string): SelectionRef | null
  // const s = window.getSelection();
  // 跨块：getCrossBlockSelection()（selection.ts:139）→ {startBlockId,startOffset,endBlockId,endOffset}
  // 同块：anchor/focus 最近 block-content span 同 id（nearestContentSpan, selection.ts:132）→ getCursorOffsets 得 {start,end}
  // 空/折叠 → null（选区为空 → 触发禁用）
  // 文档序下标：querySelectorAll('[data-block-id]') 按 DOM 序枚举 → 找 start/end blockId 下标 → SelectionRef{startLeafIndex,...}
  // （DOM 序 = 文档序；本地 markdownToState(content) 树序一致）

exportSelectionMarkdown(content, sel): string
  // markdownToState(content) → 文档序叶子 → 首叶 text.slice(0,startOffset) / 中间 serializeBlock / 尾叶 slice(endOffset) → 拼接
```

### 5.1b blockEdit.ts（渲染侧 proposal 计算）

```ts
buildNumberedBlockList(content): RewriteBlockRef[]
  // markdownToState(content) → 文档序叶子 → {blockIndex, blockId, markdown: serializeBlock}

proposeSelectionRewrite(content, sel, replyText): RewriteProposal
  // markdownToState(content) → 文档序叶子 → 按下标定位 start/end 叶
  // replyText markdownToState → 中段叶子替换选区叶子区间（首叶 slice(0,startOffset) 前段 + 新块 + 尾叶 slice(endOffset) 后段）
  //   replaceBlock/removeBlock/insertBlockAfter；区间外叶子零改动 → stateToMarkdown → rewrittenMd + ops
  // replyText 与选区片段相同（或 rewrittenMd===content）→ unchanged:true

proposeDocumentRewrite(content, numberedBlocks, replyText): RewriteProposal
  // 容错 JSON.parse(replyText) 期望 [{block_index,new_content}]
  // block_index → numberedBlocks[i].blockId 映射校验；越界/不存在 → locateFailed:true（拒应用提示）
  // 合法 op 应用到 markdownToState(content) 对应块 → stateToMarkdown → rewrittenMd + ops
```

> 渲染侧持全部块树逻辑（内核所在），主进程只产 LLM 文本；`RewriteProposal` 渲染侧构造，写入仍仅确认后
> `updateContent(proposal.rewrittenMd)`。避免跨包 import 与双实现。

### 5.2 触发入口

- **主入口（编辑器 FloatingToolbar）**：选区态时（`computeToolbarState` 已给 offsets/blocks）加「AI 改写」按钮 → `readDocumentSelection(editorStore.content)`（null → 禁用）→ `rewriteStore.startSelectionRewrite(md, sel)`。理由：贴合「选区触发为主 AGT-12」，零编辑器句柄耦合（EditorV2 实例是 ref 局部单例无全局定位器），纯 DOM 读。
- **兜底（AgentTab composer @）**：composer `@ + 描述` → `rewriteStore.startDocumentRewrite(editorStore.content, instruction)`（document scope 编号块协议）。
- 两入口写**同一** `rewriteStore`，预览卡片同一组件。选区触发自动开 AI 面板（`uiStore.setAIPanelOpen(true)`）保证预览可见。

### 5.3 红删绿增 diff 与卡片

- `rewriteDiff.diffLines(originalMd, rewrittenMd)`：逐行 LCS → `{type:'same'|'del'|'ins', line}[]`。纯函数可单测。
- `RewritePreviewCard`：header「改写预览 + 确认/取消」；body 行级红删绿增（del 红 / ins 绿 / same 灰）+ 改写后整段 `renderAIMarkdownSafe`（白名单，无 dangerouslySetInnerHTML）；确认→`applyRewrite`，取消→`clearRewrite`；`unchanged` → 提示「无变化」不弹卡片。

### 5.4 rewriteStore（新建，与 agentStore 平级）

- **理由**：改写预览是独立一次性流（proposal 待确认状态），不复用 agent 会话模板；独立 store 避免污染 agent 会话状态。consent 复用 agentStore 的 `needsConsent(config,consent,'chat')` + `pendingConsent`（跨 store 调用 `useAgentStore.getState()`）。
- 状态：`pendingRewrite: RewriteProposal|null`、`rewriting: boolean`、`rewriteError: string|null`、`staleRejected: boolean`。
- `startSelectionRewrite(md,sel)`：`needsConsent(...,'chat')` 未授权 → `setPendingConsent(true)` 弹同意页不发请求；授权 → `uiStore.setAIPanelOpen(true)` + `ai.rewritePreview({userId,scope:'selection',documentMarkdown:md,instruction,selection})` → 成功 set `pendingRewrite`（`unchanged` → 提示不弹卡片；`locateFailed` → 拒用提示）。
- `startDocumentRewrite(md,instruction)`：同上但 `scope:'document'`，`instruction` 为 @ + 描述。
- `applyRewrite()`：`editorStore.content !== proposal.originalMd` → `staleRejected=true` 提示「文档已变更，请重新生成」**不写入**；一致 → `updateContent(proposal.rewrittenMd)`（入 undo 栈，可一次撤销）+ `clearRewrite()` + 尽力恢复光标。
- `clearRewrite()`：重置 pendingRewrite/error/staleRejected。

### 5.5 stale 校验时机

确认动作（`applyRewrite`）时校验 `editorStore.content === proposal.originalMd`。预览期间任何编辑/撤销/切换都会改 content → 不等 → 拒绝并提示。校验纯渲染侧、单线程事件循环内原子完成，无竞争窗口。

### 5.6 面板 @ 兜底流程

composer `@ + 描述` → `startDocumentRewrite` 传 `scope:'document'`（documentMarkdown + instruction）→ 主进程 `buildNumberedBlockList` 编号给 LLM → 返回 `[{block_index,new_content}]` → `planDocumentBlockOps` 映射校验 → proposal；确认/取消与选区路径共用；`locateFailed` → 拒用提示重新生成。

---

## 6. 测试计划（TDD strict）

> 主进程 mock 沿用：`vi.mock('better-sqlite3', FakeDatabase)` + `vi.mock('electron')`（ipc.test.ts:3-27）；llmClient 用 `vi.mock('@main/ai/llmClient',{streamChatCompletion})` hoisted；渲染 mock `window.weaveMD.ai`（tests/setup.ts，需补 `rewritePreview`）。

| 测试文件 | 关键用例 |
|----------|---------|
| tests/main/ai/rewrite.test.ts（**新**） | 主进程薄代理：mock llmClient（hoisted）→ selection 载荷建 messages（含 selectionMarkdown）→ LLM 调用 → `{text}`；document 载荷建 messages（含 numberedBlocks JSON）→ `{text}`；consent 'chat' 拒绝 → 不进 llmChat；错误码透传（http_500/network/parse） |
| tests/main/ai/ipc.test.ts（改） | AI_REWRITE_PREVIEW 注册；mock needsConsent('chat')；授权走 runRewrite / 未授权返 consent_required；user_id 归属 |
| tests/render/edges/selectionExport.test.ts（**新**） | readDocumentSelection：跨块/同块/折叠 null；DOM 序→叶子下标；exportSelectionMarkdown 首尾 offset/中间 serializeBlock |
| tests/render/edges/blockEdit.test.ts（**新**） | proposeSelectionRewrite 仅替换选区叶子区间（**区间外字节不动断言**、首尾 offset 截取）；proposeDocumentRewrite JSON 映射/越界 locateFailed；改写==原文 unchanged；buildNumberedBlockList |
| tests/render/filters/rewriteDiff.test.ts（**新**） | 行级 LCS：相同/纯删/纯增/混合/空串 |
| tests/render/stores/rewriteStore.test.ts（**新**） | consent 闸未授权 → pendingConsent 不调 IPC；成功 → pendingRewrite；applyRewrite stale 拒绝不 updateContent / 通过入 undo；开面板；clearRewrite |
| tests/render/components/AIAgent/RewritePreviewCard.test.tsx（**新**） | 红删绿增渲染；确认/取消；unchanged 提示 |
| e2e/ai-agent-panel.spec.ts（改） | mock ai.rewritePreview → 选区→卡片→确认→编辑器 content 更新且可撤销；document @ scope；stale 拒绝。**不上网** |

---

## 7. 验收标准（可逐条勾选）

**AGT-12 @ 文件创作（选区触发为主）**
- [ ] 编辑器选中文本 → FloatingToolbar「AI 改写」→ AI 面板出现改写预览卡片；选区为空 → 入口禁用/隐藏
- [ ] 面板 AgentTab composer `@ + 描述` → document scope 编号块协议预览；两路径共享同一 `runRewrite` 管线

**AGT-13 块级精准改写（定向块编辑协议）**
- [ ] 选区路径：选区片段给 LLM → 返回改写后完整 md → `planSelectionReplace` 仅替换选区块区间；`EditBlockOp[]` 内部统一
- [ ] 面板 @ 路径：编号块列表给 LLM → `[{blockIndex,newContent}]` → `planDocumentBlockOps` 映射校验；越界/不存在 → `locateFailed` 拒应用并提示重新生成

**AGT-14 红删绿增预览 + 一次撤销**
- [ ] diff 预览（`rewriteDiff` 行级红删绿增）→ 确认 `updateContent(rewrittenMd)` 入 undo 栈，一次 Ctrl+Z 还原
- [ ] 预览期间用户改过文档 → 确认拒绝（stale）并提示重新生成（`applyRewrite` 校验 `content===originalMd`）
- [ ] 改写结果与原文相同 → 提示「无变化」，不弹预览卡片（unchanged）

**AGT-17 工具调用（写路径必经预览确认）**
- [ ] 主进程改写管线全程无写盘触发点（`runRewrite` 只产 proposal）；写入仅渲染侧确认后 `updateContent`
- [ ] 铁律二：改写触发前校验 `needsConsent(config,consent,'chat')`；未授权弹同意页，不发外发请求

**质量门禁**
- [ ] npm run typecheck 0 error | npm run test 全绿 | npm run lint 0 error（8 warning 均既有）| npm run build pass
- [ ] Playwright e2e/ai-agent-panel.spec 通过 + 原 ai-agent-panel 10/10 回归全绿
- [ ] en/zh-CN/zh-TW 三文件 `ai.rewrite.*` 键一致无缺漏

**stretch 验收（若做 editBlocks）**
- [ ] `defineCoreTools` 含 `editBlocks` 且 `executeTool` 仅产 proposal 不落盘；`WRITE_NAMES` 断言适配

---

## 8. 风险与依赖

| 风险/依赖 | 影响 | 缓解 |
|-----------|------|------|
| 本地 qwen3.5:0.8b 故障 | 本地改写活验受阻 | 真验走远程 DeepSeek（key 在）；本管线纯对话不依赖 function-calling |
| 选区叶子下标跨进程对齐 | 下标漂移导致定位错位 | 触发同一 tick 内读 selection+content（原子）；主/渲染对同一 markdown 的文档序叶子序列一致；单测断言一致性 |
| 同块选区偏移 | getCrossBlockSelection 返回 null | 补同块分支（nearestContentSpan 同 span → getCursorOffsets） |
| LLM 返回 md 结构与选区块数不一致 | 替换后结构漂移 | 整段替换选区区间（多块→多块），区间外字节不变 = 验收核心 |
| 改写后光标丢失 | UX 劣化 | 需求接受；确认前记选区，写入后 best-effort 恢复 |
| stale 覆盖用户新编辑 | 覆盖编辑 | applyRewrite 校验 content===originalMd，不一致拒绝（AGT-14 验收线） |
| document @ 编号块定位漂移 | LLM 编号与实际不符 | 主进程编号稳定（文档序叶子）；映射校验 → locateFailed 拒用提示，不静默错位 |
| 预览 diff XSS | 注入 | 复用 renderAIMarkdownSafe（白名单，无 dangerouslySetInnerHTML）；单测断言无 script 逃逸 |
| preload/ipc 契约漂移 | 类型不一致 | 批次 1 先锁 shared 类型 + preload 契约，B/D 依赖其落定 |
| stretch WRITE_NAMES 冲突 | 断言失效 | 只在 stretch 完成时改，默认维持「无 editBlocks」 |

---

## 附：依赖顺序（实现批次，可并行拆模块）

**起跑线（地基，先建测试基线，TDD）**
- 批次 1（shared，必须先于一切）：shared/ai.ts 增类型 + constants 增 AI_REWRITE_PREVIEW + preload `ai.rewritePreview`（契约锁定）

**并行批——B（主进程薄代理）与 C（渲染侧读取/触发/proposal）可双智能体并行**（C 依赖 A 类型 + selection/blockTree/markdown 导出现成；B 依赖 A 类型 + llmClient 现成；零交叉依赖）
- 批次 2（**B 主进程薄代理**）：rewrite.ts（consent 闸 + LLM 文本）+ rewrite.test；ipc.ts 注册 AI_REWRITE_PREVIEW + 错误规范化 + ipc.test（改）
- 批次 3（**C 渲染侧**）：selectionExport.ts（选区→SelectionRef+片段）+ blockEdit.ts（proposal 计算）+ 各自 test；FloatingToolbar「AI 改写」入口；AgentTab composer @ 触发
- 批次 4（**D 预览 UI + store**，依赖 C 触发与 B proposal 契约）：rewriteDiff + rewriteStore + RewritePreviewCard + 组件测试 + i18n 三文件
- 批次 5（E 收尾）：测试补全 + e2e 扩展 + 全量质量门禁（§7）+ 文档同步（模块 §4/§7、SUMMARY、CLAUDE.md 更新为第 5 期交付）

**stretch（单独，批次 4 后）**：toolRegistry 增 editBlocks + agentLoop toolCtx + WRITE_NAMES 断言适配（§F/§7 stretch 验收）

> **并行核心**：批次 2（B 主进程）与批次 3（C 渲染侧）在批次 1 类型就绪后可双智能体并行。批次 4 需 C 触发与 B proposal 契约。批次 1 必须先于所有。
