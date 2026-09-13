// ============================================
// WeaveMD Editor v2 — Block Detection (pure)
// ============================================
// 从 blockTree.ts 提取的语法检测与块转换函数。
// 纯函数：输入 text 字符串，输出检测结果，不依赖块树状态。

import {
  ATX_HEADING_RE,
  BQ_CONV_RE,
  FENCE_CONV_CORE_RE,
  FENCE_OPEN_CORE_RE,
  OL_ITEM_RE,
  TASK_ITEM_RE,
  THEMATIC_BREAK_RE,
  UL_ITEM_RE,
} from './markdownSyntax';
import type { BlockConversionV2 } from './types';

// ============================================
// 围栏检测
// ============================================

/** 判断整行是否为围栏语法行（如 ```java），供回车提交代码块使用 */
export function detectFenceLine(text: string): {
  marker: string;
  lang: string;
  prefixLength: number;
} | null {
  const fence = text.match(FENCE_OPEN_CORE_RE);
  if (!fence) return null;
  return {
    marker: fence[1],
    lang: fence[2].trim(),
    prefixLength: text.length,
  };
}

// ============================================
// 块转换检测
// ============================================
// 与 SPEC-EDIT-EXIT 及 v1 lineMarkdown 对齐：
// 分隔符支持普通空格 / Tab / 非断行空格（U+00A0，中文输入法）。

/** 块转换规则表：正则命中后构造转换结果（数组顺序即匹配优先级） */
const CONVERSION_RULES: Array<{
  re: RegExp;
  build: (m: RegExpMatchArray, text: string) => BlockConversionV2;
}> = [
  {
    re: ATX_HEADING_RE,
    build: (m, text) => ({
      type: 'heading',
      meta: { headingLevel: m[1].length as 1 | 2 | 3 | 4 | 5 | 6 },
      prefixLength: text.length - m[2].length,
    }),
  },
  {
    re: TASK_ITEM_RE,
    build: (m, text) => ({
      type: 'task-list',
      meta: { taskChecked: m[3].toLowerCase() === 'x', listMarker: '-' },
      prefixLength: text.length - m[5].length,
    }),
  },
  {
    re: UL_ITEM_RE,
    build: (m, text) => ({
      type: 'bullet-list',
      meta: { listMarker: m[1] as '-' | '*' | '+' },
      prefixLength: text.length - m[3].length,
    }),
  },
  {
    re: OL_ITEM_RE,
    build: (m, text) => ({
      type: 'ordered-list',
      meta: { orderedStart: parseInt(m[1], 10), orderedDelimiter: m[2] as '.' | ')' },
      prefixLength: text.length - m[4].length,
    }),
  },
  {
    re: BQ_CONV_RE,
    build: (m, text) => ({
      type: 'blockquote',
      prefixLength: text.length - m[1].length,
    }),
  },
  {
    re: FENCE_CONV_CORE_RE,
    build: (m, text) => ({
      type: 'code-block',
      meta: {
        fenceLanguage: m[2].trim() || undefined,
        fenceMarker: m[1],
      },
      prefixLength: text.length,
    }),
  },
];

/** 根据一行文本检测应转换的块类型（前缀匹配） */
export function detectBlockConversion(text: string): BlockConversionV2 | null {
  for (const rule of CONVERSION_RULES) {
    const match = text.match(rule.re);
    if (match) return rule.build(match, text);
  }

  if (THEMATIC_BREAK_RE.test(text)) {
    return { type: 'thematic-break', prefixLength: text.length };
  }

  return null;
}