// ============================================
// WeaveMD — MentionTagOverlay 单元测试
// ============================================
// 测试 parseMentionTags 和 getSafeCursorIndex 函数

import { describe, it, expect } from 'vitest';
import { parseMentionTags, getSafeCursorIndex } from '../../src/render/components/AIAgent/composer/MentionTagOverlay';

describe('parseMentionTags', () => {
  // Bug 1: @doc文件名有空格导致标签中断
  describe('Bug 1: @doc文件名有空格', () => {
    it('应该支持 @{my document} 语法（花括号包围）', () => {
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
    });

    it('应该支持 @doc 语法（不带花括号，不支持空格）', () => {
      const value = '@document.md 文件';
      const tags = parseMentionTags(value);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        type: 'mention',
        name: 'document.md',
        start: 0,
        end: 12, // @document.md 的长度
        fullMatch: '@document.md',
      });
    });

    it('不带花括号时，遇到空格应该停止匹配', () => {
      const value = '@claude code.md 文件';
      const tags = parseMentionTags(value);
      // 应该只匹配 @claude，不包括 " code.md"
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('claude');
      expect(tags[0].end).toBe(7); // @claude 的长度
    });
  });

  // Bug 4: /skill渲染后指针会停留在标签内
  describe('Bug 4: /skill 标签解析', () => {
    it('应该正确解析 /skill 标签', () => {
      const value = '/polish_rewrite 请帮我改写';
      const tags = parseMentionTags(value);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        type: 'skill',
        name: 'polish_rewrite',
        start: 0,
        end: 15, // /polish_rewrite 的长度
        fullMatch: '/polish_rewrite',
      });
    });

    it('应该支持带短横线的 skill 名', () => {
      const value = '/my-skill 测试';
      const tags = parseMentionTags(value);
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('my-skill');
    });
  });
});

describe('getSafeCursorIndex', () => {
  // Bug 3: 光标位置错误
  describe('Bug 3: 光标位置保护', () => {
    it('光标在标签内部时，应该返回标签末尾', () => {
      const tags = [{
        type: 'mention' as const,
        name: 'doc',
        start: 0,
        end: 4, // @doc 的长度
        fullMatch: '@doc',
      }];

      // 光标在标签内部（位置1、2、3）
      expect(getSafeCursorIndex(tags, 1)).toBe(4);
      expect(getSafeCursorIndex(tags, 2)).toBe(4);
      expect(getSafeCursorIndex(tags, 3)).toBe(4);
    });

    it('光标在标签末尾时，应该返回 null（已在标签外部）', () => {
      const tags = [{
        type: 'mention' as const,
        name: 'doc',
        start: 0,
        end: 4,
        fullMatch: '@doc',
      }];

      // 光标在标签末尾（位置4）
      // 位置4是标签后面的位置，所以应该返回 null
      expect(getSafeCursorIndex(tags, 4)).toBeNull();
    });

    it('光标在标签外部时，应该返回 null', () => {
      const tags = [{
        type: 'mention' as const,
        name: 'doc',
        start: 0,
        end: 4,
        fullMatch: '@doc',
      }];

      // 光标在标签外部（位置5）
      expect(getSafeCursorIndex(tags, 5)).toBeNull();
    });

    it('光标在标签开始位置时，应该返回标签末尾', () => {
      const tags = [{
        type: 'mention' as const,
        name: 'doc',
        start: 0,
        end: 4,
        fullMatch: '@doc',
      }];

      // 光标在标签开始（位置0）
      expect(getSafeCursorIndex(tags, 0)).toBe(4);
    });
  });

  // Bug 3: 光标位置受文件名长度影响
  describe('Bug 3: 长文件名的光标位置', () => {
    it('长文件名标签的光标位置应该正确', () => {
      const value = '@Claude_Code_斜杠命令及企业级开发完整指南.md 123';
      const tags = parseMentionTags(value);

      // 应该只匹配 @Claude_Code_斜杠命令及企业级开发完整指南.md
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('Claude_Code_斜杠命令及企业级开发完整指南.md');

      // 光标在标签内部时，应该返回标签末尾
      const cursorInTag = tags[0].start + 5; // 标签内部某个位置
      expect(getSafeCursorIndex(tags, cursorInTag)).toBe(tags[0].end);

      // 光标在 "123" 前面时，应该返回 null（不在标签内部）
      const cursorAfterTag = tags[0].end + 1; // 标签后面的位置
      expect(getSafeCursorIndex(tags, cursorAfterTag)).toBeNull();
    });
  });
});
