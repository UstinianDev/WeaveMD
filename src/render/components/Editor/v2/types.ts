import type { BlockTreeV2 } from '../../../editor/kernel';

/** 块组件统一回调集（由 EditorV2 提供） */
export interface BlockHandlers {
  onInput: (blockId: string, text: string) => boolean;
  onEnter: (blockId: string, offset: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
  registerDom: (blockId: string, el: HTMLElement) => void;
  unregisterDom: (blockId: string) => void;
}

export interface BlockRendererProps {
  blockId: string;
  tree: BlockTreeV2;
  handlers: BlockHandlers;
}
