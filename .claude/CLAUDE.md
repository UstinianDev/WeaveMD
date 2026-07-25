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
│   │       ├── EditorScrollContainer.tsx  # Document viewport (forwardRef)
│   │       ├── EditorView.tsx             # Main orchestrator (dual-mode)
│   │       ├── FindReplaceBar.tsx         # Typora-style inline Find & Replace
│   │       ├── FindReplaceModal.tsx       # (deprecated) old centered modal
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

## Architecture (as of 2026-07-25)

### Dual-Mode Editor (v3)

The editor has been reworked from "click-to-edit individual blocks" to a dual-mode architecture:

- **Normal Mode**: Block tree rendered as **read-only** rich-text React components. No click-to-edit — blocks are display-only. Canvas minimap on the right side shows document overview with viewport indicator and click-to-scroll.
- **Source Code Mode**: Full-screen Monaco editor (`SourceCodeEditor.tsx`) for raw markdown editing. Toggle via View menu (`Ctrl+``) or `ViewMenu` dropdown in the navbar. Has built-in Monaco minimap.
- **Find & Replace**: Typora-style inline bar (`FindReplaceBar.tsx`) rendered inside EditorView. Works in both modes. Toggle via `Ctrl+F` or More menu → Find & Replace. State managed via `uiStore.isFindReplaceOpen`.

**Key files:**

- `src/render/services/blockTree.ts` — Core data structures (BlockTree, BlockNode, BlockId)
- `src/render/services/blockTreeBuilder.ts` — Markdown → block tree parser
- `src/render/services/blockTreeSerializer.ts` — Block tree → markdown serializer
- `src/render/services/searchEngine.ts` — Find/replace engine (findAllMatches, replaceAll, validateRegex)
- `src/render/components/Editor/EditorView.tsx` — Dual-mode orchestrator
- `src/render/components/Editor/SourceCodeEditor.tsx` — Full Monaco editor (Source Code Mode)
- `src/render/components/Editor/FindReplaceBar.tsx` — Inline Find & Replace (Typora-style)
- `src/render/components/Editor/Minimap.tsx` — Canvas document minimap (Normal Mode)
- `src/render/components/Editor/EditorScrollContainer.tsx` — Scroll viewport for blocks
- `src/render/components/Editor/blocks/` — 7 read-only block components
- `src/render/components/Navbar/ViewMenu.tsx` — View dropdown (Source Code Mode toggle)
- `src/render/stores/uiStore.ts` — `isSourceCodeMode`, `isFindReplaceOpen` + toggles

### Design Decisions

| Aspect | Decision |
|--------|----------|
| Block editing | Removed click-to-edit; use Source Code Mode for all editing |
| Source Code toggle | `uiStore.isSourceCodeMode` → shared between TopBar and EditorView |
| Find & Replace toggle | `uiStore.isFindReplaceOpen` → inline bar, not modal |
| Block components | Read-only display only; `renderedHtml` via `dangerouslySetInnerHTML` |
| Code fence language | Display-only span badge; no `<select>` dropdown |
| Monaco themes | Defined in EditorView useEffect (`weaveMD-dark`, `weaveMD-light`) |
| New file naming | `untitled-{timestamp36}.md` |

### Resolved Issues (from old ContentWidget system)

| Issue | Resolution |
|-------|------------|
| Text horizontal overflow | Eliminated — blocks are React components in normal DOM flow |
| Heading overlap with body text | Eliminated — each block has independent layout |
| Red box artifacts | Eliminated — no ContentWidget overlays |
| Code block widget disappearing on scroll | Eliminated — blocks use native scroll |
| IME candidate window positioning | Eliminated — no DOM mount/unmount during find/replace (inline bar) |
