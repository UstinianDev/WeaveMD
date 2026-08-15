import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
}));
vi.mock('@main/ai/llmClient', () => llmMock);

import { CORE_SKILLS, loadSkills, runSkill } from '@main/ai/skillLoader';

/** 构造临时的 userData/skills 目录并返回其路径（测试结束自动清理）。 */
function makeSkillsDir(content: Record<string, string>): string {
  const base = mkdtempSync(join(tmpdir(), 'wmd-skills-'));
  for (const [name, body] of Object.entries(content)) {
    mkdirSync(join(base, name), { recursive: true });
    writeFileSync(join(base, name, 'SKILL.md'), body);
  }
  return base;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('skillLoader core skills', () => {
  it('registers 3 built-in core skills', () => {
    expect(CORE_SKILLS).toHaveLength(3);
    const names = CORE_SKILLS.map((s) => s.name);
    expect(names).toContain('polish_rewrite');
    expect(names).toContain('tech_organize');
    expect(names).toContain('kb_qa_guide');
  });

  it('core skill has structured name/description/instructions', () => {
    for (const s of CORE_SKILLS) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.instructions).toBeTruthy();
    }
  });

  it('loadSkills returns core skills when no user dir provided', () => {
    expect(loadSkills()).toHaveLength(3);
  });

  it('loadSkills returns core-only when user dir is missing', () => {
    expect(loadSkills(join(tmpdir(), 'definitely-missing-skills-xyz'))).toHaveLength(3);
  });
});

describe('skillLoader user extension loading', () => {
  it('parses SKILL.md front-matter name/description/instructions', () => {
    const dir = makeSkillsDir({
      mySkill: '---\nname: mySkill\ndescription: 我的技能\n---\n正文指令第一行\n正文指令第二行',
    });
    tempDirs.push(dir);
    const skills = loadSkills(dir);
    expect(skills).toHaveLength(4); // 3 core + 1 user
    const user = skills[3];
    expect(user.name).toBe('mySkill');
    expect(user.description).toBe('我的技能');
    expect(user.instructions).toContain('正文指令第一行');
    expect(user.instructions).toContain('正文指令第二行');
  });

  it('parses optional args JSON schema from front-matter', () => {
    const dir = makeSkillsDir({
      s2: '---\nname: s2\ndescription: 带参数\nargs: {"type":"object","properties":{"x":{"type":"string"}}}\n---\ninstructions body',
    });
    tempDirs.push(dir);
    const skills = loadSkills(dir);
    const user = skills[3];
    expect(user.argsSchema).toEqual({
      type: 'object',
      properties: { x: { type: 'string' } },
    });
  });

  it('skips directories without a valid SKILL.md', () => {
    const base = mkdtempSync(join(tmpdir(), 'wmd-skills-x-'));
    mkdirSync(join(base, 'noSkill'), { recursive: true });
    tempDirs.push(base);
    expect(loadSkills(base)).toHaveLength(3); // 仅 core
  });
});

describe('skillLoader.runSkill', () => {
  it('runs one llmClient generation with skill instructions as system', async () => {
    async function* gen() {
      yield { delta: '加' };
      yield { delta: '工结果' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const ctx = {
      backend: 'remote' as const,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    };
    const skill = CORE_SKILLS[0];
    const res = await runSkill(skill, 'input text', ctx);
    expect(res.status).toBe('ok');
    expect(res.content).toBe('加工结果');
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    const callArgs = llmMock.streamChatCompletion.mock.calls[0][0];
    expect(callArgs.messages[0]).toEqual({
      role: 'system',
      content: skill.instructions,
    });
    expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'input text' });
  });

  it('returns status error when llmClient throws', async () => {
    async function* gen() {
      yield { delta: '' };
      throw Object.assign(new Error('boom'), { code: 'http_500' });
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const res = await runSkill(CORE_SKILLS[0], 'x', {
      backend: 'remote',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('boom');
  });
});
