# 需求文档：editor-codeblock-style-toolbar-inserts

> 任务名：editor-codeblock-style-toolbar-inserts
> 来源：DevFlow 阶段 1 grill-me 共识（Q1–Q5：A / A+补充 / B / A / A）
> 日期：2026-08-09

## 1. 问题描述

三个子问题，均属编辑器主区（v2 渲染层 / 浮动工具栏 / 代码块）：

- **问题①代码块**：编辑器内代码块内容字体太小（14px）、左右/上下间距太小（16px 18px 18px）、且**无语法高亮**。
- **问题②浮动工具栏插入图片未实现**：点击 🖼 按钮无效果。
- **问题③浮动工具栏超链接未实现**：点击 🔗 按钮无效果。

## 2. 根因（已查证）

### 问题① 代码块
- 编辑器态 CodeBlock（`src/render/components/Editor/v2/blocks/CodeBlock.tsx`）→ `ContentBlock` 使用 `raw` contentEditable，**仅 HTML 转义纯文本，未接入 Prism 高亮**。
- 预览层 `src/render/services/markdown.ts` 已有 `highlightCode`（Prism + `prismjs/components/*` 已装）+ `globals.css` 已有 `.token.*` 高亮配色（`.code-fence-content .token.*` 与 markdown-preview 两套）。CSS 依赖就绪，缺的是编辑器态渲染接入。
- `.code-fence-content` 字号 14px、padding 16px 18px 18px；`.code-fence-textarea`（旧路径）也 14px。

### 问题②③ 链接/图片
- **链路代码完整且有测试**：FloatingToolbar OBJECT_BUTTONS 渲染 🔗/🖼 → `handleFormat`（L420-436）→ `window.prompt` 取 URL → `onFormat` → `useEditorActions.onFormat`（L184-198）→ `formatCtrl.formatRange` → `applyLinkOrImage`（formatCtrl L170-191）生成 `[label](url)`/`![alt](url)` → `renderInline` 渲染。
- 既有测试覆盖：`floatingToolbarV2.test.tsx` TB3（图片按钮→prompt→onFormat）、`editorV2Format.test.tsx`（image url 透传）、`formatCtrl.test.ts`（link/image 生成与 selection 映射）、`inlineRenderer.test.ts`（链接/图片渲染 + 危险链接降级）。
- **关键断点**：`window.prompt` 在 Electron 渲染进程（Chromium sandbox 渲染器）中**默认被禁用** → 点击按钮无弹窗、无效果，即用户观察到的"未实现"。
- 空 URL 也缺校验：`applyLinkOrImage` 对空 url 仍生成 `[x]() `（链接）——需一并处理。

## 3. 决策（grill-me 共识）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 断点确认 | **A**：`window.prompt` 在 Electron 失效，无弹窗；需替换为可靠输入方式 |
| Q2 | UI 形态 | **A**：自绘 React Modal 弹窗；**补充**：UI 统一 mac 终端风格（左上角红黄绿窗口控件圆点，与 CodeBlock 现有 `code-fence-window-dot` 一致） |
| Q3 | 图片输入 | **B**：URL 输入 + **本地文件选择**（`dialog.showOpenDialog` 选图） |
| Q4 | 代码块高亮 | **A**：编辑器态接入 **Prism**（复用 markdown.ts 思路 + 既有 `.token.*` CSS），无新增库 |
| Q5 | 间距/字号 | **A**：字号 14→15px；内边距上下 16→20px、左右 18→24px |

## 4. 目标

### 问题①（代码块）
- 编辑器内代码块内容字号提升至 15px，内边距上下 20px、左右 24px。
- **语法高亮**：对非 plaintext 语言，编辑器侧代码内容用 Prism 高亮渲染 token，复用 `.token.*` 配色。保持 contentEditable 可编辑（高亮与 raw 编辑共存，见技术难点）。
- 语言切换后高亮即时刷新。

### 问题②③（链接/图片）
- 点击 🔗/🖼 弹出**自绘 Modal**（mac 终端风格窗口控件，标题"插入链接"/"插入图片"，URL 输入框 + 确定/取消按钮）。
- 图片 Modal 额外提供**本地文件选择**按钮（Electron `dialog.showOpenDialog`，过滤图片格式），选完回填 URL/路径。
- 确定后调用既有 `onFormat` 链路插入（行为不变）；URL 为空校验：链接取消或提示；图片空 URL 不插入。
- 移除 `window.prompt` 用法。

## 5. 范围

### 范围内
- `src/render/components/Editor/v2/FloatingToolbar.tsx`：链接/图片分支改用新 Modal 组件（替换 `window.prompt`）。
- 新增 `src/render/components/Editor/v2/InsertUrlModal.tsx`（或同目录内联组件）：自绘 Modal（输入 + 选文件 + mac 终端窗口控件）。
- `src/render/components/Editor/v2/blocks/CodeBlock.tsx` + `ContentBlock`（或 `inlineRenderer`/新 `highlightCode` 导出）：编辑器态代码块接入 Prism 高亮。
- `src/render/styles/globals.css`：`.code-fence-content` 字号/内边距调整；Modal 样式（mac 终端窗口控件复用 `code-fence-window-dot` 风格）；高亮 token 配色确认复用。
- IPC：`src/main/ipc-handlers.ts` + `src/main/preload.ts` + `src/main/ipc-channel.ts`（若存在）：新增或复用「选图文件」channel。
- `src/render/editor/kernel/inlineRenderer.ts` / `formatCtrl.ts`：仅当需要导出 `highlightCode` 或空 URL 校验时轻微调整。
- 现有 `window.prompt` 删除。
- 新增测试：Modal 交互（输入/选文件/取消）、高亮渲染（CodeBlock 高亮 HTML）、CSS 断言。

### 范围外
- 预览层 markdown 高亮（已工作）不动。
- 非编辑器应用的弹窗、图片直传云存储、拖拽插入、文内嵌 path 的语义（保持 `![alt](path)` 字面插入）。
- 其他 FloatingToolbar 按钮、其他组件、数据层、认证。

## 6. 技术难点（规划重点）

### 编辑器态代码块高亮 × contentEditable 共存
- `ContentBlock raw` 目前 `dangerouslySetInnerHTML` 用 `toDisplayHtml(inlineHtml, text)`。代码块要显示 Prism token HTML 又保持编辑，难点：
  1. 方案 A：`toDisplayHtml` 对 code-block 特殊分支——用 Prism 生成的 HTML 替代纯转义，contentEditable 内编辑时需**保持 `raw` 语义**（DOM 与 text 同步，编辑时 token span 干扰光标但实际可行，marktext 类似处理器均如此）。
  2. 方案 B：高亮仅用于显示层（伪渲染），编辑仍走纯文本 raw；但 contentEditable 无法"显示层与编辑层分离"，必须真实渲染 token span。
- 需确认 `ContentBlock` 的 DOM 同步逻辑（`forceSyncBlockDom`、onInput DOM→model）对子元素（span.token）的兼容性：应在**纯文本读取**上工作（textContent 读取），而非依赖 innerHTML 结构。
- 高亮刷新时机：语言切换（onFenceLanguageChange）后重算 inlineHtml。

### IPC 选图
- preload 已暴露 `openFile`/`saveFile`/`openFolder`。选图需新增 `dialog.showOpenDialog` 通道（过滤 images），或验证 `openFile` 是否可复用 + filter。需确认 `weaveMD` bridge 结构（`window.weaveMD`）与 channel 常量文件。

### Modal 与工具栏聚焦
- Modal 打开时工具栏驻留逻辑（stickyRef）、选区保持不变；确定后恢复选区（restoreSelection 已由 onFormat true 处理）。
- Modal 需在当前 React 树内渲染，避免 Portal 层级问题（编辑器容器 overflow）。

## 7. 成功标准

- [ ] **问题①**：编辑器代码块非 plaintext 语言渲染 Prism token HTML（有 `.token.keyword` 等类）；字号 15px、padding 20/24px；语言切换后高亮刷新；纯文本语言/无语言不误转义。
- [ ] **问题②**：点击 🖼 弹自绘 Modal（mac 终端窗口控件）；输入 URL 或本地选图后插入 `![alt](url)`；取消不插入；空 URL 不插入。
- [ ] **问题③**：点击 🔗 弹 Modal；输入 URL 后插入 `[label](url)` 且选区保留为 label；取消不插入；空 URL 不插入。
- [ ] `window.prompt` 从代码库移除（仅剩遗留注释或删除）。
- [ ] 既有 508 例全绿（断言零改动，仅新增）；`npm run typecheck` 0 error；`npm run lint` 无 error；`vite build` 通过。
- [ ] 范围外零改动（git diff 仅限范围内文件）。

## 8. 假设 / 约束

- `window.prompt` 禁用是问题②③根因（Q1-A 共识）。若实现后仍有断点，需回到阶段 1 核对。
- 高亮方案 A（Prism 内嵌编辑器态）与 contentEditable 共存的细节由规划/实现验证；若证明不可行（DOM 同步破坏编辑），降级为**编辑时临时降为纯文本、失焦/语言切换时高亮**，需回批。
- 本地选图插入路径：字面路径（`![alt](../path)`），不做 base64/data-url。
- 风险等级：L3（编辑器核心渲染 + IPC 新增 + UI 交互）；改动前简报、批准后执行。

## 9. 未决问题

- 本地选图 channel：新增 vs 复用 `openFile` 需查证后定（见规划）。
- Modal 具体组件粒度与复用（链接/图片共用 vs 拆分）——规划决定。