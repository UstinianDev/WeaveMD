import { describe, expect, it } from 'vitest';

import { parseImageBlockText, wrapImageWidth } from '@render/editor/kernel/imageBlock';
import { applyRuntimeWidths } from '@render/editor/kernel/inlineRenderer';

describe('imageBlock — wrapImageWidth（R1-KERNEL 独立图宽度写入）', () => {
  it('裸图 + width>0 → `<div align="left" style="width:Npx">…</div>`（默认 left 表示无显式对齐）', () => {
    expect(wrapImageWidth('![a](C:/x.png)', 400)).toBe(
      '<div align="left" style="width:400px">![a](C:/x.png)</div>'
    );
  });

  it('小数 width → 整数 px（Math.round）', () => {
    expect(wrapImageWidth('![a](C:/x.png)', 400.5)).toBe(
      '<div align="left" style="width:401px">![a](C:/x.png)</div>'
    );
  });

  it('已有 wrapper → 插入/更新 style，保留原 align（center）', () => {
    expect(wrapImageWidth('<div align="center">![a](C:/x.png)</div>', 640)).toBe(
      '<div align="center" style="width:640px">![a](C:/x.png)</div>'
    );
  });

  it('已有 wrapper + 已有 style → 覆盖 width，保留 align 及其余属性', () => {
    expect(
      wrapImageWidth('<div align="center" style="margin:0;width:200px;color:red">![a](C:/x.png)</div>', 300)
    ).toBe(
      '<div align="center" style="margin:0;width:300px;color:red">![a](C:/x.png)</div>'
    );
  });

  it('width null → 剥掉 style，回到裸 align wrapper，保留 align', () => {
    expect(wrapImageWidth('<div align="center" style="width:400px">![a](C:/x.png)</div>', null)).toBe(
      '<div align="center">![a](C:/x.png)</div>'
    );
  });

  it('width null + 裸图 → 原样（无 style 可剥）', () => {
    expect(wrapImageWidth('![a](C:/x.png)', null)).toBe('![a](C:/x.png)');
  });

  it('非法 width（≤0 / NaN）→ null', () => {
    expect(wrapImageWidth('![a](C:/x.png)', 0)).toBeNull();
    expect(wrapImageWidth('![a](C:/x.png)', -100)).toBeNull();
    expect(wrapImageWidth('![a](C:/x.png)', NaN)).toBeNull();
  });

  it('非独立图 → null（行内图不可持久宽度）', () => {
    expect(wrapImageWidth('pre ![a](C:/x.png) post', 300)).toBeNull();
  });
});

describe('inlineRenderer — applyRuntimeWidths（R1-KERNEL 行内图会话宽度注入）', () => {
  const img = '0:25';

  it('命中 data-start:data-end → 注入 style="width:Npx"；img 不含 style 时附加在 tag 末尾', () => {
    const html = '<img class="inline-image" src="https://x.com/a.png" alt="a" data-start="0" data-end="25">';
    const out = applyRuntimeWidths(html, { [img]: 350 });
    expect(out).toBe(
      '<img class="inline-image" src="https://x.com/a.png" alt="a" data-start="0" data-end="25" style="width:350px">'
    );
  });

  it('小数值 → 整数 px（Math.round）', () => {
    const html =
      '<img class="inline-image" src="https://x.com/a.png" alt="a" data-start="0" data-end="25">';
    const out = applyRuntimeWidths(html, { [img]: 300.6 });
    expect(out).toContain('style="width:301px"');
  });

  it('img 已带 style 属性 → 合并并覆盖 width（保留其余），不重复 style', () => {
    const html =
      '<img class="inline-image" src="s" alt="a" style="color:red;width:100px" data-start="0" data-end="25">';
    const out = applyRuntimeWidths(html, { [img]: 200 });
    expect(out).toBe(
      '<img class="inline-image" src="s" alt="a" style="color:red;width:200px" data-start="0" data-end="25">'
    );
  });

  it('未命中 map（不同 data-start:data-end）→ 原样不变', () => {
    const html =
      '<img class="inline-image" src="s" alt="a" data-start="4" data-end="29">';
    const out = applyRuntimeWidths(html, { [img]: 350 });
    expect(out).toBe(html);
  });

  it('仅触碰 class="inline-image" 的 img（非该 class 的 img 不注入）', () => {
    const html =
      '<div><img class="inline-image" src="s" alt="a" data-start="0" data-end="25"></div><img src="o" data-start="0" data-end="25">';
    const out = applyRuntimeWidths(html, { [img]: 350 });
    expect(out).toContain('<img class="inline-image" src="s" alt="a" data-start="0" data-end="25" style="width:350px">');
    // 非 inline-image 的 <img> 保持原样
    expect(out).toContain('<img src="o" data-start="0" data-end="25">');
  });

  it('文本中多图：各命中各自宽度，未命中的不动', () => {
    const html =
      '<img class="inline-image" src="a" alt="a" data-start="0" data-end="25"><img class="inline-image" src="b" alt="b" data-start="30" data-end="55">';
    const out = applyRuntimeWidths(html, { '0:25': 100, '30:55': 200 });
    expect(out).toContain('src="a" alt="a" data-start="0" data-end="25" style="width:100px"');
    expect(out).toContain('src="b" alt="b" data-start="30" data-end="55" style="width:200px"');
  });

  it('空 widthMap / 空 html → 原样返回', () => {
    const html = '<img class="inline-image" src="s" alt="a" data-start="0" data-end="25">';
    expect(applyRuntimeWidths(html, {})).toBe(html);
    expect(applyRuntimeWidths('', { '0:25': 100 })).toBe('');
  });

  it('parse+wrap 集成：wrapImageWidth 产物再解析 width 一致（持久化往返）', () => {
    const wrapped = wrapImageWidth('![a](C:/x.png)', 400)!;
    expect(parseImageBlockText(wrapped)?.width).toBe(400);
    expect(parseImageBlockText(wrapped)?.align).toBe('left');
  });
});
