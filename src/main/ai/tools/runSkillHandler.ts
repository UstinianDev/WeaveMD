import { runSkill } from '../skills/skillLoader';
import type { ToolCtx, ToolResult } from '../toolTypes';

export async function handleRunSkill(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  const skillName = typeof args.skill === 'string' ? args.skill : '';
  const input = typeof args.input === 'string' ? args.input : '';
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
