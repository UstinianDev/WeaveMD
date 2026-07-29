# WeaveMD Normal Mode WYSIWYG Editing Fix - Verification Checklist

## Content Preservation

- [ ] Checkpoint 1: Edit existing paragraph text in Normal Mode → switch to Source Code Mode → modifications preserved
- [ ] Checkpoint 2: Create new paragraph via Enter → type content → switch to Source Code Mode → new content preserved
- [ ] Checkpoint 3: Multiple mode toggles (Normal → Source → Normal → Source) → content not duplicated or corrupted
- [ ] Checkpoint 4: Edit heading content in Normal Mode → switch to Source Code Mode → heading text preserved with correct markdown syntax

## Markdown Auto-Rendering

- [ ] Checkpoint 5: Type "# Heading" → press Enter → block converts to H1 heading style
- [ ] Checkpoint 6: Type "## Heading 2" → press Enter → block converts to H2 heading style
- [ ] Checkpoint 7: Type "- List item" → press Enter → block converts to unordered list item with bullet
- [ ] Checkpoint 8: Type "1. Ordered item" → press Enter → block converts to ordered list item
- [ ] Checkpoint 9: Type "> Quote text" → press Enter → block converts to blockquote
- [ ] Checkpoint 10: Type "- [ ] Todo item" → press Enter → block converts to task list item
- [ ] Checkpoint 11: After Markdown conversion, a new empty paragraph block is created below

## Code Quality

- [x] Checkpoint 12: `npm run typecheck` passes with zero errors
- [x] Checkpoint 13: `npm run lint` passes with zero new warnings
- [x] Checkpoint 14: `npm run test` passes — all 185 tests pass
- [x] Checkpoint 15: No console.log debug statements remain in production code
- [x] Checkpoint 16: No `syncTreeToStore` calls inside `setBlockTree` updater functions

## Edge Cases

- [ ] Checkpoint 17: New block with empty content → switch modes → no corruption
- [ ] Checkpoint 18: Rapid Enter presses creating multiple blocks → all preserved on mode switch
- [ ] Checkpoint 19: Edit → mode switch → mode switch back → content still correct
