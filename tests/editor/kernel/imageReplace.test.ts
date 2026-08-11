import { describe, expect, it } from 'vitest';

import {
  escapeMarkdownUrl,
  replaceImageRange,
} from '../../../src/render/editor/kernel/imageReplace';

describe('imageReplace — escapeMarkdownUrl（K1）', () => {
  it('命中 /[\\s()<>]/ 的 src 用 <...> 包裹', () => {
    expect(escapeMarkdownUrl('C:/Users/me/a b.png')).toBe('<C:/Users/me/a b.png>');
    expect(escapeMarkdownUrl('img (1).png')).toBe('<img (1).png>');
    expect(escapeMarkdownUrl('a<b>.png')).toBe('<a<b>.png>');
  });

  it('无特殊字符的 src 原样返回', () => {
    expect(escapeMarkdownUrl('img.png')).toBe('img.png');
    expect(escapeMarkdownUrl('https://x.com/a.png')).toBe('https://x.com/a.png');
  });
});

describe('imageReplace — replaceImageRange（K1）', () => {
  it('基本替换：把 [start,end) 替换为 `![alt](src)`，其余文本不动', () => {
    const result = replaceImageRange('abc', { start: 1, end: 2 }, { src: 'img.png', alt: 'pic' });
    expect(result.text).toBe('a![pic](img.png)c');
  });

  it('带 title：`![alt](src "title")`，title 为空时省略 "..." 段', () => {
    const withTitle = replaceImageRange('abc', { start: 1, end: 2 }, { src: 'img.png', alt: 'pic', title: 'caption' });
    expect(withTitle.text).toBe('a![pic](img.png "caption")c');
    const noTitle = replaceImageRange('abc', { start: 1, end: 2 }, { src: 'img.png', alt: 'pic' });
    expect(noTitle.text).toBe('a![pic](img.png)c');
  });

  it('src 含特殊字符（空格/括号）时自动用 <...> 包裹', () => {
    const result = replaceImageRange('abc', { start: 1, end: 2 }, { src: 'C:/x/a b.png', alt: 'pic' });
    expect(result.text).toBe('a![pic](<C:/x/a b.png>)c');
  });

  it('alt 为空：产出 `![](src)`', () => {
    const result = replaceImageRange('abc', { start: 1, end: 2 }, { src: 'img.png', alt: '' });
    expect(result.text).toBe('a![](img.png)c');
  });

  it('cursorOffset === token.start + 新片段长度（新 token 末端）', () => {
    const result = replaceImageRange('abX', { start: 1, end: 2 }, { src: 'img.png', alt: 'pic' });
    const fragment = '![pic](img.png)';
    expect(result.cursorOffset).toBe(1 + fragment.length);
    expect(result.cursorOffset).toBe(result.text.indexOf('X'));
  });

  it('区间外文本原样保留（前缀/后缀不动，完整替换 `![]()` 语法）', () => {
    const result = replaceImageRange('ab![]()cd', { start: 2, end: 7 }, { src: 'x.png', alt: 'i' });
    expect(result.text).toBe('ab![i](x.png)cd');
    expect(result.text.startsWith('ab')).toBe(true);
    expect(result.text.endsWith('cd')).toBe(true);
  });
});
