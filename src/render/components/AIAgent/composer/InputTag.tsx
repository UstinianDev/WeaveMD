// ============================================
// WeaveMD — InputTag 组件（/skill @doc 高亮标签）
// ============================================
// 显示在 Composer 输入框上方，将 /skill 和 @doc 渲染为带样式的标签。
// 支持删除按钮和悬停下划线效果。

import React, { useMemo } from 'react';

interface InputTagProps {
  /** 标签类型：技能或文档引用 */
  type: 'skill' | 'mention';
  /** 标签名称 */
  name: string;
  /** 删除回调 */
  onDelete: () => void;
}

const InputTag: React.FC<InputTagProps> = ({ type, name, onDelete }) => {
  const prefix = type === 'skill' ? '/' : '@';

  return (
    <span className={`input-tag input-tag--${type}`}>
      <span>{prefix}{name}</span>
      <button
        type="button"
        className="input-tag__delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="移除"
      >
        ×
      </button>
    </span>
  );
};

InputTag.displayName = 'InputTag';

export default InputTag;

/**
 * 从 composer value 中解析 /skill 和 @doc 标签
 */
export function parseInputTags(value: string): Array<{ type: 'skill' | 'mention'; name: string; fullMatch: string }> {
  const tags: Array<{ type: 'skill' | 'mention'; name: string; fullMatch: string }> = [];

  // 匹配 /skill 模式
  const skillRegex = /\/([a-z_]+)\s/g;
  let match: RegExpExecArray | null;

  while ((match = skillRegex.exec(value)) !== null) {
    tags.push({
      type: 'skill',
      name: match[1],
      fullMatch: match[0],
    });
  }

  // 匹配 @mention 模式
  const mentionRegex = /@([^\s@]+)\s/g;
  while ((match = mentionRegex.exec(value)) !== null) {
    tags.push({
      type: 'mention',
      name: match[1],
      fullMatch: match[0],
    });
  }

  return tags;
}
