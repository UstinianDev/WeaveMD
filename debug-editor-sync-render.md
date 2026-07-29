# Debug Session: editor-sync-render

## Status: [OPEN]

## Date: 2026-07-29

## Symptoms

### Problem 1: New content lost when switching to Source Code Mode
- **Observed**: In Normal Mode, editing existing content works correctly. But adding a new paragraph (Enter) and typing content, then switching to Source Code Mode, the new content is lost.
- **Expected**: All edits, including new paragraphs and their content, should be preserved when switching modes.

### Problem 2: Markdown doesn't auto-render after pressing Enter
- **Observed**: When typing Markdown syntax (e.g., `# Heading`) and pressing Enter, the text stays as plain text. The rich text rendering only appears after switching to Source Code Mode and back.
- **Expected**: Markdown syntax should immediately render as rich text after pressing Enter.

## Hypotheses (Falsifiable)

### H1: Async rendering replaces DOM content during user typing
- The rendering `useEffect` renders ALL blocks with `renderedHtml === null`, including newly created empty paragraphs
- When `renderMarkdownToHtml('')` returns HTML (e.g., `<p></p>`), the `renderedHtml` is set
- This causes the ParagraphBlock to re-render with `<span dangerouslySetInnerHTML>` instead of plain text
- The DOM replacement disrupts the contentEditable state, clearing user input
- **Verification**: Add logging to track when `renderedHtml` is set vs. when user typing occurs

### H2: handleBlockInput debounce races with mode toggle
- When user types in a new paragraph, `handleBlockInput` has 30ms debounce
- If user switches mode within 30ms, the content hasn't been synced to `blockTreeRef.current` yet
- `syncContentBeforeToggle` flushes the debounce but may read stale DOM
- **Verification**: Log timing between `onInput` event and debounce firing vs. mode toggle

### H3: getBlockTextContent returns incorrect content for certain block types
- For paragraph blocks, `getBlockTextContent` uses `blockEl.textContent?.trim()`
- If the DOM has been modified by React re-renders (e.g., rendered HTML replacing text nodes), `textContent` might return different content than expected
- **Verification**: Log what `getBlockTextContent` returns for new paragraphs vs existing paragraphs

### H4: Block type detection fails when reading from DOM
- After a block is type-converted (e.g., paragraph → heading), the DOM structure changes
- The new HeadingBlock renders with different internal structure
- Subsequent reads via `getBlockTextContent` might not correctly extract the text
- **Verification**: Log block content before and after type conversion, and after DOM re-render

### H5: renderedHtml is set too eagerly, interrupting contentEditable
- The rendering useEffect has `block.renderedHtml !== null` as the only guard
- For newly created blocks with empty content, `renderedHtml` starts as null
- After async rendering completes, `renderedHtml` gets set
- If user is typing in the block at this moment, the DOM replacement (from text to `<span>`) interrupts contentEditable
- **Verification**: Track the sequence of render events vs. user input events

## Next Steps

1. Start debug server
2. Add instrumentation to key functions
3. Reproduce and collect evidence
4. Analyze logs to confirm/reject hypotheses
5. Implement minimal fix
6. Verify and cleanup
