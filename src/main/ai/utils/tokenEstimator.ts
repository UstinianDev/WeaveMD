// ============================================
// WeaveMD — Token Estimator (shared utility)
// ============================================
// 无 tokenizer 依赖的字量估算：CJK 字符加权 + Latin/其他字符加权。
// 从 contextManager.ts 提取，供 agent 循环和上下文管理共用。

/**
 * token 估算：无 tokenizer，按字符类型加权。
 * - CJK 字符（含扩展 A/B、兼容、韩文、日文假名）：1 字 ≈ 1~2 token，取 0.75 token/字
 * - Latin/其他：1 token ≈ 4 字符，取 0.25 token/char
 * 比统一 length/2 更准确，避免英文被高估 8 倍导致过早压缩。
 */
export function estimateTokens(text: string): number {
  const t = text || '';
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    // CJK 统一表意文字 + 扩展 A/B + 兼容 + 韩文 + 日文假名
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk * 0.75 + other * 0.25);
}
