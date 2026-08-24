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

// 真正写盘/写库的工具名（铁律一禁用）。editBlocks / createFile / createFolder 不在此列——
// 它们只产 proposal 不落盘，另行断言其「仅产 proposal」语义。
const WRITE_NAMES = ['writeFile', 'deleteFile', 'updateFile', 'upsert'];

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
  it('defines exactly the 13 tools (listFiles/readFile/searchKB/runSkill/editBlocks/createFile/createFolder/ask_question_card/preview_patch_files/web_search/analyze_folder/check_links/get_task_activity)', () => {
    const names = defineCoreTools().map((t) => t.function.name);
    expect(names).toEqual(['listFiles', 'readFile', 'searchKB', 'runSkill', 'editBlocks', 'createFile', 'createFolder', 'ask_question_card', 'preview_patch_files', 'web_search', 'analyze_folder', 'check_links', 'get_task_activity']);
  });

  it('has valid OpenAI function schema for every tool', () => {
    for (const t of defineCoreTools()) {
      expect(t.type).toBe('function');
      expect(t.function.name).toBeTruthy();
      expect(t.function.description).toBeTruthy();
      expect(t.function.parameters).toBeTypeOf('object');
    }
  });

  it('registers editBlocks with block_ops schema (改写建议，非落盘工具)', () => {
    const editBlocks = defineCoreTools().find((t) => t.function.name === 'editBlocks');
    expect(editBlocks).toBeDefined();
    const params = editBlocks!.function.parameters as {
      required?: string[];
      properties: {
        block_ops?: {
          items?: {
            properties?: { block_id?: unknown; new_content?: unknown };
            required?: string[];
          };
        };
      };
    };
    expect(params.required).toContain('block_ops');
    expect(params.properties.block_ops?.items?.required).toEqual(['block_id', 'new_content']);
    expect(params.properties.block_ops?.items?.properties).toHaveProperty('block_id');
    expect(params.properties.block_ops?.items?.properties).toHaveProperty('new_content');
  });

  it('contains NO direct-write tools (WRITE_NAMES 均不在；proposal tools 除外)', () => {
    const names = defineCoreTools().map((t) => t.function.name);
    for (const w of WRITE_NAMES) {
      expect(names).not.toContain(w);
    }
    // proposal 型写工具：仅产 proposal，不落盘
    expect(names).toContain('editBlocks');
    expect(names).toContain('createFile');
    expect(names).toContain('createFolder');
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
      skill: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      skills: STUB_SKILLS,
    });
    const res = await executeTool('runSkill', '{"skill":"polish_rewrite","input":"text"}', ctx);
    expect(res.status).toBe('ok');
    expect(res.content).toBe('polished');
    expect(skillMock.runSkill).toHaveBeenCalledTimes(1);
  });

  it('runSkill returns error for unknown skill', async () => {
    const ctx = makeCtx({
      skill: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      skills: STUB_SKILLS,
    });
    const res = await executeTool('runSkill', '{"skill":"nope","input":"x"}', ctx);
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('未找到技能');
  });

  it('editBlocks returns proposal (applied:false) without touching disk/db', async () => {
    const ctx = makeCtx({ currentDocument: '## 原标题\n正文内容' });
    const res = await executeTool(
      'editBlocks',
      '{"block_ops":[{"block_id":"b1","new_content":"## 新标题"}]}',
      ctx
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.applied).toBe(false);
    expect(parsed.proposed).toEqual([{ block_id: 'b1', new_content: '## 新标题' }]);
    expect(parsed.documentSnapshotLength).toBe('## 原标题\n正文内容'.length);
    // 未落盘断言：写阅读工具均未被调用（proposal 只算不写）
    expect(filesMock.listFiles).not.toHaveBeenCalled();
    expect(filesMock.getFile).not.toHaveBeenCalled();
  });

  it('editBlocks returns error when currentDocument context missing', async () => {
    const res = await executeTool(
      'editBlocks',
      '{"block_ops":[{"block_id":"b1","new_content":"m"}]}',
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('当前文档上下文未就绪');
  });

  it('editBlocks returns error for missing block_ops', async () => {
    const ctx = makeCtx({ currentDocument: 'doc' });
    const res = await executeTool('editBlocks', '{}', ctx);
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('缺少 block_ops');
  });

  it('editBlocks rejects invalid block_ops entries (empty block_id/new_content)', async () => {
    const ctx = makeCtx({ currentDocument: 'doc' });
    const res = await executeTool(
      'editBlocks',
      '{"block_ops":[{"block_id":"","new_content":"x"},{"block_id":"b2","new_content":""}]}',
      ctx
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('非空 block_id');
  });

  it('returns structured error for unknown tool name', async () => {
    const res = await executeTool('unknownTool', '{}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('未知工具');
  });

  it('createFile returns proposal JSON without touching disk', async () => {
    const res = await executeTool(
      'createFile',
      '{"file_name":"note.md","content":"# Hello","parent_path":"/docs"}',
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.proposal).toBe(true);
    expect(parsed.type).toBe('createFile');
    expect(parsed.fileName).toBe('note.md');
    expect(parsed.content).toBe('# Hello');
    expect(parsed.parentPath).toBe('/docs');
    // 未落盘断言：写阅读工具均未被调用
    expect(filesMock.listFiles).not.toHaveBeenCalled();
    expect(filesMock.getFile).not.toHaveBeenCalled();
  });

  it('createFile returns error for missing file_name', async () => {
    const res = await executeTool('createFile', '{"content":"x"}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('缺少 file_name');
  });

  it('createFile returns error for missing content', async () => {
    const res = await executeTool('createFile', '{"file_name":"a.md"}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('缺少 file_name');
  });

  it('createFile defaults parentPath to empty when omitted', async () => {
    const res = await executeTool(
      'createFile',
      '{"file_name":"a.md","content":"hi"}',
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.parentPath).toBe('');
  });

  it('createFolder returns proposal JSON without touching disk', async () => {
    const res = await executeTool(
      'createFolder',
      '{"folder_name":"notes","parent_path":"/docs"}',
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.proposal).toBe(true);
    expect(parsed.type).toBe('createFolder');
    expect(parsed.folderName).toBe('notes');
    expect(parsed.parentPath).toBe('/docs');
    expect(filesMock.listFiles).not.toHaveBeenCalled();
  });

  it('createFolder returns error for missing folder_name', async () => {
    const res = await executeTool('createFolder', '{}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('缺少 folder_name');
  });

  it('createFolder defaults parentPath to empty when omitted', async () => {
    const res = await executeTool(
      'createFolder',
      '{"folder_name":"drafts"}',
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.parentPath).toBe('');
  });

  // ---- ask_question_card ----

  it('ask_question_card returns session with phase=asking for valid questions', async () => {
    const args = JSON.stringify({
      questions: [
        { id: 'q1', text: 'What is your goal?', type: 'text' },
        {
          id: 'q2',
          text: 'Which style?',
          type: 'choice',
          options: ['formal', 'casual'],
        },
        { id: 'q3', text: 'Proceed?', type: 'confirm' },
      ],
    });
    const res = await executeTool('ask_question_card', args, makeCtx());
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.success).toBe(true);
    expect(parsed.session.phase).toBe('asking');
    expect(parsed.session.questions).toHaveLength(3);
    expect(parsed.session.answers).toEqual({});
  });

  it('ask_question_card returns error for empty questions array', async () => {
    const res = await executeTool(
      'ask_question_card',
      '{"questions":[]}',
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('1-5');
  });

  it('ask_question_card returns error for more than 5 questions', async () => {
    const questions = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      text: `Question ${i}`,
      type: 'text',
    }));
    const res = await executeTool(
      'ask_question_card',
      JSON.stringify({ questions }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('1-5');
  });

  it('ask_question_card returns error for missing questions array', async () => {
    const res = await executeTool('ask_question_card', '{}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('缺少 questions');
  });

  it('ask_question_card returns error when choice question has no options', async () => {
    const args = JSON.stringify({
      questions: [{ id: 'q1', text: 'Pick one', type: 'choice' }],
    });
    const res = await executeTool('ask_question_card', args, makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('must have options');
  });

  it('ask_question_card supports conditional dependency questions', async () => {
    const args = JSON.stringify({
      questions: [
        {
          id: 'has_key',
          text: 'Do you have an API key?',
          type: 'confirm',
        },
        {
          id: 'key_value',
          text: 'Paste your API key',
          type: 'text',
          dependsOn: 'has_key',
          condition: 'yes',
        },
      ],
    });
    const res = await executeTool('ask_question_card', args, makeCtx());
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content);
    expect(parsed.session.questions).toHaveLength(2);
    expect(parsed.session.questions[1].dependsOn).toBe('has_key');
    expect(parsed.session.questions[1].condition).toBe('yes');
  });

  it('ask_question_card does not touch disk or call other tools', async () => {
    const args = JSON.stringify({
      questions: [{ id: 'q1', text: 'Hello?', type: 'text' }],
    });
    await executeTool('ask_question_card', args, makeCtx());
    expect(filesMock.listFiles).not.toHaveBeenCalled();
    expect(filesMock.getFile).not.toHaveBeenCalled();
  });
});
