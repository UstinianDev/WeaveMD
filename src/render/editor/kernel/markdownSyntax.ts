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

/** 任务列表项：marker + 分隔 + [x] + 分隔 + 内容（富捕获组，转换器/解析器共用） */
export const TASK_ITEM_RE =
  /^([-*+])([ \t\u00A0]+)\[([ xX\u00A0])\]([ \t\u00A0]+)([\s\S]*)$/;

/** 无序列表项：marker + 分隔 + 内容 */
export const UL_ITEM_RE = /^([-*+])([ \t\u00A0]+)([\s\S]*)$/;

/** 有序列表项：数字 + 分隔符 + 分隔 + 内容 */
export const OL_ITEM_RE = /^(\d{1,9})([.)])([ \t\u00A0]+)([\s\S]*)$/;

/** 引用行（转换器严格版：需 `> ` 分隔；解析器的多级/无空格版见 markdownToState） */
export const BQ_CONV_RE = /^>[ \t\u00A0]+([\s\S]*)$/;

/** 围栏开行（解析器版，可无尾随空格） */
export const FENCE_OPEN_CORE_RE = /^(`{3,}|~{3,})([^\n]*)$/;

/** 围栏行即时转换（需尾随空格，避免输入中被提前消费） */
export const FENCE_CONV_CORE_RE = /^(`{3,}|~{3,})([^\n]*?)[ \t\u00A0]+$/;

/** Setext 下划线行：= 或 - 重复至少 1 个，允许 0-3 空格缩进 */
export const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;

/** 引用行解析版：允许多级 `>`（不强制空格），供解析器递归消费引用块行 */
export const BLOCKQUOTE_RE = /^ {0,3}(?:>[ \t]?)+(.*)$/;

/** 表格分隔行：4 种对齐变体，允许 0-3 空格缩进 */
export const TABLE_SEPARATOR_RE = /^ {0,3}\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

/** 为核心正则派生"允许 0-3 空格缩进"的行级变体（解析器使用） */
export function indented(re: RegExp): RegExp {
  return new RegExp(`^(?: {0,3})${re.source.slice(1)}`, re.flags);
}
