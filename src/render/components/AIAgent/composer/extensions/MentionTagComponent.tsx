// ============================================
// WeaveMD — MentionTag TipTap NodeView 组件
// ============================================
// 渲染 @file/@folder 标签 chip：绿色背景、文件图标、hover 显示删除按钮。

import React, { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { MdOutlineFilePresent, MdOutlineFolder, MdClose } from 'react-icons/md';

export const MentionTagComponent: React.FC<NodeViewProps> = ({ node, deleteNode }) => {
  const [hovered, setHovered] = useState(false);
  const mentionName = (node.attrs.name as string) ?? '';
  const mentionType = (node.attrs.type as string) ?? 'file';
  const isFolder = mentionType === 'folder';

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
          background: isFolder
            ? 'color-mix(in srgb, #f59e0b 15%, transparent)'
            : 'color-mix(in srgb, #10b981 15%, transparent)',
          color: isFolder ? '#f59e0b' : '#10b981',
          border: `1px solid ${isFolder ? 'color-mix(in srgb, #f59e0b 30%, transparent)' : 'color-mix(in srgb, #10b981 30%, transparent)'}`,
        }}
      >
        {isFolder ? <MdOutlineFolder size={12} /> : <MdOutlineFilePresent size={12} />}
        <span>@{mentionName}</span>
        {hovered && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteNode();
            }}
            className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-white/20 transition-colors"
            aria-label={`Remove @${mentionName}`}
          >
            <MdClose size={10} />
          </button>
        )}
      </span>
    </NodeViewWrapper>
  );
};
