# WeaveMD Normal Mode WYSIWYG Editing Fix - Product Requirement Document

## Overview

- **Summary**: Fix two critical bugs in WeaveMD's Normal Mode (WYSIWYG editor): (1) new content created via Enter key is lost when switching to Source Code Mode, and (2) Markdown syntax (e.g., `# title`, `- list`) does not auto-render to rich text on Enter key press.
- **Purpose**: Normal Mode should behave like Typora/Marktext — "what you see is what you get" editing where Markdown syntax is instantly rendered and all edits are preserved when switching modes.
- **Target Users**: Writers, developers, and technical documentation authors who use WeaveMD for Markdown editing.

## Goals

- Fix new content preservation: Any content added in Normal Mode (including new blocks created via Enter) must be preserved when switching to Source Code Mode
- Fix Markdown auto-rendering: When a user types Markdown syntax and presses Enter, the syntax should be immediately converted to the corresponding rich text block type (heading, list, blockquote, etc.)
- Eliminate race conditions: Remove React anti-pattern of calling `syncTreeToStore` inside `setBlockTree` updater functions
- Match Typora/Marktext behavior: Provide seamless WYSIWYG editing experience

## Non-Goals (Out of Scope)

- Changing the overall block tree data model
- Implementing full Markdown live preview (only handle syntax detection on Enter key)
- Adding new block types or Markdown features
- Refactoring Source Code Mode (Monaco editor)

## Background & Context

- WeaveMD uses a dual-mode editor: Normal Mode (WYSIWYG) and Source Code Mode (Monaco)
- Normal Mode renders blocks (paragraphs, headings, lists, etc.) as React components with contentEditable
- A `blockTree` data structure (Zustand store + React state) manages the document
- Mode switching uses `beforeToggleSourceMode` callback to sync DOM content back to the store
- **Current anti-pattern**: `syncTreeToStore` (which calls `setContent` on the Zustand store) is called INSIDE `setBlockTree((prev) => ...)` updater functions, creating race conditions
- The root cause: when mode toggles, React hasn't committed `beforeToggleSourceMode`'s `setBlockTree` yet, so `handleBlur` fires during unmount with a stale `prev`, overwriting the correct store content

## Functional Requirements

- **FR-1**: When user creates a new paragraph via Enter key in Normal Mode and types content, switching to Source Code Mode must preserve the new content
- **FR-2**: When user types Markdown syntax (heading, list, blockquote, task list) in a block and presses Enter, the block must auto-convert to the corresponding rich text type
- **FR-3**: Editing existing content in Normal Mode and switching to Source Code Mode must preserve all modifications
- **FR-4**: Switching between modes multiple times must not corrupt or duplicate content

## Non-Functional Requirements

- **NFR-1**: No regression to existing features (Source Code Mode editing, find/replace, code blocks, etc.)
- **NFR-2**: Must pass all 185 existing tests
- **NFR-3**: TypeScript type checking must pass without errors
- **NFR-4**: ESLint must pass without new warnings

## Constraints

- **Technical**: React 18, TypeScript strict mode, Zustand state management, existing block tree data model
- **Architecture**: Must work within the current dual-mode architecture without major refactoring
- **Performance**: Must not introduce visible lag or cursor jumping during editing

## Assumptions

- Users are running the Electron desktop app with access to developer tools for verification
- The existing `detectMarkdownLine` function in `lineMarkdown.ts` correctly identifies Markdown syntax
- The existing `buildSourceLinesFromContent` helper correctly constructs source lines for each block type

## Acceptance Criteria

### AC-1: New Content Preservation on Mode Switch

- **Given**: User is in Normal Mode with an existing document open
- **When**: User clicks on a paragraph, presses Enter to create a new block, types "Hello World", then presses Ctrl+` to switch to Source Code Mode
- **Then**: The Source Code Mode editor displays "Hello World" as a paragraph (or the appropriate Markdown representation)
- **Verification**: `human-judgment`

### AC-2: Markdown Auto-Rendering on Enter

- **Given**: User is in Normal Mode with a new empty paragraph
- **When**: User types "# My Heading" and presses Enter
- **Then**: The current block is converted to H1 heading style with "My Heading" content, and a new empty paragraph block is created below
- **Verification**: `human-judgment`

### AC-3: List Auto-Rendering on Enter

- **Given**: User is in Normal Mode with a new empty paragraph
- **When**: User types "- Item 1" and presses Enter
- **Then**: The current block is converted to an unordered list item with bullet marker, and a new empty paragraph block is created below
- **Verification**: `human-judgment`

### AC-4: Blockquote Auto-Rendering on Enter

- **Given**: User is in Normal Mode with a new empty paragraph
- **When**: User types "> Quote text" and presses Enter
- **Then**: The current block is converted to a blockquote with left accent border, and a new empty paragraph block is created below
- **Verification**: `human-judgment`

### AC-5: Existing Content Modification Preservation

- **Given**: User is in Normal Mode with existing content
- **When**: User modifies a paragraph's text, then switches to Source Code Mode
- **Then**: All modifications are preserved in Source Code Mode
- **Verification**: `human-judgment`

### AC-6: Multiple Mode Switches Without Corruption

- **Given**: User toggles between Normal Mode and Source Code Mode multiple times
- **When**: User switches back to Normal Mode after several cycles
- **Then**: Content is not duplicated, corrupted, or lost
- **Verification**: `human-judgment`

### AC-7: All Existing Tests Pass

- **Given**: The codebase with all fixes applied
- **When**: Running `npm run test`
- **Then**: All 185 tests pass without failures
- **Verification**: `programmatic`

### AC-8: TypeScript and Lint Pass

- **Given**: The codebase with all fixes applied
- **When**: Running `npm run typecheck` and `npm run lint`
- **Then**: No type errors or ESLint errors
- **Verification**: `programmatic`

## Open Questions

- [ ] Should Markdown detection also work on blur (when user clicks away without pressing Enter)?
- [ ] Should the typing experience match Typora exactly (e.g., auto-render on space after `#`)?
