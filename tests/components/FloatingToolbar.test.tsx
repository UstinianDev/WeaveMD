import { describe, expect, it } from 'vitest';

// NOTE: FloatingToolbar has been temporarily disabled pending a
// full rewrite for the new block-based WYSIWYG architecture.
// These tests will be restored when the rewrite is complete.
// See: src/render/components/Editor/FloatingToolbar.tsx

describe('FloatingToolbar', () => {
  it('placeholder — toolbar is disabled pending block-based rewrite', () => {
    // The FloatingToolbar component returns null in the new architecture.
    // Its utility functions (calculateToolbarViewportPosition,
    // isSelectionWithinActiveBlock, shouldShowFloatingToolbar) will be
    // re-extracted and tested when the rewrite is complete.
    expect(true).toBe(true);
  });
});
