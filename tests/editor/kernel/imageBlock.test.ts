import { describe, expect, it } from 'vitest';

import {
  isStandaloneImageText,
  parseImageBlockText,
  unwrapImageAlign,
  wrapImageAlign,
} from '@render/editor/kernel/imageBlock';

describe('imageBlock — parseImageBlockText（edit-image-align-toolbar K2）', () => {
  it('裸图行：`![123](C:/x.png)` → align null，inner 为整行，偏移 0..16', () => {
    expect(parseImageBlockText('![123](C:/x.png)')).toEqual({
      align: null,
      inner: '![123](C:/x.png)',
      innerStart: 0,
      innerEnd: 16,
    });
  });

  it('`<div align="left">` 包裹单图：align=left，innerStart 为 open tag 长度', () => {
    expect(parseImageBlockText('<div align="left">![123](C:/x.png)</div>')).toEqual({
      align: 'left',
      inner: '![123](C:/x.png)',
      innerStart: 18,
      innerEnd: 34,
    });
  });

  it('center / right 同样解析', () => {
    expect(parseImageBlockText('<div align="center">![a](https://x.com/a.png)</div>')?.align).toBe(
      'center'
    );
    expect(parseImageBlockText('<div align="right">![a](https://x.com/a.png)</div>')?.align).toBe(
      'right'
    );
  });

  it('wrapper 内含多余文本 → null（仍按段落处理）', () => {
    expect(parseImageBlockText('<div align="left">![a](C:/x.png) extra</div>')).toBeNull();
  });

  it('非法 align（如 middle）→ null', () => {
    expect(parseImageBlockText('<div align="middle">![a](C:/x.png)</div>')).toBeNull();
  });

  it('多行 → null', () => {
    expect(parseImageBlockText('![a](C:/x.png)\nmore')).toBeNull();
  });

  it('行尾 \\r 容差：剥离后仍判定为 image-block', () => {
    expect(parseImageBlockText('<div align="left">![123](C:/x.png)</div>\r')).toEqual({
      align: 'left',
      inner: '![123](C:/x.png)',
      innerStart: 18,
      innerEnd: 34,
    });
  });

  it('wrapper 外首尾空白允许，innerStart 含空白偏移', () => {
    expect(parseImageBlockText('  <div align="left">![123](C:/x.png)</div>  ')).toEqual({
      align: 'left',
      inner: '![123](C:/x.png)',
      innerStart: 20,
      innerEnd: 36,
    });
  });

  it('空 href 占位 `![a]()` 不构成 image-block（保持段落可编辑语义）', () => {
    expect(parseImageBlockText('![a]()')).toBeNull();
  });

  it('非独立图行（混合文本）→ null', () => {
    expect(parseImageBlockText('pre ![a](C:/x.png) post')).toBeNull();
  });

  it('空串 → null', () => {
    expect(parseImageBlockText('')).toBeNull();
    expect(parseImageBlockText('   ')).toBeNull();
  });
});

describe('imageBlock — isStandaloneImageText（对齐可行性判定）', () => {
  it('裸图行 true', () => {
    expect(isStandaloneImageText('![123](C:/x.png)')).toBe(true);
  });

  it('wrapper 单图 true', () => {
    expect(isStandaloneImageText('<div align="center">![a](C:/x.png)</div>')).toBe(true);
  });

  it('混合文本 false', () => {
    expect(isStandaloneImageText('pre ![a](C:/x.png) post')).toBe(false);
  });

  it('空 / 纯空白 false', () => {
    expect(isStandaloneImageText('')).toBe(false);
    expect(isStandaloneImageText('   ')).toBe(false);
  });
});

describe('imageBlock — wrapImageAlign / unwrapImageAlign', () => {
  it('裸图 → 包裹为 `<div align="center">...</div>`', () => {
    expect(wrapImageAlign('![123](C:/x.png)', 'center')).toBe(
      '<div align="center">![123](C:/x.png)</div>'
    );
  });

  it('已有 wrapper → 仅替换 align 值（left → center）', () => {
    expect(wrapImageAlign('<div align="left">![a](C:/x.png)</div>', 'center')).toBe(
      '<div align="center">![a](C:/x.png)</div>'
    );
  });

  it('非独立图 → null（工具栏置灰语义）', () => {
    expect(wrapImageAlign('mixed text ![a](C:/x.png)', 'left')).toBeNull();
  });

  it('unwrapImageAlign：wrapper → 内层原文', () => {
    expect(unwrapImageAlign('<div align="left">![a](C:/x.png)</div>')).toBe('![a](C:/x.png)');
  });

  it('unwrapImageAlign：裸图 → 原样', () => {
    expect(unwrapImageAlign('![a](C:/x.png)')).toBe('![a](C:/x.png)');
  });
});
