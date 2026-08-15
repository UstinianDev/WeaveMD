// ============================================
// WeaveMD — Agent tool registry (read-only)
// ============================================
// 内置只读工具：listFiles / readFile / searchKB / runSkill。
// 铁律一：无任何写工具（无 editBlocks / 无写盘）——本轮 Agent 无直接落盘能力。
// 数据访问全部按 ctx.userId 隔离（SECURITY：即使工具参数含 user_id，也只以 ctx.userId 为准）。

import type { IKbSearchResult, ToolDef } from '@shared/ai';
import { getFile, listFiles } from '../db/files';
import { runSkill, type CoreSkill, type SkillRunnerCtx } from './skillLoader';

export type ToolStatus = 'ok' | 'error';

export interface ToolResult {
  content: string;
  status: ToolStatus;
  errorDesc?: string;
}

/**
 * KB 检索本地接口（契约，勿 import 并行智能体正在实现的 kbSearch.ts）。
 * 由 agentLoop 注入实际实现，test 注入 mock。
 */
export type SearchKbFn = (
  userId: string,
  query: string,
  opts?: {
    topK?: number;
    vectorEnabled?: boolean;
    pinnedWeight?: number;
    threshold?: number;
  }
) => Promise<{
  refused: boolean;
  threshold: number;
  best: IKbSearchResult | null;
  results: IKbSearchResult[];
}>;

export interface ToolCtx {
  userId: string;
  /** KB 检索实现注入点（未注入则 searchKB 返回「知识库未就绪」）。 */
  searchKb?: SearchKbFn;
  /** runSkill 执行所需 LLM 上下文（复用 skillLoader.SkillRunnerCtx）。 */
  skill?: SkillRunnerCtx;
  /** 已加载技能列表（由调用方注入；缺省为空）。 */
  skills?: CoreSkill[];
}

/** 定义 4 个只读核心工具（OpenAI function JSON Schema）。 */
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
  ];
}

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
  const argObj = parseArgs(args);

  switch (name) {
    case 'listFiles': {
      const files = listFiles(ctx.userId);
      const list = files.map((f) => ({
        name: f.name,
        fileId: f.id,
        modifiedAt: f.modifiedAt,
      }));
      return { content: JSON.stringify(list), status: 'ok' };
    }

    case 'readFile': {
      const fileId = typeof argObj.file_id === 'string' ? argObj.file_id : '';
      if (!fileId) {
        return {
          content: '',
          status: 'error',
          errorDesc: 'readFile: 缺少 file_id',
        };
      }
      const file = getFile(fileId, ctx.userId);
      if (!file) {
        return {
          content: '',
          status: 'error',
          errorDesc: 'readFile: 文件不存在或不可访问',
        };
      }
      return {
        content: JSON.stringify({
          name: file.name,
          content: file.content,
          modifiedAt: file.modifiedAt,
        }),
        status: 'ok',
      };
    }

    case 'searchKB': {
      if (!ctx.searchKb) {
        return {
          content: '',
          status: 'error',
          errorDesc: 'searchKB: 知识库未就绪',
        };
      }
      const query = typeof argObj.query === 'string' ? argObj.query : '';
      if (!query) {
        return { content: '', status: 'error', errorDesc: 'searchKB: 缺少 query' };
      }
      const topK = typeof argObj.topK === 'number' ? argObj.topK : undefined;
      const res = await ctx.searchKb(ctx.userId, query, { topK });
      if (res.refused) {
        return {
          content: JSON.stringify({
            refused: true,
            threshold: res.threshold,
            best: res.best,
            message: '未找到足够相关的来源',
          }),
          status: 'ok',
        };
      }
      return { content: JSON.stringify(res.results), status: 'ok' };
    }

    case 'runSkill': {
      const skillName = typeof argObj.skill === 'string' ? argObj.skill : '';
      const input = typeof argObj.input === 'string' ? argObj.input : '';
      if (!skillName || !input) {
        return { content: '', status: 'error', errorDesc: 'runSkill: 缺少 skill 或 input' };
      }
      if (!ctx.skill) {
        return { content: '', status: 'error', errorDesc: 'runSkill: LLM 执行上下文未就绪' };
      }
      const skill = (ctx.skills ?? []).find((s) => s.name === skillName);
      if (!skill) {
        return { content: '', status: 'error', errorDesc: `runSkill: 未找到技能 ${skillName}` };
      }
      const result = await runSkill(skill, input, ctx.skill);
      if (result.status === 'error') {
        return { content: '', status: 'error', errorDesc: result.errorDesc };
      }
      return { content: result.content, status: 'ok' };
    }

    default:
      return {
        content: '',
        status: 'error',
        errorDesc: `未知工具: ${name}`,
      };
  }
}
