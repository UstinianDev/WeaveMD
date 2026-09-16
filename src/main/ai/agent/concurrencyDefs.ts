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
  // ==========================================
  'listLocalDirectory':    { defaultSafe: false },
  'web_search':            { defaultSafe: false },
  'research_search':       { defaultSafe: false },
  'runSkill':              { defaultSafe: false },
  'readFileRevision':      { defaultSafe: false },
  'listFileRevisions':     { defaultSafe: false },
  'getFileInfo':           { defaultSafe: false },

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