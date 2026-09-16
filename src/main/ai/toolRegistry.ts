// ============================================
// WeaveMD — Agent tool registry
// ============================================
// 内置工具：listFiles / readFile / searchKB / runSkill / editBlocks / createFile / createFolder 等。
// 写工具直接执行（原铁律一已移除）。
// 数据访问全部按 ctx.userId 隔离（SECURITY：即使工具参数含 user_id，也只以 ctx.userId 为准）。
//
// S5 工具延迟加载：
// - 核心工具（5 个）：始终发送完整 JSON Schema → 缓存前缀稳定
// - 延迟工具（19 个）：仅发送名称 stub + defer_loading: true 标记
// - 当 LLM 选择调用延迟工具时，拦截 → 补充完整 schema → 重发请求
// - 重发上限 3 次，防止死循环

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
import { handleReadLocalFile } from './tools/readLocalFile';
import { handleListLocalDirectory } from './tools/listLocalDirectory';
import { handleEditLocalFile } from './tools/editLocalFileHandler';
import { handleDeleteLocalFile, deleteLocalFileSchema } from './tools/deleteLocalFile';
import { executePreviewFileRevision, previewFileRevisionSchema } from './tools/previewFileRevision';
import { handleListSkills, handleGetSkillDetails } from './tools/skillToolsHandler';

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
  ['readLocalFile', handleReadLocalFile],
  ['listLocalDirectory', handleListLocalDirectory],
  ['editLocalFile', handleEditLocalFile],
  ['deleteLocalFile', handleDeleteLocalFile],
  ['preview_file_revision', executePreviewFileRevision],
  ['list_skills', handleListSkills],
  ['get_skill_details', handleGetSkillDetails],
]);

// ---------------------------------------------------------------------------
// 工具 Schema 定义（OpenAI function JSON Schema，不变）
// ---------------------------------------------------------------------------

/** 核心工具定义缓存（模块级常量，避免每次调用重新创建 20+ 工具定义对象）。 */
const CORE_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'listFiles',
      description: '列出当前用户的全部笔记文件（名称与修改时间）。',
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
      description: '按文件 id 读取笔记内容（只读）。',
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
      description: '在知识库中检索与查询相关的片段。支持 HyDE（假设性文档检索）和多种搜索模式。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索查询短语' },
          topK: { type: 'number', description: '返回条数上限（默认 5）' },
          hyde: { type: 'boolean', description: '启用 HyDE：先让 LLM 生成假设性文档，再用其 embedding 做语义检索（适合复杂/模糊查询，默认 false）' },
          searchMode: { type: 'string', enum: ['fts5', 'vector', 'hybrid'], description: '搜索模式：fts5（纯关键词）、vector（纯向量）、hybrid（混合，默认）' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runSkill',
      description: '调用已注册技能处理输入，返回结果。',
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
    defer_loading: true,
  },
  {
    type: 'function',
    function: {
      name: 'editBlocks',
      description: '对当前文档生成定向块改写建议（仅 proposal，不落盘）。',
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
          preview: { type: 'boolean', description: '是否生成 diff 预览（默认 true）' },
        },
        required: ['block_ops'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createFile',
      description: '在工作区新建文件并写入内容。创建文件必须调用此工具。',
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
    defer_loading: true,
  },
  {
    type: 'function',
    function: {
      name: 'createFolder',
      description: '在工作区新建文件夹。',
      parameters: {
        type: 'object',
        properties: {
          folder_name: { type: 'string', description: '文件夹名称' },
          parent_path: { type: 'string', description: '父目录路径（可选，默认根目录）' },
        },
        required: ['folder_name'],
      },
    },
    defer_loading: true,
  },
  askQuestionCardSchema,
  { ...previewPatchFilesSchema, defer_loading: true },
  { ...webSearchSchema, defer_loading: true },
  { ...analyzeFolderSchema, defer_loading: true },
  { ...checkLinksSchema, defer_loading: true },
  { ...getTaskActivitySchema, defer_loading: true },
  { ...renameFileSchema, defer_loading: true },
  { ...moveFileSchema, defer_loading: true },
  { ...deleteFileSchema, defer_loading: true },
  { ...previewFileRevisionSchema, defer_loading: true },
  {
    type: 'function',
    function: {
      name: 'research_search',
      description: '研究模式搜索：拆分子查询并多轮搜索，返回综合结果。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '研究查询主题' },
          maxSubQueries: { type: 'number', description: '最大子查询数（默认 3）' },
        },
        required: ['query'],
      },
    },
  defer_loading: true,
  },
  {
    type: 'function',
    function: {
      name: 'readLocalFile',
      description: '读取本地文件系统文件（只读，限 1MB）。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件的绝对路径（如 C:/Users/xxx/Desktop/note.md）' },
        },
        required: ['file_path'],
      },
    },
  defer_loading: true,
  },
  {
    type: 'function',
    function: {
      name: 'listLocalDirectory',
      description: '列出本地目录内容。',
      parameters: {
        type: 'object',
        properties: {
          directory_path: { type: 'string', description: '目录的绝对路径（如 C:/Users/xxx/Desktop）' },
        },
        required: ['directory_path'],
      },
    },
  defer_loading: true,
  },
  {
    type: 'function',
    function: {
      name: 'editLocalFile',
      description: '编辑或创建本地文件。文件不存在时自动创建。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件的绝对路径（如 C:/Users/xxx/Desktop/note.md）' },
          new_content: { type: 'string', description: '文件的新完整内容' },
        },
        required: ['file_path', 'new_content'],
      },
    },
    defer_loading: true,
  },
  { ...deleteLocalFileSchema, defer_loading: true },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: '列出所有可用技能（名称、描述、启用状态）。',
      parameters: { type: 'object', properties: {} },
    },
    defer_loading: true,
  },
  {
    type: 'function',
    function: {
      name: 'get_skill_details',
      description: '查看指定技能的详细信息。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: '技能名称' },
        },
        required: ['skill_name'],
      },
    },
    defer_loading: true,
  },
];

// ---------------------------------------------------------------------------
// S5: 工具延迟加载（defer_loading）—— 辅助函数
// ---------------------------------------------------------------------------

/** 预构建的延迟工具名 → 完整 ToolDef 映射（模块级常量，O(1) 查找）。 */
const deferredSchemaMap = new Map<string, ToolDef>(
  CORE_TOOLS.filter((t) => t.defer_loading).map((t) => [t.function.name, t])
);

/** 预构建的延迟工具名集合（模块级常量，O(1) 查找）。 */
const deferredToolNames: ReadonlySet<string> = new Set(deferredSchemaMap.keys());

/**
 * 判断工具是否为延迟加载工具。
 * 延迟工具在 prompt 中仅发送轻量 stub，完整 schema 由 getDeferredToolSchema 按需获取。
 */
export function isDeferredTool(name: string): boolean {
  return deferredToolNames.has(name);
}

/**
 * 获取延迟工具的完整 JSON Schema。
 * 非延迟工具 / 不存在的工具返回 undefined。
 */
export function getDeferredToolSchema(name: string): ToolDef | undefined {
  return deferredSchemaMap.get(name);
}

/**
 * 获取工具的轻量 stub（仅名称 + 描述，不含完整 parameters schema）。
 * stub 在 prompt 中代替完整 schema，减少缓存前缀体积。
 * 非延迟工具返回 undefined（不应为其生成 stub）。
 */
export function getToolStub(name: string): ToolDef | undefined {
  const full = deferredSchemaMap.get(name);
  if (!full) return undefined;
  return {
    type: 'function',
    function: {
      name: full.function.name,
      description: full.function.description,
      parameters: { type: 'object', properties: {} },
    },
    defer_loading: true,
  };
}

/**
 * 构建发往 LLM prompt 的工具列表：
 * - 核心工具（defer_loading 非 true）：保留完整 JSON Schema
 * - 延迟工具（defer_loading: true）：替换为轻量 stub
 * - 保持原有顺序不变（字母序由 defineCoreTools 保证）
 */
export function buildToolListForPrompt(tools: ToolDef[]): ToolDef[] {
  return tools.map((t) => {
    if (t.defer_loading) {
      return getToolStub(t.function.name) ?? t;
    }
    return t;
  });
}

/** 定义只读核心工具（OpenAI function JSON Schema）。含 editBlocks（仅产改写建议，不落盘）。
 *  返回按 function.name 字母序排序的副本，确保每次缓存前缀一致（S5/S7）。 */
export function defineCoreTools(): ToolDef[] {
  return [...CORE_TOOLS].sort((a, b) =>
    a.function.name.localeCompare(b.function.name)
  );
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
