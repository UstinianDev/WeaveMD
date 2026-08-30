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
- `src/main/ai/` — AI 主进程服务（remote-only）：`llm/`（llmClient/modelList）+
  `agent/`（agentLoop/agentSession/agentTaskQueue）+ `knowledge/`（kbIndexer/kbSearch）+
  `files/`（conversationExport/documentParser）+ `skills/` + `tools/`（18+ handler）+
  `ipc/` 按域拆分（7 个 handler 模块）
- `src/render/components/AIAgent/` — AI 面板三视图外壳（home/session/settings）+
  AIPanelComposer + AgentTab 消息流 + settings/{ModelForm,EmbeddingSettings,SearchSettings,...}
- `docs/` — REQUIREMENTS / SUMMARY / modules/ / specs/

## 规范

- 中文交流；代码/标识符英文；React 18 + TS strict；Zustand v4；Tailwind（自定义色板，禁止默认色）
- 文档优先：改代码前先同步需求/技术文档，完成后更新进度与验证记录
- 命名：组件 PascalCase，函数/文件 camelCase；不用 `any`
- 标题字号：H1 26/700、H2 22/600、H3 18/600、H4 16/500、正文 14/400
- 编辑器+目录区字体：中文楷体（KaiTi）、英文 Consolas（`.editor-scroll-container` + `.outline-scroll`）
- 行前缀解析统一走 `src/render/services/lineMarkdown.ts`（含 U+00A0 分隔）

## 编辑主区 v2（当前主线）

> 详细规范见 `docs/specs/editor-v2-architecture.md`（§1-§6 架构）+
> `docs/specs/editor-v2-progress.md`（§13 实施记录）+
> `docs/modules/04-编辑主区-Editor.md`（模块文档）

- 仅叶子块内容 span（`ContentBlock`）可编辑；不可变块树 + 无损双向转换（往返不变式）
- 前缀即时转换（`# `/`- `/`1. `/`- [ ] `/`> `/` ```lang `），退格在内容起点降级
  （六条退出规则：docs/specs/markdown-block-exit-rules.md）
- 语法外观对齐 marktext：标题 `#`×n 光标提示、深灰列表 marker、圆形任务复选框、引用绿色竖线
- 浮动工具栏（SPEC-EDIT-FT）：选区触发 + 块类型下拉 + 行内格式（加粗/斜体/删除线/高亮/代码/链接/图片/数学/表格）
- 图片：工具栏直选系统文件框 + `media://` 本地图协议 + 四角等比缩放 + 图片工具栏
- 可编辑表格块：`tableCodec.ts` 纯函数 + `TableBlock.tsx` 每格 `contenteditable="plaintext-only"` + `TableToolbar.tsx`
- 跨块拖选：rAF 节流 + 反向交换端点 + `useCrossBlockDragSelection.ts`
- 跨块选区替换：`beforeinput`/`onPaste` 拦截 → `replaceLeafRange` 块树级删除+插入
- 性能优化：cloneTree 精准化 + tokenizeInline LRU 缓存（256 条）+ outline 脏标记 + React.memo 补全 + Prism/KaTeX code splitting

## AI 代理面板与知识库

> 详细规范见 `docs/specs/ai-panel-features.md`（交付记录）+
> `docs/modules/11-AI代理面板-Agent.md`（架构文档）

- **后端 remote-only**：Ollama 已移除，`ChatBackend` 收敛为 `'remote'`；KB 仅 FTS5 关键词召回
- 右侧 AI 面板（导航栏「AI」按钮开合），仅 Agent 模式（Chat 已删除）
- 铁律一：**AI 写入必经确认**——红删绿增预览 → 用户确认 → `updateContent` 入 undo 栈
- 铁律二：**联网 / 笔记外发必须用户知情同意**；key 用 safeStorage 加密存 SQLite
- Agent 能力：toolRegistry + agentLoop（≤6 轮）+ skillLoader + intentRouter + contextManager
- 知识库：FTS5 BM25 召回 + 拒答 0.6 + 出处可跳转 + 置顶 ×1.5
- 写控制：writeMode auto/manual + MD5 staleness detection + Agent 交互暂停/恢复 + 事件持久化
- 三视图重构：home（RECENT 最近3）/ session（会话）/ settings（设置侧栏）

## 关键文件

- `src/render/editor/kernel/` — blockTree / markdownToState / stateToMarkdown / inlineRenderer / selection
- `src/main/media-protocol.ts` — media:// 本地图协议（非 standard scheme）
- `src/render/services/saveCurrentDraft.ts` — 切换/关闭前统一保存前置
- `src/render/editor/controllers/` — input / enter / backspace / convert / click / list / format
- `src/render/editor/editorInstance.ts` — 内核宿主（内容加载、markdown 同步）
- `src/render/components/Editor/v2/EditorV2.tsx` — v2 入口（状态、事件路由、焦点恢复、撤销）
- `src/render/components/Editor/v2/blocks/ContentBlock.tsx` — 唯一 contentEditable 表面
- `src/render/components/Editor/v2/FloatingToolbar.tsx` — 文本浮动工具栏
- `src/render/components/Editor/v2/ImageResizeBox.tsx` + `resizeMath.ts` — 图片四角缩放
- `src/render/components/Editor/EditorView.tsx` — 薄编排器（v2 唯一）

## UI 美化

> 详细规范见 `docs/specs/editor-v2-features.md`（编辑器 UI）+
> CLAUDE.md 同级 `memory/ui-beautify-2026-08-29.md`

- 字体：代码块 `Consolas + 阿里巴巴普惠体 B`；编辑主区 `Consolas + 阿里巴巴普惠体`
- 工具栏毛玻璃：`backdrop-filter: blur(12px) saturate(180%)`
- 浮动工具栏图标：Material Design Icons（react-icons/md）
- 主题：Default（明亮）+ Warm Earth（暖色陶土），CSS 变量在 globals.css

## 已知限制（详见 docs/specs/editor-v2-progress.md §13.x）

- v2 Normal 无查找高亮；撤销/重做后光标回到重建树首块；段落级 MD Source 视图未迁移
