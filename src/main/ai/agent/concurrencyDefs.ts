// ============================================
// WeaveMD — Per-Invocation Concurrency Safety Definitions
// ============================================
// 替代静态 READ_ONLY_TOOLS/WRITE_TOOLS 分区的 per-invocation 并发安全判断。
// 阶段 1 仅覆盖 TOP10 高频工具（fail-closed：未知/未审核工具默认串行）。
// 阶段 2 将补全所有只读工具的 defaultSafe=true。

export interface ConcurrencyDef {
  /** 默认并发安全性。阶段 1 仅 TOP10 为 true，其余 false。 */
  defaultSafe: boolean;
  /** 可选：基于 args 的细粒度判断（阶段 2 使用）。 */
  checkArgs?: (args: Record<string, unknown>) => boolean;
}

const CONCURRENCY_DEFS: Record<string, ConcurrencyDef> = {
  // ==========================================
  // TOP10 高频工具 — 并发安全（只读或 proposal-only）
  // ==========================================
  'listFiles':             { defaultSafe: true },
  'readFile':              { defaultSafe: true },
  'searchKB':              { defaultSafe: true },
  'editBlocks':            { defaultSafe: true },   // 只产 proposal，无副作用
  'list_skills':           { defaultSafe: true },
  'get_skill_details':     { defaultSafe: true },
  'analyze_folder':        { defaultSafe: true },
  'check_links':           { defaultSafe: true },
  'get_task_activity':     { defaultSafe: true },
  'readLocalFile':         { defaultSafe: true },

  // ==========================================
  // 其余只读工具 — 阶段 2 补全（当前串行执行）
  // B8 六-1②：陈旧名 readFileRevision/listFileRevisions/getFileInfo 已清理
  //（不在表中 → fail-closed 串行，语义不变；避免照抄坏范式）
  // ==========================================
  'listLocalDirectory':    { defaultSafe: false },
  'web_search':            { defaultSafe: false },
  'research_search':       { defaultSafe: false },
  'runSkill':              { defaultSafe: false },

  // ==========================================
  // B8 文档四工具 — 只读并发安全（不落 fail-closed 串行陷阱）
  // ==========================================
  'searchDocument':        { defaultSafe: true },
  'readPage':              { defaultSafe: true },
  'extractTable':          { defaultSafe: true },
  'analyzeChart':          { defaultSafe: true },

  // ==========================================
  // C1 记忆两工具（agent-memory-optimize 第二批）
  // read 只读 → 并发安全；write 是写入工具，按本表「写入工具始终串行」约定显式 false
  //（显式入表而非留空：入表值可被测试断言，留空只能 fail-closed 到同一个 false）
  // ==========================================
  'memory_read':           { defaultSafe: true },
  'memory_write':          { defaultSafe: false },

  // ==========================================
  // 写入工具 — 始终串行
  // ==========================================
  'createFile':            { defaultSafe: false },
  'createFolder':          { defaultSafe: false },
  'renameFile':            { defaultSafe: false },
  'moveFile':              { defaultSafe: false },
  'deleteFile':            { defaultSafe: false },
  'editLocalFile':         { defaultSafe: false },
  'deleteLocalFile':       { defaultSafe: false },

  // ==========================================
  // 特殊工具 — 串行
  // ==========================================
  'ask_question_card':     { defaultSafe: false },
  'preview_file_revision': { defaultSafe: false },
  'preview_patch_files':   { defaultSafe: false },
};

/**
 * 判断工具名是否已显式登记在并发表中。
 * 与 `isToolConcurrencySafe` 的区别：未登记也返回 false（fail-closed 串行），
 * 二者不可区分；本函数让「已登记为串行」与「根本没登记」可被测试分辨，
 * 避免新增工具漏入表却因同样返回 false 而测不出来。
 */
export function hasConcurrencyDef(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONCURRENCY_DEFS, name);
}

/**
 * 安全解析工具 args JSON 字符串。
 * 解析失败时返回 {}（触发 fail-closed：未知/写入工具默认串行）。
 */
export function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 判断给定工具调用是否可并发执行（无副作用、可与其他工具并行）。
 *
 * - 未知工具：返回 false（fail-closed，默认串行）
 * - 已知工具：优先 checkArgs，否则使用 defaultSafe
 *
 * @param name  工具名称
 * @param args  已解析的工具参数（由 safeParseArgs 预处理）
 */
export function isToolConcurrencySafe(name: string, args: Record<string, unknown>): boolean {
  const def = CONCURRENCY_DEFS[name];
  if (!def) return false; // 未知工具默认串行
  if (def.checkArgs) return def.checkArgs(args);
  return def.defaultSafe;
}