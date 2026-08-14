// ============================================
// WeaveMD — Export HTML template (self-contained)
// ============================================
// 构建可独立打开的导出 HTML 文档：内嵌导出 CSS，视觉迁移自
// src/render/styles/globals.css `.markdown-preview`（光色/light 配色段），
// 所有 `var(--x)` 替换为固定色值，不依赖应用 CSS 变量，保证自包含。
// 纯函数、Node 兼容、可单测，不依赖 React/DOM。

/** 转义 HTML：仅用于 <title>，避免用户标题注入标签 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 导出专用 CSS（自包含固定色值）。独立模板字符串导出便于测试断言。
 * 标题字号与 CLAUDE.md 规范一致：H1 26/700、H2 22/600、H3 18/600、H4 16/500、正文 14/400。
 */
export const EXPORT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  color: #1a1a1a;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.65;
  background: #fff;
  word-wrap: break-word;
}
.markdown-export {
  max-width: 74ch;
  margin: 0 auto;
  padding: 2.5em 2em 4em;
}
.markdown-export h1 {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.03em;
  margin: 0 0 1rem 0;
  padding-bottom: 0.4em;
  border-bottom: 1px solid #e5e7eb;
  color: #1a1a1a;
}
.markdown-export h2 {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.025em;
  margin: 1.9em 0 0.85em 0;
  padding-bottom: 0.35em;
  border-bottom: 1px solid #e5e7eb;
  color: #1a1a1a;
}
.markdown-export h3 {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
  margin: 1.7em 0 0.7em 0;
  color: #1a1a1a;
}
.markdown-export h4 {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.3;
  margin: 1.45em 0 0.55em 0;
  color: #1a1a1a;
}
.markdown-export h5 {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  margin: 1.3em 0 0.45em 0;
  color: #4b5563;
}
.markdown-export h6 {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  margin: 1.25em 0 0.45em 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #4b5563;
}
.markdown-export p { margin: 0 0 1.05em 0; }
.markdown-export ul,
.markdown-export ol { margin: 0 0 1.05em 0; padding-left: 1.4em; }
.markdown-export ul { list-style-type: disc; }
.markdown-export ol { list-style-type: decimal; }
.markdown-export li { margin: 0.32em 0; padding-left: 0.2em; }
.markdown-export li > p { margin: 0.35em 0; }
.markdown-export ul ul,
.markdown-export ul ol,
.markdown-export ol ul,
.markdown-export ol ol { margin-top: 0.25em; margin-bottom: 0; }
.markdown-export ul.contains-task-list { list-style-type: none; padding-left: 0; }
.markdown-export .task-list-item { display: flex; align-items: flex-start; gap: 0.65em; padding-left: 0; }
.markdown-export .task-list-item-checkbox { margin-top: 0.26em; flex-shrink: 0; accent-color: #7c3aed; }
.markdown-export .task-list-item:has(> .task-list-item-checkbox[checked]) {
  color: #9ca3af;
  text-decoration: line-through;
}
.markdown-export blockquote {
  margin: 0 0 1.15em 0;
  padding: 0.85em 1em;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f0eef7;
  color: #4b5563;
}
.markdown-export blockquote > :last-child { margin-bottom: 0; }
.markdown-export code {
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 0.9em;
  background: #f6f8fa;
  padding: 0.18em 0.42em;
  border-radius: 6px;
  color: #7c3aed;
}
.markdown-export pre {
  margin: 0 0 1.15em 0;
  padding: 1em 1.1em;
  background: #f6f8fa;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow-x: auto;
}
.markdown-export .markdown-code-block { position: relative; }
.markdown-export pre code {
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 0.9em;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  color: #24292f;
}
.markdown-export pre code[data-language]::before {
  content: attr(data-language);
  display: block;
  margin-bottom: 0.75em;
  padding-bottom: 0.6em;
  border-bottom: 1px solid rgba(107, 114, 128, 0.2);
  color: #6b7280;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.markdown-export a { color: #7c3aed; text-decoration: underline; text-underline-offset: 0.16em; }
.markdown-export a:hover { color: #6d28d9; text-decoration-thickness: 2px; }
.markdown-export .markdown-table-wrap { width: 100%; margin: 0 0 1.15em 0; overflow-x: auto; }
.markdown-export table { width: 100%; margin: 0; border-collapse: collapse; border-spacing: 0; font-size: 0.95em; }
.markdown-export .markdown-export table th,
.markdown-export table td { padding: 0.65em 0.85em; border: 1px solid #e5e7eb; vertical-align: top; }
.markdown-export table th { background: #eef0f8; font-weight: 700; text-align: left; }
.markdown-export table tr:nth-child(even) td { background: #fafafa; }
.markdown-export del { text-decoration: line-through; color: #9ca3af; }
.markdown-export img { max-width: 100%; height: auto; border-radius: 8px; margin: 0.5em 0; }
.markdown-export hr { border: none; height: 1px; background: #e5e7eb; margin: 2em 0; }
.markdown-export strong { font-weight: 700; }
.markdown-export em { font-style: italic; }
.markdown-export .markdown-highlight,
.markdown-export mark { background: rgba(250, 204, 21, 0.56); color: inherit; padding: 0.05em 0.22em; border-radius: 4px; }
.markdown-export .markdown-comment {
  display: inline-block;
  font-size: 0.85em;
  color: #6b7280;
  background: #f0f0f0;
  border-radius: 6px;
  padding: 0.1em 0.45em;
}
.markdown-export pre[class*='language-'],
.markdown-export code[class*='language-'] { color: #24292f; text-shadow: none; }
.markdown-export .token.comment,
.markdown-export .token.prolog,
.markdown-export .token.doctype,
.markdown-export .token.cdata { color: #6b7280; }
.markdown-export .token.punctuation { color: #374151; }
.markdown-export .token.property,
.markdown-export .token.tag,
.markdown-export .token.boolean,
.markdown-export .token.number,
.markdown-export .token.constant,
.markdown-export .token.symbol,
.markdown-export .token.deleted { color: #dc2626; }
.markdown-export .token.selector,
.markdown-export .token.attr-name,
.markdown-export .token.string,
.markdown-export .token.char,
.markdown-export .token.builtin,
.markdown-export .token.inserted { color: #059669; }
.markdown-export .token.operator,
.markdown-export .token.entity,
.markdown-export .token.url,
.markdown-export .language-css .token.string,
.markdown-export .style .token.string { color: #d97706; }
.markdown-export .token.atrule,
.markdown-export .token.attr-value,
.markdown-export .token.keyword { color: #7c3aed; }
.markdown-export .token.function,
.markdown-export .token.class-name { color: #2563eb; }
.markdown-export .token.regex,
.markdown-export .token.important,
.markdown-export .token.variable { color: #ea580c; }
`.trim();

/**
 * 构建自包含的导出 HTML 完整文档。
 * @param body 渲染后的正文片段（renderMarkdownToHtml 输出，含 Prism token span）
 * @param title 文档标题（写入 <title>，会自动 HTML 转义）
 */
export function buildExportHtml({ body, title }: { body: string; title: string }): string {
  const escapedTitle = escapeHtml(title);
  const styles = EXPORT_CSS;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>${styles}</style>
</head>
<body class="markdown-export"><div class="markdown-export-body">${body}</div></body>
</html>
`;
  return html;
}
