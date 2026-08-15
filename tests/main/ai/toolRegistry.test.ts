import { beforeEach, describe, expect, it, vi } from 'vitest';

const filesMock = vi.hoisted(() => ({
  listFiles: vi.fn(),
  getFile: vi.fn(),
}));
vi.mock('@main/db/files', () => filesMock);

const skillMock = vi.hoisted(() => ({ runSkill: vi.fn() }));
vi.mock('@main/ai/skillLoader', () => skillMock);

import { defineCoreTools, executeTool, type SearchKbFn, type ToolCtx } from '@main/ai/toolRegistry';
import type { CoreSkill } from '@main/ai/skillLoader';

const WRITE_NAMES = ['editBlocks', 'writeFile', 'createFile', 'deleteFile', 'updateFile', 'upsert'];

const STUB_SKILLS: CoreSkill[] = [
  {
    name: 'polish_rewrite',
    description: '润色',
    instructions: '润色指令',
  },
];

function makeCtx(over: Partial<ToolCtx> = {}): ToolCtx {
  return { userId: 'u1', ...over };
}

describe('toolRegistry.defineCoreTools', () => {
  it('defines exactly the 4 read-only tools', () => {
    const names = defineCoreTools().map((t) => t.function.name);
    expect(names).toEqual(['listFiles', 'readFile', 'searchKB', 'runSkill']);
  });

  it('has valid OpenAI function schema for every tool', () => {
    for (const t of defineCoreTools()) {
      expect(t.type).toBe('function');
      expect(t.function.name).toBeTruthy();
      expect(t.function.description).toBeTruthy();
      expect(t.function.parameters).toBeTypeOf('object');
    }
  });

  it('contains NO write/edit tools (铁律一：无直接落盘)', () => {
    const names = defineCoreTools().map((t) => t.function.name);
    for (const w of WRITE_NAMES) {
      expect(names).not.toContain(w);
    }
  });
});

describe('toolRegistry.executeTool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('listFiles returns file summary bound to ctx.userId', async () => {
    filesMock.listFiles.mockReturnValue([
      {
        id: 'f1',
        userId: 'u1',
        name: 'a.md',
        content: 'x',
        createdAt: 'now',
        modifiedAt: 't1',
        deletedAt: null,
      },
    ]);
    const res = await executeTool('listFiles', '{}', makeCtx());
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed).toEqual([
      { name: 'a.md', fileId: 'f1', modifiedAt: 't1' },
    ]);
    expect(filesMock.listFiles).toHaveBeenCalledWith('u1');
  });

  it('readFile returns content for existing owned file', async () => {
    filesMock.getFile.mockReturnValue({
      id: 'f1',
      userId: 'u1',
      name: 'a.md',
      content: '## Heading',
      createdAt: 'now',
      modifiedAt: 't1',
      deletedAt: null,
    });
    const res = await executeTool('readFile', '{"file_id":"f1"}', makeCtx());
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed).toEqual({
      name: 'a.md',
      content: '## Heading',
      modifiedAt: 't1',
    });
    expect(filesMock.getFile).toHaveBeenCalledWith('f1', 'u1');
  });

  it('readFile returns error for missing/unauthorized file', async () => {
    filesMock.getFile.mockReturnValue(undefined);
    const res = await executeTool('readFile', '{"file_id":"none"}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('文件不存在');
  });

  it('searchKB returns results via injected searchKb with ctx.userId', async () => {
    const searchKb: SearchKbFn = vi.fn(async () => ({
      refused: false,
      threshold: 0.6,
      best: null,
      results: [{ docId: 'd', chunkId: 'c', fileName: 'a.md', content: 'seg', seq: 1, score: 0.9, pinned: false, sourceRef: null }],
    }));
    const res = await executeTool('searchKB', '{"query":"FTS5"}', makeCtx({ searchKb }));
    expect(res.status).toBe('ok');
    expect(searchKb).toHaveBeenCalledWith('u1', 'FTS5', expect.anything());
    const parsed = JSON.parse(res.content);
    expect(parsed[0].fileName).toBe('a.md');
  });

  it('searchKB refuses response is surfaced as ok with refused flag', async () => {
    const searchKb: SearchKbFn = vi.fn(async () => ({
      refused: true,
      threshold: 0.6,
      best: null,
      results: [],
    }));
    const res = await executeTool('searchKB', '{"query":"xyz"}', makeCtx({ searchKb }));
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.refused).toBe(true);
  });

  it('searchKB returns error when searchKb not injected', async () => {
    const res = await executeTool('searchKB', '{"query":"x"}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('知识库未就绪');
  });

  it('runSkill executes via skillLoader for a known skill', async () => {
    skillMock.runSkill.mockResolvedValue({ content: 'polished', status: 'ok' });
    const ctx = makeCtx({
      skill: { backend: 'remote', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      skills: STUB_SKILLS,
    });
    const res = await executeTool('runSkill', '{"skill":"polish_rewrite","input":"text"}', ctx);
    expect(res.status).toBe('ok');
    expect(res.content).toBe('polished');
    expect(skillMock.runSkill).toHaveBeenCalledTimes(1);
  });

  it('runSkill returns error for unknown skill', async () => {
    const ctx = makeCtx({
      skill: { backend: 'remote', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      skills: STUB_SKILLS,
    });
    const res = await executeTool('runSkill', '{"skill":"nope","input":"x"}', ctx);
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('未找到技能');
  });

  it('returns structured error for unknown tool name', async () => {
    const res = await executeTool('unknownTool', '{}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('未知工具');
  });
});
