// ============================================
// WeaveMD — Skill 管理工具（list_skills / get_skill_details）
// ============================================

import { getManagedSkills, getManagedSkill } from '../skills/skillManager';
import type { ToolCtx, ToolResult } from '../toolTypes';

/** 列出所有可用技能（名称、描述、启用状态）。 */
export async function handleListSkills(_args: Record<string, unknown>, _ctx: ToolCtx): Promise<ToolResult> {
  const skills = getManagedSkills();
  const summary = skills.map((s) => ({
    name: s.name,
    description: s.description,
    enabled: s.enabled,
    source: s.source,
  }));
  return { content: JSON.stringify(summary), status: 'ok' };
}

/** 查看指定技能的详细信息。 */
export async function handleGetSkillDetails(args: Record<string, unknown>, _ctx: ToolCtx): Promise<ToolResult> {
  const skillName = typeof args.skill_name === 'string' ? args.skill_name : '';
  if (!skillName) {
    return { content: '', status: 'error', errorDesc: 'get_skill_details: 缺少 skill_name' };
  }
  const skill = getManagedSkill(skillName);
  if (!skill) {
    return { content: '', status: 'error', errorDesc: `get_skill_details: 未找到技能 ${skillName}` };
  }
  return {
    content: JSON.stringify({
      name: skill.name,
      description: skill.description,
      enabled: skill.enabled,
      source: skill.source,
    }),
    status: 'ok',
  };
}
