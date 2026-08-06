# WeaveMD — CLAUDE.md

## Build Commands

```bash
npm run dev          # Start Vite dev server + Electron (HMR)
npm run build        # Vite production build + Electron Builder
npm run lint         # ESLint check — must pass before commit
npm run test         # Vitest — run before every commit
npm run test:watch   # Vitest watch mode
npm run typecheck    # tsc --noEmit
npm run format       # Prettier
npm run db:migrate   # Run SQLite migrations
npx playwright test  # E2E (real Chromium, e2e/editor.spec.ts) — requires @playwright/test + chromium
```

## Directory Structure

```
.claude/             # AI config: CLAUDE.md, AGENTS.md, rules/
docs/                # Detailed design docs (SUMMARY.md, modules/)
src/
├── main/            # Electron main process
│   ├── index.ts, window.ts, ipc-handlers.ts
│   └── db/          # SQLite (better-sqlite3) — users, files, history, settings
├── render/          # React 18 + TypeScript frontend
│   ├── editor/      # Editor v2 kernel (React-free)
│   │   ├── kernel/        # blockTree, markdownToState/stateToMarkdown, inlineRenderer, outline, selection
│   │   ├── controllers/   # input/enter/backspace/convert/click/list/format ctrl
│   │   └── editorInstance.ts
│   ├── components/  # Auth/, Editor/ (below), Navbar/, Settings/, Common/
│   │   └── Editor/               # Editor UI
│   │       ├── v2/               # Editor v2 render layer (ACTIVE)
│   │       │   ├── EditorV2.tsx, EditorScrollContainer.tsx, BlockRenderer.tsx
│   │       │   └── blocks/       # ContentBlock (only contentEditable), LeafBlock, CodeBlock, ListItemBlock, BlockquoteBlock
│   │       ├── panels/           # Side panels & tools: OutlinePanel, HistoryPanel, FileTreePanel, Minimap, FindReplaceBar
│   │       ├── blocks/           # v1 read-only blocks (fallback only)
│   │       ├── BlockRenderer.tsx, EditorScrollContainer.tsx  # v1 (fallback)
│   │       ├── EditorView.tsx             # Dual-mode orchestrator (v2 by default, __EDITOR_V2__ false → v1)
│   │       ├── FindReplaceBar.tsx         # Typora-style inline Find & Replace
│   │       ├── SourceCodeEditor.tsx       # Full Monaco for Source Code Mode
│   │       └── OutlinePanel.tsx, HistoryPanel.tsx
│   ├── components/Common/    # CreateDialog.tsx (新建文件/文件夹弹窗)
│   ├── pages/       # AuthPage, MainPage
│   ├── hooks/       # useAuth, useEditor, useTheme
│   ├── stores/      # Zustand — auth, editor, ui, history
│   ├── services/    # blockTree, blockTreeBuilder, blockTreeSerializer, markdown, markdownBlockDetector, lineMarkdown, searchEngine, export
│   ├── styles/      # globals.css
│   └── utils/       # crypto, validators, weaveMDBridge, monacoSetup
└── shared/          # types.ts, constants.ts
public/              # icons, images
```

## Code Standards

- **Framework**: React 18 + TypeScript strict mode
- **UI**: TailwindCSS v4 + Shadcn/ui — dark theme via `<html class="dark">`
- **State**: Zustand v4 — stores in `src/render/stores/`
- **Editor**: Editor v2 self-built block-tree kernel (marktext/muya-style) + Monaco for Source mode
- **Markdown**: editor kernel markdownToState/stateToMarkdown (lossless round-trip) + inlineRenderer
- **Database**: better-sqlite3 in main process, IPC bridge to renderer
- **Auth**: Local accounts (5-15 chars, a-z/0-9/_), bcryptjs, JWT localStorage
- **Naming**: `PascalCase` for components, `camelCase` for hooks/functions/files
- **Imports**: Group — 1) React/external, 2) stores/hooks, 3) components, 4) utils
- **Types**: Share via `src/shared/types.ts`; avoid `any`
- **CSS**: Tailwind utility classes preferred; extract to CSS only for complex animations
- **No inline styles** — use Tailwind classes or CSS modules
- **Heading typography (Doubao-aligned)**: H1 26/700, H2 22/600, H3 18/600, H4 16/500, Paragraph 14/400
- **Markdown line parsing**: Heading detection (`#...`) must be shared across import/new/edit/paste via `src/render/services/lineMarkdown.ts`

## Architecture (as of 2026-08-06)

### Dual-Mode Editor (v2)

Normal Mode uses the **Editor v2 kernel** (`src/render/editor/`), architecture ported from
marktext/muya. v1 (container-level contentEditable, below) remains as fallback
(`window.__EDITOR_V2__ = false`).

- **Normal Mode (v2)**: only leaf-block content spans are `contentEditable` (`ContentBlock`).
  Key mechanisms (aligned with marktext):
  - **On-demand re-render**: plain text input never triggers React re-render; only autoPair
    completion or format-syntax presence does (marktext `checkNeedRender`).
  - **IME guard**: compositionstart/end skip input handling; Chinese IME works.
  - **Syntax markers kept in DOM** (`<span class="md-syntax">`): `textContent` always equals
    source text, so editing rendered bold/italic never loses `**`/`*` markers.
  - Prefix conversion (`# `/`- `/`1. `/`- [ ] `/`> `/` ``` `) converts instantly; Backspace
    at content start demotes (six exit rules, see docs/specs/markdown-block-exit-rules.md).
  - Empty document always has one editable empty paragraph.
  - **Syntax rendering aligned with marktext** (spec 13.7): heading shows gray `#`×n level
    hint via `h1~h6.heading-block::before` + `:focus-within` (collapsed when unfocused);
    list markers are dark gray (`.list-marker` → `--text-sub`); task checkbox is an 18px
    circle (`border-radius: 50%`, checked = accent bg + white ✓ via `::after`); blockquote
    is a 3px green bar (`--quote-bar-color: #42d392`, non-italic). All syntax symbols are
    unselectable (`user-select: none` + `contentEditable={false}` / pseudo-elements).
    Note: `.editor-content-area [data-block-id]:not(blockquote)` keeps `border:none!important`
    so only blockquote may show its left bar; code blocks unchanged.
  - **Rendering pitfalls fixed (spec 13.8)**: do NOT name a v2 component class `list-item`
    (Tailwind's `list-item` utility forces `display:list-item` and overrides `flex`, adding a
    native marker dot and stacking marker/content vertically — use `list-item-block`); heading
    uses `display:flex; align-items:baseline` so the `#` marker stays on the same line as
    content; heading blocks have a click handler that focuses the content span so empty
    heading lines (including the marker area) are clickable; the generic empty-block
    placeholder rule excludes `.heading-block` so it can't override the `#` hint.
- **Source Code Mode**: Full-screen Monaco (`SourceCodeEditor.tsx`). Toggle via `Ctrl+\`` or View menu.
- **Find & Replace**: Typora-style inline bar (`FindReplaceBar.tsx`); replace works in v2 via content rebuild.

**Key files:**

- `src/render/editor/kernel/blockTree.ts` — Immutable block tree ops (list links + parent/children, split/merge)
- `src/render/editor/kernel/markdownToState.ts` — Markdown → block tree parser
- `src/render/editor/kernel/stateToMarkdown.ts` — Block tree → markdown serializer (lossless round-trip)
- `src/render/editor/kernel/inlineRenderer.ts` — Inline rendering with syntax markers kept
- `src/render/editor/kernel/outline.ts` — Heading outline + serialized line numbers
- `src/render/editor/kernel/selection.ts` — Cursor/selection DOM read/write
- `src/render/editor/controllers/` — Seven interaction controllers (input/enter/backspace/convert/click/list/format)
- `src/render/editor/editorInstance.ts` — Kernel host (content load, markdown sync)
- `src/render/components/Editor/v2/EditorV2.tsx` — v2 entry (state, event routing, focus restore, undo/redo, outline)
- `src/render/components/Editor/v2/blocks/ContentBlock.tsx` — The only contentEditable surface
- `src/render/components/Editor/EditorView.tsx` — Dual-mode orchestrator (v2 default)
- `src/render/stores/editorStore.ts` — Content state with undo/redo stack

### v1 (fallback, window.__EDITOR_V2__ === false)

Container-level contentEditable + `renderedHtml` cache; known structural issues
(input interruption, IME breakage, marker loss — see specs 13.5 R1-R4). Kept for
rollback; retirement is a separate task.

### Design Decisions

> 以下决策表为 **v1 基线（回退路径）** 记录；v2 当前决策见
> [docs/specs/editor-v2-architecture.md](docs/specs/editor-v2-architecture.md)。

| Aspect                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Block editing           | Container-level `contentEditable` on `editor-content-area` div                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Source Code toggle      | `uiStore.isSourceCodeMode` → shared between TopBar and EditorView                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Find & Replace toggle   | `uiStore.isFindReplaceOpen` → inline bar, not modal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Undo/Redo               | Store-based history stack; paragraph ops manually push to undoStack                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Code fence language     | `<select>` dropdown for language selection; Copy button in header; double-click editing removed (use Source Code Mode)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Code block editing      | Via Source Code Mode only; double-click disabled; Copy button copies code to clipboard                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Floating toolbar        | Appears on text selection; toolbar div 条件渲染，Modal 移出 `!isVisible` 守卫始终渲染（修复 Link 点击后工具栏永久消失）                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Monaco themes           | Defined in EditorView useEffect (`weaveMD-dark`, `weaveMD-light`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| New file naming         | `untitled-{timestamp36}.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Empty block placeholder | Zero-width space (`\u200B`) + CSS `::before` 绝对定位背景层（`position:absolute; z-index:-1`），仅聚焦空块显示，光标在占位符前；`EditorScrollContainer.updatePlaceholder` + `selectionchange` 动态管理 `data-empty`；失焦 `onBlur` 清除                                                                                                                                                                                                                                                                                                          |     |
| Serialization separator | `\n\n` between blocks to preserve paragraph boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Outline navigation      | Normal Mode: lineNumber → find block by `startLine` → `scrollToBlock` (no offset, title to viewport top); Source Code Mode: lineNumber → `scrollToLine`                                                                                                                                                                                                                                                                                                                                                                                          |
| Outline highlight       | Normal Mode: viewport top + 10px detectLine → last heading above it; Source Code Mode: cursor position → nearest heading line → headingIndex conversion                                                                                                                                                                                                                                                                                                                                                                                          |
| Outline width           | `uiStore.outlineWidth` (default 280px, range 200-500px); drag handle on right border, persisted to localStorage                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| HistoryPanel width      | `uiStore.historyPanelWidth` (default 280px, min 200px, no upper limit); drag handle outside panel (`right: -4px`) to avoid scrollbar overlap; persisted to localStorage; `.history-scroll` 10px scrollbar                                                                                                                                                                                                                                                                                                                                        |
| Scrollbar width         | Editor + outline + history: 10px webkit scrollbar with rounded thumb; global: 6px                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 侧边栏 Tab              | OutlinePanel 改为 Tab 容器（目录/文件）；`fileTreeStore`（folders[], activeTab）；文件树递归操作（removeFromTree/toggleInTree）；文件夹 IPC 4 通道（dialog:open-folder, folder:read/create/delete）；垃圾箱仅清列表不删磁盘                                                                                                                                                                                                                                                                                                                      |
| 文件系统同步            | editorStore.saveFile 对路径型 ID 直接 file:write 写磁盘；handleOpenFile 用磁盘路径作 ID；CreateDialog 弹窗创建文件/文件夹                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 垃圾箱语义              | 侧边栏垃圾箱仅清列表不同步删除磁盘；顶部导航栏删除文件/文件夹实时同步磁盘                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 删除文件夹              | 从侧栏 getSelectedFolder() 获取选中文件夹（递归搜索），非文件夹选中时提示                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 空状态                  | 文件被删（垃圾箱/顶部删除/所属文件夹删除）时 closeFile() → 编辑主区显示空状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 文件树累积              | loadFolderContents 累积添加文件夹（同路径替换）；addFile 累积独立文件；文件/文件夹分隔排序                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Scroll padding          | Padding moved to inner `editor-content-area` (`40px 40px 100vh 40px`); outer scroll container has no padding → scrollbar reflects actual content size; `scrollToBlock` clamps to `scrollHeight - clientHeight`                                                                                                                                                                                                                                                                                                                                   |
| Navigate ready timing   | `useEffect` depends on `[isSourceCodeMode, onNavigateReady, themesLoading]` — ensures `scrollContainerRef` is set after Monaco themes load                                                                                                                                                                                                                                                                                                                                                                                                       |
| BlockNode.startLine     | 每个 BlockNode 记录 `startLine`（1-based），用于 lineNumber 导航映射；blockTreeBuilder 构建时计算                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| BlockNode.renderedHtml  | 存储 DOM innerHTML，React 重渲染时通过 `dangerouslySetInnerHTML` 恢复富文本格式                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| BlockTree.version 语义  | `version` 仅在内容/结构变更时自增（insert/remove/updateBlockSource/setFenceLanguage 等）；`setBlockRenderedHtml` **不**自增（renderedHtml 是渲染缓存）。渲染 useEffect 依赖 `[blockTree.version]`，缓存写入不重触发 effect                                                                                                                                                                                                                                                                                                                       |
| 渲染 useEffect          | `EditorView` 渲染 effect 依赖 `[blockTree.version]`；effect 启动时捕获 blocks 快照，循环内逐块 `setBlockTree((prev) => setBlockRenderedHtml(prev, id, html))`。version 不变 → effect 不重触发 → 循环完整跑一遍 O(N)                                                                                                                                                                                                                                                                                                                              |
| 内容同步防 stale ID     | `lastBuiltContentRef` 记录当前 blockTree 对应的 content。内容 useEffect 在 `lastBuiltContentRef.current === content` 时**跳过重建**（挂载时 useState 已建树）。`buildBlockTree` 用 counter+random 生成 ID，重建会换 ID，而渲染 effect 依赖 `[version]` 不变则不重触发，导致捕获的旧 ID 失效、`setBlockRenderedHtml` no-op → 代码块不高亮                                                                                                                                                                                                         |
| WYSIWYG 格式化          | FloatingToolbarWYSIWYG 使用 `document.execCommand` + `Range API` 直接操作 DOM，同步后存储 renderedHtml                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| MD Source 功能          | 对选中段落显示/隐藏 Markdown 源码；切换前 `handleSyncToStore` 同步 DOM → React state，确保格式不丢失                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 超链接交互              | 点 Link 即隐藏工具栏开 Modal；edit 模式有"移除链接"按钮（unwrap anchor 保留文本）；`wrapRangeWithTag` 返回创建元素供 `handleLinkConfirm` 直接 `setAttribute('href')`（修复 sel.anchorNode 查找失败致 href 丢失）；Ctrl/Cmd+click 经 `LINK_OPEN_EXTERNAL` IPC → `shell.openExternal` 打开；`will-navigate`+`setWindowOpenHandler` 阻止窗口内导航；hover 蓝色斜体加粗 tooltip（`::after`+`--link-tip`，无背景，i18n `toolbar.linkTip`）                                                                                                            |
| Code-fence 保护         | `handleSyncToStore`/`handleBlockInput`/`handleBlockContentChange` 对 `code-fence` 块特殊处理：不重建 sourceLines、不运行 `detectMarkdownLine`；代码块有独立编辑路径（textarea 双击编辑）                                                                                                                                                                                                                                                                                                                                                         |
| List block 类型转换     | `blockTree.ts` 的 `resolveNextTypeFromSource` 针对 paragraph/heading 当前类型，使用 `detectMarkdownLine` 识别 heading/task/ordered/unordered/blockquote/code-fence 前缀，正确返回目标块类型（含 `orderedIndex`/`checked`）；`ListItemBlock.tsx` `getVisibleText` 正则按「task 前缀 > ordered 前缀 > unordered 前缀」顺序剥离，避免 `- [ ] ` 先匹配 `- ` 留下 `[ ]` 显示；前缀分隔符正则 `[ \t\u00A0]` 支持非断行空格（U+00A0，中文输入法产生），`handleBlockEnter` 无 pending 时回退 `detectMarkdownLine`，渲染 effect 按类型重建带前缀 markdown |
| 链接 WYSIWYG 保留       | `wrapRangeWithTag` 包裹前将 range 钳制到 `span.block-content` 内（防止跨装饰 span 边界触发 surroundContents 异常→extractContents 分裂 marker 致双复选框）；`buildSourceLinesFromContent` 与 `getBlockRenderedHtml` list-item 分支改为克隆 blockEl→移除 `.list-marker/.task-checkbox/.list-bullet`→`domToMarkdown(clone)`（不再只看 contentEl 子节点，能看见祖先 `<a>`）；包裹后清理 el 内嵌套同标签元素 + 空 `<a>` 兄弟节点（extractContents 残留）                                                                                              |
| 渲染后 WYSIWYG 同步     | `renderedHtml` 通过 `dangerouslySetInnerHTML` 恢复 DOM；任何编辑（link/格式化/回车）后 `handleSyncToStore` 将 DOM → sourceLines+renderedHtml，避免下次 render 依赖 store 的 renderedHtml 为空回退到原始文本                                                                                                                                                                                                                                                                                                                                      |
| Navbar menu trigger     | `.navbar-menu-trigger` CSS 类统一 6 个菜单（font-size 15px / letter-spacing 0.06em / word-spacing 0.1em）                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Resolved Issues (from old ContentWidget system + link-list 4 bugs)

| Issue                                    | Resolution                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text horizontal overflow                 | Eliminated — blocks are React components in normal DOM flow                                                                                                                                                         |
| Heading overlap with body text           | Eliminated — each block has independent layout                                                                                                                                                                      |
| Red box artifacts                        | Eliminated — no ContentWidget overlays                                                                                                                                                                              |
| Code block widget disappearing on scroll | Eliminated — blocks use native scroll                                                                                                                                                                               |
| IME candidate window positioning         | Eliminated — no DOM mount/unmount during find/replace (inline bar)                                                                                                                                                  |
| Link + list 4 bugs (2026-08)             | Eliminated — range clamp to .block-content + list clone/strip in buildSourceLinesFromContent/getBlockRenderedHtml + nested <a> cleanup in wrapRangeWithTag + resolveNextTypeFromSource + getVisibleText regex order |
| 文件系统同步                             | Eliminated — editorStore.saveFile 路径型ID→file:write；handleOpenFile 用磁盘路径；CreateDialog 弹窗；垃圾箱仅清列表                                                                                                 |
