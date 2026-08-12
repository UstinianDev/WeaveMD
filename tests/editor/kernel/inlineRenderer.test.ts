import { describe, expect, it, vi } from 'vitest';

import {
  escapeHtml,
  renderBlockHtml,
  renderInline,
  safeUrl,
  toImgSrc,
} from '@render/editor/kernel/inlineRenderer';

vi.mock('katex', () => ({
  default: {
    renderToString: vi.fn((expr: string) => `<span class="katex">${expr}</span>`),
  },
}));

describe('inlineRenderer — 基础转义与安全', () => {
  it('转义 HTML 特殊字符', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapeHtml 转义五个字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('safeUrl 拒绝危险协议', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('/relative/path')).toBe('/relative/path');
  });

  it('换行渲染为 <br>', () => {
    expect(renderInline('a\nb')).toBe('a<br>b');
  });
});

describe('inlineRenderer — 行内语法', () => {
  it('加粗与斜体', () => {
    expect(renderInline('**bold**')).toBe(
      '<strong><span class="md-syntax">**</span>bold<span class="md-syntax">**</span></strong>'
    );
    expect(renderInline('*italic*')).toBe(
      '<em><span class="md-syntax">*</span>italic<span class="md-syntax">*</span></em>'
    );
    expect(renderInline('__bold__')).toBe(
      '<strong><span class="md-syntax">__</span>bold<span class="md-syntax">__</span></strong>'
    );
    expect(renderInline('_italic_')).toBe(
      '<em><span class="md-syntax">_</span>italic<span class="md-syntax">_</span></em>'
    );
  });

  it('嵌套强调', () => {
    expect(renderInline('**bold *nested* end**')).toBe(
      '<strong><span class="md-syntax">**</span>bold <em><span class="md-syntax">*</span>nested<span class="md-syntax">*</span></em> end<span class="md-syntax">**</span></strong>'
    );
  });

  it('三连星（加粗+斜体叠加）渲染为 em 内嵌 strong，无字面残缺', () => {
    expect(renderInline('***both***')).toBe(
      '<em><span class="md-syntax">*</span><strong><span class="md-syntax">**</span>both<span class="md-syntax">**</span></strong><span class="md-syntax">*</span></em>'
    );
    expect(renderInline('___both___')).toContain('<strong>');
    expect(renderInline('___both___')).toContain('<em>');
    expect(renderInline('***both***')).not.toContain('***both***');
  });

  it('删除线与高亮', () => {
    expect(renderInline('~~gone~~')).toBe(
      '<del><span class="md-syntax">~~</span>gone<span class="md-syntax">~~</span></del>'
    );
    expect(renderInline('==mark==')).toBe(
      '<mark><span class="md-syntax">==</span>mark<span class="md-syntax">==</span></mark>'
    );
  });

  it('行内代码不解析内部语法', () => {
    expect(renderInline('`**not bold**`')).toBe(
      '<code class="inline-code"><span class="md-syntax">`</span>**not bold**<span class="md-syntax">`</span></code>'
    );
  });

  it('链接与图片', () => {
    expect(renderInline('[text](https://example.com)')).toBe(
      '<a class="inline-link" href="https://example.com" data-href="https://example.com" target="_blank" rel="noopener noreferrer"><span class="md-syntax">[</span>text<span class="md-syntax">](https://example.com)</span></a>'
    );
    expect(renderInline('![alt](https://example.com/a.png)')).toBe(
      '<img class="inline-image" src="https://example.com/a.png" alt="alt" data-start="0" data-end="33">'
    );
  });

  it('链接带标题', () => {
    expect(renderInline('[t](https://x.com "title")')).toContain('title="title"');
  });

  it('本地图片路径：Windows 盘符 / UNC 转 media://，相对 / 网络原样', () => {
    // Windows 盘符：`C:\...` → media://C%3A/正斜杠路径（契约：盘符保留 `/` 分隔）
    expect(renderInline(String.raw`![alt](C:\Users\me\a.png)`)).toContain(
      'src="media://C%3A/Users/me/a.png"'
    );
    // UNC：`\\server\share` → media:// + 整段编码（契约：`//` → `%2F%2F`）
    expect(renderInline(String.raw`![alt](\\server\share\a.png)`)).toContain(
      'src="media://%2F%2Fserver%2Fshare%2Fa.png"'
    );
    // 站内根路径原样保留；无前导斜杠的相对路径不识别为图片（降级纯文本）
    expect(renderInline('![a](/img/a.png)')).toContain('src="/img/a.png"');
    expect(renderInline('![a](img/a.png)')).toBe('![a](img/a.png)');
    // https URL 不受影响
    expect(renderInline('![a](https://x.com/a.png)')).toContain(
      'src="https://x.com/a.png"'
    );
  });

  it('本地图片路径含空格/中文：markdown 尖括号包裹（`![a](<...>)`）转 media:// 编码形态', () => {
    const spaced = String.raw`![alt](<C:\Users\me\My Folder\屏幕截图 2026-08-10 a b.png>)`;
    const html = renderInline(spaced);
    expect(html).toContain(
      'src="media://C%3A/Users/me/My%20Folder/%E5%B1%8F%E5%B9%95%E6%88%AA%E5%9B%BE%202026-08-10%20a%20b.png"'
    );
    // 未包裹的含空格 URL 不识别为图片（降级纯文本，历史产物不静默误判）
    expect(renderInline(String.raw`![alt](C:\Users\me\a b.png)`)).toBe(
      String.raw`![alt](C:\Users\me\a b.png)`
    );
  });

  it('空 href 图片渲染占位（K1）：含 .inline-image-empty 且不产出 <img>', () => {
    const html = renderInline('![]()');
    expect(html).toContain('inline-image-empty');
    expect(html).not.toContain('<img');
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe('![]()');
  });

  it('空 href 图片占位中 alt 可见，textContent 与源文本一致', () => {
    const source = '![alt]()';
    const html = renderInline(source);
    expect(html).toContain('inline-image-empty');
    expect(html).toContain('alt');
    expect(html).not.toContain('<img');
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe(source);
  });

  it('空 href 图片占位结构：两个 md-syntax 包裹 `![` 与 `]()`，中段 inline-image-empty 为 alt', () => {
    const html = renderInline('![empty]()');
    const container = document.createElement('div');
    container.innerHTML = html;
    const syntaxSpans = [...container.querySelectorAll('.md-syntax')].map((s) => s.textContent);
    expect(syntaxSpans).toEqual(['![', ']()']);
    expect(container.querySelector('.inline-image-empty')?.textContent).toBe('empty');
  });

  it('非空 href 图片输出保持既有 <img class="inline-image"> 不变（含 data-start/data-end 偏移）', () => {
    expect(renderInline('![alt](https://example.com/a.png)')).toBe(
      '<img class="inline-image" src="https://example.com/a.png" alt="alt" data-start="0" data-end="33">'
    );
  });

  it('危险链接降级为纯文本', () => {
    expect(renderInline('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
  });

  it('自动链接', () => {
    expect(renderInline('<https://example.com>')).toContain(
      'href="https://example.com"'
    );
  });

  it('反斜杠转义', () => {
    expect(renderInline('\\*literal\\*')).toBe(
      '<span class="md-syntax">\\*</span>literal<span class="md-syntax">\\*</span>'
    );
  });

  it('下划线在单词内不作为强调（路径场景）', () => {
    expect(renderInline('foo_bar_baz')).toBe('foo_bar_baz');
  });

  it('普通文本原样', () => {
    expect(renderInline('hello world 中文 测试')).toBe('hello world 中文 测试');
  });

  it('渲染结果 textContent 与源文本一致（输入不丢标记）', () => {
    const html = renderInline('**bold** and `code` and [link](https://x.com)');
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe('**bold** and `code` and [link](https://x.com)');
  });

  it('无协议裸域名链接：href/data-href 补 https://，`.md-syntax` 保留原始 URL', () => {
    expect(renderInline('[t](www.baidu.com)')).toBe(
      '<a class="inline-link" href="https://www.baidu.com" data-href="https://www.baidu.com" target="_blank" rel="noopener noreferrer"><span class="md-syntax">[</span>t<span class="md-syntax">](www.baidu.com)</span></a>'
    );
  });

  it('裸域名链接与本地图片源文本保存', () => {
    // 链接：`.md-syntax` 保留原始裸域名（href 补全不影响 textContent）
    const linkHtml = renderInline('[t](www.baidu.com)');
    const linkContainer = document.createElement('div');
    linkContainer.innerHTML = linkHtml;
    expect(linkContainer.textContent).toBe('[t](www.baidu.com)');
    // 本地图片：图片 token 无标记 span，src 统一转 media://；alt 保留源 label
    const imgHtml = renderInline(String.raw`![a](C:\a.png)`);
    expect(imgHtml).toContain('src="media://C%3A/a.png"');
    expect(imgHtml).toContain('alt="a"');
    const imgContainer = document.createElement('div');
    imgContainer.innerHTML = imgHtml;
    // 图片不产文本节点，但 alt 属性与源 label 一致；完整往返由 RT5/RT3 覆盖
    expect(imgContainer.querySelector('img')?.getAttribute('alt')).toBe('a');
  });
});

describe('inlineRenderer — 下划线 / 数学（阶段 1 新增）', () => {
  it('IR1 下划线渲染为 <u> 富文本且 textContent 保留', () => {
    expect(renderInline('<u>x</u>')).toBe(
      '<u><span class="md-syntax">&lt;u&gt;</span>x<span class="md-syntax">&lt;/u&gt;</span></u>'
    );
    const container = document.createElement('div');
    container.innerHTML = renderInline('<u>x</u>');
    expect(container.textContent).toBe('<u>x</u>');
  });

  it('IR2 数学公式渲染为 math-inline + KaTeX HTML，$ 不可见', () => {
    const html = renderInline('$x^2$');
    expect(html).toContain('<span class="math-inline">');
    expect(html).toContain('<span class="katex">x^2</span>');
    expect(html).toContain('<span class="md-syntax">$</span>');
  });

  it('IR3 cost $5 不误判为数学', () => {
    expect(renderInline('cost $5')).toBe('cost $5');
  });

  it('IR4 $ x$ / 未闭合 $ 不误判为数学', () => {
    expect(renderInline('$ x$')).toBe('$ x$');
    expect(renderInline('$x')).toBe('$x');
  });

  it('IR5 \\$ 转义为字面量（$ 属于 ESCAPABLE_CHARS）', () => {
    expect(renderInline('\\$5')).toBe('<span class="md-syntax">\\$</span>5');
  });

  it('IR6 katex 异常回退为转义字面量，不抛错', async () => {
    const katexMock = (await import('katex')).default as unknown as {
      renderToString: ReturnType<typeof vi.fn>;
    };
    katexMock.renderToString.mockImplementationOnce(() => {
      throw new Error('katex fail');
    });
    expect(renderInline('$x^2$')).toBe(
      '<span class="md-syntax">$</span>x^2<span class="md-syntax">$</span>'
    );
  });

  it('IR7 含 u/math 文本 textContent 与源串一致', () => {
    const source = '<u>u</u> and $x$';
    const html = renderInline(source);
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe(source);
  });

  it('IR8 金标准不回归（既有断言由上方用例覆盖）', () => {
    expect(renderInline('**bold** and *italic*')).toContain('<strong>');
    expect(renderInline('~~gone~~')).toContain('<del>');
    expect(renderInline('==mark==')).toContain('<mark>');
    expect(renderInline('`c`')).toContain('inline-code');
    expect(renderInline('[l](https://x.com)')).toContain('inline-link');
    expect(renderInline('![a](https://x.com/a.png)')).toContain('inline-image');
    expect(renderInline('<https://x.com>')).toContain('href="https://x.com"');
  });

  it('IR9 underline 精确小写，不干扰 autolink', () => {
    // autolink 仍是 autolink
    expect(renderInline('<https://x.com>')).toContain('href="https://x.com"');
    // 大写 <U> 不解析为 underline
    expect(renderInline('<U>x</U>')).toBe('&lt;U&gt;x&lt;/U&gt;');
  });
});

describe('inlineRenderer — 相邻混合强调渲染（PLAN-EDIT-FT4 / AGT-C）', () => {
  it('`**12*3***` 渲染为 strong 内嵌 em，无字面 `*` 残体', () => {
    expect(renderInline('**12*3***')).toBe(
      '<strong><span class="md-syntax">**</span>12<em><span class="md-syntax">*</span>3<span class="md-syntax">*</span></em><span class="md-syntax">**</span></strong>'
    );
    expect(renderInline('**12*3***')).not.toContain('*3*</strong><span class="md-syntax">*</span>');
  });

  it('`**加*粗***`（DSG-R2a 产物）渲染嵌套无残体，textContent 与源串一致', () => {
    const source = '**加*粗***';
    const html = renderInline(source);
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe(source);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).not.toContain('*粗***</em>');
  });

  it('`***12*3**`（open 三连拆分产物）渲染 strong 内嵌 em，无字面 `*` 残体', () => {
    const source = '***12*3**';
    const html = renderInline(source);
    expect(html).toBe(
      '<strong><span class="md-syntax">**</span><em><span class="md-syntax">*</span>12<span class="md-syntax">*</span></em>3<span class="md-syntax">**</span></strong>'
    );
    expect(html).not.toContain('*<strong>');
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe(source);
  });

  it('两两风格组合渲染：strong+del / mark+strong / strong+math / underline+em', () => {
    const cases: Array<[string, string]> = [
      ['**~~x~~**', '<del>'],
      ['==**x**==', '<strong>'],
      ['**$x$**', '<span class="math'],
      ['<u>*x*</u>', '<em>'],
    ];
    for (const [source, expectContain] of cases) {
      const html = renderInline(source);
      expect(html).toContain(expectContain);
      const container = document.createElement('div');
      container.innerHTML = html;
      expect(container.textContent).toBe(source);
    }
  });
});

describe('inlineRenderer — open 三连拆分剩余区渲染（fix-inline-marker-remainder）', () => {
  it('B1 旗舰：`***12*<u>3</u>**` 渲染 strong 内嵌 em+u，无字面 <u> 文本', () => {
    const html = renderInline('***12*<u>3</u>**');
    expect(html).toBe(
      '<strong><span class="md-syntax">**</span><em><span class="md-syntax">*</span>12<span class="md-syntax">*</span></em><u><span class="md-syntax">&lt;u&gt;</span>3<span class="md-syntax">&lt;/u&gt;</span></u><span class="md-syntax">**</span></strong>'
    );
    expect(html).not.toContain('&lt;u&gt;3&lt;/u&gt;');
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe('***12*<u>3</u>**');
  });

  it('B2 五种成对标记在剩余区各渲染出目标标签且往返一致', () => {
    const cases: Array<[string, string]> = [
      ['***12*~~3~~**', '<del>'],
      ['***12*==3==**', '<mark>'],
      ['***12*<u>3</u>**', '<u>'],
      ['***12*`3`**', '<code class="inline-code">'],
      ['***12*$3$**', '<span class="math-inline">'],
    ];
    for (const [source, expectContain] of cases) {
      const html = renderInline(source);
      expect(html, source).toContain(expectContain);
      expect(html, source).not.toContain('&lt;u&gt;3&lt;/u&gt;');
      const container = document.createElement('div');
      container.innerHTML = html;
      expect(container.textContent, source).toBe(source);
    }
  });

  it('B3 嵌套：`***12*~~<u>3</u>~~**` 渲染含 <del> 与 <u>，往返一致', () => {
    const source = '***12*~~<u>3</u>~~**';
    const html = renderInline(source);
    expect(html).toContain('<del>');
    expect(html).toContain('<u>');
    expect(html).not.toContain('&lt;u&gt;3&lt;/u&gt;');
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe(source);
  });
});

describe('inlineRenderer — code-block Prism 高亮（U2）', () => {
  it('javascript 代码块渲染 Prism token HTML，keyword 被包裹', () => {
    const html = renderBlockHtml({
      type: 'code-block',
      text: 'const a = 1',
      meta: { fenceLanguage: 'javascript' },
    });
    expect(html).toContain('<span class="token keyword">const</span>');
    expect(html).not.toContain('const a = 1');
  });

  it('plaintext 语言回退为纯转义，无 token span', () => {
    expect(
      renderBlockHtml({
        type: 'code-block',
        text: '<div>x</div>',
        meta: { fenceLanguage: 'plaintext' },
      })
    ).toBe('&lt;div&gt;x&lt;/div&gt;');
  });

  it('无 meta（无语言）回退为纯转义', () => {
    expect(renderBlockHtml({ type: 'code-block', text: '<div>x</div>' })).toBe(
      '&lt;div&gt;x&lt;/div&gt;'
    );
  });

  it('无 Prism grammar 的语言回退为纯转义，不抛错', () => {
    const html = renderBlockHtml({
      type: 'code-block',
      text: 'foo < bar',
      meta: { fenceLanguage: 'nosuchlang' },
    });
    expect(html).toBe('foo &lt; bar');
    expect(html).not.toContain('token');
  });

  it('高亮结果 textContent 与源文本一致（不丢字符）', () => {
    const source = 'const x = 1;\nconsole.log(x);';
    const html = renderBlockHtml({
      type: 'code-block',
      text: source,
      meta: { fenceLanguage: 'typescript' },
    });
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.textContent).toBe(source);
  });

  it('语言别名 js → javascript 高亮生效', () => {
    const html = renderBlockHtml({
      type: 'code-block',
      text: 'const a = 1',
      meta: { fenceLanguage: 'js' },
    });
    expect(html).toContain('<span class="token keyword">const</span>');
  });

  it('普通 paragraph 类型不受影响，仍走行内渲染', () => {
    expect(renderBlockHtml({ type: 'paragraph', text: '**bold**' })).toContain('<strong>');
    expect(renderBlockHtml({ type: 'paragraph', text: '**bold**' })).not.toContain('token');
  });
});

describe('inlineRenderer — renderBlockHtml image-block（edit-image-align-toolbar K2）', () => {
  it('wrapper 单图：输出内层 <img>（wrapper 不转义为字面文本），data-start 为 innerStart 绝对偏移', () => {
    const html = renderBlockHtml({
      type: 'image-block',
      text: '<div align="center">![a](C:/x.png)</div>',
    });
    expect(html).toContain('<img class="inline-image"');
    expect(html).not.toContain('&lt;div');
    expect(html).not.toContain('</div>');
    expect(html).toContain('data-start="20"');
    expect(html).toContain('data-end="34"');
  });

  it('裸图 image-block：data-start=0，data-end 为 inner 长度', () => {
    const html = renderBlockHtml({ type: 'image-block', text: '![a](C:/x.png)' });
    expect(html).toContain('<img class="inline-image"');
    expect(html).toContain('data-start="0"');
    expect(html).toContain('data-end="14"');
  });

  it('非独立图文本回退为普通行内渲染（不抛错）', () => {
    const html = renderBlockHtml({
      type: 'image-block',
      text: 'pre ![a](C:/x.png) post',
    });
    expect(html).toContain('<img class="inline-image"');
    expect(html).toContain('data-start="4"');
  });

  it('R3 wrapper 带 width → 宽度注入 <img> 自身（style="width:Npx"），wrapper 不出现', () => {
    const html = renderBlockHtml({
      type: 'image-block',
      text: '<div align="center" style="width:640px">![a](C:/x.png)</div>',
    });
    expect(html).toContain('<img class="inline-image"');
    expect(html).toContain('style="width:640px"');
    expect(html).not.toContain('&lt;div');
    expect(html).not.toContain('width:640px" style="width');
    expect(html).not.toContain('<div');
  });

  it('R3 裸图 + width wrapper（wrapImageWidth 产物）→ 宽度注入 img，data-start 为 innerStart 绝对偏移', () => {
    const html = renderBlockHtml({
      type: 'image-block',
      text: '<div align="left" style="width:400px">![a](C:/x.png)</div>',
    });
    expect(html).toContain('<img class="inline-image"');
    expect(html).toContain('style="width:400px"');
    expect(html).toContain('data-start="38"');
    expect(html).toContain('data-end="52"');
  });

  it('R3 无 width → 不注入 style（保持既有输出）', () => {
    const html = renderBlockHtml({ type: 'image-block', text: '![a](C:/x.png)' });
    expect(html).toContain('<img class="inline-image"');
    expect(html).not.toContain('style="width:');
  });
});

describe('inlineRenderer — toImgSrc 单层解码修复（edit-image-align-toolbar K1）', () => {
  it('未转义空格路径（既有契约不回归）→ media:// + %20', () => {
    expect(toImgSrc('C:/Users/a b.png')).toBe('media://C%3A/Users/a%20b.png');
  });

  it('已含 %20 转义的 markdown src 不再双重编码（不含 %25，空格为单层 %20）', () => {
    const src = 'C:/Users/屏幕截图%202026-08-11%20003530.png';
    const result = toImgSrc(src);
    expect(result).not.toContain('%25');
    expect(result).toBe(
      'media://C%3A/Users/%E5%B1%8F%E5%B9%95%E6%88%AA%E5%9B%BE%202026-08-11%20003530.png'
    );
  });

  it('UNC 含 %20 转义 → 单层编码，不双重编码', () => {
    expect(toImgSrc('//server/share/a%20b.png')).toBe(
      'media://%2F%2Fserver%2Fshare%2Fa%20b.png'
    );
  });

  it('非法 %XX（如 %2）字面保留，encode 后 %252 形态，不抛错', () => {
    expect(toImgSrc('C:/Users/a%2.png')).toBe('media://C%3A/Users/a%252.png');
  });

  it('相对路径 / 网络 URL 原样返回（不触碰）', () => {
    expect(toImgSrc('img/a.png')).toBe('img/a.png');
    expect(toImgSrc('https://x.com/a.png')).toBe('https://x.com/a.png');
    expect(toImgSrc('a b.png')).toBe('a b.png');
  });

  it('renderInline 集成：已含 %20 的本地路径 src 输出单层 media://', () => {
    const html = renderInline('![a](<C:/Users/屏幕截图%202026-08-11%20003530.png>)');
    expect(html).toContain(
      'src="media://C%3A/Users/%E5%B1%8F%E5%B9%95%E6%88%AA%E5%9B%BE%202026-08-11%20003530.png"'
    );
    expect(html).not.toContain('%2520');
  });
});

describe('inlineRenderer — img data-start/data-end 偏移（edit-image-align-toolbar K1）', () => {
  it('整行图片 → data-start=0，data-end=token 区间末端', () => {
    expect(renderInline('![a](https://x.com/a.png)')).toBe(
      '<img class="inline-image" src="https://x.com/a.png" alt="a" data-start="0" data-end="25">'
    );
  });

  it('混合文本偏移正确（base 透传）', () => {
    const html = renderInline('pre ![a](https://x.com/a.png) post');
    expect(html).toContain('data-start="4"');
    expect(html).toContain('data-end="29"');
  });

  it('空 href 占位不受影响（无 data 属性、无 <img>）', () => {
    expect(renderInline('![a]()')).not.toContain('data-start');
  });
});
