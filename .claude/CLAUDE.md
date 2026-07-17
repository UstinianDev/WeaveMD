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
│   ├── components/  # Auth/, Editor/, Navbar/, Settings/, Common/
│   ├── pages/       # AuthPage, MainPage
│   ├── hooks/       # useAuth, useEditor, useTheme
│   ├── stores/      # Zustand — auth, editor, ui, history
│   ├── services/    # api, storage, export, markdown
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

## Known Issues (as of 2026-07-17)

### ContentWidget Text Horizontal Overflow (UNRESOLVED)
Rendered paragraph text in ContentWidget overlays does not auto-wrap when content
exceeds the editor width. Despite CSS `overflow-wrap: anywhere !important`,
`word-break: break-word !important`, `white-space: normal !important`, and JS
width being set immediately in `upsertWidget()`, long text lines can still
overflow the editor horizontally.

**Suspect causes (under investigation):**
- Monaco's `.monaco-editor` CSS sets `overflow-wrap: initial` which may cascade
  into the widget layer despite `!important` rules
- The ContentWidget DOM node lives inside Monaco's overlay container, which may
  have unconstrained width causing `width:100%` to resolve incorrectly
- Browser default `white-space: pre` on `<code>` elements within text
- Possible CSS containment or stacking context interference from Monaco

**Files involved:**
- `src/render/components/Editor/markdownBlockWidgets.ts` — `MarkdownRenderedBlocksController`
- `src/render/styles/globals.css` — `.markdown-block-widget` / `.markdown-block-rendered` rules

### Other Resolved Issues
| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Heading overlap with body text | Rendered heading taller than Monaco source lines, `allowEditorOverflow: true` | `overflow: hidden` + dynamic `max-height` per block type |
| Red box artifacts in rendered blocks | `bracketPairColorization`, `matchBrackets`, `occurrencesHighlight` drawing colored decorations | Disabled all three in Monaco config |
| Code block widget disappearing on scroll | ContentWidget anchored at `block.startLine`, Monaco hides widgets whose anchor is off-screen | Dynamic anchor + 50ms debounced scroll listener + `translateY()` offset |
| Code block plain-text styling ugly | No distinct code block background/theme | Catppuccin Mocha `--bg-code` / `--text-code` + Prism.js dark highlighting |