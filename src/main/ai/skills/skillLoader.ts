// ============================================
// WeaveMD — Skill loader & runner (Agent)
// ============================================
// 内置 3 个 core skill 随代码注册（结构化对象，非磁盘文件）；
// 用户扩展从 userData/skills/<name>/SKILL.md 读取（front-matter + 正文）。
// runSkill 复用 llmClient 走一次纯生成（嵌套一次非循环，防递归）。
// 无写盘、无密钥外发；全在主进程执行。

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { AgentSkillInfo, IntentName } from '@shared/ai';
import { streamChatCompletion } from '../llm/llmClient';
import { streamAnthropicCompletion } from '../llm/anthropicClient';
import { EXPERIENCE_INTENTS } from '../agent/agentPromptBuilder';
import { AUTO_SKILLS_DIR_NAME, getDefaultSkillDirs } from './skillPaths';

/** 单技能定义：执行时把 instructions 注入 role:'system' 片段。 */
export interface CoreSkill {
  name: string;
  description: string;
  /** 注入 system 的指令正文。 */
  instructions: string;
  /** 可选参数 JSON Schema（OpenAI parameters）。 */
  argsSchema?: Record<string, unknown>;
  /**
   * 提炼状态（六.1 草稿态）：`draft` = 未确认，**绝不生效**；`active` = 已确认生效。
   * 内置 core 与普通手写技能不写该字段（undefined 视为生效，兼容既有格式）。
   */
  status?: 'draft' | 'active';
  /**
   * 任务类型标注（六.2 / D4）：该技能适用于哪些意图，值取自
   * {@link EXPERIENCE_INTENTS}（5 个显式规则意图，**不含 chat**）。
   * - `undefined` = 未标注 → 注入侧按 description/name 关键词推断；
   * - `[]` = 标注了但无合法值 → 视为「已标注却不适用」，不注入也不推断。
   */
  intents?: IntentName[];
}

/** runSkill 所需的 LLM 调用上下文（与工具执行器解耦）。 */
export interface SkillRunnerCtx {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** LLM 协议分流：anthropic 走 /v1/messages，缺省 openai。 */
  protocol?: 'openai' | 'anthropic';
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

/**
 * 归一化扫描目录入参。
 * - 不传 → 默认目录（`getDefaultSkillDirs()`，必含 userData/skills；非 Electron 环境为 []）
 * - 传字符串 → 单目录；传数组 → 按序扫描
 */
function normalizeDirs(dirs?: string | string[]): string[] {
  if (dirs === undefined) return getDefaultSkillDirs();
  if (typeof dirs === 'string') return dirs ? [dirs] : [];
  return dirs;
}

/**
 * 同名冲突检测：保留**先出现**的技能，跳过后出现者并 `console.warn`。
 * 顺序 = 内置 core → 各扫描目录（目录内 mode1 子目录 → mode2 扁平 → mode3 `_auto`）。
 * req Q5：`scanUserSkillsDir` 原本不去重，冲突静默覆盖会造成「改了文件却不生效」的假象。
 */
function dedupeSkills(skills: CoreSkill[], where: string): CoreSkill[] {
  const seen = new Set<string>();
  const out: CoreSkill[] = [];
  for (const skill of skills) {
    if (seen.has(skill.name)) {
      console.warn(`[skillLoader] 技能名冲突，跳过重复项: ${skill.name}`, { where });
      continue;
    }
    seen.add(skill.name);
    out.push(skill);
  }
  return out;
}

/**
 * 加载技能：内置 core + 用户/提炼技能。
 * `dirs` 缺省时走默认目录 —— 这是「3 处无参 loadSkills() 只拿到内置 3 个」的根因修复：
 * agentContext / skillManager 由此才看得到 userData/skills（含 `_auto/`）里的技能。
 */
export function loadSkills(dirs?: string | string[]): CoreSkill[] {
  const scanDirs = normalizeDirs(dirs);
  const userExt = scanDirs.length > 0 ? loadUserSkillsFromDirs(scanDirs) : [];
  return dedupeSkills([...CORE_SKILLS, ...userExt], 'loadSkills');
}

/** 扫描多个目录下的用户扩展技能，去重（按 name，重名 console.warn 后跳过后者）。 */
export function loadUserSkillsFromDirs(dirs: string[]): CoreSkill[] {
  const skills: CoreSkill[] = [];
  for (const dir of dirs) {
    skills.push(...scanUserSkillsDir(dir));
  }
  return dedupeSkills(skills, 'loadUserSkillsFromDirs');
}

/**
 * 渲染侧技能清单（第 7 期 B1 补全菜单数据源）。
 * 返回 [{name, description}]——仅名称+描述，**不含 instructions/argsSchema/status**，
 * 避免把执行指令/参数细节经 IPC 外泄到渲染进程。
 * 目录缺省时走默认目录；目录不可读/不存在不抛错。
 */
export function listSkillsForUi(dirs?: string | string[]): AgentSkillInfo[] {
  const skills = loadSkills(dirs);
  return skills.map((s) => ({ name: s.name, description: s.description }));
}

/**
 * 扫描用户 skills 目录，支持三种结构：
 * 1. `<dir>/<name>/SKILL.md` — 子目录 + SKILL.md（标准格式）
 * 2. `<dir>/<name>.md` — 扁平 .md 文件（文件名即 skill 名）
 * 3. `<dir>/_auto/<name>.md` — 提炼生效技能（**仅 status: active 生效**；`_auto/_drafts/` 不扫）
 * front-matter 格式：开篇 `---` 块，`name:` / `description:` 键；正文作 instructions；
 * 可选 `args:` 块（JSON Schema）、`status:`（draft | active）与 `intents:`（任务类型标注，D4）。
 * 任意位置的 `status: draft` 一律不加载 —— 草稿绝不进入 prompt / list_skills / runSkill。
 */
function scanUserSkillsDir(dir: string): CoreSkill[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // 目录不存在 / 不可读 -> 无用户扩展
    return [];
  }

  const skills: CoreSkill[] = [];

  // 模式 1：子目录 + SKILL.md
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skill = parseSkillFile(entry.name, join(dir, entry.name, 'SKILL.md'));
      if (skill) skills.push(skill);
    }
  }

  // 模式 2：扁平 .md 文件（文件名去掉 .md 后缀即 skill 名）
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
      const skillName = entry.name.slice(0, -3); // 去掉 .md
      const skill = parseSkillFile(skillName, join(dir, entry.name));
      if (skill) skills.push(skill);
    }
  }

  // 模式 3：_auto/ 提炼生效技能（子目录 `_drafts` 不在 readdir 的 isFile 分支，天然被排除）
  skills.push(...scanAutoSkillsDir(join(dir, AUTO_SKILLS_DIR_NAME)));

  // 草稿（status: draft）一律不生效；冲突检测与去重由上层 dedupeSkills 统一处理。
  // 此处静默跳过（草稿是预期内状态，每次加载都 warn 会刷屏；异常态 warn 在 scanAutoSkillsDir）
  return skills.filter((skill) => skill.status !== 'draft');
}

/**
 * 扫描 `_auto/` 目录：**只有 `status: active` 才生效**（req 双重防线 ——
 * 草稿目录本身表示 draft，文件被手工挪进 `_auto/` 也必须 status 才算生效）。
 * 只读 `_auto/` 自身的 `.md` 文件，不递归子目录（`_drafts/` 因此永不进入）。
 */
function scanAutoSkillsDir(autoDir: string): CoreSkill[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(autoDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: CoreSkill[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const skillName = entry.name.slice(0, -3);
    const skill = parseSkillFile(skillName, join(autoDir, entry.name));
    if (!skill) continue;
    if (skill.status !== 'active') {
      console.warn(`[skillLoader] _auto 目录内技能未标 status: active，不生效`, {
        name: skill.name,
        autoDir,
      });
      continue;
    }
    skills.push(skill);
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
  return parseSkillMarkdown(raw, dirName);
}

/**
 * 解析一份技能 Markdown（front-matter + 正文）—— skillLoader 与 skillAutoStore 共用同一口径。
 * @param fallbackName front-matter 缺 `name:` 时的兜底（扁平 .md 用文件名、子目录用目录名）
 */
export function parseSkillMarkdown(raw: string, fallbackName = ''): CoreSkill | null {
  const front = parseFrontMatter(raw);
  const name = (front.meta.name || fallbackName).trim();
  if (!name) return null;
  const description = (front.meta.description || '').trim();
  const argsRaw = front.meta.args && front.meta.args.trim() ? front.meta.args : undefined;
  const argsSchema = argsRaw
    ? (safeJsonParse(argsRaw) as Record<string, unknown> | null) ?? undefined
    : undefined;
  const status = parseStatus(front.meta.status);
  const intents = parseIntents(front.meta.intents, name);
  return {
    name,
    description,
    instructions: front.body.trim(),
    argsSchema,
    ...(status ? { status } : {}),
    ...(intents ? { intents } : {}),
  };
}

/**
 * 解析 front-matter 的可选 `intents:`（六.2 / D4 任务类型标注）。
 * 两种写法等价：逗号分隔 `rewrite, kbQa` 或 JSON 数组 `["rewrite","kbQa"]`
 * （统一去括号去引号后按逗号切分，与本文件既有的轻量解析风格一致，不引入 JSON 依赖）。
 *
 * - 值必须落在 {@link EXPERIENCE_INTENTS} 白名单（**5 个显式规则意图，chat 不合法**——
 *   它是无规则 fallback，注入侧一律不注入，裁定 3）；
 * - **非法值忽略并 `console.warn`**，合法值保留；
 * - **字段缺失 → `undefined`**（未标注 → 注入侧按 description/name 推断）；
 * - 字段存在但全部非法 → `[]`（已标注却不适用 → 不注入也不推断，避免误推断）。
 */
function parseIntents(raw: string | undefined, skillName: string): IntentName[] | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;

  const body = text.replace(/^\[/, '').replace(/\]$/, '');
  const allowed = EXPERIENCE_INTENTS as readonly string[];
  const out: IntentName[] = [];
  const invalid: string[] = [];
  for (const piece of body.split(',')) {
    const value = piece.replace(/^["'\s]+|["'\s]+$/g, '');
    if (!value) continue;
    if (allowed.includes(value)) {
      if (!out.includes(value as IntentName)) out.push(value as IntentName);
    } else {
      invalid.push(value);
    }
  }
  if (invalid.length > 0) {
    console.warn('[skillLoader] intents 含非法或不可注入的值，已忽略', {
      skill: skillName,
      ignored: invalid,
      allowed,
    });
  }
  return out;
}

/** front-matter `status:` 白名单解析：只认 draft / active，其余一律视为未声明。 */
function parseStatus(raw: string | undefined): 'draft' | 'active' | undefined {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'draft') return 'draft';
  if (value === 'active') return 'active';
  return undefined;
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
    const opts = {
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      apiKey: ctx.apiKey,
      messages: [
        { role: 'system' as const, content: skill.instructions },
        { role: 'user' as const, content: input },
      ],
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    };
    // 纯文本生成（不带 tools），按协议分流
    const gen =
      ctx.protocol === 'anthropic'
        ? streamAnthropicCompletion(opts)
        : streamChatCompletion(opts);
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
