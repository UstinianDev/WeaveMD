// ============================================
// WeaveMD — TipTap 自定义 Node 扩展：MentionTag
// ============================================
// @file/@folder 标签 chip 节点，原子级（不可编辑内部），支持选中和删除。

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MentionTagComponent } from './MentionTagComponent';

export const MentionTag = Node.create({
  name: 'mentionTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      type: {
        default: 'file' as string,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-type') ?? 'file',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-mention-type': attributes.type }),
      },
      id: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-id') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-mention-id': attributes.id }),
      },
      name: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-name') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-name': attributes.name }),
      },
      path: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-path') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-path': attributes.path }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention-tag]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-mention-tag': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionTagComponent);
  },
});
