// ============================================
// agent-memory-optimize-3 D3（六.1）：_auto 提炼技能加载与默认扫描目录
// ============================================
// 覆盖：
//   1) getDefaultSkillDirs —— 默认扫描目录含 userData/skills（三处无参 loadSkills 的修复载体）
//   2) `_auto/*.md` 只有 status: active 才生效；`_auto/_drafts/**` 草稿一律不加载
//   3) status: draft 的文件即使被挪进 _auto/ 也不生效（双重防线）
//   4) 同名冲突：console.warn 并跳过后加载者（内置 core 优先）
//   5) skillManager（list_skills 数据源）看得到 _auto 生效技能
//   6) 内置 3 个 core skill 行为零改动
// 无 any、无 dangerouslySetInnerHTML。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';

// --- Electron mock（skillPaths 经 app.getPath('userData') 推导默认目录） ---
const electronMock = vi.hoisted(() => ({
  userData: ':memory:',
  getPath: (name: string): string => {
    if (name !== 'userData') throw new Error(`unexpected path: ${name}`);
    return electronMock.userData;
  },
}));
vi.mock('electron', () => ({
  app: { getPath: (name: string): string => electronMock.getPath(name) },
}));

import { CORE_SKILLS, loadSkills, listSkillsForUi } from '@main/ai/skills/skillLoader';
import {
  getDefaultSkillDirs,
  getAutoSkillsDir,
  isPathInside,
} from '@main/ai/skills/skillPaths';
import { getManagedSkills } from '@main/ai/skills/skillManager';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const HANDWRITTEN = '---\nname: handwritten\ndescription: 手写技能\n---\n手写正文';

let root = '';
let skillsDir = '';

/** 建一份临时 userData/skills 目录树。 */
function seedSkillsDir(files: Record<string, string>): void {
  root = mkdtempSync(join(tmpdir(), 'wmd-d3-'));
  skillsDir = join(root, 'skills');
  for (const [rel, body] of Object.entries(files)) {
    const full = join(skillsDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf-8');
  }
  electronMock.userData = root;
}

let warnSpy: MockInstance<any[], void>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  electronMock.userData = ':memory:';
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = '';
  }
});

// ---------------------------------------------------------------------------

describe('getDefaultSkillDirs — 默认扫描目录', () => {
  it('含 userData/skills（app 可用时）', () => {
    seedSkillsDir({});
    expect(getDefaultSkillDirs()).toEqual([join(root, 'skills')]);
    expect(getAutoSkillsDir()).toBe(join(root, 'skills', '_auto'));
  });

  it('getPath 抛错 → 空数组（fail-safe，不抛穿）', () => {
    const boom = vi.spyOn(electronMock, 'getPath').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(getDefaultSkillDirs()).toEqual([]);
    expect(getAutoSkillsDir()).toBeNull();
    boom.mockRestore();
  });

  it('无参 loadSkills() 走默认目录：userData/skills 下的技能可见', () => {
    seedSkillsDir({ 'flat.md': HANDWRITTEN });
    const names = loadSkills().map((s) => s.name);
    expect(names).toContain('handwritten');
    // 内置 3 个仍在
    expect(names).toEqual(expect.arrayContaining(CORE_SKILLS.map((s) => s.name)));
  });
});

describe('_auto 提炼技能加载', () => {
  it('_auto/<name>.md status: active → 生效并进入 loadSkills 结果', () => {
    seedSkillsDir({
      '_auto/auto_kb_qa.md':
        '---\nname: auto_kb_qa\ndescription: 提炼技能\ntype: draft\nstatus: active\nsource: auto\n---\n提炼正文',
    });
    const list = loadSkills(skillsDir);
    const auto = list.find((s) => s.name === 'auto_kb_qa');
    expect(auto).toBeDefined();
    expect(auto?.instructions).toContain('提炼正文');
    expect(auto?.status).toBe('active');
    expect(list).toHaveLength(CORE_SKILLS.length + 1);
  });

  it('_auto/_drafts/ 下的草稿一律不加载（即便 status: active）', () => {
    seedSkillsDir({
      '_auto/_drafts/auto_draft.md':
        '---\nname: auto_draft\ndescription: 草稿\nstatus: active\n---\n草稿正文',
    });
    const list = loadSkills(skillsDir);
    expect(list.map((s) => s.name)).not.toContain('auto_draft');
    expect(list).toHaveLength(CORE_SKILLS.length);
  });

  it('status: draft 即便被挪进 _auto/ 也不生效（双重防线）', () => {
    seedSkillsDir({
      '_auto/auto_moved.md':
        '---\nname: auto_moved\ndescription: 被挪进来的草稿\nstatus: draft\n---\n草稿正文',
    });
    const list = loadSkills(skillsDir);
    expect(list.map((s) => s.name)).not.toContain('auto_moved');
  });

  it('手写技能带 status: draft 也不加载', () => {
    seedSkillsDir({
      'pending.md': '---\nname: pending\ndescription: 未生效\nstatus: draft\n---\n正文',
    });
    expect(loadSkills(skillsDir).map((s) => s.name)).not.toContain('pending');
  });

  it('_auto 目录不存在 → 静默返回 core（无 throw）', () => {
    seedSkillsDir({});
    expect(loadSkills(skillsDir)).toHaveLength(CORE_SKILLS.length);
  });
});

describe('同名冲突检测', () => {
  it('用户技能与内置 core 同名 → console.warn 并保留内置', () => {
    seedSkillsDir({
      'polish_rewrite.md': '---\nname: polish_rewrite\ndescription: 冒名技能\n---\n冒名正文',
    });
    const list = loadSkills(skillsDir);
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('polish_rewrite');
    const hit = list.filter((s) => s.name === 'polish_rewrite');
    expect(hit).toHaveLength(1);
    // 保留的是内置（description 为内置文案）
    expect(hit[0].description).toBe(CORE_SKILLS[0].description);
  });

  it('两个用户目录同名 → 保留先加载者并 warn', () => {
    const a = mkdtempSync(join(tmpdir(), 'wmd-d3a-'));
    const b = mkdtempSync(join(tmpdir(), 'wmd-d3b-'));
    writeFileSync(join(a, 'dup.md'), '---\nname: dup\ndescription: 第一份\n---\nA');
    writeFileSync(join(b, 'dup.md'), '---\nname: dup\ndescription: 第二份\n---\nB');
    const list = loadSkills([a, b]);
    expect(list.filter((s) => s.name === 'dup')).toHaveLength(1);
    expect(list.find((s) => s.name === 'dup')?.description).toBe('第一份');
    expect(warnSpy).toHaveBeenCalled();
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  });
});

describe('skillManager（list_skills 数据源）', () => {
  it('无参 loadSkills 修复后：getManagedSkills 看得到 _auto 生效技能', () => {
    seedSkillsDir({
      '_auto/auto_x.md': '---\nname: auto_x\ndescription: 提炼出来的\nstatus: active\n---\n正文',
      'handwritten/SKILL.md': HANDWRITTEN,
    });
    const names = getManagedSkills().map((s) => s.name);
    expect(names).toContain('auto_x');
    expect(names).toContain('handwritten');
    expect(names).toEqual(expect.arrayContaining(CORE_SKILLS.map((s) => s.name)));
  });

  it('未确认的草稿不出现在 getManagedSkills（list_skills 看不到）', () => {
    seedSkillsDir({
      '_auto/_drafts/auto_secret.md':
        '---\nname: auto_secret\ndescription: 未确认草稿\nstatus: draft\n---\n草稿',
    });
    const names = getManagedSkills().map((s) => s.name);
    expect(names).not.toContain('auto_secret');
  });
});

describe('内置 3 个 core skill 零改动', () => {  it('CORE_SKILLS 仍为 3 个且名称文案不变', () => {
    expect(CORE_SKILLS.map((s) => s.name)).toEqual([
      'polish_rewrite',
      'tech_organize',
      'kb_qa_guide',
    ]);
    for (const s of CORE_SKILLS) {
      expect(s.description).toBeTruthy();
      expect(s.instructions).toBeTruthy();
      expect(s.status).toBeUndefined();
    }
  });

  it('listSkillsForUi 仍只回 name/description（不泄 instructions）', () => {
    seedSkillsDir({
      '_auto/auto_x.md': '---\nname: auto_x\ndescription: 提炼\nstatus: active\n---\nsecret-body',
    });
    const list = listSkillsForUi(skillsDir);
    expect(list).toHaveLength(CORE_SKILLS.length + 1);
    for (const item of list) {
      expect(item).not.toHaveProperty('instructions');
      expect(item).not.toHaveProperty('argsSchema');
      expect(item).not.toHaveProperty('status');
    }
  });
});

describe('isPathInside — 目录穿越防线（纯函数）', () => {
  const root = join(tmpdir(), 'wmd-auto-root');

  it('子路径在 root 内 → true', () => {
    expect(isPathInside(root, join(root, 'auto_x.md'))).toBe(true);
    expect(isPathInside(root, join(root, '_drafts', 'auto_y.md'))).toBe(true);
    expect(isPathInside(root, root)).toBe(true);
  });

  it('../ 逃逸到 root 之外 → false', () => {
    expect(isPathInside(root, join(root, '..', 'evil.md'))).toBe(false);
    expect(isPathInside(root, join(root, '_drafts', '..', '..', 'evil.md'))).toBe(false);
    expect(isPathInside(root, join(tmpdir(), 'evil.md'))).toBe(false);
  });

  it('同名前缀不误判（root 与 root-sibling 必须算外部）', () => {
    expect(isPathInside(root, `${root}-sibling${sep}evil.md`)).toBe(false);
  });

  it('root 为空 → false（fail-closed）', () => {
    expect(isPathInside('', join(tmpdir(), 'x.md'))).toBe(false);
  });
});
