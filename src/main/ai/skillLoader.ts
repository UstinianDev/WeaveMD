// ============================================
// WeaveMD — Skill loader & runner (Agent)
// ============================================
// 内置 3 个 core skill 随代码注册（结构化对象，非磁盘文件）；
// 用户扩展从 userData/skills/<name>/SKILL.md 读取（front-matter + 正文）。
// runSkill 复用 llmClient 走一次纯生成（嵌套一次非循环，防递归）。
// 无写盘、无密钥外发；全在主进程执行。

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { AgentSkillInfo } from '@shared/ai';
import { streamChatCompletion } from './llmClient';

/** 单技能定义：执行时把 instructions 注入 role:'system' 片段。 */
export interface CoreSkill {
  name: string;
  description: string;
  /** 注入 system 的指令正文。 */
  instructions: string;
  /** 可选参数 JSON Schema（OpenAI parameters）。 */
  argsSchema?: Record<string, unknown>;
}

/** runSkill 所需的 LLM 调用上下文（与工具执行器解耦）。 */
export interface SkillRunnerCtx {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * 内置 core skill（随代码注册）。
 * 名称/描述/指令/参数结构化，非磁盘文件。
 */
export const CORE_SKILLS: CoreSkill[] = [
  {
    name: 'polish_rewrite',
    description: '润色、缩写或扩写用户提供的文本，保持原意并优化表达。',
    instructions:
      '你是资深文字编辑。对用户输入做润色（修正语病、提升流畅度）、缩写（压缩到要点）或扩写（补充细节、丰富层次）。根据用户的明确要求选择模式；未指明时以润色为主。输出仅返回加工后的文本，不加解释。',
    argsSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['polish', 'condense', 'expand'],
          description: '加工模式：polish 润色 / condense 缩写 / expand 扩写',
        },
      },
    },
  },
  {
    name: 'tech_organize',
    description: '将零散的技术资料、笔记整理成结构化、可检索的要点。',
    instructions:
      '你是技术资料整理助手。将零散的技术笔记/资料整理为条理清晰的结构：提取关键技术点、术语定义、步骤、示例和注意事项。可输出 Markdown 标题分层与列表。忠于原文，不编造事实。',
    argsSchema: {
      type: 'object',
      properties: {
        structure: {
          type: 'string',
          enum: ['outline', 'notes', 'faq'],
          description: '输出结构：outline 大纲 / notes 条目笔记 / faq 问答',
        },
      },
    },
  },
  {
    name: 'kb_qa_guide',
    description: '基于知识库检索结果进行引导式问答，帮助用户定位信息。',
    instructions:
      '你是知识库问答引导助手。基于给定的检索片段回答用户问题：先直接给出来自片段的结论，再标注信息来源文件名；若检索片段不足，明确提出需要进一步检索的方向。答案保持简洁、忠实于片段内容。',
  },
];

/** 从 userData/skills 目录加载用户扩展技能（SKILL.md front-matter + 正文）。 */
export function loadSkills(userDataSkillsDir?: string): CoreSkill[] {
  const userExt = userDataSkillsDir ? scanUserSkillsDir(userDataSkillsDir) : [];
  return [...CORE_SKILLS, ...userExt];
}

/**
 * 渲染侧技能清单（第 7 期 B1 补全菜单数据源）。
 * 返回 [{name, description}]——仅名称+描述，**不含 instructions/argsSchema**，
 * 避免把执行指令/参数细节经 IPC 外泄到渲染进程。
 * userDataSkillsDir 缺省时仅返回内置 core skill（用户目录不可读/不存在不抛错）。
 */
export function listSkillsForUi(userDataSkillsDir?: string): AgentSkillInfo[] {
  const skills = loadSkills(userDataSkillsDir);
  return skills.map((s) => ({ name: s.name, description: s.description }));
}

/**
 * 扫描 userData/skills/<name>/SKILL.md。
 * front-matter 格式：开篇 `---` 块，`name:` / `description:` 键；正文作 instructions；
 * 可选 `args:` 块（JSON Schema）。
 */
function scanUserSkillsDir(dir: string): CoreSkill[] {
  let skillDirs: string[];
  try {
    skillDirs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // 目录不存在 / 不可读 -> 无用户扩展
    return [];
  }

  const skills: CoreSkill[] = [];
  for (const name of skillDirs) {
    const skill = parseSkillFile(name, join(dir, name, 'SKILL.md'));
    if (skill) skills.push(skill);
  }
  return skills;
}

function parseSkillFile(dirName: string, filePath: string): CoreSkill | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null; // 无 SKILL.md 或不可读 -> 跳过
  }
  const front = parseFrontMatter(raw);
  const name = (front.meta.name || dirName).trim();
  if (!name) return null;
  const description = (front.meta.description || '').trim();
  const argsRaw = front.meta.args && front.meta.args.trim() ? front.meta.args : undefined;
  const argsSchema = argsRaw
    ? (safeJsonParse(argsRaw) as Record<string, unknown> | null) ?? undefined
    : undefined;
  return { name, description, instructions: front.body.trim(), argsSchema };
}

function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  // 开篇行必须是 `---`，捕获 front-matter 块为 m[1]、其后正文为 m[2]（可空）。
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) {
    return { meta: {}, body: raw };
  }
  const meta: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      meta[key] = value.slice(1, -1);
    } else {
      meta[key] = value;
    }
  }
  return { meta, body: m[2] || '' };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * 执行单个技能：instructions 注入 system + 用户 input，走一次 llmClient 纯生成。
 * 返回结构化文本结果；失败返回 status:'error'。嵌套一次非循环。
 */
export async function runSkill(
  skill: CoreSkill,
  input: string,
  ctx: SkillRunnerCtx
): Promise<{ content: string; status: 'ok' | 'error'; errorDesc?: string }> {
  try {
    const gen = streamChatCompletion({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      apiKey: ctx.apiKey,
      messages: [
        { role: 'system', content: skill.instructions },
        { role: 'user', content: input },
      ],
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    let content = '';
    for await (const chunk of gen) {
      content += chunk.delta;
    }
    return { content: content.trim(), status: 'ok' };
  } catch (err) {
    return {
      content: '',
      status: 'error',
      errorDesc: err instanceof Error ? err.message : String(err),
    };
  }
}
