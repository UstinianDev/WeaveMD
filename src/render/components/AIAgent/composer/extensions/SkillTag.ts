// ============================================
// WeaveMD — TipTap 自定义 Node 扩展：SkillTag
// ============================================
// /skill 标签 chip 节点，原子级（不可编辑内部），支持选中和删除。

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { SkillTagComponent } from './SkillTagComponent';

export const SkillTag = Node.create({
  name: 'skillTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-name') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-name': attributes.name }),
      },
      description: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-description') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-description': attributes.description }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-skill-tag]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-skill-tag': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkillTagComponent);
  },
});
