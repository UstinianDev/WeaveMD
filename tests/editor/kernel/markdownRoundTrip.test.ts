import { describe, expect, it } from 'vitest';

import { markdownToState } from '../../../src/render/editor/kernel/markdownToState';
import { stateToMarkdown } from '../../../src/render/editor/kernel/stateToMarkdown';
import { getAllBlocksInOrder } from '../../../src/render/editor/kernel/blockTree';

/** 规范化往返：stateToMarkdown(markdownToState(M)) === M */
function roundTrip(markdown: string): string {
  const tree = markdownToState(markdown);
  return stateToMarkdown(tree);
}

function expectRoundTrip(markdown: string): void {
  expect(roundTrip(markdown)).toBe(markdown);
}

describe('markdown round-trip — 基础块', () => {
  it('空文档', () => {
    expectRoundTrip('');
    // 纯空白归一化为空文档
    expect(roundTrip('\n\n')).toBe('');
  });

  it('单段落', () => {
    expectRoundTrip('hello world');
  });

  it('多段落（空行分隔）', () => {
    expectRoundTrip('para one\n\npara two\n\npara three');
  });

  it('段落内软换行', () => {
    expectRoundTrip('line one\nline two');
  });

  it('ATX 标题 1-6', () => {
    expectRoundTrip('# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6');
  });

  it('标题与段落混排', () => {
    expectRoundTrip('# Title\n\ntext under title');
  });

  it('Setext 标题（= 与 -）', () => {
    expectRoundTrip('Setext One\n==========\n\nSetext Two\n----------');
  });

  it('分割线', () => {
    expectRoundTrip('before\n\n---\n\nafter');
    // *** / ___ 归一化为 ---（语义等价）
    expect(roundTrip('***')).toBe('---');
    expect(roundTrip('___')).toBe('---');
  });
});

describe('markdown round-trip — 引用', () => {
  it('单段引用', () => {
    expectRoundTrip('> quoted text');
  });

  it('多行引用合并为一段', () => {
    expectRoundTrip('> line one\n> line two');
  });

  it('引用内多段', () => {
    expectRoundTrip('> para one\n>\n> para two');
  });

  it('引用内嵌套标题与列表', () => {
    expectRoundTrip('> # Heading\n>\n> - item a\n> - item b');
  });

  it('引用后接普通段落', () => {
    expectRoundTrip('> quote\n\nnormal text');
  });
});

describe('markdown round-trip — 列表', () => {
  it('无序列表', () => {
    expectRoundTrip('- a\n- b\n- c');
  });

  it('无序列表多种标记归一为 -', () => {
    // 输入 + 与 * 会归一化输出为 -（语义等价）
    expect(roundTrip('* a\n+ b')).toBe('- a\n- b');
  });

  it('列表项多行文本', () => {
    expectRoundTrip('- first line\n  second line\n- next item');
  });

  it('有序列表', () => {
    expectRoundTrip('1. first\n2. second\n3. third');
  });

  it('有序列表自定义起始编号', () => {
    expectRoundTrip('3. three\n4. four');
  });

  it('有序列表 ) 分隔符', () => {
    expectRoundTrip('1) one\n2) two');
  });

  it('任务列表', () => {
    expectRoundTrip('- [ ] todo\n- [x] done');
  });

  it('任务与普通项混排', () => {
    expectRoundTrip('- plain\n- [ ] todo\n- [x] done');
  });

  it('嵌套列表（两级）', () => {
    expectRoundTrip('- parent\n  - child one\n  - child two\n- other');
  });

  it('松散列表（项间空行）', () => {
    expectRoundTrip('- a\n\n- b');
  });

  it('列表后接段落', () => {
    expectRoundTrip('- item\n\nparagraph after');
  });
});

describe('markdown round-trip — 代码块与表格', () => {
  it('无语言代码块', () => {
    expectRoundTrip('```\ncode line\n```');
  });

  it('带语言代码块', () => {
    expectRoundTrip('```javascript\nconst a = 1;\n```');
  });

  it('波浪围栏', () => {
    expectRoundTrip('~~~python\nprint(1)\n~~~');
  });

  it('代码内容含围栏时自动加长', () => {
    const result = roundTrip('```\ninner ``` fence\n```');
    // 内容含 ``` → 序列化用更长的围栏包裹，重解析后语义等价（SPEC-EDIT-CBTP：尾部代码块规范化补保护空行）
    expect(markdownToState(result).root.childrenIds.length).toBe(2);
    expect(stateToMarkdown(markdownToState(result))).toBe(result);
  });

  it('表格', () => {
    expectRoundTrip('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  });

  it('表格对齐分隔行', () => {
    expectRoundTrip('| left | center | right |\n|:-----|:------:|------:|\n| x    | y      | z     |');
  });
});

describe('markdown round-trip — 组合与边界', () => {
  it('综合文档', () => {
    expectRoundTrip(
      [
        '# WeaveMD',
        '',
        'A markdown editor.',
        '',
        '## Features',
        '',
        '- [x] WYSIWYG',
        '- [ ] Export',
        '',
        '> Quote block',
        '',
        '```ts',
        'const x: number = 1;',
        '```',
        '',
        '| col | val |',
        '|-----|-----|',
        '| a   | 1   |',
        '',
        '---',
      ].join('\n')
    );
  });

  it('HTML 特殊字符保持原样', () => {
    expectRoundTrip('a < b & c > d "quote"');
  });

  it('行内 markdown 语法字符在段落中保留', () => {
    expectRoundTrip('**bold** and *italic* and `code`');
  });

  it('转义字符保留', () => {
    expectRoundTrip('\\*not italic\\* and \\# not heading');
  });

  it('空行开头与结尾', () => {
    // 首尾空行归一化剥离
    expect(roundTrip('\n# Title\n\nbody\n')).toBe('# Title\n\nbody');
  });

  it('归一化：无空行分隔的块补空行', () => {
    expect(roundTrip('# H\np')).toBe('# H\n\np');
  });

  it('归一化：标题 closing # 剥离', () => {
    expect(roundTrip('# Title #')).toBe('# Title');
  });

  it('归一化：列表后无空行段落', () => {
    expect(roundTrip('- item\nparagraph')).toBe('- item\n\nparagraph');
  });
});

describe('markdownToState — 树结构', () => {
  it('嵌套列表的块结构正确', () => {
    const tree = markdownToState('- parent\n  - child');
    const blocks = getAllBlocksInOrder(tree);
    const list = blocks.find((b) => b.type === 'bullet-list')!;
    const item = tree.blocks[list.childrenIds[0]];
    expect(item.type).toBe('list-item');
    const subList = tree.blocks[item.childrenIds[1]];
    expect(subList.type).toBe('bullet-list');
  });

  it('任务列表项带 checked 元数据', () => {
    const tree = markdownToState('- [x] done');
    const blocks = getAllBlocksInOrder(tree);
    const item = blocks.find((b) => b.type === 'list-item')!;
    expect(item.meta?.taskChecked).toBe(true);
  });

  it('引用内块挂到 blockquote 下', () => {
    const tree = markdownToState('> quote');
    const quote = getAllBlocksInOrder(tree).find((b) => b.type === 'blockquote')!;
    expect(quote.childrenIds.length).toBe(1);
    expect(tree.blocks[quote.childrenIds[0]].type).toBe('paragraph');
  });
});
