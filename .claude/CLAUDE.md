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
docs/                # Detailed design docs (FRONTEND.md, SECURITY.md, etc.)
src/
├── main/            # Electron main process
│   ├── index.ts, window.ts, ipc-handlers.ts
│   └── db/          # SQLite (better-sqlite3) — users, files, history, settings
├── render/          # React 18 + TypeScript frontend
│   ├── components/  # Auth/, Editor/ (below), Navbar/, Settings/, Common/
│   │   └── Editor/               # Block-based WYSIWYG editor
│   │       ├── blocks/           # Per-block-type React components
│   │       │   ├── HeadingBlock.tsx, ParagraphBlock.tsx, ListItemBlock.tsx
│   │       │   ├── CodeFenceBlock.tsx, TableBlock.tsx, BlockquoteBlock.tsx
│   │       │   └── EmptyBlock.tsx
│   │       ├── ActiveBlockEditor.tsx      # Monaco mini-editor wrapper
│   │       ├── BlockRenderer.tsx          # Block type dispatcher
│   │       ├── EditorScrollContainer.tsx  # Document viewport
│   │       ├── EditorView.tsx             # Main editor orchestrator
│   │       ├── FloatingToolbar.tsx        # Selection toolbar (stub — needs rewrite)
│   │       └── OutlinePanel.tsx, HistoryPanel.tsx
│   ├── pages/       # AuthPage, MainPage
│   ├── hooks/       # useAuth, useEditor, useTheme
│   ├── stores/      # Zustand — auth, editor, ui, history
│   ├── services/    # api, storage, export, markdown, blockTree*, blockController, inlineDecorator
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
- **Editor UI constraint**: Any code-fence language selector must be mounted inside the code block header container (no portal/fixed dropdown in the page side area)

## Architecture (as of 2026-07-18)

### Block-Based WYSIWYG Editor v2
The editor has been reworked to use a block-based architecture inspired by MarkText/Muya:
- **Block Tree**: Document model with stable BlockIds (not position-based)
- **React Block Components**: Each block (heading, paragraph, list, code, table, blockquote) is a React component
- **Monaco Mini-Editor**: Only the active block embeds a small Monaco editor for editing
- **Inline WYSIWYG**: Syntax markers hidden via Monaco decorations
- **Markdown Pipeline**: unified/remark/rehype + Prism.js retained for HTML generation

**Key files:**
- `src/render/services/blockTree.ts` — Core data structures
- `src/render/services/blockTreeBuilder.ts` — Markdown → block tree parser
- `src/render/services/blockTreeSerializer.ts` — Block tree → markdown serializer
- `src/render/services/blockController.ts` — Block navigation/split/merge
- `src/render/services/inlineDecorator.ts` — Inline WYSIWYG decorations
- `src/render/components/Editor/blocks/` — 7 block type components
- `src/render/components/Editor/ActiveBlockEditor.tsx` — Monaco mini-editor wrapper
- `src/render/components/Editor/EditorScrollContainer.tsx` — Document viewport

### Resolved Issues (from old ContentWidget system)
| Issue | Resolution |
|-------|-----------|
| Text horizontal overflow | Eliminated — blocks are React components in normal DOM flow |
| Heading overlap with body text | Eliminated — each block has independent layout |
| Red box artifacts | Eliminated — no ContentWidget overlays |
| Code block widget disappearing on scroll | Eliminated — blocks use native scroll |
| Code block plain-text styling | Improved — light “terminal window” style + language dropdown selector in header; `Plain Text` normalized to `plaintext` |
