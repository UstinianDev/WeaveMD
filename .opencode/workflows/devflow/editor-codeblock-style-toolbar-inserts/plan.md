# 实现计划：editor-codeblock-style-toolbar-inserts

> 来源：DevFlow 阶段 2（@planner 两度空返回，总指挥基于查证事实自产）| 需求：requirements.md | 日期：2026-08-09

## Overview

三个子问题（grill-me Q1–Q5 共识）：
1. **代码块**：编辑器态接入 Prism 高亮（复用预览层思路 + 既有 `.token.*` CSS）；字号 14→15px、内边距 16/18→20/24px。
2. **图片插入**：断点 = FloatingToolbar `window.prompt`（Electron 禁用）→ 自绘 Modal（mac 终端红黄绿窗口控件），支持 URL + 本地选图。
3. **链接插入**：同断点 → 自绘 Modal URL 输入。

## 架构结论（已逐行查证）

### 代码块高亮注入点
- `blockTree.ts` `renderBlock`（L497-502）调 `renderBlockHtml({type, text})` → `inlineRenderer.ts` L32-36 code-block 分支**仅 escapeHtml**（无高亮）。
- **关键**：`editorInstance.ts:65` 已传**整 block** `renderBlockHtml(block)`（block 含 `meta.fenceLanguage`），但 `renderBlock` 内部只传 `{type,text}`——language 丢失。
- **修复**：
  - `inlineRenderer.ts` `renderBlockHtml(block: Pick<BlockNodeV2,'type'|'text'|'meta'>)`：code-block 分支读 `block.meta?.fenceLanguage`，非 plaintext 且有 Prism grammar 时用 `Prism.highlight` 生成 token HTML；否则回退 `escapeHtml`。`escapeHtml` 输出需含语法着色 span（`<span class="token keyword">`），安全：Prism 输出的是受控 HTML，但需对文本先转义（Prism.highlight 内部已对原文转义）。
  - `blockTree.ts` `renderBlock`：透传 `block.meta.fenceLanguage` → `renderBlockHtml({ type: block.type, text: content, meta: block.meta })`。
  - `toDisplayHtml` 不变（code-block 的 inlineHtml 已是高亮 HTML，ContentBlock raw 直接渲染）。
- **contentEditable 共存安全**：ContentBlock `syncDomToModel`（L97）用 **`el.textContent`** 读 DOM→model，天然忽略 token span；`raw` 模式禁用快照吸附/方向键 snap（L228/L254 `!raw`），代码块编辑不受干扰。**无需编辑降级方案**。
- 高亮刷新时机：`onFenceLanguageChange`（updateMeta）→ 由上层触发 `renderBlock` 重算 inlineHtml → React 重渲染（`setTree`）。确认 updateMeta 后需 renderBlock（见下文）。语言为 plaintext/无 grammar → 回退转义。

> 注意：`renderBlock` 当前在语言变更路径是否被调用需在实现时验证；若无，需在 updateMeta code-block 分支补 renderBlock 调用（实现阶段处理，属计划内）。

### Modal（图片/链接）
- FloatingToolbar 根 div 为 `fixed z-[100]`，Modal 作为其子元素渲染，`position:fixed` 居中，无 overflow 裁剪（fixed 脱离文档流）。不引入 Portal。
- Modal 触发：`handleFormat`（L420-436）link/image 分支由 `window.prompt` 改为 `setInsertState({ style, open:true })`。
- Modal 确认：`onConfirm(url)` → `onFormat(selection.blockId, style, selection.start, selection.end, url, true)`（既有链路不变）。
- 取消/关闭：`onCancel()`，不调用 onFormat；恢复工具栏 sticky（保持驻留）。

### IPC 本地选图
- 新增 channel：`IPC_CHANNELS.DIALOG_PICK_IMAGE = 'dialog:pick-image'`（constants.ts L69 附近）。
- `ipc-handlers.ts`：`ipcMain.handle(..., async () => { const r = await dialog.showOpenDialog({ properties:['openFile'], filters:[{name:'Images', extensions:['png','jpg','jpeg','gif','webp','svg','bmp']}] }); return r.canceled ? null : r.filePaths[0]; })`。
- `preload.ts`：bridge 暴露 `pickImage: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_PICK_IMAGE)`。
- Modal 图片分支「选择文件」按钮 → `await window.weaveMD.dialog.pickImage()`（需查 preload 命名空间）→ 回填 url 输入框。

### 代码块间距/字号
- `globals.css` `.code-fence-content`（L1647）：`font-size: 14px→15px`。
- `.code-fence-content pre`（L1659）：`padding: 16px 18px 18px → 20px 24px`。
- `.code-fence-textarea`（L1680，旧路径可能未用）：同步 15px/20·24（可选）。
- ContentBlock raw 内联 style（L295）：`fontSize:'13px'→'15px'`（或由 CSS 覆盖，实现时选一，避免双源）。

## 实施步骤（TDD，单元顺序）

### U1 — IPC 选图 channel（无源码依赖，先行）
- 文件：`src/shared/constants.ts`、`src/main/ipc-handlers.ts`、`src/main/preload.ts`
- 测试：新增 `tests/main/ipc.test.ts`（或复用现有 main 测试目录；mock dialog.showOpenDialog 返回路径/canceled）。确认测试目录结构后写。
- 验证：`npx vitest run tests/main/*`（如有）→ `npm run typecheck`。

### U2 — 代码块 Prism 高亮（kernel 改动）
- 文件：`inlineRenderer.ts`、`blockTree.ts`；测试 `tests/editor/kernel/inlineRenderer.test.ts`、`tests/editor/kernel/blockTree.test.ts`（新增）。
- 新增测试断言：
  - `renderBlockHtml({type:'code-block', text:'const a=1', meta:{fenceLanguage:'javascript'}})` 含 `<span class="token keyword">`；不含字面 `const` 裸文本。
  - plaintext / 无 language / 无 grammar 语言 → 回退 escapeHtml（`&lt;` 转义，无 token span）。
  - `renderBlock`（带 meta）→ inlineHtml 为高亮 HTML；`textContent` 往返等于原文。
  - 语言别名（js→javascript）归一化复用 CodeBlock 的 LANGUAGE_ALIASES？——注意：kernel 与组件各有一套别名。**实现时在 kernel 内提供 normalizeLanguage 或复用组件导出**，规划倾向 kernel 内轻量实现（避免组件依赖 kernel 反向）。
- 验证：`npx vitest run tests/editor/kernel/inlineRenderer.test.ts tests/editor/kernel/blockTree.test.ts` → `npm test`。

### U3 — 代码块字号/间距（纯 CSS + raw style）
- 文件：`globals.css`（`.code-fence-content`、`.code-fence-content pre`）；`ContentBlock.tsx` raw fontSize。
- 测试：`tests/styles/ft2Css.test.ts` 追加断言（`.code-fence-content` 15px、pre padding 20/24）。
- 验证：`npx vitest run tests/styles/ft2Css.test.ts` → `npm test`。

### U4 — InsertUrlModal 组件
- 文件：新增 `src/render/components/Editor/v2/InsertUrlModal.tsx`。
- 组件 Props：`{ title, open, onConfirm(url), onCancel, pickImage?: () => Promise<string|null> }`。mac 终端窗口控件（红黄绿 dot，复用 `code-fence-window-dot` 类或新建 `.modal-window-dot`）。
- 测试：新增 `tests/components/insertUrlModal.test.tsx`（或并入 floatingToolbarV2）：打开渲染标题/输入框/确定/取消；输入 URL 确定→onConfirm(url)；取消→onCancel；空 URL 确定→不提交（onConfirm 不被调/提示）；图片模式显示「选择文件」按钮，点击调 pickImage 回填。
- 验证：`npx vitest run tests/components/insertUrlModal.test.tsx`。

### U5 — FloatingToolbar 接线（link/image 分支替换 prompt）
- 文件：`FloatingToolbar.tsx`（L420-436 handleFormat 改为 state 驱动 Modal；JSX 渲染 Modal）。
- 测试：`tests/components/floatingToolbarV2.test.tsx` 现有 TB3 断言**需适配**（prompt mock → Modal）。注意既有断言零改动约束：TB3 用 prompt mock，改为 Modal 交互后原断言必然破坏。**处理**：TB3 属"断言改动"——与需求"既有断言零改动"冲突。决策：TB3 改为通过 Modal 交互断言（属测试适配而非削减，且是本需求直接目标）；若拒绝改动，则 Modal 触发链路无法验证。**列入计划明确此点，实现时如违反"零改动"需回批**。
- 验证：`npx vitest run tests/components/floatingToolbarV2.test.tsx` → `npm test`。

### U6 — 回归与收尾
- `npm test`（既有 508 零漂移 + 新增）→ `npm run typecheck` → `npm run lint`（跑后审查 diff）→ `npx vite build`。
- `git diff --stat` 确认仅范围内文件。

## 依赖关系

```
U1(IPC) ──► U5(接线,图片选文件)
U2(高亮) ──► U3(CSS 独立)
U4(Modal) ──► U5
U5 ──► U6(回归)
```

## 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | Prism 高亮 span 干扰 contentEditable 光标/编辑 | `syncDomToModel` 用 textContent（L97）天然免疫；raw 禁用 snap；实现时用现有 code-block 编辑测试回归（editorV2.test.tsx L36-37 textContent 断言） |
| R2 | 语言切换后 inlineHtml 未刷新 | updateMeta 路径需触发 renderBlock；实现时验证/补调用 |
| R3 | IPC sandbox 暴露 pickImage | 仅只读文件对话框，无新权限；遵循既有 channel 模式 |
| R4 | TB3 既有断言（prompt mock）冲突 | 测试适配为 Modal 交互（本需求直接目标）；列入明确决策，实现时若需改既有断言回批 |
| R5 | kernel 引入 Prism 依赖 | Prism 已在 package.json；kernel 引入需确认无循环依赖（markdown.ts 已是上层服务，kernel 是渲染核心——**倾向在 inlineRenderer 层 import Prism 组件**，与 markdown.ts 同思路）；typecheck 验证 |
| R6 | 双源字号（CSS + ContentBlock inline style） | 统一为 CSS 控制（raw style 移除 fontSize 或保留其一），CSS 断言为准 |
| R7 | Modal 打开时工具栏 hide | Modal 打开设 sticky，onMouseEnter 保留；关闭恢复 |

## 测试策略

- 定向：各单元验证命令见上。
- 全量：`npm test`（期望 508 + ~20 新增全绿）、`npm run typecheck` 0 error、`npm run lint` 无 error、`vite build`。

## 成功标准

- [ ] 编辑器代码块非 plaintext 渲染 Prism token HTML；plaintext/无 language 回退转义；textContent 往返一致。
- [ ] 代码块字号 15px、内边距 20/24px（CSS 断言）。
- [ ] 🖼 点击弹 Modal（红黄绿窗口控件），URL 或本地选图后插入 `![alt](url)`；取消/空 URL 不插入。
- [ ] 🔗 点击弹 Modal，URL 插入 `[label](url)` 选区保留；取消不插入。
- [ ] `window.prompt` 从代码库移除。
- [ ] 既有测试全绿（除 R4 明确说明的 TB3 适配，若需则回批）；typecheck/lint/build 通过；范围外零改动。

## 风险等级

- **L3**：U2（kernel inlineRenderer/blockTree 高亮）、U4/U5（UI 交互 + 替换 prompt）、U1（IPC 新增 channel）。改动前简报、批准后执行（已获 grill-me 共识，执行时简报确认）。
- **L4**：无。

## 遗留（范围外不处理）

- 预览层 markdown 高亮（已工作）不动；图片直传云、拖拽插入、data-url。
- 非编辑器应用 Modal 复用；其他工具栏按钮。
- kernel 与组件语言别名归一化的统一（若实现发现不一致，记录不强行重构）。