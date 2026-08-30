// ============================================
// WeaveMD — MentionTagOverlay（输入框内标签渲染层）
// ============================================

import React, { useMemo } from 'react';
import Icon from '../../Common/Icon';

export interface MentionTag {
  type: 'skill' | 'mention';
  name: string;
  start: number;
  end: number;
  fullMatch: string;
}

interface MentionTagOverlayProps {
  value: string;
  tags: MentionTag[];
  onDeleteTag: (tag: MentionTag) => void;
  cursorIndex: number; // eslint-disable-line @typescript-eslint/no-unused-vars -- 保留接口兼容
}

const MentionTagOverlay: React.FC<MentionTagOverlayProps> = ({
  value,
  tags,
  onDeleteTag,
  cursorIndex,
}) => {
  const segments = useMemo(() => {
    if (tags.length === 0) return [{ text: value, tag: null }];

    const result: Array<{ text: string; tag: MentionTag | null }> = [];
    let lastIndex = 0;
    const sortedTags = [...tags].sort((a, b) => a.start - b.start);

    for (const tag of sortedTags) {
      if (tag.start > lastIndex) {
        result.push({ text: value.slice(lastIndex, tag.start), tag: null });
      }
      result.push({ text: ' '.repeat(tag.end - tag.start), tag });
      lastIndex = tag.end;
    }

    if (lastIndex < value.length) {
      result.push({ text: value.slice(lastIndex), tag: null });
    }

    return result;
  }, [value, tags]);

  return (
    <div
      className="mention-tag-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // 与 textarea 的 padding 保持一致：px-2.5 py-1.5 = 6px 10px
        padding: '6px 10px',
        lineHeight: '24px',
        fontSize: 15,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'normal',
        pointerEvents: 'none',
        color: 'var(--text-primary)',
        fontFamily: "'Consolas', 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif",
      }}
    >
      {segments.map((segment, index) => {
        if (!segment.tag) {
          return <span key={index}>{segment.text}</span>;
        }

        const isSkill = segment.tag.type === 'skill';
        return (
          <span
            key={index}
            className="mention-tag"
            contentEditable={false}
            style={{
              display: 'inline',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 14,
              fontWeight: 500,
              background: isSkill
                ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
                : 'color-mix(in srgb, #10b981 20%, transparent)',
              color: isSkill ? 'var(--accent)' : '#059669',
              border: `1px solid ${isSkill
                ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
                : 'color-mix(in srgb, #10b981 40%, transparent)'}`,
              pointerEvents: 'auto',
              cursor: 'default',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              verticalAlign: 'baseline',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              lineHeight: '22px',
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span>{segment.tag.fullMatch.trim()}</span>
            <button
              type="button"
              className="mention-tag__delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteTag(segment.tag!);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 13,
                height: 13,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                opacity: 0.5,
                padding: 0,
                marginLeft: 2,
                fontSize: 9,
                lineHeight: 1,
                pointerEvents: 'auto',
                verticalAlign: 'middle',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.background = 'color-mix(in srgb, currentColor 20%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.5';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon icon="close" size={9} />
            </button>
          </span>
        );
      })}
    </div>
  );
};

MentionTagOverlay.displayName = 'MentionTagOverlay';

export default MentionTagOverlay;

/**
 * 从 composer value 中解析 /skill 和 @doc 标签
 *
 * 参考 Notus 的正则：
 * - /skill: 斜杠后跟字母/数字/下划线/短横线，遇到空格结束
 * - @doc: @后跟文件名
 *   - @{my document} - 花括号包围（支持空格）
 *   - @doc - 不带花括号（不支持空格）
 */
export function parseMentionTags(value: string): MentionTag[] {
  const tags: MentionTag[] = [];
  let match: RegExpExecArray | null;

  // 匹配 /skill 模式（斜杠后跟字母/数字/下划线/短横线，遇到空格或行尾结束）
  const skillRegex = /\/([a-zA-Z0-9_-]+)(?=\s|$)/g;
  while ((match = skillRegex.exec(value)) !== null) {
    const before = match.index > 0 ? value[match.index - 1] : ' ';
    if (before === ' ' || before === '\n' || match.index === 0) {
      tags.push({
        type: 'skill',
        name: match[1],
        start: match.index,
        end: match.index + match[0].length,
        fullMatch: match[0],
      });
    }
  }

  // 匹配 @mention 模式（参考 Notus 的正则）
  // 情况1: @{my document} - 花括号包围（支持空格）
  // 情况2: @doc - 不带花括号（不支持空格）
  const mentionRegex = /@(?:\{([^}]*)\}|([^\s@{]+))/g;
  while ((match = mentionRegex.exec(value)) !== null) {
    const before = match.index > 0 ? value[match.index - 1] : ' ';
    if (before === ' ' || before === '\n' || match.index === 0) {
      const name = match[1] ?? match[2];
      if (name !== undefined) {
        tags.push({
          type: 'mention',
          name,
          start: match.index,
          end: match.index + match[0].length,
          fullMatch: match[0],
        });
      }
    }
  }

  return tags;
}

/**
 * 检查光标是否在标签内部，如果是则返回应该移动到的位置
 *
 * 标签的字符位置是 [start, end)，即 start 到 end-1
 * 当光标在 tag.end 时，它已经在标签外部了
 */
export function getSafeCursorIndex(tags: MentionTag[], cursorIndex: number): number | null {
  for (const tag of tags) {
    // 光标在标签内部（不包括标签末尾）
    // tag.end 是标签后面的位置，所以用 <
    if (cursorIndex >= tag.start && cursorIndex < tag.end) {
      return tag.end;
    }
  }
  return null;
}
