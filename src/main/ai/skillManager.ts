// ============================================
// WeaveMD — Skills 管理器
// ============================================
// Skills 管理增强（M5）。
// 提供 Skills 的启用/禁用/更新/重扫功能。

import type { CoreSkill } from './skillLoader';
import { loadSkills } from './skillLoader';

export interface ManagedSkill extends CoreSkill {
  /** 是否启用。 */
  enabled: boolean;
  /** 来源（builtin / user / installed）。 */
  source: 'builtin' | 'user' | 'installed';
  /** 安装路径（仅 installed 类型）。 */
  installPath?: string;
}

/** 内存中的技能启用状态。 */
const skillStates = new Map<string, boolean>();

/** 获取所有管理的 Skills。 */
export function getManagedSkills(): ManagedSkill[] {
  const skills = loadSkills();

  return skills.map((skill) => ({
    ...skill,
    enabled: skillStates.get(skill.name) ?? true,
    source: 'user' as const,
  }));
}

/** 获取单个 Skill。 */
export function getManagedSkill(name: string): ManagedSkill | null {
  const skills = loadSkills();
  const skill = skills.find((s) => s.name === name);
  if (!skill) return null;

  return {
    ...skill,
    enabled: skillStates.get(skill.name) ?? true,
    source: 'user' as const,
  };
}

/** 启用/禁用 Skill。 */
export function setSkillEnabled(name: string, enabled: boolean): boolean {
  const skills = loadSkills();
  const skill = skills.find((s) => s.name === name);
  if (!skill) return false;

  skillStates.set(name, enabled);
  return true;
}

/** 检查 Skill 是否启用。 */
export function isSkillEnabled(name: string): boolean {
  return skillStates.get(name) ?? true;
}

/** 重新扫描 Skills（刷新缓存）。 */
export function rescanSkills(): ManagedSkill[] {
  // 清除状态缓存
  skillStates.clear();
  return getManagedSkills();
}

/** 获取 Skills 统计信息。 */
export function getSkillsStats(): {
  total: number;
  enabled: number;
  disabled: number;
} {
  const skills = getManagedSkills();
  const enabled = skills.filter((s) => s.enabled).length;

  return {
    total: skills.length,
    enabled,
    disabled: skills.length - enabled,
  };
}
