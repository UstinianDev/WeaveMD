import { describe, expect, it } from 'vitest';

import { parseTableText, serializeTable, type TableMatrix } from '@render/editor/kernel/tableCodec';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { stateToMarkdown } from '@render/editor/kernel/stateToMarkdown';
import { getAllBlocksInOrder } from '@render/editor/kernel/blockTree';

/** 规范化表格文本端到端往返：markdownToState(serializeTable(...)) 再 stateToMarkdown */
function kernelRoundTrip(matrix: TableMatrix): string {
  const md = serializeTable(matrix);
  return stateToMarkdown(markdownToState(md));
}

/** 找到文档序中类型为 table 的叶子块文本 */
function firstTableText(markdown: string): string {
  const tree = markdownToState(markdown);
  const table = getAllBlocksInOrder(tree).find((b) => b.type === 'table')!;
  return table.text ?? '';
}

describe('tableCodec — parse/serialize 往返不变量（T1.2）', () => {
  it('普通矩形矩阵互逆', () => {
    const m: TableMatrix = {
      header: ['a', 'b', 'c'],
      rows: [
        ['1', '2', '3'],
        ['4', '5', '6'],
      ],
    };
    expect(parseTableText(serializeTable(m))).toEqual(m);
  });

  it('含 `|` 单元格经转义/解义闭环互逆', () => {
    const m: TableMatrix = {
      header: ['x|y', 'plain'],
      rows: [['a|b|c', 'd']],
    };
    expect(parseTableText(serializeTable(m))).toEqual(m);
  });

  it('空单元格互逆', () => {
    const m: TableMatrix = {
      header: ['', 'b'],
      rows: [['', '']],
    };
    expect(parseTableText(serializeTable(m))).toEqual(m);
  });

  it('单元格 trim：边界空白剥离，内嵌空格保留', () => {
    // 计划 §1.1 step4：每格 trim。解析对边界空白做归一化（trim 稳定）。
    const m: TableMatrix = { header: ['a', 'b'], rows: [['spaced', '']] };
    expect(parseTableText(serializeTable(m))).toEqual(m);
    // 原始带边界空白的输入 → 解析后剥离空白（trim 归一化）
    const raw = '|  a  | b |\n| --- | --- |\n| spaced   | c |';
    expect(parseTableText(raw)).toEqual({ header: ['a', 'b'], rows: [['spaced', 'c']] });
  });

  it('对齐标记输入 → serialize 固定 `---` 输出（T1.3），列数一致', () => {
    const input =
      '| left | center | right |\n' +
      '|:-----|:------:|------:|\n' +
      '| x    | y      | z     |';
    const m = parseTableText(input);
    expect(m.header).toEqual(['left', 'center', 'right']);
    expect(parseTableText(serializeTable(m))).toEqual(m);
    // 归一化输出不含 `:` 对齐标记
    expect(serializeTable(m)).toContain('| --- | --- | --- |');
  });
});

describe('tableCodec — `\\|` 转义/解义闭环', () => {
  it('单元格内 `|` 序列化为 `\\|`，再解析还原为原始内容', () => {
    const m: TableMatrix = {
      header: ['a'],
      rows: [['pipe|inside']],
    };
    const md = serializeTable(m);
    expect(md).toBe('| a |\n| --- |\n| pipe\\|inside |');
    expect(parseTableText(md)).toEqual(m);
  });

  it('连续多个 `|` 均正确转义/解义', () => {
    const m: TableMatrix = { header: ['h'], rows: [['one|two|three']] };
    expect(parseTableText(serializeTable(m))).toEqual(m);
  });

  it('字面反斜杠（非 `\\|`）保留不误解义', () => {
    // 转义的反斜杠+竖线在计划中被保守按字面处理；纯反斜杠字面保留
    const input = '| a |\n| --- |\n| back\\\\slash |';
    const m = parseTableText(input);
    expect(m.rows[0][0]).toBe('back\\\\slash');
  });
});

describe('tableCodec — 对齐容错（T1.3）', () => {
  it.each([':---:', ':---', '---:'])('分隔单元格 `%s` 均可识别，列数一致', (align) => {
    const md = `| h1 | h2 |\n| ${align} | ${align} |\n| 1 | 2 |`;
    const m = parseTableText(md);
    expect(m.header).toEqual(['h1', 'h2']);
    expect(m.rows).toEqual([['1', '2']]);
    // serialize 归一化为固定 `---`
    expect(serializeTable(m)).toContain('| --- | --- |');
  });

  it('单列无首尾竖线分隔行 `---` 亦可识别', () => {
    const m = parseTableText('Header\n---\ndata');
    expect(m.header).toEqual(['Header']);
    expect(m.rows).toEqual([['data']]);
  });
});

describe('tableCodec — 畸形输入保守空（T1.1）', () => {
  it('空串 → 空结构，不抛错', () => {
    expect(parseTableText('')).toEqual({ header: [], rows: [] });
  });

  it.each(['| a |', '| a |\n| b |', 'single line', '| a | b |\nnot a sep line'])(
    '畸形/单行/非分隔行输入 `%j` → 空结构不抛错',
    (input) => {
      expect(parseTableText(input)).toEqual({ header: [], rows: [] });
    }
  );
});

describe('tableCodec — 单元格补齐/截断（恒矩形）', () => {
  it('数据行不足 header 列数 → 尾部补空串', () => {
    const md = '| a | b | c |\n| --- | --- | --- |\n| 1 |';
    const m = parseTableText(md);
    expect(m.rows).toEqual([['1', '', '']]);
  });

  it('数据行超出 header 列数 → 截断', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 | 4 |';
    const m = parseTableText(md);
    expect(m.rows).toEqual([['1', '2']]);
  });
});

describe('tableCodec — 与 markdownToState/stateToMarkdown 端到端往返（T6.1/T4.1）', () => {
  it('serialize 文本经内核重解析列数与内容等价', () => {
    const m: TableMatrix = {
      header: ['col1', 'col2'],
      rows: [
        ['a|b', 'x'],
        ['c', 'y|z'],
      ],
    };
    const md = serializeTable(m);
    // 该文本能被内核解析为 table 叶子块
    expect(firstTableText(md)).toBe(md);
    // 经 markdownToState → stateToMarkdown 往返，文本原样输出
    const repr = stateToMarkdown(markdownToState(md));
    expect(repr).toBe(md);
    // 重解析后矩阵与原文等价
    expect(parseTableText(repr)).toEqual(m);
  });

  it('kernelRoundTrip 对普通矩阵保持文本不变', () => {
    const m: TableMatrix = { header: ['a', 'b'], rows: [['1', '2'], ['3', '4']] };
    expect(kernelRoundTrip(m)).toBe(serializeTable(m));
  });
});
