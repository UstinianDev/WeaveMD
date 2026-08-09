// ============================================
// WeaveMD Editor v2 — useDomRegistry
// ============================================
// 块 DOM 注册表：ContentBlock 挂载/卸载时登记元素，供焦点恢复与按需渲染下的强制 DOM 同步使用。

import { useCallback, useRef } from 'react';

import type { EditorInstance } from '../../../editor/editorInstance';
import { toDisplayHtml } from '../../../editor/kernel';

export interface DomRegistry {
  registerDom: (blockId: string, el: HTMLElement) => void;
  unregisterDom: (blockId: string) => void;
  getBlockEl: (blockId: string) => HTMLElement | undefined;
  forceSyncBlockDom: (instance: EditorInstance, blockId: string) => void;
}

export function useDomRegistry(): DomRegistry {
  const domRegistryRef = useRef<Map<string, HTMLElement>>(new Map());

  const registerDom = useCallback((blockId: string, el: HTMLElement) => {
    domRegistryRef.current.set(blockId, el);
  }, []);

  const unregisterDom = useCallback((blockId: string) => {
    domRegistryRef.current.delete(blockId);
  }, []);

  const getBlockEl = useCallback((blockId: string) => domRegistryRef.current.get(blockId), []);

  // 按需渲染下 React 状态可能陈旧、memo 跳过重渲染，需按模型强制同步受影响块 DOM
  const forceSyncBlockDom = useCallback((instance: EditorInstance, blockId: string) => {
    const el = domRegistryRef.current.get(blockId);
    const block = instance?.tree.blocks[blockId];
    if (!el || !block || block.text === null) return;
    const display = toDisplayHtml(block.inlineHtml, block.text);
    if (el.innerHTML !== display) {
      el.innerHTML = display;
    }
  }, []);

  return { registerDom, unregisterDom, getBlockEl, forceSyncBlockDom };
}
