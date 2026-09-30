// ============================================
// WeaveMD — 提炼技能文件存储（agent-memory-optimize-3 D3 六.1）
// ============================================
// 存储选型（req Q5 裁定）：**纯文件系统、不建 DB 表**（避免 L4 迁移）。
//   userData/skills/_auto/           —— 生效技能（status: active）
//   userData/skills/_auto/_drafts/   —— 草稿（status: draft，人工确认前绝不生效）
// 沿用既有 `<name>.md` 单文件格式 + front matter（parseSkillMarkdown 与 skillLoader 同口径）。
// 安全口径（SECURITY.md「IPC」）：
//   1. 技能名必须匹配 `auto_[a-z0-9_]{2,60}`（闸一）；
//   2. 解析后的绝对路径必须仍在目标目录内（闸二，isPathInside 防目录穿越）；
//   3. 两道闸任一不过即拒绝，**不产生任何读写副作用**。
// 与铁律一解耦：草稿是后台自动产出，写盘不经逐条确认；但**生效必须经设置页人工确认**
// （approveDraftSkill 是唯一把 draft 变 active 的入口）。

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import type { IntentName } from '@shared/ai';
import { EXPERIENCE_INTENTS } from '../agent/agentPromptBuilder';
import { parseSkillMarkdown } from './skillLoader';
import {
  AUTO_SKILL_NAME_RE,
  getAutoSkillsDir,
  getDraftSkillsDir,
  isPathInside,
} from './skillPaths';

// ---------------------------------------------------------------------------
// 常量（长度阈值均为**无实测数据、待校准**，与 C1 记忆提取同量级取值）
// ---------------------------------------------------------------------------

/** description 上限（单行一句话）。 */
export const SKILL_DESCRIPTION_MAX_CHARS = 200;
/** instructions 上限（可直接执行的步骤 + 避坑小节）。 */
export const SKILL_INSTRUCTIONS_MAX_CHARS = 4000;
/** 提炼技能名前缀（避免与用户手写技能重名）。 */
export const AUTO_SKILL_NAME_PREFIX = 'auto_';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 提炼产出的最小字段（LLM 输出经 parseSkillDrafts 校验后的形状）。 */
export interface SkillDraftInput {
  name: string;
  description: string;
  instructions: string;
  /**
   * 任务类型标注（六.2 / D4）：**可选**，取值必须是 {@link EXPERIENCE_INTENTS}
   * （5 个显式规则意图）的子集；`chat` 不合法（无规则 fallback，一律不注入）。
   * 缺省 = 未标注，兼容 D3 与更早的草稿格式，注入侧走关键词推断。
   */
  intents?: IntentName[];
}

/** 磁盘上的一份技能文件（草稿或生效）。 */
export interface SkillDraftFile extends SkillDraftInput {
  status: 'draft' | 'active';
  /** front matter 的 source（恒 'auto'，用于区分提炼与手写）。 */
  source: string;
  /** 文件修改时间（ISO），供 UI 排序展示。 */
  updatedAt: string;
}

export type DraftWriteReason =
  | 'written'
  | 'duplicate'
  | 'invalid'
  | 'no_dir'
  | 'parse_error';

export interface DraftWriteResult {
  written: boolean;
  reason: DraftWriteReason;
}

export type SkillOpReason =
  | 'approved'
  | 'rejected'
  | 'not_found'
  | 'invalid_name'
  | 'name_mismatch'
  | 'no_dir'
  | 'parse_error';

export interface SkillOpResult {
  ok: boolean;
  reason: SkillOpReason;
}

// ---------------------------------------------------------------------------
// 校验（严格：任一项不合法即抛错，由调用方决定是整批拒写还是单条跳过）
// ---------------------------------------------------------------------------

/**
 * 严格校验一条提炼产出。
 * - name 必须匹配 `auto_[a-z0-9_]+`（req：正则约束、命名前缀 auto_）
 * - description 单行 1~{@link SKILL_DESCRIPTION_MAX_CHARS} 字符
 * - instructions 1~{@link SKILL_INSTRUCTIONS_MAX_CHARS} 字符
 * - intents（可选，D4）：必须是 {@link EXPERIENCE_INTENTS} 的**非空**子集，`chat` 不合法
 * 任一项不合法 → **抛错**（错误信息带字段名，便于定位）。
 */
export function assertValidSkillDraft(value: unknown, where: string): SkillDraftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where}: 不是对象`);
  }
  const rec = value as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name.trim() : '';
  if (!AUTO_SKILL_NAME_RE.test(name)) {
    throw new Error(`${where}: name 非法（须匹配 auto_[a-z0-9_]+ 且总长 ≤65，当前 "${name}"）`);
  }
  const description = typeof rec.description === 'string' ? rec.description.trim() : '';
  if (description.length < 1 || description.length > SKILL_DESCRIPTION_MAX_CHARS) {
    throw new Error(
      `${where}: description 必须为 1~${SKILL_DESCRIPTION_MAX_CHARS} 字符（当前 ${description.length}）`
    );
  }
  if (/[\r\n]/.test(description)) {
    throw new Error(`${where}: description 不能包含换行（front matter 单行键值）`);
  }
  const instructions = typeof rec.instructions === 'string' ? rec.instructions.trim() : '';
  if (instructions.length < 1 || instructions.length > SKILL_INSTRUCTIONS_MAX_CHARS) {
    throw new Error(
      `${where}: instructions 必须为 1~${SKILL_INSTRUCTIONS_MAX_CHARS} 字符（当前 ${instructions.length}）`
    );
  }
  const intents = assertIntents(rec.intents, where);
  return {
    name,
    description,
    instructions,
    ...(intents ? { intents } : {}),
  };
}

/**
 * 校验 `intents` 字段（D4）：**缺省合法**（未标注 → 注入侧推断）；
 * 给了就必须是 {@link EXPERIENCE_INTENTS} 的非空子集，任一值非法（含 `chat`）即抛错。
 * 不做「静默丢弃」—— 草稿是 LLM 产出，丢字段会让任务类型标注无声失效。
 */
function assertIntents(raw: unknown, where: string): IntentName[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${where}: intents 必须是数组（当前 ${typeof raw}）`);
  }
  if (raw.length === 0) {
    throw new Error(`${where}: intents 不能为空数组（至少标注 1 个任务类型）`);
  }
  const allowed = EXPERIENCE_INTENTS as readonly string[];
  const out: IntentName[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new Error(`${where}: intents 含非字符串值（${typeof item}）`);
    }
    const value = item.trim();
    if (!allowed.includes(value)) {
      throw new Error(
        `${where}: intents 含不可注入的值 "${value}"（合法值：${allowed.join('/')}；` +
          `chat 是无规则 fallback，一律不注入）`
      );
    }
    if (!out.includes(value as IntentName)) out.push(value as IntentName);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 序列化 / 读取
// ---------------------------------------------------------------------------

/** 技能 → `<name>.md` 文本（front-matter + 正文，与 parseSkillMarkdown 互逆）。 */
function serializeSkillFile(skill: SkillDraftInput, status: 'draft' | 'active'): string {
  const front = ['---', `name: ${skill.name}`, `description: ${skill.description}`];
  // intents 未标注（D3 与更早格式）时不写该键 —— 老文件往返零差异
  if (skill.intents && skill.intents.length > 0) {
    front.push(`intents: ${skill.intents.join(', ')}`);
  }
  front.push(`status: ${status}`, 'source: auto', '---');
  return [...front, '', skill.instructions, ''].join('\n');
}

/** 读取目录下全部 `<name>.md`（不递归；坏文件跳过）。 */
function readSkillFiles(dir: string): SkillDraftFile[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SkillDraftFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = join(dir, entry.name);
    try {
      const skill = parseSkillMarkdown(readFileSync(filePath, 'utf-8'), entry.name.slice(0, -3));
      if (!skill) continue;
      out.push({
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        status: skill.status ?? 'active',
        source: 'auto',
        updatedAt: statSync(filePath).mtime.toISOString(),
        ...(skill.intents ? { intents: skill.intents } : {}),
      });
    } catch {
      /* 坏文件 / 不可读：跳过 */
    }
  }
  return out;
}

/** 草稿清单（设置页「提炼技能」只读列表的数据源）。 */
export function listDraftSkills(): SkillDraftFile[] {
  const dir = getDraftSkillsDir();
  if (!dir) return [];
  return readSkillFiles(dir).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** 生效技能清单（语义去重时与草稿一起比对）。 */
export function listActiveSkills(): SkillDraftFile[] {
  const dir = getAutoSkillsDir();
  if (!dir) return [];
  return readSkillFiles(dir);
}

/**
 * 两道闸：名称正则 + 解析路径必须落在 `root` 内。
 * 任一不过返回 null（调用方按 `invalid_name` 拒绝，零副作用）。
 */
function resolveSkillPath(root: string, name: string): string | null {
  if (!AUTO_SKILL_NAME_RE.test(name)) return null;
  const target = resolve(root, `${name}.md`);
  return isPathInside(root, target) ? target : null;
}

// ---------------------------------------------------------------------------
// 写草稿（语义去重：同 name 或同 description 已存在 → 跳过并 warn）
// ---------------------------------------------------------------------------

/**
 * 写入一份提炼草稿。**同步、不抛**（校验不过返回 reason:'invalid'）。
 * 语义去重按 req：同 name 或同 description 已存在（草稿或生效任一）即跳过并 `console.warn`。
 */
export function writeDraftSkill(value: unknown): DraftWriteResult {
  const dir = getDraftSkillsDir();
  if (!dir) return { written: false, reason: 'no_dir' };

  let draft: SkillDraftInput;
  try {
    draft = assertValidSkillDraft(value, 'skill_distill');
  } catch (error) {
    console.error('[skillAutoStore] 草稿校验未通过，未写盘', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { written: false, reason: 'invalid' };
  }

  const filePath = resolveSkillPath(dir, draft.name);
  if (!filePath) return { written: false, reason: 'invalid' };

  // 语义去重：同 name / 同 description（跨草稿与生效）
  const existing = [...listDraftSkills(), ...listActiveSkills()];
  const dup = existing.find(
    (item) => item.name === draft.name || item.description === draft.description
  );
  if (dup) {
    console.warn('[skillAutoStore] 语义重复，跳过写入', {
      name: draft.name,
      duplicateOf: dup.name,
      by: dup.name === draft.name ? 'name' : 'description',
    });
    return { written: false, reason: 'duplicate' };
  }

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, serializeSkillFile(draft, 'draft'), 'utf-8');
    return { written: true, reason: 'written' };
  } catch (error) {
    console.error('[skillAutoStore] 草稿写盘失败', {
      name: draft.name,
      message: error instanceof Error ? error.message : String(error),
    });
    return { written: false, reason: 'parse_error' };
  }
}

// ---------------------------------------------------------------------------
// 人工确认 / 驳回（设置页入口）
// ---------------------------------------------------------------------------

/**
 * 确认草稿 → 生效：写入 `_auto/<name>.md`（status: active）后删除草稿文件。
 * 是**唯一**把 draft 变 active 的路径；未确认的草稿永不进入技能可见范围。
 */
export function approveDraftSkill(name: string): SkillOpResult {
  const draftsDir = getDraftSkillsDir();
  const autoDir = getAutoSkillsDir();
  if (!draftsDir || !autoDir) return { ok: false, reason: 'no_dir' };

  const draftPath = resolveSkillPath(draftsDir, name);
  const activePath = resolveSkillPath(autoDir, name);
  if (!draftPath || !activePath) return { ok: false, reason: 'invalid_name' };
  if (!existsSync(draftPath)) return { ok: false, reason: 'not_found' };

  let draft: SkillDraftInput;
  try {
    const skill = parseSkillMarkdown(readFileSync(draftPath, 'utf-8'), name);
    if (!skill) return { ok: false, reason: 'parse_error' };
    if (skill.name !== name) return { ok: false, reason: 'name_mismatch' };
    draft = assertValidSkillDraft(skill, 'approve');
  } catch (error) {
    console.error('[skillAutoStore] 确认失败：草稿内容非法', {
      name,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'parse_error' };
  }

  try {
    mkdirSync(autoDir, { recursive: true });
    writeFileSync(activePath, serializeSkillFile(draft, 'active'), 'utf-8');
    unlinkSync(draftPath);
    return { ok: true, reason: 'approved' };
  } catch (error) {
    console.error('[skillAutoStore] 确认写盘失败', {
      name,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'parse_error' };
  }
}

/** 驳回草稿：删除 `_auto/_drafts/<name>.md`。 */
export function rejectDraftSkill(name: string): SkillOpResult {
  const draftsDir = getDraftSkillsDir();
  if (!draftsDir) return { ok: false, reason: 'no_dir' };
  const draftPath = resolveSkillPath(draftsDir, name);
  if (!draftPath) return { ok: false, reason: 'invalid_name' };
  if (!existsSync(draftPath)) return { ok: false, reason: 'not_found' };
  try {
    unlinkSync(draftPath);
    return { ok: true, reason: 'rejected' };
  } catch (error) {
    console.error('[skillAutoStore] 驳回删除失败', {
      name,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'parse_error' };
  }
}
