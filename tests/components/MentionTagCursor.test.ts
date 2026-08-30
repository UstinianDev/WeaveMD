// ============================================
// WeaveMD — MentionTagOverlay 光标位置测试
// ============================================
// 测试用户报告的光标位置问题

import { describe, it, expect } from 'vitest';
import { parseMentionTags, getSafeCursorIndex } from '../../src/render/components/AIAgent/composer/MentionTagOverlay';

describe('用户报告的光标位置问题', () => {
  // Bug 3: 输入@doc后输入123，指针停在2和3之间
  it('Bug 3: @doc后输入123，光标应该在最后', () => {
    const value = '@doc 123';
    const tags = parseMentionTags(value);

    // @doc 标签应该是 start=0, end=4
    expect(tags).toHaveLength(1);
    expect(tags[0].start).toBe(0);
    expect(tags[0].end).toBe(4);

    // 光标在位置5（"123"前面的空格后面）
    // 这时光标应该不在标签内部，getSafeCursorIndex 应该返回 null
    const cursorAfterSpace = 5;
    const result = getSafeCursorIndex(tags, cursorAfterSpace);
    expect(result).toBeNull(); // 应该返回 null，表示不需要移动光标
  });

  // Bug 3: 光标在标签末尾时不应该被移动
  it('Bug 3: 光标在标签末尾时不应该被移动', () => {
    const value = '@doc 123';
    const tags = parseMentionTags(value);

    // 光标在位置4（标签末尾）
    // 位置4是标签后面的位置，所以不应该被移动
    const cursorAtEnd = 4;
    const result = getSafeCursorIndex(tags, cursorAtEnd);

    // 修复后：光标在标签末尾时，应该返回 null（不需要移动）
    expect(result).toBeNull();
  });

  // Bug 4: /skill渲染后指针会停留在标签内
  it('Bug 4: /skill标签的光标位置', () => {
    const value = '/polish_rewrite 请帮我改写';
    const tags = parseMentionTags(value);

    // /polish_rewrite 标签应该是 start=0, end=15
    expect(tags).toHaveLength(1);
    expect(tags[0].start).toBe(0);
    expect(tags[0].end).toBe(15);

    // 光标在位置10（标签内部）
    const cursorInTag = 10;
    const result = getSafeCursorIndex(tags, cursorInTag);
    expect(result).toBe(15); // 应该返回标签末尾

    // 光标在位置15（标签末尾，已经在标签外部）
    const cursorAtEnd = 15;
    const result2 = getSafeCursorIndex(tags, cursorAtEnd);
    // 修复后：光标在标签末尾时，应该返回 null（不需要移动）
    expect(result2).toBeNull();
  });

  // Bug 3: 长文件名的光标位置
  it('Bug 3: 长文件名的光标位置', () => {
    const value = '@Claude_Code_斜杠命令及企业级开发完整指南.md 123';
    const tags = parseMentionTags(value);

    expect(tags).toHaveLength(1);
    const tag = tags[0];

    // 标签应该是 @Claude_Code_斜杠命令及企业级开发完整指南.md
    expect(tag.name).toBe('Claude_Code_斜杠命令及企业级开发完整指南.md');

    // 光标在标签内部
    const cursorInTag = tag.start + 5;
    const result = getSafeCursorIndex(tags, cursorInTag);
    expect(result).toBe(tag.end); // 应该返回标签末尾

    // 光标在标签末尾（已经在标签外部）
    const cursorAtEnd = tag.end;
    const result2 = getSafeCursorIndex(tags, cursorAtEnd);
    // 修复后：光标在标签末尾时，应该返回 null（不需要移动）
    expect(result2).toBeNull();

    // 光标在 "123" 前面（标签后面）
    const cursorAfterTag = tag.end + 1; // 跳过空格
    const result3 = getSafeCursorIndex(tags, cursorAfterTag);
    expect(result3).toBeNull(); // 应该返回 null
  });

  // Bug 1: @doc文件名有空格
  it('Bug 1: 支持 @{my document} 语法', () => {
    const value = '@{claude code.md} 文件';
    const tags = parseMentionTags(value);

    expect(tags).toHaveLength(1);
    expect(tags[0]).toEqual({
      type: 'mention',
      name: 'claude code.md',
      start: 0,
      end: 17, // @{claude code.md} 的长度
      fullMatch: '@{claude code.md}',
    });

    // 光标在标签内部
    const cursorInTag = 5;
    const result = getSafeCursorIndex(tags, cursorInTag);
    expect(result).toBe(17); // 应该返回标签末尾

    // 光标在标签末尾
    const cursorAtEnd = 17;
    const result2 = getSafeCursorIndex(tags, cursorAtEnd);
    // 修复后：光标在标签末尾时，应该返回 null（不需要移动）
    expect(result2).toBeNull();
  });
});
