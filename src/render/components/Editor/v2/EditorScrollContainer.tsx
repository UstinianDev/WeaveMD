// ============================================
// WeaveMD Editor v2 — Scroll Container
// ============================================
// 滚动视口 + 内容区。容器本身非 contentEditable，只有叶子块内容区可编辑。

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type { BlockTreeV2 } from '../../../editor/kernel';
import BlockRenderer from './BlockRenderer';
import type { BlockHandlers } from './types';

export interface EditorScrollContainerHandle {
  scrollToBlock: (blockId: string) => void;
  getContentArea: () => HTMLElement | null;
}

interface EditorScrollContainerProps {
  tree: BlockTreeV2;
  handlers: BlockHandlers;
  onScroll?: (scrollTop: number, containerEl: HTMLElement) => void;
}

const EditorScrollContainer = forwardRef<EditorScrollContainerHandle, EditorScrollContainerProps>(
  ({ tree, handlers, onScroll }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      scrollToBlock: (blockId) => {
        const el = containerRef.current?.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
        if (el && containerRef.current) {
          const top = el.offsetTop - containerRef.current.offsetTop;
          containerRef.current.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
      },
      getContentArea: () => containerRef.current,
    }));

    useEffect(() => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const handleScroll = () => {
        onScroll?.(container.scrollTop, container);
      };
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }, [onScroll]);

    return (
      <div ref={containerRef} className="editor-scroll-container h-full overflow-y-auto">
        <div className="editor-content-area" style={{ padding: '40px 40px 100vh 40px' }}>
          {tree.root.childrenIds.length === 0 ? (
            <div
              className="paragraph-block text-[14px] font-normal leading-[1.65] mb-1 text-[var(--text-primary)]"
              data-placeholder="Type something..."
            >
              {'\u200B'}
            </div>
          ) : (
            tree.root.childrenIds.map((childId) => (
              <BlockRenderer key={childId} blockId={childId} tree={tree} handlers={handlers} />
            ))
          )}
        </div>
      </div>
    );
  }
);

export default React.memo(EditorScrollContainer);
