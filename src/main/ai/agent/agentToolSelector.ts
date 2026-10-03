// ============================================
// WeaveMD — Agent Tool Selector
// ============================================
// 从 agentLoop.ts 提取：工具选择逻辑（按意图决定可用工具子集）。
// 纯函数，不依赖 IPC / 数据库。

import type { IIntent, ToolDef } from '@shared/ai';
import { defineCoreTools, buildToolListForPrompt } from '../toolRegistry';
// 任务 13（Q23）：写工具清单以 confirmMatrix 为唯一权威，本文件从其常量派生再导出
//（方向倒置：原 confirmMatrix→agentToolSelector 的 import 已移除，防循环）。
import { CONFIRM_BATCH_TOOLS, CONFIRM_FORCE_TOOLS } from './confirmMatrix';

// Re-export per-invocation concurrency safety (step toward S2 granular partition)
export { isToolConcurrencySafe } from './concurrencyDefs';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 只读工具集合（无副作用，可并行执行）。B8 六-1②：陈旧名已清理 + 文档四工具入区。 */
export const READ_ONLY_TOOLS = new Set([
  'listFiles', 'readFile', 'searchKB',
  'readLocalFile', 'listLocalDirectory',
  'analyze_folder', 'check_links', 'get_task_activity', 'web_search',
  'editBlocks',
  'research_search',
  'list_skills', 'get_skill_details',
  // B8 文档工具集（只读）
  'searchDocument', 'readPage', 'extractTable', 'analyzeChart',
]);

/**
 * 写入工具集合（有副作用，需串行执行 + 预览通知）。
 * 任务 13（Q23）：从 confirmMatrix 权威常量派生，成员逐一不变（7 项，
 * 既有引用方与测试零改动；顺序按原常量声明序保持）。
 */
export const WRITE_TOOLS = new Set([
  ...CONFIRM_BATCH_TOOLS,
  ...CONFIRM_FORCE_TOOLS,
]);

/**
 * 强制确认工具集合（硬编码拦截，不依赖 LLM 自觉，删除操作不可恢复）。
 * 任务 13：从 confirmMatrix.CONFIRM_FORCE_TOOLS 派生再导出，成员逐一不变；
 * 确认档位以 confirmMatrix.confirmTierFor 为准（任务 11）。
 */
export const FORCE_CONFIRM_TOOLS = new Set(CONFIRM_FORCE_TOOLS);

// ---------------------------------------------------------------------------
// 工具选择
// ---------------------------------------------------------------------------

/**
 * 工具子集记忆化（性能：TOOL-1）。
 *
 * 键空间是**封闭且很小**的：`intent.intent`（6 值）× 6 个布尔开关 = 至多 384 种组合，
 * 且开关全部来自每轮不变的会话上下文。`toolsForIntent` 却在每次
 * `prepareAgentContext` / 每子任务切换 / 每个并行分支都重跑一遍全量构建。
 *
 * 缓存值同样是「函数输出的完整内容」；返回时**浅拷贝一层数组** ——
 * `agentLoop` 的延迟工具升级会把 `ctx.tools[idx]` **原地替换**成完整 schema
 * （见 agentLoop.ts 的 stub 升级段），共享同一个数组实例会把这个改写泄给下一次调用。
 * 元素对象本身只被替换、从不原地改写，故可安全共享。
 */
const TOOL_SUBSET_CACHE = new Map<string, readonly ToolDef[]>();

/** 记忆化键：只取真正参与分支的 `intent.intent`（confidence/reason 不参与工具选择）。 */
function toolSubsetKey(
  intent: IIntent,
  useKnowledgeBase: boolean,
  kbEgressAuthorized: boolean,
  hasCurrentDocument: boolean,
  hasInteractionSupport: boolean,
  hasSearchConfig: boolean,
  kbAttachmentEgressGranted: boolean
): string {
  return [
    intent.intent,
    useKnowledgeBase ? 1 : 0,
    kbEgressAuthorized ? 1 : 0,
    hasCurrentDocument ? 1 : 0,
    hasInteractionSupport ? 1 : 0,
    hasSearchConfig ? 1 : 0,
    kbAttachmentEgressGranted ? 1 : 0,
  ].join('|');
}

/**
 * 按意图决定可用工具子集。
 * - ask_question_card 仅在有交互暂停/恢复回调时提供（避免无回调时 LLM 调用导致卡死）。
 * - searchKB 仅在「启用知识库 + (kbEgressAuthorized 或 勾选授权附件存在)」时提供。
 *   B11 八-1②：`kbEgressAuthorized`（= allowSend）不变；`kbAttachmentEgressGranted`
 *   表示该用户存在勾选授权的附件文档（勾选=该文档显式授权，不追溯放宽其他笔记）——
 *   此时注入的 searchKB 结果由过滤层收敛到授权附件（agentTaskWorker.searchKb 闭包）。
 * - editBlocks 在 rewrite/create/tech 意图 + 有 currentDocument 时提供（create/tech 用于创作写入）。
 * - createFile/createFolder 在 create/tech 意图时提供（直接写盘）。
 * - listFiles/readFile/runSkill 在 create/tech 意图时提供，rewrite 意图也提供（需看文件才能改）。
 */
export function toolsForIntent(
  intent: IIntent,
  useKnowledgeBase: boolean,
  kbEgressAuthorized: boolean,
  currentDocument?: string,
  hasInteractionSupport = false,
  hasSearchConfig = false,
  kbAttachmentEgressGranted = false
): ToolDef[] {
  const key = toolSubsetKey(
    intent,
    useKnowledgeBase,
    kbEgressAuthorized,
    !!currentDocument,
    hasInteractionSupport,
    hasSearchConfig,
    kbAttachmentEgressGranted
  );
  const cached = TOOL_SUBSET_CACHE.get(key);
  if (cached) return [...cached];

  const kbSearchAllowed = kbEgressAuthorized || kbAttachmentEgressGranted;
  const all = defineCoreTools();
  const names = new Set<string>();

  /** 收敛出口：按名集过滤 → stub 化 → 写入记忆化 → 返回独立数组副本。 */
  const finish = (): ToolDef[] => {
    const built = buildToolListForPrompt(all.filter((t) => names.has(t.function.name)));
    TOOL_SUBSET_CACHE.set(key, built);
    return [...built];
  };

  // ask_question_card 仅在有暂停/恢复回调时可用（直接 IPC 调用无回调，不提供）
  if (hasInteractionSupport) {
    names.add('ask_question_card');
  }

  // 所有意图都可用的基础工具（文件访问 + 目录浏览 + 本地文件系统读写 + 辅助只读）
  names.add('listFiles');
  names.add('readFile');
  names.add('readLocalFile');
  names.add('listLocalDirectory');
  names.add('editLocalFile');
  names.add('deleteLocalFile');
  names.add('analyze_folder');
  names.add('check_links');
  names.add('get_task_activity');
  names.add('list_skills');
  names.add('get_skill_details');
  // B8 六-1：文档四工具对所有意图可用（与 readLocalFile 同为只读基础区）
  names.add('searchDocument');
  names.add('readPage');
  names.add('extractTable');
  names.add('analyzeChart');
  // C1（Q7）：记忆读写对所有意图无条件可用——记忆是跨意图的慢思考回路，
  // chat 意图同样要能读回/写入画像，故放在 switch 之前的基础区
  names.add('memory_read');
  names.add('memory_write');

  // Agentic RAG：web_search 对所有非 chat 意图可用（与 searchKB 模式对齐）
  // 让 LLM 自主决定是否需要联网搜索，而非由意图路由硬性限制
  // 仅在用户已配置搜索服务时注入，避免 LLM 调用注定失败的工具
  if (hasSearchConfig) {
    names.add('web_search');
    names.add('research_search');
  }

  switch (intent.intent) {
    case 'chat':
      // 闲聊意图：仅在有交互支持时提供 ask_question_card（模糊输入可能需要澄清）
      // 若无交互支持则不给任何工具，LLM 直接回答
      if (hasInteractionSupport) {
        names.add('ask_question_card');
      }
      return finish();
    case 'kbQa':
      if (useKnowledgeBase && kbSearchAllowed) {
        names.add('searchKB');
      }
      break;
    case 'rewrite':
      names.add('runSkill');
      names.add('renameFile');
      names.add('moveFile');
      names.add('deleteFile');
      if (currentDocument) {
        names.add('editBlocks');
      }
      // Agentic RAG：rewrite 意图也可自主检索知识库
      if (useKnowledgeBase && kbSearchAllowed) {
        names.add('searchKB');
      }
      break;
    case 'create':
    case 'tech':
      names.add('runSkill');
      names.add('createFile');
      names.add('createFolder');
      names.add('renameFile');
      names.add('moveFile');
      names.add('deleteFile');
      names.add('preview_file_revision');
      names.add('preview_patch_files');
      if (currentDocument) {
        names.add('editBlocks');
      }
      // Agentic RAG：create/tech 意图也可自主检索知识库
      if (useKnowledgeBase && kbSearchAllowed) {
        names.add('searchKB');
      }
      break;
    case 'web':
      // web_search 和 research_search 已在基础工具集中
      // Agentic RAG：web 意图也可自主检索知识库
      if (useKnowledgeBase && kbSearchAllowed) {
        names.add('searchKB');
      }
      break;
    default:
      break;
  }

  return finish();
}
