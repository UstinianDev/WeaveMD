// ============================================
// WeaveMD — Agent tool registry (read-only + proposal-only write tools)
// ============================================
// 内置只读工具：listFiles / readFile / searchKB / runSkill + editBlocks（改写建议）。
// 提案型写工具：createFile / createFolder（仅返回 proposal JSON，用户确认后渲染侧落盘）。
// 分析工具：web_search / analyze_folder / check_links / get_task_activity。
// 铁律一：无直接落盘工具——所有写路径必经预览确认。
// 数据访问全部按 ctx.userId 隔离（SECURITY：即使工具参数含 user_id，也只以 ctx.userId 为准）。

import type { ToolDef } from '@shared/ai';
import type { ToolCtx, ToolHandler, ToolResult } from './toolTypes';

// Re-export 类型保持向后兼容（agentLoop 等模块从 toolRegistry 导入）
export type { ToolCtx, ToolHandler, ToolResult, SearchKbFn, ToolStatus } from './toolTypes';

// 各工具处理器
import { handleListFiles } from './tools/listFiles';
import { handleReadFile } from './tools/readFile';
import { handleSearchKB } from './tools/searchKBHandler';
import { handleRunSkill } from './tools/runSkillHandler';
import { handleEditBlocks } from './tools/editBlocksHandler';
import { handleCreateFile } from './tools/createFileHandler';
import { handleCreateFolder } from './tools/createFolderHandler';
import { handleAskQuestionCard } from './tools/askQuestionCardHandler';
import { handlePreviewPatchFiles } from './tools/previewPatchFilesHandler';
import { handleWebSearch } from './tools/webSearchHandler';
import { handleAnalyzeFolder } from './tools/analyzeFolderHandler';
import { handleCheckLinks } from './tools/checkLinksHandler';
import { handleGetTaskActivity } from './tools/getTaskActivityHandler';
import { handleRenameFile, handleMoveFile, handleDeleteFile } from './tools/fileOperationsHandler';
import { handleResearchSearch } from './tools/researchSearchHandler';

// Schema 导入（defineCoreTools 需要）
import { askQuestionCardSchema } from './tools/askQuestionCard';
import { previewPatchFilesSchema } from './tools/previewPatchFiles';
import { webSearchSchema } from './tools/webSearch';
import { analyzeFolderSchema } from './tools/analyzeFolder';
import { checkLinksSchema } from './tools/checkLinks';
import { getTaskActivitySchema } from './tools/getTaskActivity';
import { renameFileSchema, moveFileSchema, deleteFileSchema } from './tools/fileOperations';

// ---------------------------------------------------------------------------
// 工具处理器注册表（策略模式，替代 switch-case）
// ---------------------------------------------------------------------------

const handlerMap = new Map<string, ToolHandler>([
  ['listFiles', handleListFiles],
  ['readFile', handleReadFile],
  ['searchKB', handleSearchKB],
  ['runSkill', handleRunSkill],
  ['editBlocks', handleEditBlocks],
  ['createFile', handleCreateFile],
  ['createFolder', handleCreateFolder],
  ['ask_question_card', handleAskQuestionCard],
  ['preview_patch_files', handlePreviewPatchFiles],
  ['web_search', handleWebSearch],
  ['analyze_folder', handleAnalyzeFolder],
  ['check_links', handleCheckLinks],
  ['get_task_activity', handleGetTaskActivity],
  ['renameFile', handleRenameFile],
  ['moveFile', handleMoveFile],
  ['deleteFile', handleDeleteFile],
  ['research_search', handleResearchSearch],
]);

// ---------------------------------------------------------------------------
// 工具 Schema 定义（OpenAI function JSON Schema，不变）
// ---------------------------------------------------------------------------

/** 定义只读核心工具（OpenAI function JSON Schema）。含 editBlocks（仅产改写建议，不落盘）。 */
export function defineCoreTools(): ToolDef[] {
  return [
    {
      type: 'function',
      function: {
        name: 'listFiles',
        description: '列出当前用户账号内未删除的全部笔记文件（名称与修改时间）。',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'readFile',
        description: '按文件 id 读取某个笔记的完整内容（只读，不修改）。',
        parameters: {
          type: 'object',
          properties: {
            file_id: { type: 'string', description: '目标文件 id' },
          },
          required: ['file_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'searchKB',
        description: '在账号知识库中检索与查询最相关的片段（多文档关键词/向量融合召回）。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索查询短语' },
            topK: { type: 'number', description: '返回条数上限（默认 5）' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'runSkill',
        description: '调用一个已注册技能（如润色/整理/问答引导）处理给定输入，返回加工结果。',
        parameters: {
          type: 'object',
          properties: {
            skill: { type: 'string', description: '技能名称' },
            input: { type: 'string', description: '要交由技能处理的输入文本' },
            params: { type: 'object', description: '可选技能参数' },
          },
          required: ['skill', 'input'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'editBlocks',
        description:
          '针对当前文档的定向块改写建议。仅产 proposal（applied:false），不会落盘修改文档，请基于返回的建议文本与用户确认后再告知渲染侧应用。',
        parameters: {
          type: 'object',
          properties: {
            block_ops: {
              type: 'array',
              description: '要改写的块操作列表（block_id 为渲染侧提供的稳定标识）。',
              items: {
                type: 'object',
                properties: {
                  block_id: { type: 'string', description: '目标块 id' },
                  new_content: { type: 'string', description: '改写后的块内容' },
                },
                required: ['block_id', 'new_content'],
              },
            },
          },
          required: ['block_ops'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createFile',
        description: '在工作区新建文件（仅生成提案，用户确认后才创建）。',
        parameters: {
          type: 'object',
          properties: {
            file_name: { type: 'string', description: '文件名（含扩展名，如 note.md）' },
            content: { type: 'string', description: '文件初始内容（Markdown 格式）' },
            parent_path: { type: 'string', description: '父目录路径（可选，默认根目录）' },
          },
          required: ['file_name', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createFolder',
        description: '在工作区新建文件夹（仅生成提案，用户确认后才创建）。',
        parameters: {
          type: 'object',
          properties: {
            folder_name: { type: 'string', description: '文件夹名称' },
            parent_path: { type: 'string', description: '父目录路径（可选，默认根目录）' },
          },
          required: ['folder_name'],
        },
      },
    },
    askQuestionCardSchema,
    previewPatchFilesSchema,
    webSearchSchema,
    analyzeFolderSchema,
    checkLinksSchema,
    getTaskActivitySchema,
    renameFileSchema,
    moveFileSchema,
    deleteFileSchema,
    {
      type: 'function',
      function: {
        name: 'research_search',
        description: '研究模式搜索：将查询拆分为多个子查询并执行多轮搜索，返回综合研究结果。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '研究查询主题' },
            maxSubQueries: { type: 'number', description: '最大子查询数（默认 3）' },
          },
          required: ['query'],
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 工具执行（查表调度）
// ---------------------------------------------------------------------------

/** 解析工具参数 JSON 字符串；失败返回结构错误（不抛断循环）。 */
function parseArgs(args: string): Record<string, unknown> {
  if (!args || !args.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(args);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 执行单个工具。返回结构化结果；任何步骤失败都收敛为 status:'error'，不抛断调用方循环。
 * 数据访问严格按 ctx.userId 隔离。
 */
export async function executeTool(
  name: string,
  args: string,
  ctx: ToolCtx
): Promise<ToolResult> {
  const handler = handlerMap.get(name);
  if (!handler) {
    return { content: '', status: 'error', errorDesc: `未知工具: ${name}` };
  }

  const argObj = parseArgs(args);

  try {
    return await handler(argObj, ctx);
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: err instanceof Error ? err.message : String(err),
    };
  }
}
