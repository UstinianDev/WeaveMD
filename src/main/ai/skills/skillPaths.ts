// ============================================
// WeaveMD — Skill 目录路径与安全工具（agent-memory-optimize-3 D3）
// ============================================
// 职责单一：把「Electron userData 路径」翻译成技能目录，并提供路径安全判定。
// skillLoader / skillAutoStore / skillManager 共用，避免三处各写一遍 app.getPath。
//
// 关键目录（req Q5 裁定：纯文件系统、不建 DB 表）：
//   userData/skills/               —— 用户手写技能根目录（既有 `<name>/SKILL.md` 与 `<name>.md`）
//   userData/skills/_auto/         —— 提炼生效技能（status: active 才算生效）
//   userData/skills/_auto/_drafts/ —— 提炼草稿（status: draft，人工确认前绝不生效）

import { join, resolve, sep } from 'path';
import { app } from 'electron';

/** 用户技能根目录名。 */
export const SKILLS_DIR_NAME = 'skills';
/** 提炼技能目录（生效）。 */
export const AUTO_SKILLS_DIR_NAME = '_auto';
/** 提炼草稿目录（未确认，永不生效）。 */
export const SKILL_DRAFTS_DIR_NAME = '_drafts';

/** 提炼技能名闸：`auto_` 前缀 + 小写字母/数字/下划线（req：`auto_[a-z0-9_]+`），总长 6~65。 */
export const AUTO_SKILL_NAME_RE = /^auto_[a-z0-9_]{1,60}$/;

/**
 * userData/skills 绝对路径。
 * 非 Electron 环境（单测）或 `app.getPath` 抛错 → 返回 null（调用方降级为「仅内置技能」）。
 */
export function getUserDataSkillsDir(): string | null {
  try {
    if (!app || typeof app.getPath !== 'function') return null;
    const dir = app.getPath('userData');
    if (typeof dir !== 'string' || dir.length === 0) return null;
    return join(dir, SKILLS_DIR_NAME);
  } catch {
    return null;
  }
}

/**
 * 无参 `loadSkills()` 的默认扫描目录。
 * **必须包含 userData/skills**（req Q5：目录列表含 userData/skills）；环境不可用时返回 []。
 */
export function getDefaultSkillDirs(): string[] {
  const dir = getUserDataSkillsDir();
  return dir ? [dir] : [];
}

/** 提炼生效技能目录（`userData/skills/_auto`）；环境不可用 → null。 */
export function getAutoSkillsDir(): string | null {
  const base = getUserDataSkillsDir();
  return base ? join(base, AUTO_SKILLS_DIR_NAME) : null;
}

/** 提炼草稿目录（`userData/skills/_auto/_drafts`）；环境不可用 → null。 */
export function getDraftSkillsDir(): string | null {
  const auto = getAutoSkillsDir();
  return auto ? join(auto, SKILL_DRAFTS_DIR_NAME) : null;
}

/**
 * 目录穿越防线：`target` 解析后必须仍在 `root` 之内（含 root 自身）。
 * 纯函数，便于单测；与名称正则闸叠加构成双重防线（SECURITY.md「IPC」路径参数化同口径）。
 */
export function isPathInside(root: string, target: string): boolean {
  if (!root) return false;
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (normalizedTarget === normalizedRoot) return true;
  return normalizedTarget.startsWith(normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep);
}
