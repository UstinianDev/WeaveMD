// ============================================
// WeaveMD — SkillTag TipTap NodeView 组件
// ============================================
// 渲染 /skill 标签 chip：蓝色背景、闪电图标、hover 显示删除按钮。

import React, { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { MdOutlineElectricBolt, MdClose } from 'react-icons/md';

export const SkillTagComponent: React.FC<NodeViewProps> = ({ node, deleteNode }) => {
  const [hovered, setHovered] = useState(false);
  const skillName = (node.attrs.name as string) ?? '';

  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex items-center gap-0.5 align-middle mx-0.5"
      contentEditable={false}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[12px] font-medium leading-tight cursor-default select-none"
        style={{
          background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
          color: 'var(--accent)',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
        }}
      >
        <MdOutlineElectricBolt size={12} />
        <span>/{skillName}</span>
        {hovered && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteNode();
            }}
            className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-white/20 transition-colors"
            aria-label={`Remove /${skillName}`}
          >
            <MdClose size={10} />
          </button>
        )}
      </span>
    </NodeViewWrapper>
  );
};
