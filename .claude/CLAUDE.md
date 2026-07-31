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
│   ├── components/  # Auth/, Editor/ (below), Navbar/, Settings/, Common/
│   │   └── Editor/               # Block-based WYSIWYG editor
│   │       ├── blocks/           # Per-block-type React components (read-only)
│   │       │   ├── HeadingBlock.tsx, ParagraphBlock.tsx, ListItemBlock.tsx
│   │       │   ├── CodeFenceBlock.tsx, TableBlock.tsx, BlockquoteBlock.tsx
│   │       │   └── EmptyBlock.tsx
│   │       ├── ActiveBlockEditor.tsx      # (deprecated) Monaco mini-editor
│   │       ├── BlockRenderer.tsx          # Block type dispatcher (read-only)
│   │       ├── EditorScrollContainer.tsx  # Document viewport (contentEditable surface)
│   │       ├── EditorView.tsx             # Main orchestrator (dual-mode)
│   │       ├── FindReplaceBar.tsx         # Typora-style inline Find & Replace
│   │       ├── SourceCodeEditor.tsx       # Full Monaco for Source Code Mode
│   │       ├── Minimap.tsx                # Canvas document minimap (Normal Mode)
│   │       └── OutlinePanel.tsx, HistoryPanel.tsx
│   ├── pages/       # AuthPage, MainPage
│   ├── hooks/       # useAuth, useEditor, useTheme
│   ├── stores/      # Zustand — auth, editor, ui, history
│   ├── services/    # api, storage, export, markdown, blockTree*, searchEngine
│   ├── styles/      # globals.css, tailwind.css
│   └── utils/       # crypto, validators, helpers
└── shared/          # types.ts, constants.ts
public/              # icons, images
```

## Code Standards

- **Framework**: React 18 + TypeScript strict mode
- **UI**: TailwindCSS v4 + Shadcn/ui — dark theme via `<html class="dark">`
- **State**: Zustand v4 — stores in `src/render/stores/`
- **Editor**: Monaco Editor (`@monaco-editor/react`)
- **Markdown**: unified + remark + rehype AST pipeline
- **Database**: better-sqlite3 in main process, IPC bridge to renderer
- **Auth**: Local accounts (5-15 chars, a-z/0-9/_), bcryptjs, JWT localStorage
- **Naming**: `PascalCase` for components, `camelCase` for hooks/functions/files
- **Imports**: Group — 1) React/external, 2) stores/hooks, 3) components, 4) utils
- **Types**: Share via `src/shared/types.ts`; avoid `any`
- **CSS**: Tailwind utility classes preferred; extract to CSS only for complex animations
- **No inline styles** — use Tailwind classes or CSS modules
- **Heading typography (Doubao-aligned)**: H1 26/700, H2 22/600, H3 18/600, H4 16/500, Paragraph 14/400
- **Markdown line parsing**: Heading detection (`#...`) must be shared across import/new/edit/paste via `src/render/services/lineMarkdown.ts`

## Architecture (as of 2026-07-31)

### Dual-Mode Editor (v4)

The editor supports WYSIWYG editing in Normal Mode via **container-level contentEditable**:

- **Normal Mode**: Block tree rendered as editable rich-text React components. The `editor-content-area` div is the single `contentEditable` surface. Users can:
  - Click and edit paragraph/heading content directly (empty blocks show "Type something..." placeholder)
  - Press Enter to create new paragraphs (cursor auto-placed at new block start)
  - Press Backspace in empty paragraphs to delete them
  - Use Ctrl+Z/Ctrl+Y to undo/redo all operations
  - Canvas minimap shows document overview with viewport indicator
  - Floating toolbar appears when text is selected (formatting via `document.execCommand` + DOM manipulation, toggle for Bold/Italic/Underline/Strikethrough/Highlight/InlineCode/Link/Comment/MD Source)
  - Block components use `dangerouslySetInnerHTML` to render rich text formatting (Bold/Italic/Highlight etc.) in real-time
  - Cross-block text selection enabled via container-level contentEditable
  - Code blocks editable via double-click
  - MD Source toggle: click toolbar "Src" button to show raw Markdown for the current block; click again or elsewhere to restore rich text
- **Source Code Mode**: Full-screen Monaco editor (`SourceCodeEditor.tsx`) for raw markdown editing. Toggle via `Ctrl+\`` or View menu.
- **Find & Replace**: Typora-style inline bar (`FindReplaceBar.tsx`). Works in both modes. Toggle via `Ctrl+F`.

**Key files:**

- `src/render/services/blockTree.ts` — Core data structures and operations
- `src/render/services/blockTreeBuilder.ts` — Markdown → block tree parser
- `src/render/services/blockTreeSerializer.ts` — Block tree → markdown serializer (uses `\n\n` paragraph separator)
- `src/render/services/lineMarkdown.ts` — Shared markdown line detection
- `src/render/components/Editor/EditorView.tsx` — Dual-mode orchestrator with WYSIWYG handlers
- `src/render/components/Editor/EditorScrollContainer.tsx` — Document viewport (contentEditable surface, forwardRef + scrollToBlock + active heading detection)
- `src/render/components/Editor/BlockRenderer.tsx` — Block type dispatcher (read-only rendering)
- `src/render/components/Editor/FloatingToolbarWYSIWYG.tsx` — Floating toolbar for text formatting
- `src/render/components/Editor/OutlinePanel.tsx` — Document outline with heading navigation + dynamic highlight
- `src/render/components/Editor/blocks/` — Read-only block components (ParagraphBlock, HeadingBlock, CodeFenceBlock, EmptyBlock)
- `src/render/stores/editorStore.ts` — Content state with undo/redo stack

### Design Decisions

| Aspect                  | Decision                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Block editing           | Container-level `contentEditable` on `editor-content-area` div                                                                                                                                                 |
| Source Code toggle      | `uiStore.isSourceCodeMode` → shared between TopBar and EditorView                                                                                                                                              |
| Find & Replace toggle   | `uiStore.isFindReplaceOpen` → inline bar, not modal                                                                                                                                                            |
| Undo/Redo               | Store-based history stack; paragraph ops manually push to undoStack                                                                                                                                            |
| Code fence language     | `<select>` dropdown for language selection                                                                                                                                                                     |
| Code block editing      | Double-click to enter edit mode with textarea                                                                                                                                                                  |
| Floating toolbar        | Appears on text selection; hides when selection collapsed                                                                                                                                                      |
| Monaco themes           | Defined in EditorView useEffect (`weaveMD-dark`, `weaveMD-light`)                                                                                                                                              |
| New file naming         | `untitled-{timestamp36}.md`                                                                                                                                                                                    |
| Empty block placeholder | Zero-width space (`\u200B`) + CSS `::before` pseudo-element                                                                                                                                                    |
| Serialization separator | `\n\n` between blocks to preserve paragraph boundaries                                                                                                                                                         |
| Outline navigation      | Normal Mode: lineNumber → find block by `startLine` → `scrollToBlock` (no offset, title to viewport top); Source Code Mode: lineNumber → `scrollToLine`                                                        |
| Outline highlight       | Normal Mode: viewport top + 10px detectLine → last heading above it; Source Code Mode: cursor position → nearest heading line → headingIndex conversion                                                        |
| Outline width           | `uiStore.outlineWidth` (default 280px, range 200-500px); drag handle on right border, persisted to localStorage                                                                                                |
| Scrollbar width         | Editor + outline: 10px webkit scrollbar with rounded thumb; global: 6px                                                                                                                                        |
| Scroll padding          | Padding moved to inner `editor-content-area` (`40px 40px 100vh 40px`); outer scroll container has no padding → scrollbar reflects actual content size; `scrollToBlock` clamps to `scrollHeight - clientHeight` |
| Navigate ready timing   | `useEffect` depends on `[isSourceCodeMode, onNavigateReady, themesLoading]` — ensures `scrollContainerRef` is set after Monaco themes load                                                                     |
| BlockNode.startLine     | 每个 BlockNode 记录 `startLine`（1-based），用于 lineNumber 导航映射；blockTreeBuilder 构建时计算                                                                                                              |
| BlockNode.renderedHtml  | 存储 DOM innerHTML，React 重渲染时通过 `dangerouslySetInnerHTML` 恢复富文本格式                                                                                                                                |
| WYSIWYG 格式化          | FloatingToolbarWYSIWYG 使用 `document.execCommand` + `Range API` 直接操作 DOM，同步后存储 renderedHtml                                                                                                         |
| MD Source 功能          | 对选中段落显示/隐藏 Markdown 源码；切换前 `handleSyncToStore` 同步 DOM → React state，确保格式不丢失                                                                                                           |
| Code-fence 保护         | `handleSyncToStore`/`handleBlockInput`/`handleBlockContentChange` 对 `code-fence` 块特殊处理：不重建 sourceLines、不运行 `detectMarkdownLine`；代码块有独立编辑路径（textarea 双击编辑）                       |

### Resolved Issues (from old ContentWidget system)

| Issue                                    | Resolution                                                         |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Text horizontal overflow                 | Eliminated — blocks are React components in normal DOM flow        |
| Heading overlap with body text           | Eliminated — each block has independent layout                     |
| Red box artifacts                        | Eliminated — no ContentWidget overlays                             |
| Code block widget disappearing on scroll | Eliminated — blocks use native scroll                              |
| IME candidate window positioning         | Eliminated — no DOM mount/unmount during find/replace (inline bar) |
