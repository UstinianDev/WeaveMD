import type { BlockTreeV2 } from '../../../editor/kernel';
import type { InlineFormatStyle } from '../../../editor/controllers';

export interface InputEventResult {
  needRender: boolean;
  cursorOffset?: number;
}

/** 块组件统一回调集（由 EditorV2 提供） */
export interface BlockHandlers {
  onInput: (blockId: string, text: string, cursorOffset: number) => InputEventResult;
  onEnter: (blockId: string, offset: number) => void;
  onBackspaceAtStart: (blockId: string) => void;
  onTab: (blockId: string) => boolean;
  onShiftTab: (blockId: string) => boolean;
  onFormat: (blockId: string, style: InlineFormatStyle, start: number, end: number) => void;
  onToggleTask: (listItemId: string) => void;
  registerDom: (blockId: string, el: HTMLElement) => void;
  unregisterDom: (blockId: string) => void;
}

export interface BlockRendererProps {
  blockId: string;
  tree: BlockTreeV2;
  handlers: BlockHandlers;
}
