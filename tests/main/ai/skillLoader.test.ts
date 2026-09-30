import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const llmMock = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  streamAnthropicCompletion: vi.fn(),
}));
vi.mock('@main/ai/llm/llmClient', () => llmMock);
vi.mock('@main/ai/llm/anthropicClient', () => ({
  streamAnthropicCompletion: llmMock.streamAnthropicCompletion,
}));

import {
  CORE_SKILLS,
  listSkillsForUi,
  loadSkills,
  parseSkillMarkdown,
  runSkill,
} from '@main/ai/skills/skillLoader';

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

describe('skillLoader.listSkillsForUi (B1)', () => {
  it('returns [name, description] for core skills (no instructions/argsSchema leak)', () => {
    const list = listSkillsForUi();
    // 渲染仅需名称+描述；instructions/argsSchema 不得外泄
    for (const item of list) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('description');
      expect(item).not.toHaveProperty('instructions');
      expect(item).not.toHaveProperty('argsSchema');
    }
    expect(list).toHaveLength(CORE_SKILLS.length);
    const names = list.map((s) => s.name);
    expect(names).toContain('polish_rewrite');
    expect(names).toContain('tech_organize');
    expect(names).toContain('kb_qa_guide');
  });

  it('merges user-extended skills when a userData/skills dir is provided', () => {
    const dir = makeSkillsDir({
      mySkill:
        '---\nname: mySkill\ndescription: 我的技能\ninstructions: secret-instructions\n---\n正文指令',
    });
    tempDirs.push(dir);
    const list = listSkillsForUi(dir);
    // 3 core + 1 user
    const user = list.find((s) => s.name === 'mySkill');
    expect(list).toHaveLength(4);
    expect(user).toBeDefined();
    expect(user?.description).toBe('我的技能');
    // 用户扩展同样不泄 instructions
    expect(user).not.toHaveProperty('instructions');
  });

  it('is core-only when userData dir is missing (non-throw)', () => {
    expect(listSkillsForUi(join(tmpdir(), 'definitely-missing-skills-xyz'))).toHaveLength(
      CORE_SKILLS.length
    );
  });
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

  it('protocol=anthropic 时分流到 streamAnthropicCompletion（openai 保持原路径）', async () => {
    async function* gen() {
      yield { delta: 'ok' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    llmMock.streamAnthropicCompletion.mockImplementation(() => gen());
    const skill = CORE_SKILLS[0];

    await runSkill(skill, 'a', {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      protocol: 'anthropic',
    });
    expect(llmMock.streamAnthropicCompletion).toHaveBeenCalledTimes(1);
    expect(llmMock.streamChatCompletion).not.toHaveBeenCalled();

    await runSkill(skill, 'b', {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      protocol: 'openai',
    });
    expect(llmMock.streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(llmMock.streamAnthropicCompletion).toHaveBeenCalledTimes(1);
  });

  it('returns status error when llmClient throws', async () => {
    async function* gen() {
      yield { delta: '' };
      throw Object.assign(new Error('boom'), { code: 'http_500' });
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const res = await runSkill(CORE_SKILLS[0], 'x', {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('boom');
  });
});

// ---------------------------------------------------------------------------
// D4 — front matter `intents` 解析（六.2 任务类型标注，总指挥裁定 2/4）
// ---------------------------------------------------------------------------

/** 组一份 front matter + 正文的技能文件文本。 */
function skillFile(frontExtra: string[] = []): string {
  return [
    '---',
    'name: auto_flow',
    'description: 示例技能',
    ...frontExtra,
    '---',
    '1. 第一步',
    '2. 第二步',
  ].join('\n');
}

describe('skillLoader front matter intents 解析（D4）', () => {
  it('逗号分隔 → 解析为意图数组', () => {
    const skill = parseSkillMarkdown(skillFile(['intents: rewrite, kbQa']));
    expect(skill?.intents).toEqual(['rewrite', 'kbQa']);
  });

  it('JSON 数组 → 解析为意图数组', () => {
    const skill = parseSkillMarkdown(skillFile(['intents: ["rewrite", "tech"]']));
    expect(skill?.intents).toEqual(['rewrite', 'tech']);
  });

  it('无 intents 字段 → 不带该键（视为未标注，走注入侧推断）', () => {
    const skill = parseSkillMarkdown(skillFile());
    expect(skill).not.toHaveProperty('intents');
    expect(skill?.intents).toBeUndefined();
  });

  it('非法值被忽略并 console.warn，合法值保留', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const skill = parseSkillMarkdown(skillFile(['intents: foo, rewrite, bar']));
    expect(skill?.intents).toEqual(['rewrite']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('chat 不可注入（裁定 3）→ 忽略并 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const skill = parseSkillMarkdown(skillFile(['intents: chat, rewrite']));
    expect(skill?.intents).toEqual(['rewrite']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('标注了但全部非法 → 空数组（已标注却不注入，不回落到推断）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const skill = parseSkillMarkdown(skillFile(['intents: chat, nope']));
    expect(skill?.intents).toEqual([]);
    warn.mockRestore();
  });

  it('解析出的 intents 只在技能对象上出现一次且正文不受影响', () => {
    const skill = parseSkillMarkdown(skillFile(['intents: tech']));
    expect(skill?.instructions).toBe('1. 第一步\n2. 第二步');
    expect(skill?.description).toBe('示例技能');
  });
});
