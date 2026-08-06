// ============================================
// WeaveMD Editor v2 — Markdown Syntax 单一来源
// ============================================
// 六种块前缀语法的核心正则（内容块内检测），供转换器（detectBlockConversion）
// 与解析器（markdownToState）共用，避免同一语法多处定义导致漂移。
//
// 注意：解析器的行级正则保留各自的缩进/多级语义（见 markdownToState.ts），
// 通过 indented() 从核心正则派生无缩进变体。

/** ATX 标题：# 1-6 个 + 分隔符 + 内容 */
export const ATX_HEADING_RE = /^(#{1,6})[ \t\u00A0]+([\s\S]*)$/;

/** 分割线：*** / --- / ___（独立成块） */
export const THEMATIC_BREAK_RE =
  /^(?:\*[ \t]*\*[ \t]*\*|-[ \t]*-[ \t]*-|_[ \t]*_[ \t]*_)[ \t*\-_]*$/;

/** 为核心正则派生"允许 0-3 空格缩进"的行级变体（解析器使用） */
export function indented(re: RegExp): RegExp {
  return new RegExp(`^(?: {0,3})${re.source.slice(1)}`, re.flags);
}
