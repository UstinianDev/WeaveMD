# WeaveMD Normal Mode WYSIWYG Editing Fix - Implementation Plan

## [x] Task 1: Refactor handleBlockContentChange to Eliminate Race Condition

- **Priority**: high
- **Depends On**: None
- **Description**:
  - Refactor `handleBlockContentChange` in `EditorView.tsx` to NOT call `syncTreeToStore` inside `setBlockTree` updater function
  - Read current tree from `blockTreeRef.current` synchronously
  - Compute new tree outside the updater
  - Update `blockTreeRef.current = newTree` first
  - Then call `setBlockTree(newTree)` and `syncTreeToStore(newTree)` separately
  - This eliminates the stale-prev race when blur fires during mode toggle
- **Acceptance Criteria Addressed**: AC-1, AC-5
- **Test Requirements**:
  - `programmatic` TR-1.1: TypeScript typecheck passes after refactoring
  - `programmatic` TR-1.2: All 185 existing tests pass
  - `human-judgement` TR-1.3: Edit existing content in Normal Mode → switch to Source Code Mode → content preserved
- **Notes**: The key change is from `setBlockTree((prev) => { ... syncTreeToStore(next); return next; })` to reading from ref and calling functions outside updater

## [x] Task 2: Refactor handleBlockEnter to Eliminate Race Condition

- **Priority**: high
- **Depends On**: None
- **Description**:
  - Refactor `handleBlockEnter` in `EditorView.tsx` to NOT call `syncTreeToStore` inside `setBlockTree` updater
  - Apply same pattern: read from ref, compute outside updater, update ref first
  - Ensure Markdown detection path also follows this pattern
  - Ensure version is properly incremented for all tree mutations
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-2.1: TypeScript typecheck passes after refactoring
  - `programmatic` TR-2.2: All 185 existing tests pass
  - `human-judgement` TR-2.3: Create new paragraph via Enter → type content → switch to Source Code Mode → content preserved
  - `human-judgement` TR-2.4: Type "# Title" → press Enter → block converts to H1 heading
  - `human-judgement` TR-2.5: Type "- Item" → press Enter → block converts to list item
  - `human-judgement` TR-2.6: Type "> Quote" → press Enter → block converts to blockquote
- **Notes**: The Markdown detection reads from DOM, so it must be done outside the updater

## [x] Task 3: Refactor handleFenceLanguageChange to Eliminate Race Condition

- **Priority**: medium
- **Depends On**: None
- **Description**:
  - Apply same refactoring pattern to `handleFenceLanguageChange`
  - Read from ref, compute outside updater, update ref first
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `programmatic` TR-3.1: TypeScript typecheck passes
  - `programmatic` TR-3.2: All 185 existing tests pass
  - `human-judgement` TR-3.3: Switch code fence language → switch modes → language preserved
- **Notes**: Lower priority because code fence editing is less common

## [x] Task 4: Verify Markdown Render useEffect Triggers

- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - Verify that the render HTML useEffect (dependent on `blockTree.version`) properly triggers after Markdown conversion
  - If needed, add version increment in manual tree construction paths
  - Add temporary debug log to render effect to verify
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-4
- **Test Requirements**:
  - `human-judgement` TR-4.1: Type "# Title" → Enter → Console shows render-effect triggered
  - `human-judgement` TR-4.2: After Enter, block visually renders as H1 heading
- **Notes**: The render effect iterates blocks and renders those with `renderedHtml === null`. If version changes correctly, it should trigger.

## [x] Task 5: Integration Testing and Cleanup

- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 3, Task 4
- **Description**:
  - Run full test suite
  - Run typecheck and lint
  - Remove all debug console.log statements
  - Perform complete manual verification of all acceptance criteria
- **Acceptance Criteria Addressed**: AC-1 through AC-8
- **Test Requirements**:
  - `programmatic` TR-5.1: `npm run typecheck` passes with no errors
  - `programmatic` TR-5.2: `npm run lint` passes with no new warnings
  - `programmatic` TR-5.3: `npm run test` passes — all 185 tests pass
  - `human-judgement` TR-5.4: Full manual verification of AC-1 through AC-6
- **Notes**: This is the final verification step
