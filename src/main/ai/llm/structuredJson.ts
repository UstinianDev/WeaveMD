// ============================================
// WeaveMD — LLM 结构化出参解析骨架（agent-multi-intent 任务 1，Q3 不引入 zod）
// ============================================
// 通用链路：trim → 剥 ```json 围栏 → JSON.parse（失败则兜底截取首个 { 到
// 最后一个 } 再解析，覆盖前后缀解说文本）→ validate 逐项严格校验（校验器负责
// 带序号错误与整批拒绝）→ 返回 T。
// 错误文案 `${label}: LLM 输出不是合法 JSON → …` 与 memory_extract /
// skill_distill 既有口径一致；直接解析失败时 reason 取首个 JSON.parse 错误，
// 保证 memory 侧既有文案逐字不变。

/** parseStructuredJson 入参。 */
export interface StructuredJsonOptions<T> {
  /** 错误前缀标签，如 'memory_extract' / 'task_plan'。 */
  label: string;
  /** 严格校验器：非法时必须 throw（整批拒绝），返回归一化结果。 */
  validate: (value: unknown) => T;
}

/** 拼装 JSON 解析失败的统一错误（文案格式为跨模块契约，不得改写）。 */
function jsonParseError(label: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`${label}: LLM 输出不是合法 JSON → ${reason}`);
}

/** 解析 LLM 结构化出参并交校验器严格校验。 */
export function parseStructuredJson<T>(raw: string, opts: StructuredJsonOptions<T>): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    // 兜底：前后缀解说文本 → 截取首个 { 到最后一个 } 再解析；
    // 截取失败或再次解析失败，一律抛首个解析错误（保持既有错误文案）。
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        throw jsonParseError(opts.label, error);
      }
    } else {
      throw jsonParseError(opts.label, error);
    }
  }

  return opts.validate(parsed);
}
