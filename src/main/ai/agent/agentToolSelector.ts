// ============================================
// WeaveMD — Agent Tool Selector
// ============================================
// 从 agentLoop.ts 提取：工具选择逻辑（按意图决定可用工具子集）。
// 纯函数，不依赖 IPC / 数据库。

import type { IIntent, ToolDef } from '@shared/ai';
import { defineCoreTools } from '../toolRegistry';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 只读工具集合（无副作用，可并行执行）。 */
export const READ_ONLY_TOOLS = new Set([
  'listFiles', 'readFile', 'searchKB', 'readFileRevision',
  'listFileRevisions', 'getFileInfo', 'readLocalFile', 'listLocalDirectory',
  'analyze_folder', 'check_links', 'get_task_activity', 'web_search',
  'editBlocks',
  'research_search',
  'list_skills', 'get_skill_details',
]);

/** 写入工具集合（有副作用，需串行执行 + 预览通知）。 */
export const WRITE_TOOLS = new Set([
  'createFile', 'createFolder', 'renameFile', 'moveFile',
  'deleteFile', 'editLocalFile', 'deleteLocalFile',
]);

// ---------------------------------------------------------------------------
// 工具选择
// ---------------------------------------------------------------------------

/**
 * 按意图决定可用工具子集。
 * - ask_question_card 仅在有交互暂停/恢复回调时提供（避免无回调时 LLM 调用导致卡死）。
 * - searchKB 仅在「kbQa 意图 + 启用知识库」时提供。
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
  hasSearchConfig = false
): ToolDef[] {
  const all = defineCoreTools();
  const names = new Set<string>();

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

  // Agentic RAG：web_search 对所有非 chat 意图可用（与 searchKB 模式对齐）
  // 让 LLM 自主决定是否需要联网搜索，而非由意图路由硬性限制
  // 仅在用户已配置搜索服务时注入，避免 LLM 调用注定失败的工具
  if (hasSearchConfig) {
    names.add('web_search');
    names.add('research_search');
  }

  switch (intent.intent) {
    case 'chat':
      // 闲聊意图：不提供任何工具，LLM 直接回答
      return [];
    case 'kbQa':
      if (useKnowledgeBase && kbEgressAuthorized) {
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
      if (useKnowledgeBase && kbEgressAuthorized) {
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
      if (useKnowledgeBase && kbEgressAuthorized) {
        names.add('searchKB');
      }
      break;
    case 'web':
      // web_search 和 research_search 已在基础工具集中
      // Agentic RAG：web 意图也可自主检索知识库
      if (useKnowledgeBase && kbEgressAuthorized) {
        names.add('searchKB');
      }
      break;
    default:
      break;
  }

  return all.filter((t) => names.has(t.function.name));
}
