// ============================================
// B8 六-1：文档四工具（searchDocument / readPage / extractTable / analyzeChart）
// RED 覆盖面：注册与只读分区 / concurrency 安全 / defer 意图分区 /
// 四工具行为（页码定位、章节、表格清单与 CSV、图表定位）/ readLocalFile 文案一致性。
// ============================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- 附件 DAO mock（四工具的数据源，user_id 归属过滤由 DAO 承担） ---
const attachMock = vi.hoisted(() => ({
  getParsedAttachment: vi.fn(),
  listParsedAttachmentsByConversation: vi.fn(),
}));
vi.mock('@main/db/attachments', () => attachMock);

import {
  defineCoreTools,
  executeTool,
  getDeferredToolSchema,
  type ToolCtx,
} from '@main/ai/toolRegistry';
import {
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  FORCE_CONFIRM_TOOLS,
  toolsForIntent,
} from '@main/ai/agent/agentToolSelector';
import { isToolConcurrencySafe } from '@main/ai/agent/concurrencyDefs';
import { buildAgentSystemPrompt } from '@main/ai/agent/agentPromptBuilder';
import type { ParsedAttachmentRecord } from '@main/db/attachments';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 分页附件正文（3 页，页偏移按内容定位）。 */
const PDF_CONTENT = [
  '# 季度报告',
  '第一季度收入同比增长 12%。',
  '线上渠道贡献显著。',
  '## 收入明细',
  '分区域数据如下。',
  '第三季度成本上升 3%。',
].join('\n');

const PDF_PAGE_OFFSETS = [
  0,
  PDF_CONTENT.indexOf('## 收入明细'),
  PDF_CONTENT.indexOf('第三季度'),
];

function makePdfAttachment(over: Partial<ParsedAttachmentRecord> = {}): ParsedAttachmentRecord {
  return {
    id: 'att-pdf',
    userId: 'u1',
    conversationId: 'c1',
    fileName: 'report.pdf',
    fileType: 'file',
    content: PDF_CONTENT,
    parseStatus: 'done',
    parseVersion: 2,
    structure: {
      parseVersion: 2,
      pageCount: 3,
      pageOffsets: PDF_PAGE_OFFSETS,
      sections: [{ title: '季度报告', path: ['季度报告'] }],
      tables: [
        {
          index: 1,
          sectionPath: ['季度报告', '收入明细'],
          pageIndex: 2,
          csv: 'Region,Q1\nEast,50\nWest,60',
        },
      ],
      images: [{ index: 1, sectionPath: ['季度报告'], pageIndex: 2 }],
    },
    createdAt: 'now',
    ...over,
  };
}

/** 无页码结构的 md 附件（structure 无 pageOffsets）。 */
function makeMdAttachment(over: Partial<ParsedAttachmentRecord> = {}): ParsedAttachmentRecord {
  return {
    id: 'att-md',
    userId: 'u1',
    conversationId: 'c1',
    fileName: 'notes.md',
    fileType: 'file',
    content: '# 随笔\n今天研究了检索召回率问题。\n相关结论见下文。',
    parseStatus: 'done',
    parseVersion: 2,
    structure: {
      parseVersion: 2,
      sections: [{ title: '随笔', path: ['随笔'] }],
      tables: [],
      images: [],
    },
    createdAt: 'now',
    ...over,
  };
}

function makeCtx(over: Partial<ToolCtx> = {}): ToolCtx {
  return { userId: 'u1', currentConversationId: 'c1', ...over };
}

const DOC_TOOLS = ['searchDocument', 'readPage', 'extractTable', 'analyzeChart'] as const;

beforeEach(() => {
  attachMock.getParsedAttachment.mockReset();
  attachMock.listParsedAttachmentsByConversation.mockReset().mockReturnValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 注册与分区（六-1② 硬约束）
// ---------------------------------------------------------------------------

describe('B8 六-1 — 注册与只读分区', () => {
  it('四工具进入注册表且均为 defer_loading（5 核心结构不变）', () => {
    const all = defineCoreTools();
    const names = all.map((t) => t.function.name);
    for (const name of DOC_TOOLS) {
      expect(names).toContain(name);
      const def = all.find((t) => t.function.name === name);
      expect(def?.defer_loading).toBe(true);
    }
    expect(all.filter((t) => !t.defer_loading)).toHaveLength(5);
  });

  it('四工具有完整 JSON Schema（defer 可检索发现，参数名无歧义）', () => {
    const searchSchema = getDeferredToolSchema('searchDocument');
    expect(searchSchema).toBeDefined();
    const params = searchSchema!.function.parameters as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toContain('query');
    expect(Object.keys(params.properties)).toEqual(
      expect.arrayContaining(['query', 'attachment_id', 'file_name'])
    );

    const pageSchema = getDeferredToolSchema('readPage');
    const pageParams = pageSchema!.function.parameters as { required?: string[] };
    expect(pageParams.required).toContain('page');

    expect(getDeferredToolSchema('extractTable')).toBeDefined();
    expect(getDeferredToolSchema('analyzeChart')).toBeDefined();
  });

  it('四工具落只读区：READ_ONLY_TOOLS 包含，WRITE_TOOLS / FORCE_CONFIRM_TOOLS 不含', () => {
    for (const name of DOC_TOOLS) {
      expect(READ_ONLY_TOOLS.has(name)).toBe(true);
      expect(WRITE_TOOLS.has(name)).toBe(false);
      expect(FORCE_CONFIRM_TOOLS.has(name)).toBe(false);
    }
  });

  it('陈旧工具名（readFileRevision/listFileRevisions/getFileInfo）已从 selector 清理', () => {
    expect(READ_ONLY_TOOLS.has('readFileRevision')).toBe(false);
    expect(READ_ONLY_TOOLS.has('listFileRevisions')).toBe(false);
    expect(READ_ONLY_TOOLS.has('getFileInfo')).toBe(false);
    // registry 中本就不存在 —— 清理后集合与 handlerMap 一致
    const registryNames = new Set(defineCoreTools().map((t) => t.function.name));
    for (const stale of ['readFileRevision', 'listFileRevisions', 'getFileInfo']) {
      expect(registryNames.has(stale)).toBe(false);
    }
  });

  it('四工具注册 concurrencyDefs 并发安全（不落 fail-closed 串行陷阱）', () => {
    for (const name of DOC_TOOLS) {
      expect(isToolConcurrencySafe(name, {}), `${name} 应并发安全`).toBe(true);
    }
  });

  it('陈旧工具名已从 concurrencyDefs 清理（未知 → fail-closed 串行）', () => {
    for (const stale of ['readFileRevision', 'listFileRevisions', 'getFileInfo']) {
      expect(isToolConcurrencySafe(stale, {})).toBe(false);
    }
  });

  it('toolsForIntent 各意图均注入四工具（chat/kbQa/create 三型断言）', () => {
    for (const intent of ['chat', 'kbQa', 'create'] as const) {
      const tools = toolsForIntent(
        { intent, confidence: 0.9 } as never,
        true,
        true,
        undefined,
        false,
        false
      );
      const names = tools.map((t) => t.function.name);
      for (const name of DOC_TOOLS) {
        expect(names, `${intent} 意图应含 ${name}`).toContain(name);
      }
    }
  });

  it('系统提示词含文档工具路由（工具规则引导，防模型选错工具）', () => {
    const prompt = buildAgentSystemPrompt('', '', false);
    expect(prompt).toContain('searchDocument');
    expect(prompt).toContain('searchKB');
  });

  it('executeTool 已接线：调用四工具不再返回「未知工具」', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([makePdfAttachment()]);
    const res = await executeTool('searchDocument', '{"query":"收入"}', makeCtx());
    expect(res.errorDesc ?? '').not.toContain('未知工具');
    expect(res.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// searchDocument
// ---------------------------------------------------------------------------

describe('searchDocument — 关键词检索与页码/章节定位', () => {
  it('命中返回 offset/snippet/page/sectionPath（页码真实、章节取匹配处标题栈）', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([makePdfAttachment()]);
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '收入' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      attachmentId: string;
      fileName: string;
      matchCount: number;
      matches: Array<{
        offset: number;
        snippet: string;
        page?: number;
        sectionPath: string[];
      }>;
    };
    expect(parsed.attachmentId).toBe('att-pdf');
    expect(parsed.fileName).toBe('report.pdf');
    expect(parsed.matchCount).toBeGreaterThanOrEqual(2);
    const first = parsed.matches[0];
    expect(first.page).toBe(1);
    expect(first.sectionPath).toEqual(['季度报告']);
    expect(first.snippet).toContain('同比增长');
    // 第二处命中位于第 2 页（## 收入明细 之后）
    const second = parsed.matches.find((m) => m.page === 2);
    expect(second).toBeDefined();
  });

  it('md 附件无 pageOffsets → 结果不含 page 字段（向后兼容降级）', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([makeMdAttachment()]);
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '召回率' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      matches: Array<{ page?: number; sectionPath: string[] }>;
    };
    expect(parsed.matches.length).toBeGreaterThan(0);
    expect(parsed.matches[0].page).toBeUndefined();
    expect(parsed.matches[0].sectionPath).toEqual(['随笔']);
  });

  it('top_k 默认 5、显式值截断', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([makeMdAttachment()]);
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '结', top_k: 1 }),
      makeCtx()
    );
    const parsed = JSON.parse(res.content) as { matchCount: number; matches: unknown[] };
    expect(parsed.matches.length).toBeLessThanOrEqual(1);
    expect(parsed.matchCount).toBeLessThanOrEqual(1);
  });

  it('无匹配 → ok 且空 matches（不报错，模型可换词重试）', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([makeMdAttachment()]);
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '不存在的词xyz' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as { matchCount: number; matches: unknown[] };
    expect(parsed.matchCount).toBe(0);
    expect(parsed.matches).toHaveLength(0);
  });

  it('多附件会话未指定 → 错误列出可用文件名（引导重试）', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([
      makePdfAttachment(),
      makeMdAttachment(),
    ]);
    const res = await executeTool('searchDocument', '{"query":"收入"}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('report.pdf');
    expect(res.errorDesc).toContain('notes.md');
  });

  it('attachment_id 不存在/跨用户 → 归属错误（DAO 按 user_id 过滤）', async () => {
    attachMock.getParsedAttachment.mockReturnValue(null);
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: 'x', attachment_id: 'nope' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('附件不存在');
    expect(attachMock.getParsedAttachment).toHaveBeenCalledWith('nope', 'u1');
  });

  it('附件未解析完成 → 显式状态错误', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makePdfAttachment({ parseStatus: 'processing' })
    );
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '收入', attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('尚未解析');
  });

  it('缺少 query → 参数错误', async () => {
    const res = await executeTool('searchDocument', '{}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('query');
  });

  it('file_name 按名匹配会话附件；名字不存在 → 错误列出可用名', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([
      makePdfAttachment(),
      makeMdAttachment(),
    ]);
    const ok = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '收入', file_name: 'report.pdf' }),
      makeCtx()
    );
    expect(ok.status).toBe('ok');
    expect(JSON.parse(ok.content).attachmentId).toBe('att-pdf');

    const miss = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '收入', file_name: 'other.pdf' }),
      makeCtx()
    );
    expect(miss.status).toBe('error');
    expect(miss.errorDesc).toContain('report.pdf');
  });

  it('无提示且会话内全部未解析 → 错误指引上传/改用 searchKB', async () => {
    attachMock.listParsedAttachmentsByConversation.mockReturnValue([
      makePdfAttachment({ parseStatus: 'processing' }),
    ]);
    const res = await executeTool('searchDocument', '{"query":"x"}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('searchKB');
  });

  it('无会话上下文且无 attachment_id → 参数错误', async () => {
    const res = await executeTool(
      'searchDocument',
      '{"query":"x"}',
      makeCtx({ currentConversationId: undefined })
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('attachment_id');
  });

  it('正文无标题（txt 型）→ sectionPath 空数组降级', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makeMdAttachment({
        content: '纯文本正文，讨论召回率问题。',
        structure: { parseVersion: 2, tables: [], images: [] },
      })
    );
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '召回率', attachment_id: 'att-md' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as { matches: Array<{ sectionPath: string[] }> };
    expect(parsed.matches[0].sectionPath).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R3 searchDocument 外发闸 + 会话边界（L4 fail-closed）
// 裁定：当前会话用户主动上传且落库的附件豁免 allowSend 闸；跨会话/未授权恒拒。
// ToolCtx 缺 attachmentEgressAllowed 字段视为 false（fail-closed）。
// ---------------------------------------------------------------------------

describe('R3 外发双检矩阵 — allowSend × 本会话/跨会话 × 勾选授权（L4）', () => {
  interface MatrixCell {
    allowSend: boolean;
    granted: boolean;
    inCurrentSession: boolean;
    expectOk: boolean;
    reason?: string;
  }
  const CELLS: MatrixCell[] = [
    // 本会话：裁定豁免 —— 不受 allowSend / 授权状态影响，恒放行
    { allowSend: true, granted: true, inCurrentSession: true, expectOk: true },
    { allowSend: true, granted: false, inCurrentSession: true, expectOk: true },
    { allowSend: false, granted: true, inCurrentSession: true, expectOk: true },
    { allowSend: false, granted: false, inCurrentSession: true, expectOk: true },
    // 跨会话：恒拒（外发未授权时报外发原因，已授权时报会话边界原因）
    { allowSend: true, granted: true, inCurrentSession: false, expectOk: false, reason: '不属于当前会话' },
    { allowSend: true, granted: false, inCurrentSession: false, expectOk: false, reason: '不属于当前会话' },
    { allowSend: false, granted: true, inCurrentSession: false, expectOk: false, reason: '不属于当前会话' },
    { allowSend: false, granted: false, inCurrentSession: false, expectOk: false, reason: '外发未授权' },
  ];

  for (const cell of CELLS) {
    const label = [
      `allowSend=${cell.allowSend ? 'T' : 'F'}`,
      cell.inCurrentSession ? '本会话' : '跨会话',
      cell.granted ? '勾选授权' : '未授权',
      cell.expectOk ? '→ 放行' : `→ 拦截「${cell.reason ?? ''}」`,
    ].join(' × ');
    it(label, async () => {
      attachMock.getParsedAttachment.mockReturnValue(
        makePdfAttachment({
          conversationId: cell.inCurrentSession ? 'c1' : 'c-other',
        })
      );
      // 外发标志 = allowSend ∨ 勾选授权（agentContext 同口径：kbEgressAuthorized || kbAttachmentEgressGranted）
      const res = await executeTool(
        'searchDocument',
        JSON.stringify({ query: '收入', attachment_id: 'att-pdf' }),
        makeCtx({ attachmentEgressAllowed: cell.allowSend || cell.granted })
      );
      if (cell.expectOk) {
        expect(res.status).toBe('ok');
      } else {
        expect(res.status).toBe('error');
        expect(res.errorDesc).toContain(cell.reason ?? '');
      }
    });
  }

  it('ToolCtx 缺 attachmentEgressAllowed → 跨会话附件 fail-closed 拒「外发未授权」', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makePdfAttachment({ conversationId: 'c-other' })
    );
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '收入', attachment_id: 'att-pdf' }),
      makeCtx({ attachmentEgressAllowed: undefined })
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('外发未授权');
  });

  it('ToolCtx 缺 attachmentEgressAllowed → 本会话附件仍按裁定豁免放行', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makePdfAttachment({ conversationId: 'c1' })
    );
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: '收入', attachment_id: 'att-pdf' }),
      makeCtx({ attachmentEgressAllowed: undefined })
    );
    expect(res.status).toBe('ok');
  });

  it('跨用户 attachment_id（DAO user_id 过滤为 null）→ 先拒归属，不进外发闸', async () => {
    attachMock.getParsedAttachment.mockReturnValue(null);
    const res = await executeTool(
      'searchDocument',
      JSON.stringify({ query: 'x', attachment_id: 'foreign' }),
      makeCtx({ attachmentEgressAllowed: true })
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('附件不存在');
  });

  it('四工具同洞共闸：readPage 同样被会话边界拦截', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makePdfAttachment({ conversationId: 'c-other' })
    );
    const res = await executeTool(
      'readPage',
      JSON.stringify({ attachment_id: 'att-pdf', page: 1 }),
      makeCtx({ attachmentEgressAllowed: true })
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('不属于当前会话');
  });
});

// ---------------------------------------------------------------------------
// readPage
// ---------------------------------------------------------------------------

describe('readPage — 按页读取', () => {
  it('按 pageOffsets 切片返回指定页正文（页码来自 B7 真实页偏移）', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'readPage',
      JSON.stringify({ page: 2, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      page: number;
      pageCount: number;
      text: string;
      fileName: string;
    };
    expect(parsed.page).toBe(2);
    expect(parsed.pageCount).toBe(3);
    expect(parsed.text).toContain('## 收入明细');
    expect(parsed.text).not.toContain('第一季度');
    expect(parsed.fileName).toBe('report.pdf');
  });

  it('page 超范围 → 错误含有效区间', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'readPage',
      JSON.stringify({ page: 9, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('1-3');
  });

  it('缺 page → 参数错误', async () => {
    const res = await executeTool('readPage', '{}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('page');
  });

  it('page 非整数 → 参数错误', async () => {
    const res = await executeTool('readPage', JSON.stringify({ page: 1.5 }), makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('page');
  });

  it('md/txt 无页码结构 → 错误并指引 searchDocument', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makeMdAttachment());
    const res = await executeTool(
      'readPage',
      JSON.stringify({ page: 1, attachment_id: 'att-md' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('页码');
    expect(res.errorDesc).toContain('searchDocument');
  });
});

// ---------------------------------------------------------------------------
// extractTable
// ---------------------------------------------------------------------------

describe('extractTable — 表格清单与 CSV 提取', () => {
  it('不带 table_index → 清单含序号/章节/页码/行列数', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool('extractTable', '{"attachment_id":"att-pdf"}', makeCtx());
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      tables: Array<{ index: number; rows: number; cols: number; pageIndex?: number; sectionPath: string[] }>;
    };
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].index).toBe(1);
    expect(parsed.tables[0].rows).toBe(3);
    expect(parsed.tables[0].cols).toBe(2);
    expect(parsed.tables[0].pageIndex).toBe(2);
    expect(parsed.tables[0].sectionPath).toEqual(['季度报告', '收入明细']);
  });

  it('带 table_index → 返回完整 CSV（handler 层不截断，超预算交 S6 落盘）', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'extractTable',
      JSON.stringify({ table_index: 1, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      table: { index: number; csv: string; rows: number; cols: number };
    };
    expect(parsed.table.index).toBe(1);
    expect(parsed.table.csv).toBe('Region,Q1\nEast,50\nWest,60');
    expect(parsed.table.rows).toBe(3);
    expect(parsed.table.cols).toBe(2);
  });

  it('大 CSV 返回完整内容（>10k 字符不被 handler 自行截断）', async () => {
    const bigCsv = ['H1,H2', ...Array.from({ length: 6000 }, (_, i) => `a${i},b${i}`)].join('\n');
    attachMock.getParsedAttachment.mockReturnValue(
      makePdfAttachment({
        structure: {
          parseVersion: 2,
          tables: [{ index: 1, sectionPath: [], pageIndex: 1, csv: bigCsv }],
        },
      })
    );
    const res = await executeTool(
      'extractTable',
      JSON.stringify({ table_index: 1, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    expect(JSON.parse(res.content).table.csv).toHaveLength(bigCsv.length);
  });

  it('附件无表格 → 错误提示', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makeMdAttachment());
    const res = await executeTool('extractTable', '{"attachment_id":"att-md"}', makeCtx());
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('表格');
  });

  it('table_index 不存在 → 错误含总数', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'extractTable',
      JSON.stringify({ table_index: 5, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('1');
  });

  it('引号含逗号的 CSV 计列不误拆（引号感知拆分）', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makePdfAttachment({
        structure: {
          parseVersion: 2,
          tables: [
            { index: 1, sectionPath: [], csv: 'Name,Note\n"Smith, J.","a,b"' },
          ],
        },
      })
    );
    const res = await executeTool(
      'extractTable',
      JSON.stringify({ table_index: 1, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    const table = JSON.parse(res.content).table as { rows: number; cols: number };
    expect(table.rows).toBe(2);
    expect(table.cols).toBe(2);
  });

  it('表格缺 CSV 结构 → 错误指引 searchDocument', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makePdfAttachment({
        structure: { parseVersion: 2, tables: [{ index: 1, sectionPath: [] }] },
      })
    );
    const res = await executeTool(
      'extractTable',
      JSON.stringify({ table_index: 1, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('searchDocument');
  });

  it('table_index 非正整数 → 参数错误', async () => {
    const res = await executeTool(
      'extractTable',
      JSON.stringify({ table_index: 0.5 }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('table_index');
  });
});

// ---------------------------------------------------------------------------
// analyzeChart
// ---------------------------------------------------------------------------

describe('analyzeChart — 图表定位与结构化上下文', () => {
  it('page 定位 → 页码 + 上下文摘录 + 同页关联数据表', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'analyzeChart',
      JSON.stringify({ page: 2, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      location: { page?: number; imageIndex?: number; sectionPath?: string[] };
      excerpt: string;
      tables: Array<{ index: number; csv?: string }>;
      note: string;
    };
    expect(parsed.location.page).toBe(2);
    expect(parsed.excerpt).toContain('## 收入明细');
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].csv).toContain('Region,Q1');
    // 显式说明：像素识读不在工具内（D 路线解析期已转数据表）
    expect(parsed.note).toContain('识读');
  });

  it('image_index 定位（无页码 docx 图片）→ 章节路径 + 同章节表格', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makeMdAttachment({
        fileName: 'report.docx',
        content: '# 图表章节\n说明文字。\n数据表在下方。',
        structure: {
          parseVersion: 2,
          sections: [{ title: '图表章节', path: ['图表章节'] }],
          tables: [{ index: 1, sectionPath: ['图表章节'], csv: 'A,B\n1,2' }],
          images: [{ index: 1, sectionPath: ['图表章节'] }],
        },
      })
    );
    const res = await executeTool(
      'analyzeChart',
      JSON.stringify({ image_index: 1, attachment_id: 'att-md' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      location: { imageIndex?: number; sectionPath?: string[] };
      excerpt: string;
      tables: unknown[];
    };
    expect(parsed.location.imageIndex).toBe(1);
    expect(parsed.location.sectionPath).toEqual(['图表章节']);
    expect(parsed.excerpt).toContain('说明文字');
    expect(parsed.tables).toHaveLength(1);
  });

  it('缺 page 与 image_index → 参数错误（引导二选一）', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'analyzeChart',
      JSON.stringify({ attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('page');
    expect(res.errorDesc).toContain('image_index');
  });

  it('image_index 不存在 → 错误（该附件未记录此图片序号）', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'analyzeChart',
      JSON.stringify({ image_index: 7, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('7');
  });

  it('图片带 pageIndex 但附件无页码结构 → 回落章节摘录，不报错', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makeMdAttachment({
        fileName: 'report.docx',
        content: '# 图表章节\n说明文字。\n下一段。',
        structure: {
          parseVersion: 2,
          sections: [{ title: '图表章节', path: ['图表章节'] }],
          tables: [{ index: 1, sectionPath: ['图表章节'], csv: 'A,B\n1,2' }],
          images: [{ index: 1, sectionPath: ['图表章节'], pageIndex: 3 }],
        },
      })
    );
    const res = await executeTool(
      'analyzeChart',
      JSON.stringify({ image_index: 1, attachment_id: 'att-md' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    const parsed = JSON.parse(res.content) as {
      location: { page?: number };
      excerpt: string;
      tables: unknown[];
    };
    expect(parsed.location.page).toBe(3);
    expect(parsed.excerpt).toContain('说明文字');
    expect(parsed.tables).toHaveLength(1);
  });

  it('章节路径在正文无对应标题 → excerpt 降级为空（不抛）', async () => {
    attachMock.getParsedAttachment.mockReturnValue(
      makeMdAttachment({
        fileName: 'report.docx',
        content: '没有标题的正文。',
        structure: {
          parseVersion: 2,
          tables: [],
          images: [{ index: 1, sectionPath: ['不存在的章节'] }],
        },
      })
    );
    const res = await executeTool(
      'analyzeChart',
      JSON.stringify({ image_index: 1, attachment_id: 'att-md' }),
      makeCtx()
    );
    expect(res.status).toBe('ok');
    expect(JSON.parse(res.content).excerpt).toBeUndefined();
  });

  it('page 超出页码范围 → 错误含有效区间', async () => {
    attachMock.getParsedAttachment.mockReturnValue(makePdfAttachment());
    const res = await executeTool(
      'analyzeChart',
      JSON.stringify({ page: 9, attachment_id: 'att-pdf' }),
      makeCtx()
    );
    expect(res.status).toBe('error');
    expect(res.errorDesc).toContain('1-3');
  });
});

// ---------------------------------------------------------------------------
// readLocalFile 文案与实现一致（六-1② 择一记录：修正文案）
// ---------------------------------------------------------------------------

describe('readLocalFile — 超限错误文案不再指向不存在的 readFile 分块', () => {
  it('>1MB 文件错误文案不提 readFile 分块读取', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const big = path.join(os.tmpdir(), `weavemd-b8-big-${Date.now()}.txt`);
    fs.writeFileSync(big, 'x'.repeat(1_100_000));
    try {
      const res = await executeTool(
        'readLocalFile',
        JSON.stringify({ file_path: big }),
        makeCtx()
      );
      expect(res.status).toBe('error');
      expect(res.errorDesc).toContain('1000KB');
      expect(res.errorDesc).not.toContain('readFile 分块');
    } finally {
      fs.rmSync(big, { force: true });
    }
  });
});
