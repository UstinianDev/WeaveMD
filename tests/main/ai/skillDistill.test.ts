// ============================================
// agent-memory-optimize-3 D3（六.1）：执行轨迹 → 可复用 Skill 提炼
// ============================================
// 覆盖验收：
//   1) 3 次同类任务轨迹 → 提炼草稿 → 人工确认 → 第 4 次经 runSkill 可调用
//   2) 失败轨迹提炼出的避坑规则在后续 runSkill 的 system prompt 中生效
//   3) 未确认的草稿不进 ctx.skills / list_skills / 系统提示词
//   4) 提炼 JSON 严格校验（非法 name / 超长 / 超限 → 整批拒写零落盘）
//   5) 节流 + 同会话 pending 去重 + 失败落 failed 不重试、不阻塞
//   6) 语义去重（同 name / 同 description 已存在 → 跳过并 warn）
// 全程注入 fake llm 与注入式 reader/writer —— 不依赖真 LLM、不碰 better-sqlite3。
// 无 any、无 dangerouslySetInnerHTML。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- Electron mock（skillPaths 经 app.getPath('userData') 推导目录） ---
const electronMock = vi.hoisted(() => ({
  userData: ':memory:',
  getPath: (): string => electronMock.userData,
}));
vi.mock('electron', () => ({
  app: { getPath: (): string => electronMock.getPath() },
}));

// --- llmClient mock（runSkill 的一次纯生成） ---
const llmMock = vi.hoisted(() => ({ streamChatCompletion: vi.fn() }));
vi.mock('@main/ai/llm/llmClient', () => ({ streamChatCompletion: llmMock.streamChatCompletion }));
vi.mock('@main/ai/llm/anthropicClient', () => ({ streamAnthropicCompletion: vi.fn() }));

import {
  SKILL_DISTILL_TASK_TYPE,
  SKILL_DISTILL_MIN_ROUND_GAP,
  maybeEnqueueSkillDistillation,
  parseSkillDrafts,
  formatTrajectory,
  runSkillDistillJob,
  isSkillDistillTask,
  resetSkillDistillState,
  type TrajectoryMessage,
  type SkillDistillJobDeps,
} from '@main/ai/skills/skillDistiller';
import type { SkillDraftInput, SkillDraftFile } from '@main/ai/skills/skillAutoStore';
import {
  listDraftSkills,
  writeDraftSkill,
  approveDraftSkill,
  rejectDraftSkill,
  assertValidSkillDraft,
} from '@main/ai/skills/skillAutoStore';
import { loadSkills, CORE_SKILLS } from '@main/ai/skills/skillLoader';
import { getDefaultSkillDirs } from '@main/ai/skills/skillPaths';
import { handleListSkills } from '@main/ai/tools/skillToolsHandler';
import { handleRunSkill } from '@main/ai/tools/runSkillHandler';
import { buildAgentSystemPrompt, EXPERIENCE_INTENTS } from '@main/ai/agent/agentPromptBuilder';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let root = '';
let skillsDir = '';
let draftsDir = '';
let autoDir = '';

function makeEnv(): void {
  root = mkdtempSync(join(tmpdir(), 'wmd-d3-distill-'));
  electronMock.userData = root;
  skillsDir = join(root, 'skills');
  autoDir = join(skillsDir, '_auto');
  draftsDir = join(autoDir, '_drafts');
  mkdirSync(draftsDir, { recursive: true });
}

/** 同类任务轨迹：3 轮（用户 → 助手调工具 → 工具结果 → 助手收尾）。 */
function sameTaskTrajectory(extraToolContent = '整理结果正常返回'): TrajectoryMessage[] {
  const rows: TrajectoryMessage[] = [];
  for (let i = 1; i <= 3; i += 1) {
    rows.push({ role: 'user', content: `第${i}次：把零散笔记整理成大纲` });
    rows.push({
      role: 'assistant',
      content: '我先读取文件再整理',
      toolCalls: [{ id: `c${i}`, type: 'function', function: { name: 'readFile', arguments: '{}' } }],
    });
    rows.push({ role: 'tool', content: `第${i}次 ${extraToolContent}` });
    rows.push({ role: 'assistant', content: `第${i}次大纲已生成` });
  }
  return rows;
}

/** 每次调用递增的假 LLM 队列（队列耗尽后返回最后一项）。 */
function llmQueue(responses: string[]): { fn: (messages: unknown[]) => Promise<string> } {
  let i = 0;
  return {
    fn: async () => {
      const value = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return value;
    },
  };
}

function draftsOf(): SkillDraftFile[] {
  return listDraftSkills();
}

let warnSpy: MockInstance<any[], void>;
let errorSpy: MockInstance<any[], void>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  llmMock.streamChatCompletion.mockReset();
  resetSkillDistillState();
  makeEnv();
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

/** 默认依赖桩：轨迹读取、成功终态判定、llm、写草稿。 */
function makeDeps(over: Partial<SkillDistillJobDeps> = {}): SkillDistillJobDeps {
  return {
    readPage: (): TrajectoryMessage[] => sameTaskTrajectory(),
    hasCompletedTask: (): boolean => true,
    llm: llmQueue(['[]']).fn,
    writeDraft: (draft: SkillDraftInput) => writeDraftSkill(draft),
    ...over,
  };
}

async function runJob(
  deps: SkillDistillJobDeps = makeDeps(),
  ctx = { conversationId: 'c1', userId: 'u1' }
) {
  const statuses: Array<[string, ...string[]]> = [];
  await runSkillDistillJob(deps, ctx, (status, code, message) => {
    statuses.push([status, ...(code ? [code] : []), ...(message ? [message] : [])]);
  });
  return statuses;
}

// ---------------------------------------------------------------------------

describe('验收 1：3 次同类轨迹 → 草稿 → 人工确认 → 第 4 次 runSkill 可调用', () => {
  const TRAJECTORY_LLM = JSON.stringify([
    {
      name: 'auto_outline_flow',
      description: '把零散笔记整理成大纲的固定流程',
      instructions: '1. 读取原文件\n2. 提取标题层级\n3. 输出大纲\n避坑：不要直接改写原文件',
    },
  ]);

  it('提炼只写草稿目录，确认后进入 _auto/ 且 status: active，随后 runSkill 可调用', async () => {
    // 1) 提炼：LLM 产出 1 条技能 → 只落草稿
    const statuses = await runJob(makeDeps({ llm: llmQueue([TRAJECTORY_LLM]).fn }));
    expect(statuses).toEqual([['completed']]);
    expect(existsSync(join(draftsDir, 'auto_outline_flow.md'))).toBe(true);
    expect(existsSync(join(autoDir, 'auto_outline_flow.md'))).toBe(false);

    // 2) 未确认 → 不在 loadSkills / list_skills / 系统提示词里
    expect(loadSkills(getDefaultSkillDirs()).map((s) => s.name)).not.toContain('auto_outline_flow');
    const listedBefore = JSON.parse(
      (await handleListSkills({}, { userId: 'u1' })).content
    );
    expect(listedBefore.map((s: { name: string }) => s.name)).not.toContain('auto_outline_flow');
    const promptBefore = buildAgentSystemPrompt('', '');
    expect(promptBefore).not.toContain('auto_outline_flow');

    // 3) 人工确认：草稿 → 生效
    const approved = approveDraftSkill('auto_outline_flow');
    expect(approved.ok).toBe(true);
    expect(existsSync(join(draftsDir, 'auto_outline_flow.md'))).toBe(false);
    const activeRaw = readFileSync(join(autoDir, 'auto_outline_flow.md'), 'utf-8');
    expect(activeRaw).toContain('status: active');
    expect(activeRaw).toContain('source: auto');

    // 4) 第 4 次任务：runSkill 按 name 找到技能并执行
    const skills = loadSkills(getDefaultSkillDirs());
    expect(skills.map((s) => s.name)).toContain('auto_outline_flow');
    async function* gen() {
      yield { delta: '大纲结果' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const res = await handleRunSkill(
      { skill: 'auto_outline_flow', input: '整理这份笔记' },
      { userId: 'u1', skills, skill: { baseUrl: 'https://x', model: 'm' } }
    );
    expect(res.status).toBe('ok');
    expect(res.content).toBe('大纲结果');
    const callArgs = llmMock.streamChatCompletion.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArgs.messages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('不要直接改写原文件'),
    });
    expect(callArgs.messages[1]).toEqual({ role: 'user', content: '整理这份笔记' });
  });

  it('验收 2：失败轨迹提炼的避坑规则出现在后续 runSkill 的 system prompt', async () => {
    // 失败轨迹：工具结果带失败痕迹
    const failing = sameTaskTrajectory('工具报错：直接写入被拒，需先确认预览');
    const withPitfall = JSON.stringify([
      {
        name: 'auto_safe_write',
        description: '写文件前先出预览的流程',
        instructions: '1. 读取目标文件\n2. 生成改写预览\n避坑：绝不直接覆盖原文件，必须先出预览让用户确认',
      },
    ]);
    await runJob(
      makeDeps({
        readPage: (): TrajectoryMessage[] => failing,
        llm: llmQueue([withPitfall]).fn,
      })
    );
    expect(approveDraftSkill('auto_safe_write').ok).toBe(true);

    async function* gen() {
      yield { delta: 'ok' };
    }
    llmMock.streamChatCompletion.mockImplementation(() => gen());
    const skills = loadSkills(getDefaultSkillDirs());
    await handleRunSkill(
      { skill: 'auto_safe_write', input: '改写这一段' },
      { userId: 'u1', skills, skill: { baseUrl: 'https://x', model: 'm' } }
    );
    const callArgs = llmMock.streamChatCompletion.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArgs.messages[0].content).toContain('绝不直接覆盖原文件');
    // 轨迹里的失败痕迹确实进了提炼输入（否则 LLM 无从产出避坑）
    expect(formatTrajectory(failing)).toContain('工具报错');
  });

  it('验收 3：驳回后草稿被删除，且永远不进技能可见范围', async () => {
    await runJob(makeDeps({ llm: llmQueue([TRAJECTORY_LLM]).fn }));
    expect(draftsOf().map((d) => d.name)).toContain('auto_outline_flow');
    const rejected = rejectDraftSkill('auto_outline_flow');
    expect(rejected.ok).toBe(true);
    expect(draftsOf()).toHaveLength(0);
    expect(loadSkills(getDefaultSkillDirs()).map((s) => s.name)).not.toContain('auto_outline_flow');
  });
});

describe('验收 4：提炼 JSON 严格校验（任一项不合法 → 整批拒写零落盘）', () => {
  const GOOD = { name: 'auto_ok', description: '正常', instructions: '正常正文' };

  it('非 auto_ 前缀 / 非法字符 name → 抛错', () => {
    for (const name of ['kb_flow', 'AUTO_X', 'auto_A', 'auto_x-y', '../evil', 'auto_x/y', '']) {
      expect(() =>
        parseSkillDrafts(JSON.stringify([{ ...GOOD, name }]))
      ).toThrowError(/name/);
    }
  });

  it('description / instructions 超长或为空 → 抛错', () => {
    expect(() =>
      parseSkillDrafts(
        JSON.stringify([{ ...GOOD, description: 'x'.repeat(201) }])
      )
    ).toThrowError(/description/);
    expect(() =>
      parseSkillDrafts(JSON.stringify([{ ...GOOD, description: '' }]))
    ).toThrowError(/description/);
    expect(() =>
      parseSkillDrafts(JSON.stringify([{ ...GOOD, description: '多\n行' }]))
    ).toThrowError(/description/);
    expect(() =>
      parseSkillDrafts(JSON.stringify([{ ...GOOD, instructions: '' }]))
    ).toThrowError(/instructions/);
    expect(() =>
      parseSkillDrafts(JSON.stringify([{ ...GOOD, instructions: 'x'.repeat(4001) }]))
    ).toThrowError(/instructions/);
  });

  it('条数超上限 → 整批拒绝（不截断写入）', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      ...GOOD,
      name: `auto_item_${i}`,
    }));
    expect(() => parseSkillDrafts(JSON.stringify(many))).toThrowError(/上限|条数/);
  });

  it('非 JSON / 非数组 / 项缺字段 → 抛错', () => {
    expect(() => parseSkillDrafts('not json')).toThrowError();
    expect(() => parseSkillDrafts('{"a":1}')).toThrowError();
    expect(() => parseSkillDrafts(JSON.stringify([{ name: 'auto_x' }]))).toThrowError();
  });

  it('整批拒写：任一项非法时 runSkillDistillJob 落 failed 且零文件', async () => {
    const bad = JSON.stringify([
      GOOD,
      { ...GOOD, name: 'auto_bad', description: 'x'.repeat(500) },
    ]);
    const statuses = await runJob(makeDeps({ llm: llmQueue([bad]).fn }));
    expect(statuses[0][0]).toBe('failed');
    expect(statuses[0][1]).toBe('skill_distill');
    expect(draftsOf()).toHaveLength(0);
    expect(existsSync(join(draftsDir, 'auto_ok.md'))).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('代码块包裹的 JSON 也能解析（与 memory_extract 同口径）', () => {
    const wrapped = '```json\n' + JSON.stringify([GOOD]) + '\n```';
    expect(parseSkillDrafts(wrapped)).toHaveLength(1);
  });

  it('空数组 → 合法但零写入，落 completed', async () => {
    const statuses = await runJob(makeDeps({ llm: llmQueue(['[]']).fn }));
    expect(statuses).toEqual([['completed']]);
    expect(draftsOf()).toHaveLength(0);
  });
});

describe('语义去重：同 name / 同 description 已存在则跳过', () => {
  const ONE = {
    name: 'auto_dup',
    description: '同一个描述',
    instructions: '正文',
  };

  it('同 name 已有草稿 → 跳过并 warn', () => {
    writeDraftSkill(ONE);
    const res = writeDraftSkill({ ...ONE, instructions: '换了正文' });
    expect(res.written).toBe(false);
    expect(res.reason).toBe('duplicate');
    expect(warnSpy).toHaveBeenCalled();
    expect(listDraftSkills()).toHaveLength(1);
    expect(readFileSync(join(draftsDir, 'auto_dup.md'), 'utf-8')).toContain('正文');
  });

  it('同 description 不同 name → 跳过并 warn', () => {
    writeDraftSkill(ONE);
    const res = writeDraftSkill({ ...ONE, name: 'auto_other' });
    expect(res.written).toBe(false);
    expect(res.reason).toBe('duplicate');
    expect(listDraftSkills()).toHaveLength(1);
  });

  it('已生效（_auto/）的同名/同描述也会挡住新草稿', () => {
    writeDraftSkill(ONE);
    expect(approveDraftSkill('auto_dup').ok).toBe(true);
    const res = writeDraftSkill({ ...ONE, name: 'auto_second' });
    expect(res.written).toBe(false);
    expect(res.reason).toBe('duplicate');
    expect(listDraftSkills()).toHaveLength(0);
  });
});

describe('入队：节流 / 同会话 pending 去重 / 不抛', () => {
  function fakeQueue() {
    const enqueueMock = vi.fn((payload: {
      conversationId: string;
      userId: string;
      message: string;
      payloadJson?: string;
    }) => ({ id: 't1' }));
    const pendingMock = vi.fn(
      (): Array<{ id: string; status: string }> => []
    );
    return {
      queue: { enqueue: enqueueMock, getTasksByConversation: pendingMock },
      enqueueMock,
      pendingMock,
    };
  }

  it('payloadJson.type === skill_distill 时 isSkillDistillTask 为真', () => {
    expect(
      isSkillDistillTask({ payloadJson: JSON.stringify({ type: SKILL_DISTILL_TASK_TYPE }) })
    ).toBe(true);
    expect(isSkillDistillTask({ payloadJson: JSON.stringify({ type: 'memory_extract' }) })).toBe(
      false
    );
    expect(isSkillDistillTask({ payloadJson: null })).toBe(false);
    expect(isSkillDistillTask({ payloadJson: 'not json' })).toBe(false);
  });

  it('首轮入队成功；同会话 pending 存在时跳过（不 supersede 别的任务）', () => {
    resetSkillDistillState();
    const { queue, enqueueMock, pendingMock } = fakeQueue();
    const first = maybeEnqueueSkillDistillation(
      { queue },
      { conversationId: 'c1', userId: 'u1' }
    );
    expect(first.enqueued).toBe(true);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const enqueuedPayload = enqueueMock.mock.calls[0][0] as { payloadJson: string };
    expect(enqueuedPayload.payloadJson).toContain(SKILL_DISTILL_TASK_TYPE);

    // 节流窗口已过（换一轮），但同会话仍有 pending（例如 memory_extract 刚入队）
    // → 必须跳过：AgentTaskQueue.enqueue 会 supersede 同会话旧 pending，不能误伤别的后台任务
    resetSkillDistillState();
    pendingMock.mockReturnValue([{ id: 'm1', status: 'pending' }]);
    const second = maybeEnqueueSkillDistillation(
      { queue },
      { conversationId: 'c1', userId: 'u1' }
    );
    expect(second.enqueued).toBe(false);
    expect(second.reason).toBe('pending');
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it(`节流：同会话 ${SKILL_DISTILL_MIN_ROUND_GAP} 轮内不重复入队`, () => {
    resetSkillDistillState();
    const { queue, enqueueMock } = fakeQueue();
    maybeEnqueueSkillDistillation({ queue }, { conversationId: 'c2', userId: 'u1' });
    for (let i = 1; i < SKILL_DISTILL_MIN_ROUND_GAP; i += 1) {
      const res = maybeEnqueueSkillDistillation({ queue }, { conversationId: 'c2', userId: 'u1' });
      expect(res.enqueued).toBe(false);
      expect(res.reason).toBe('throttled');
    }
    // 走满间隔后可再次入队
    const ok = maybeEnqueueSkillDistillation(
      { queue },
      { conversationId: 'c2', userId: 'u1' }
    );
    expect(ok.enqueued).toBe(true);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it('enqueue 抛错 → 收敛为 enqueue_error，绝不抛给调用方', () => {
    resetSkillDistillState();
    const queue = {
      enqueue: (): { id: string } => {
        throw new Error('db down');
      },
      getTasksByConversation: (): Array<{ id: string; status: string }> => [],
    };
    const res = maybeEnqueueSkillDistillation(
      { queue },
      { conversationId: 'c3', userId: 'u1' }
    );
    expect(res.enqueued).toBe(false);
    expect(res.reason).toBe('enqueue_error');
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('任务体：成功终态过滤 + 失败不重试 + 永不 reject', () => {
  it('会话没有 completed 终态 → 直接跳过，不调 LLM', async () => {
    const llm = vi.fn(async () => '[]');
    const statuses = await runJob(makeDeps({ hasCompletedTask: (): boolean => false, llm }));
    expect(statuses).toEqual([['completed']]);
    expect(llm).not.toHaveBeenCalled();
  });

  it('轨迹为空 → 跳过，不调 LLM', async () => {
    const llm = vi.fn(async () => '[]');
    const statuses = await runJob(makeDeps({ readPage: (): TrajectoryMessage[] => [], llm }));
    expect(statuses).toEqual([['completed']]);
    expect(llm).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 落 failed（带 skill_distill 错误码），零写入、不 reject', async () => {
    const llm = async (): Promise<string> => {
      throw new Error('llm down');
    };
    const statuses = await runJob(makeDeps({ llm }));
    expect(statuses[0]).toEqual(['failed', 'skill_distill', 'llm down']);
    expect(draftsOf()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('writeDraft 抛错 → 落 failed（不静默吞掉）', async () => {
    const llm = llmQueue([
      JSON.stringify([{ name: 'auto_x', description: 'd', instructions: 'i' }]),
    ]).fn;
    const statuses = await runJob(
      makeDeps({
        llm,
        writeDraft: () => {
          throw new Error('disk full');
        },
      })
    );
    expect(statuses[0][0]).toBe('failed');
    expect(String(statuses[0][2])).toContain('disk full');
  });
});

describe('formatTrajectory — 轨迹格式化', () => {
  it('保留角色、工具调用名与工具结果摘要', () => {
    const text = formatTrajectory(sameTaskTrajectory('这是工具结果'));
    expect(text).toContain('用户');
    expect(text).toContain('readFile');
    expect(text).toContain('这是工具结果');
    expect(text).toContain('第3次');
  });

  it('按字符预算截断时保留最近的轨迹（旧轮先丢）', () => {
    const rows = sameTaskTrajectory();
    const text = formatTrajectory(rows, 150);
    expect(text.length).toBeLessThanOrEqual(150);
    expect(text).toContain('第3次');
    expect(text).not.toContain('第1次');
  });

  it('空轨迹返回空串', () => {
    expect(formatTrajectory([])).toBe('');
  });
});

describe('既定约束：内置 3 个 core skill 不受影响', () => {
  it('提炼/确认后 CORE_SKILLS 数量与名称不变', async () => {
    await runJob(
      makeDeps({
        llm: llmQueue([
          JSON.stringify([
            { name: 'auto_y', description: 'x', instructions: 'y' },
          ]),
        ]).fn,
      })
    );
    expect(approveDraftSkill('auto_y').ok).toBe(true);
    expect(CORE_SKILLS).toHaveLength(3);
    const names = loadSkills(getDefaultSkillDirs()).map((s) => s.name);
    expect(names).toContain('auto_y');
    expect(names.slice(0, 3)).toEqual([
      'polish_rewrite',
      'tech_organize',
      'kb_qa_guide',
    ]);
  });
});

describe('writeDraftSkill — 单条写入校验', () => {
  it('非法 name → 返回 invalid 且零落盘（不抛）', () => {
    const res = writeDraftSkill({ name: 'bad', description: 'd', instructions: 'i' });
    expect(res).toEqual({ written: false, reason: 'invalid' });
    expect(draftsOf()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('合法草稿 → written:true 且文件可被 listDraftSkills 读回', () => {
    const res = writeDraftSkill({
      name: 'auto_valid',
      description: '描述',
      instructions: '正文',
    });
    expect(res).toEqual({ written: true, reason: 'written' });
    const rows = draftsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'auto_valid',
      description: '描述',
      instructions: '正文',
      status: 'draft',
      source: 'auto',
    });
  });
});

// ---------------------------------------------------------------------------
// D4 — intents 字段（六.2 任务类型标注：提炼 prompt 要求 + 校验 + 落盘往返）
// ---------------------------------------------------------------------------

describe('D4 — 提炼产出的 intents 标注与校验', () => {
  const GOOD = { name: 'auto_ok', description: '正常', instructions: '正常正文' };

  it('intents 含 chat → 拒绝（chat 是无规则 fallback，一律不注入，裁定 3）', () => {
    expect(() => assertValidSkillDraft({ ...GOOD, intents: ['chat'] }, 'd4')).toThrowError(/chat/);
    expect(() =>
      parseSkillDrafts(JSON.stringify([{ ...GOOD, intents: ['chat'] }]))
    ).toThrowError(/chat/);
  });

  it('intents 含白名单外的值 → 拒绝（整批拒写，与其余字段同口径）', () => {
    expect(() =>
      assertValidSkillDraft({ ...GOOD, intents: ['rewrite', 'nope'] }, 'd4')
    ).toThrowError(/intents/);
    expect(() =>
      parseSkillDrafts(JSON.stringify([{ ...GOOD, intents: ['nope'] }]))
    ).toThrowError(/intents/);
  });

  it('intents 是 5 个显式规则意图的子集 → 通过并原样保留', () => {
    const draft = assertValidSkillDraft(
      { ...GOOD, intents: ['rewrite', 'kbQa'] },
      'd4'
    );
    expect(draft.intents).toEqual(['rewrite', 'kbQa']);
    expect(EXPERIENCE_INTENTS).not.toContain('chat');
    expect([...EXPERIENCE_INTENTS].sort()).toEqual(['create', 'kbQa', 'rewrite', 'tech', 'web']);
  });

  it('缺省 intents → 通过且不带该键（老技能兼容，未标注走推断）', () => {
    const draft = assertValidSkillDraft(GOOD, 'd4');
    expect(draft.intents).toBeUndefined();
    expect('intents' in draft).toBe(false);
  });

  it('intents 非数组 / 空数组 / 含非字符串 → 拒绝', () => {
    expect(() =>
      assertValidSkillDraft({ ...GOOD, intents: 'rewrite' }, 'd4')
    ).toThrowError(/intents/);
    expect(() => assertValidSkillDraft({ ...GOOD, intents: [] }, 'd4')).toThrowError(/intents/);
    expect(() =>
      assertValidSkillDraft({ ...GOOD, intents: [1] }, 'd4')
    ).toThrowError(/intents/);
  });

  it('提炼 prompt 要求 LLM 同时标注 intents，且只列 5 个合法值', async () => {
    let systemPrompt = '';
    const deps = makeDeps({
      llm: async (messages) => {
        systemPrompt = String(messages[0]?.content ?? '');
        return '[]';
      },
    });
    await runJob(deps);
    expect(systemPrompt).toContain('intents');
    expect(systemPrompt).toContain('["create","rewrite","kbQa","tech","web"]');
    expect(systemPrompt).toMatch(/chat/); // 明确写「不得使用 chat」
  });

  it('带 intents 的草稿：落盘 front matter 含 intents，确认后仍保留并可被加载读回', () => {
    const res = writeDraftSkill({ ...GOOD, name: 'auto_int_tag', intents: ['rewrite'] });
    expect(res).toEqual({ written: true, reason: 'written' });
    const draftRaw = readFileSync(join(draftsDir, 'auto_int_tag.md'), 'utf-8');
    expect(draftRaw).toContain('intents: rewrite');

    expect(approveDraftSkill('auto_int_tag').ok).toBe(true);
    const activeRaw = readFileSync(join(autoDir, 'auto_int_tag.md'), 'utf-8');
    expect(activeRaw).toContain('intents: rewrite');
    expect(activeRaw).toContain('status: active');

    const loaded = loadSkills(getDefaultSkillDirs()).find((s) => s.name === 'auto_int_tag');
    expect(loaded?.intents).toEqual(['rewrite']);
  });

  it('不带 intents 的旧格式落盘与加载零回归（front matter 不多出空键）', () => {
    const res = writeDraftSkill({ ...GOOD, name: 'auto_legacy_format' });
    expect(res.written).toBe(true);
    const raw = readFileSync(join(draftsDir, 'auto_legacy_format.md'), 'utf-8');
    expect(raw).not.toContain('intents:');
    expect(approveDraftSkill('auto_legacy_format').ok).toBe(true);
    const loaded = loadSkills(getDefaultSkillDirs()).find((s) => s.name === 'auto_legacy_format');
    expect(loaded).not.toHaveProperty('intents');
  });
});
