// ============================================
// WeaveMD — Document Minimap (Normal Mode)
// ============================================
// Canvas-based miniature document overview shown
// alongside the rich-text block view. Provides:
//   • Block-level structure at a glance
//   • Viewport indicator (current visible area)
//   • Click-to-scroll navigation
//
// Similar to Monaco's minimap but for rendered
// rich-text content.
// ============================================

import React, { useCallback, useEffect, useRef } from 'react';

import type { BlockTree } from '../../../services/blockTree';
import { getAllBlocksInOrder } from '../../../services/blockTree';

// ============================================
// Constants
// ============================================

const CANVAS_WIDTH = 64;
const LINE_HEIGHT = 3; // px per source line in minimap
const BLOCK_GAP = 2; // px gap between blocks
const DEVICE_PIXEL_RATIO = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

// Block type colors (dark theme)
const BLOCK_COLORS: Record<string, string> = {
  heading: '#7C3AED', // Purple (matches theme accent)
  paragraph: '#6B7280', // Gray
  'code-fence': '#3B82F6', // Blue
  'list-item': '#9CA3AF', // Light gray
  table: '#F59E0B', // Amber
  blockquote: '#10B981', // Green
  empty: '#4B5563', // Dark gray
};

// ============================================
// Types
// ============================================

export interface MinimapScrollInfo {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
}

interface MinimapProps {
  blockTree: BlockTree;
  scrollInfo: MinimapScrollInfo;
  onScrollTo: (ratio: number) => void;
}

// ============================================
// Helpers
// ============================================

/** Estimate block display height from its source lines */
function estimateBlockHeight(block: { type: string; sourceLines: string[] }): number {
  const lines = Math.max(1, block.sourceLines.length);
  // Headings get a little extra weight for their larger font
  if (block.type === 'heading') {
    return lines * LINE_HEIGHT + 3;
  }
  if (block.type === 'code-fence') {
    // Code blocks have header + content
    return (lines + 1) * LINE_HEIGHT + BLOCK_GAP;
  }
  if (block.type === 'blockquote') {
    return lines * LINE_HEIGHT + 2;
  }
  return lines * LINE_HEIGHT;
}

// ============================================
// Component
// ============================================

const Minimap: React.FC<MinimapProps> = ({ blockTree, scrollInfo, onScrollTo }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  // --- Draw ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = DEVICE_PIXEL_RATIO;
    const width = CANVAS_WIDTH;
    const blocks = getAllBlocksInOrder(blockTree);

    // Calculate total content height in minimap coordinates
    const totalHeight = blocks.reduce((sum, b) => sum + estimateBlockHeight(b) + BLOCK_GAP, 0);

    // Canvas logical size → physical pixels
    const logicalHeight = Math.max(
      scrollInfo.viewportHeight,
      Math.min(totalHeight, 2000) // cap at reasonable max
    );

    canvas.width = width * dpr;
    canvas.height = logicalHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${logicalHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0F0F0F';
    ctx.fillRect(0, 0, width, logicalHeight);

    if (blocks.length === 0) return;

    // Scale factor: map block positions into canvas space
    const scale = totalHeight > 0 ? logicalHeight / totalHeight : 1;
    const scaledTotal = totalHeight * scale;

    // Draw each block
    let y = 0;
    for (const block of blocks) {
      const blockH = estimateBlockHeight(block) * scale;
      const gapH = BLOCK_GAP * scale;

      if (blockH < 0.5) {
        y += blockH + gapH;
        continue; // Too small to draw
      }

      const color = BLOCK_COLORS[block.type] || BLOCK_COLORS.paragraph;

      ctx.fillStyle = color;
      ctx.globalAlpha = block.type === 'heading' ? 0.85 : 0.45;

      // Rounded rectangle for each block
      const rx = 2;
      const ry = 2;
      const bx = 8;
      const bw = width - 16;
      const by = y;
      const bh = Math.max(1, blockH);

      ctx.beginPath();
      ctx.moveTo(bx + rx, by);
      ctx.lineTo(bx + bw - rx, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + ry);
      ctx.lineTo(bx + bw, by + bh - ry);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rx, by + bh);
      ctx.lineTo(bx + rx, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - ry);
      ctx.lineTo(bx, by + ry);
      ctx.quadraticCurveTo(bx, by, bx + rx, by);
      ctx.closePath();
      ctx.fill();

      y += blockH + gapH;
    }

    ctx.globalAlpha = 1;

    // --- Viewport indicator ---
    const { scrollTop, viewportHeight, contentHeight } = scrollInfo;
    if (contentHeight > 0 && viewportHeight > 0) {
      const viewTop = (scrollTop / contentHeight) * scaledTotal;
      const viewH = (viewportHeight / contentHeight) * scaledTotal;
      const clampedViewH = Math.max(12, Math.min(viewH, scaledTotal - viewTop));

      // Semi-transparent overlay
      ctx.fillStyle = '#7C3AED';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(4, viewTop, width - 8, clampedViewH);
      ctx.globalAlpha = 1;

      // Border on the indicator
      ctx.strokeStyle = '#7C3AED';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.strokeRect(4, viewTop, width - 8, clampedViewH);
      ctx.globalAlpha = 1;
    }
  }, [blockTree, scrollInfo]);

  // --- Redraw on change ---
  useEffect(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [draw]);

  // --- Click to scroll ---
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const canvasHeight = rect.height;

      if (canvasHeight <= 0) return;

      const ratio = clickY / canvasHeight;
      onScrollTo(Math.max(0, Math.min(1, ratio)));
    },
    [onScrollTo]
  );

  return (
    <div
      className="minimap-container flex-shrink-0 border-l"
      style={{
        width: CANVAS_WIDTH,
        backgroundColor: '#0F0F0F',
        borderColor: 'var(--border-color, #2D2D2D)',
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="cursor-pointer w-full block"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};

export default React.memo(Minimap);
