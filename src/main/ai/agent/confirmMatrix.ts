// ============================================
// WeaveMD — 风险分档确认矩阵（agent-multi-intent 任务 11，任务 13 权威收敛）
// ============================================
// intent × tool 三档确认矩阵（纯函数，Q13/Q14 裁定「代码矩阵为准」；Q23 裁定
// confirmMatrix 为写工具清单**唯一权威**——agentToolSelector 的 WRITE_TOOLS /
// FORCE_CONFIRM_TOOLS 从本文件常量派生再导出，方向倒置，本文件不依赖 selector）：
//   - force：deleteFile / deleteLocalFile —— 任何 intent 恒强制确认卡（现
//     FORCE_CONFIRM_TOOLS 语义等价，拦截强度只强不弱）；
//   - batch：WRITE_TOOLS 其余 5 项 —— 任何 intent 均不得返回 'none'（铁律一
//     不削弱：写入必经确认，单意图保持现状 preview 路径，多写子任务链链末汇总）；
//   - none ：已登记只读/非写工具 —— 不进确认拦截（memory_write 维持现口径，
//     不进强制档，见 docs/architecture/ai-agent.md 写控制）。
// fail-closed：未知 intent、未登记工具名 → 'batch'（只向确认方向兜底，
// 禁止向放行方向兜底；删除类即使 intent 未知仍恒 'force'）。
// 禁止分叉（Q14）：提示词一致性由 tests/main/ai/agentToolExecutor.test.ts
// 「确认矩阵」describe 钉死；清单交叉断言见 writeModeConsumption.test.ts ⑤。

import type { IntentName } from '@shared/ai';

/** 确认档位：none = 不拦截；batch = 汇总/现状确认；force = 单工具强制确认卡。 */
export type ConfirmTier = 'none' | 'batch' | 'force';

// ---------------------------------------------------------------------------
// 权威常量（Q23：本文件是写工具清单唯一权威）
// ---------------------------------------------------------------------------

/** force 档权威常量（删除类，任何 intent 恒强制确认卡）。 */
export const CONFIRM_FORCE_TOOLS: ReadonlySet<string> = new Set([
  'deleteFile',
  'deleteLocalFile',
]);

/** batch 档权威常量（WRITE_TOOLS 其余 5 项：执行 + 确认，不返回 'none'）。 */
export const CONFIRM_BATCH_TOOLS: ReadonlySet<string> = new Set([
  'createFile',
  'createFolder',
  'renameFile',
  'moveFile',
  'editLocalFile',
]);

/** 合法意图全集（6 值；运行期出现未知值即 fail-closed 到 'batch'）。 */
const KNOWN_INTENTS: ReadonlySet<string> = new Set<IntentName>([
  'create', 'rewrite', 'kbQa', 'tech', 'web', 'chat',
]);

/**
 * 已登记非写工具（= toolRegistry 30 项 − 写工具 7 项 = 23 项）：确认档 'none'。
 * 显式枚举（不 spread agentToolSelector.READ_ONLY_TOOLS——方向倒置后本文件
 * 不得依赖 selector；交叉测试钉死 READ_ONLY_TOOLS ⊆ 本集合，见
 * writeModeConsumption.test.ts ⑤）：
 *   只读 17 项（与 selector.READ_ONLY_TOOLS 逐一对应）+ 交互/技能/记忆/预览 6 项；
 *   memory_write 在此维持现口径（铁律一仅约束笔记/文件写入，记忆后台写入不逐条确认）。
 */
const KNOWN_NON_WRITE_TOOLS: ReadonlySet<string> = new Set([
  // ---- 只读 17 项（＝ agentToolSelector.READ_ONLY_TOOLS，交叉断言钉同）----
  'listFiles', 'readFile', 'searchKB',
  'readLocalFile', 'listLocalDirectory',
  'analyze_folder', 'check_links', 'get_task_activity', 'web_search',
  'editBlocks',
  'research_search',
  'list_skills', 'get_skill_details',
  'searchDocument', 'readPage', 'extractTable', 'analyzeChart',
  // ---- 交互/技能/记忆/预览 6 项 ----
  'ask_question_card',
  'runSkill',
  'memory_read',
  'memory_write',
  'preview_file_revision',
  'preview_patch_files',
]);

/**
 * 确认档位判定（矩阵唯一权威入口）。
 * 顺序：force（删除恒拦截）→ batch（写档）→ 已登记非写（none）→ 兜底 batch。
 */
export function confirmTierFor(intent: IntentName, tool: string): ConfirmTier {
  if (CONFIRM_FORCE_TOOLS.has(tool)) return 'force';
  if (CONFIRM_BATCH_TOOLS.has(tool)) return 'batch';
  if (KNOWN_NON_WRITE_TOOLS.has(tool) && KNOWN_INTENTS.has(intent)) return 'none';
  return 'batch';
}

/**
 * 写工具按档拆分（提示词/确认卡文案的单一数据源）。
 * 任务 13：直接读自身权威常量（成员/顺序与原「遍历 WRITE_TOOLS 再判档」逐字节一致）。
 */
export function writeToolsByTier(): { force: string[]; batch: string[] } {
  return {
    force: [...CONFIRM_FORCE_TOOLS],
    batch: [...CONFIRM_BATCH_TOOLS],
  };
}

/**
 * 已登记工具判定（矩阵三集合并集 = toolRegistry 30 项）。
 * 未登记名由 `confirmTierFor` fail-closed 到 'batch'；skip-set 派生与
 * 单意图放行均按「未登记」口径向确认方向兜底（连通性报告 §6）。
 */
export function isRegisteredConfirmTool(tool: string): boolean {
  return (
    CONFIRM_FORCE_TOOLS.has(tool) ||
    CONFIRM_BATCH_TOOLS.has(tool) ||
    KNOWN_NON_WRITE_TOOLS.has(tool)
  );
}

/**
 * `StreamingToolExecutor.waitForAll(skip-set)` 派生（计划 §1.6 消费点）：
 * 按本轮实际工具名逐个调用 `confirmTierFor` 判档，不按写工具集合枚举
 * （枚举会遗漏未登记名，令流式路径绕过矩阵 fail-closed）：
 *   - tier 'none'（已登记只读/非写）→ 不入 skip（现行为）；
 *   - 未登记名（confirmTierFor 兜底 'batch'）→ 恒入 skip，留给
 *     checkForceConfirmTools 分派（流式路径不再直通执行）；
 *   - 已登记保持 inChain 现语义：force 恒入（现 FORCE_CONFIRM_TOOLS 行为）、
 *     batch 链态入（收集写批次，链末一次汇总确认）、非链态走现状路径不改。
 * 任务 13：本函数输出保持与任务 11 逐字节等价（confirmMatrix.test 103-129 钉死）；
 * 无交互拒写 / manual 逐写的 caller 侧补强在 agentLoop.computeRoundSkipSet，
 * 不改本函数。
 * @param toolNames 本轮实际出现的工具名（返回集合仅含其中成员）。
 */
export function confirmSkipSet(
  intent: IntentName,
  inChain: boolean,
  toolNames: Iterable<string>
): Set<string> {
  const skip = new Set<string>();
  for (const name of toolNames) {
    const tier = confirmTierFor(intent, name);
    if (tier === 'none') continue;
    if (tier === 'force') {
      skip.add(name);
      continue;
    }
    // batch 档：未登记名恒入（fail-closed）；已登记按 inChain 现语义（链态入）
    if (!isRegisteredConfirmTool(name) || inChain) skip.add(name);
  }
  return skip;
}
