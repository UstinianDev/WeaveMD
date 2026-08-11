// ============================================
// WeaveMD Editor v2 — Image Range Replace
// ============================================
// 纯函数：把图片 token 区间替换为 `![alt](src "title")` 文本。
// src 含空白/括号等特殊字符时按 Markdown 标准用 `<...>` 包裹，
// 保证 lexer 能整段识别（与 formatCtrl 的 applyLinkOrImage 规则一致）。
// cursorOffset 指向新片段末端（token.start + 片段长度）。

export interface ImageReplaceTarget {
  src: string;
  alt: string;
  title?: string;
}

/** src 命中 /[\s()<>]/ 时用 `<...>` 包裹，否则原样返回 */
export function escapeMarkdownUrl(src: string): string {
  return /[\s()<>]/.test(src) ? `<${src}>` : src;
}

/**
 * 把 text 的 [token.start, token.end) 区间替换为 `![alt](src "title")`。
 * title 省略时不输出 ` "..."` 段；title 内双引号转义为 `\"`。
 * 返回新文本与光标偏移（token.start + 新片段长度）。
 */
export function replaceImageRange(
  text: string,
  token: { start: number; end: number },
  img: ImageReplaceTarget
): { text: string; cursorOffset: number } {
  const writtenSrc = escapeMarkdownUrl(img.src);
  const titlePart = img.title !== undefined ? ` "${img.title.replace(/"/g, '\\"')}"` : '';
  const fragment = `![${img.alt}](${writtenSrc}${titlePart})`;
  const newText = text.slice(0, token.start) + fragment + text.slice(token.end);
  return { text: newText, cursorOffset: token.start + fragment.length };
}