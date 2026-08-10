// ============================================
// WeaveMD Editor v2 — Code Fence Language
// ============================================
// 围栏语言归一化（kernel 与 CodeBlock 组件共用，避免两套别名漂移）。
// 归一化目标：返回 Prism grammar 已知语言名或 'plaintext'。

/** 语言别名归一化表（compact 形式：去空格/下划线/连字符后小写） */
export const LANGUAGE_ALIASES: Record<string, string> = {
  plaintext: 'plaintext',
  plain: 'plaintext',
  text: 'plaintext',
  txt: 'plaintext',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  zsh: 'shell',
  md: 'markdown',
  js: 'javascript',
  ts: 'typescript',
  yml: 'yaml',
};

/** 编辑器支持（有 Prism grammar / 编辑器语义）的语言规范名集合 */
export const FENCE_LANGUAGES: readonly string[] = [
  'plaintext',
  'markdown',
  'shell',
  'json',
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'html',
  'css',
  'yaml',
  'python',
  'sql',
  'java',
];

/** 归一化围栏语言：不在已知集合时回退 'plaintext' */
export function normalizeFenceLanguage(language?: string): string {
  if (!language) return 'plaintext';
  const normalized = language.trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  const alias = LANGUAGE_ALIASES[compact];
  if (alias) return alias;
  return FENCE_LANGUAGES.includes(normalized) ? normalized : 'plaintext';
}