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