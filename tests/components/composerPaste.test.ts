// ============================================
// B2 一-3②：Composer 粘贴上传（图片双兜底 / 7 格式文件分支 / 防文本重复插入）
// + 一-1/一-2：路径数组逐个解析、单文件失败不断批
// 逻辑抽自 AIPanelComposer（composer/pasteAttachment.ts 纯函数，无组件渲染）
// ============================================
import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';

import {
  handleComposerPaste,
  ingestFilePaths,
  buildAttachmentSendText,
  toAttachmentPayloads,
  validateImageAttachment,
  type Attachment,
  type ComposerPasteDeps,
} from '@render/components/AIAgent/composer/pasteAttachment';

// ---------- helpers ----------

function makeView(): { view: EditorView; insertText: ReturnType<typeof vi.fn> } {
  const insertText = vi.fn();
  const view = {
    state: { tr: { insertText } },
    dispatch: vi.fn(),
  } as unknown as EditorView;
  return { view, insertText };
}

interface ClipboardDataOpts {
  items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
  files?: File[];
  text?: string;
  linkPreview?: string;
}

function makeClipboardData(opts: ClipboardDataOpts = {}): unknown {
  return {
    items: opts.items ?? [],
    files: opts.files ?? [],
    getData: (format: string): string => {
      if (format === 'text/plain') return opts.text ?? '';
      if (format === 'text/link-preview') return opts.linkPreview ?? '';
      return '';
    },
  };
}

function makePasteEvent(clipboardData: unknown): ClipboardEvent {
  const ev = new Event('paste', { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, 'clipboardData', { value: clipboardData, configurable: true });
  return ev;
}

function makeImageFile(name = 'shot.png', type = 'image/png'): File {
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  return new File([bytes], name, { type });
}

/** 给 File 附加 Electron 本地路径（Electron 31 的 File.path 属性模拟） */
function withPath(file: File, path: string): File {
  Object.defineProperty(file, 'path', { value: path, configurable: true });
  return file;
}

type PasteDepsWithMock = { addAttachment: ReturnType<typeof vi.fn> } & ComposerPasteDeps;

function baseDeps(overrides: Partial<ComposerPasteDeps> = {}): PasteDepsWithMock {
  const addAttachment = vi.fn();
  const deps: ComposerPasteDeps = { addAttachment, ...overrides };
  return { ...deps, addAttachment } as PasteDepsWithMock;
}

// ---------- handleComposerPaste：图片双兜底 ----------

describe('handleComposerPaste — 图片粘贴双兜底（照 ContentBlock 范式）', () => {
  it('方式1：clipboardData.items 含图片项 → 返回 true 且异步入图片附件（data URL 临时引用）', async () => {
    const deps = baseDeps();
    const { view } = makeView();
    const file = makeImageFile();
    const event = makePasteEvent(
      makeClipboardData({
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      })
    );

    const handled = handleComposerPaste(view, event, deps);

    // 同步返回 true → 阻止默认粘贴（防文本重复插入）
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(deps.addAttachment).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const att = deps.addAttachment.mock.calls[0][0] as {
      type: string;
      name: string;
      content?: string;
    };
    expect(att.type).toBe('image');
    expect(att.name).toMatch(/^clipboard-[a-z0-9]+\.png$/);
    expect(att.content).toMatch(/^data:image\/png/);
  });

  it('方式1 降级：items 无图片但 files 含图片 → 仍走图片分支', async () => {
    const deps = baseDeps();
    const { view } = makeView();
    const file = makeImageFile('pasted.jpg', 'image/jpeg');
    const event = makePasteEvent(makeClipboardData({ files: [file] }));

    const handled = handleComposerPaste(view, event, deps);

    expect(handled).toBe(true);
    await vi.waitFor(() => expect(deps.addAttachment).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const att = deps.addAttachment.mock.calls[0][0] as { type: string; name: string };
    expect(att.type).toBe('image');
    expect(att.name).toMatch(/^clipboard-[a-z0-9]+\.jpg$/);
  });

  it('方式2：无图片信号 + Electron api.clipboard.readImage() 兜底 → 入图片附件', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const readElectronImage = vi.fn(async () => dataUrl);
    const deps = baseDeps({ readElectronImage });
    const { view } = makeView();
    const event = makePasteEvent(makeClipboardData({}));

    const handled = handleComposerPaste(view, event, deps);

    // 无文本可插入 → 同步 return true 阻止默认（防重复插入）
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(deps.addAttachment).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(readElectronImage).toHaveBeenCalledTimes(1);
    const att = deps.addAttachment.mock.calls[0][0] as { type: string; content?: string };
    expect(att.type).toBe('image');
    expect(att.content).toBe(dataUrl);
  });

  it('方式2 无图：Electron 兜底返回 null → 不入附件也不崩溃', async () => {
    const deps = baseDeps({ readElectronImage: vi.fn(async () => null) });
    const { view } = makeView();
    const event = makePasteEvent(makeClipboardData({}));

    const handled = handleComposerPaste(view, event, deps);

    expect(handled).toBe(true);
    await flushMicroTasks();
    expect(deps.addAttachment).not.toHaveBeenCalled();
  });
});

// ---------- handleComposerPaste：7 格式文件分支 ----------

describe('handleComposerPaste — DataTransfer.files 7 格式分支', () => {
  it('有本地路径的文档文件 → 返回 true 且收集 paths 交解析层（保序）', () => {
    const parsePaths = vi.fn(async (_paths: string[]) => undefined);
    const deps = baseDeps({ parsePaths });
    const { view } = makeView();
    const f1 = withPath(new File(['a'], 'b.pdf', { type: 'application/pdf' }), 'C:\\d\\b.pdf');
    const f2 = withPath(new File(['b'], 'a.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }), 'C:\\d\\a.xlsx');
    const event = makePasteEvent(makeClipboardData({ files: [f1, f2], text: 'C:\\d' }));

    const handled = handleComposerPaste(view, event, deps);

    expect(handled).toBe(true);
    expect(parsePaths).toHaveBeenCalledTimes(1);
    expect(parsePaths.mock.calls[0][0]).toEqual(['C:\\d\\b.pdf', 'C:\\d\\a.xlsx']);
  });

  it('无路径的文本格式（txt/md）→ 浏览器读文本入附件（B3 统一持久化前的临时通道）', async () => {
    const deps = baseDeps();
    const { view } = makeView();
    const file = new File(['# hi\nbody'], 'note.md', { type: 'text/markdown' });
    const event = makePasteEvent(makeClipboardData({ files: [file] }));

    const handled = handleComposerPaste(view, event, deps);

    expect(handled).toBe(true);
    await vi.waitFor(() => expect(deps.addAttachment).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const att = deps.addAttachment.mock.calls[0][0] as {
      type: string;
      name: string;
      content?: string;
    };
    expect(att.type).toBe('file');
    expect(att.name).toBe('note.md');
    expect(att.content).toBe('# hi\nbody');
  });

  it('无路径二进制（pdf）跳过但不断批：同批 txt 仍处理', async () => {
    const deps = baseDeps();
    const { view } = makeView();
    const pdf = new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' });
    const txt = new File(['plain'], 'ok.txt', { type: 'text/plain' });
    const event = makePasteEvent(makeClipboardData({ files: [pdf, txt] }));

    const handled = handleComposerPaste(view, event, deps);

    expect(handled).toBe(true);
    await vi.waitFor(() => expect(deps.addAttachment).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const att = deps.addAttachment.mock.calls[0][0] as { name: string };
    expect(att.name).toBe('ok.txt');
  });

  it('白名单外文件（zip）忽略，返回 false 走默认粘贴', () => {
    const deps = baseDeps();
    const { view } = makeView();
    const zip = new File(['PK'], 'pkg.zip', { type: 'application/zip' });
    const event = makePasteEvent(makeClipboardData({ files: [zip], text: 'pkg.zip' }));

    const handled = handleComposerPaste(view, event, deps);

    expect(handled).toBe(false);
    expect(deps.addAttachment).not.toHaveBeenCalled();
    expect(deps.parsePaths).toBeUndefined();
  });
});

// ---------- handleComposerPaste：文本行为保持 + 防重复 ----------

describe('handleComposerPaste — 既有文本行为与防重复插入', () => {
  it('普通纯文本 → 返回 false（交给默认粘贴，不重复处理）', () => {
    const deps = baseDeps();
    const { view } = makeView();
    const event = makePasteEvent(makeClipboardData({ text: 'hello world' }));

    expect(handleComposerPaste(view, event, deps)).toBe(false);
    expect(deps.addAttachment).not.toHaveBeenCalled();
  });

  it('纯文本 URL → 返回 true 且插入原文 URL', () => {
    const deps = baseDeps();
    const { view, insertText } = makeView();
    const event = makePasteEvent(
      makeClipboardData({ text: 'https://example.com/a' })
    );

    expect(handleComposerPaste(view, event, deps)).toBe(true);
    expect(insertText).toHaveBeenCalledWith('https://example.com/a');
  });

  it('text/link-preview → 返回 true 且插入原始 URL 而非 HTML 标题', () => {
    const deps = baseDeps();
    const { view, insertText } = makeView();
    const event = makePasteEvent(
      makeClipboardData({
        linkPreview: JSON.stringify({ url: 'https://origin.example' }),
        text: 'https://title.example',
      })
    );

    expect(handleComposerPaste(view, event, deps)).toBe(true);
    expect(insertText).toHaveBeenCalledWith('https://origin.example');
  });

  it('clipboardData 缺失 → 返回 false 不崩溃', () => {
    const deps = baseDeps();
    const { view } = makeView();
    const ev = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: null, configurable: true });

    expect(handleComposerPaste(view, ev, deps)).toBe(false);
  });
});

// ---------- ingestFilePaths：批量解析 ----------

describe('validateImageAttachment — 图片格式入口校验（B6 五-2②）', () => {
  it('svg → 拒绝并给出可读原因', () => {
    const out = validateImageAttachment('logo.svg');
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('SVG');
  });

  it('白名单外格式 → 拒绝并列出支持格式', () => {
    const out = validateImageAttachment('scan.tiff');
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('png');
  });

  it('png/jpg/jpeg/gif/webp/bmp → 通过', () => {
    for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp']) {
      expect(validateImageAttachment(name).ok).toBe(true);
    }
  });
});

describe('handleComposerPaste — 图片拒绝回调（svg 粘贴不入附件、防重复插入）', () => {
  it('clipboardData 含 svg 图片项 → onImageRejected 收到原因且不入附件', async () => {
    const addAttachment = vi.fn();
    const onImageRejected = vi.fn();
    const view = makeView();
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.svg', { type: 'image/svg+xml' });
    const event = makePasteEvent(
      makeClipboardData({
        items: [{ kind: 'file', type: 'image/svg+xml', getAsFile: () => file }],
      })
    );
    const handled = handleComposerPaste(view.view, event, { addAttachment, onImageRejected });
    expect(handled).toBe(true);
    expect(onImageRejected).toHaveBeenCalledWith(expect.stringContaining('SVG'));
    expect(addAttachment).not.toHaveBeenCalled();
    expect(view.insertText).not.toHaveBeenCalled();
  });
});

describe('ingestFilePaths — 路径数组逐个解析（一-1②/一-2②）', () => {
  type ParseRes = { success: boolean; data?: { text?: string } };

  it('全部成功：按输入顺序逐个解析并 append（保用户选择顺序）', async () => {
    const parse = vi.fn(
      async (path: string): Promise<ParseRes> => ({
        success: true,
        data: { text: `body:${path}` },
      })
    );
    const append = vi.fn();
    const paths = ['C:/d/c.pdf', 'C:/d/a.xlsx', 'C:/d/b.md'];

    await ingestFilePaths(paths, parse, append);

    expect(parse).toHaveBeenCalledTimes(3);
    expect(parse.mock.calls.map((c) => c[0])).toEqual(paths);
    expect(append).toHaveBeenCalledTimes(3);
    const names = append.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names).toEqual(['c.pdf', 'a.xlsx', 'b.md']);
    const first = append.mock.calls[0][0] as { type: string; path?: string; content?: string };
    expect(first.type).toBe('file');
    expect(first.path).toBe('C:/d/c.pdf');
    expect(first.content).toBe('body:C:/d/c.pdf');
  });

  it('单文件解析返回 success:false → 不断批，失败项无 content 但仍 append', async () => {
    const parse = vi.fn(async (path: string): Promise<ParseRes> => {
      if (path.includes('bad')) return { success: false };
      return { success: true, data: { text: 'ok' } };
    });
    const append = vi.fn();

    await ingestFilePaths(['C:/d/ok1.md', 'C:/d/bad.pdf', 'C:/d/ok2.md'], parse, append);

    expect(parse).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenCalledTimes(3);
    const failed = append.mock.calls[1][0] as { name: string; content?: string };
    expect(failed.name).toBe('bad.pdf');
    expect(failed.content).toBeUndefined();
    const third = append.mock.calls[2][0] as { content?: string };
    expect(third.content).toBe('ok');
  });

  it('单文件解析抛异常 → 不断批，后续文件继续', async () => {
    const parse = vi.fn(async (path: string): Promise<ParseRes> => {
      if (path.includes('boom')) throw new Error('parse crash');
      return { success: true, data: { text: 'ok' } };
    });
    const append = vi.fn();

    await ingestFilePaths(['C:/d/boom.docx', 'C:/d/good.md'], parse, append);

    expect(parse).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledTimes(2);
    expect((append.mock.calls[0][0] as { content?: string }).content).toBeUndefined();
    expect((append.mock.calls[1][0] as { content?: string }).content).toBe('ok');
  });

  it('空数组 → 不调用 parse 也不 append', async () => {
    const parse = vi.fn();
    const append = vi.fn();

    await ingestFilePaths([], parse, append);

    expect(parse).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});

/** 连续让出微任务（FileReader onload 之后的断言用） */
async function flushMicroTasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ---------------------------------------------------------------------------
// B3 一-4②：发送正文只留占位符 + Attachment → IPC 载荷
// ---------------------------------------------------------------------------

function makeAttachment(over: Partial<Attachment> = {}): Attachment {
  return { id: 'a1', type: 'file', name: 'report.pdf', ...over };
}

describe('buildAttachmentSendText — 正文只拼占位符（不打爆 CONTEXT_WINDOW）', () => {
  it('文件附件只拼 [文件: xxx]，绝不拼接解析正文', () => {
    const att = makeAttachment({ content: '十万字全文'.repeat(1000) });
    const out = buildAttachmentSendText('帮我看下', [att]);
    expect(out).toBe('帮我看下\n\n[文件: report.pdf]');
    expect(out).not.toContain('十万字全文');
  });

  it('图片附件拼 [图片: xxx]（data URL 不进正文）', () => {
    const att = makeAttachment({ id: 'i1', type: 'image', name: 'shot.png', content: 'data:image/png;base64,AAA' });
    const out = buildAttachmentSendText('看图', [att]);
    expect(out).toBe('看图\n\n[图片: shot.png]');
    expect(out).not.toContain('base64');
  });

  it('多附件按顺序拼接，占位符逐个追加', () => {
    const out = buildAttachmentSendText('对比', [
      makeAttachment({ id: 'a1', name: 'a.pdf' }),
      makeAttachment({ id: 'a2', name: 'b.md', content: 'md 正文' }),
      makeAttachment({ id: 'i1', type: 'image', name: 'c.png' }),
    ]);
    expect(out).toBe('对比\n\n[文件: a.pdf]\n\n[文件: b.md]\n\n[图片: c.png]');
  });

  it('无附件 → 原文本返回', () => {
    expect(buildAttachmentSendText('纯文本', [])).toBe('纯文本');
  });
});

describe('toAttachmentPayloads — Attachment → IPC 载荷（一物两表入参）', () => {
  it('携带 id/fileName/fileType/content/path，size 取正文 UTF-8 字节数', () => {
    const payloads = toAttachmentPayloads([
      makeAttachment({ path: 'C:/docs/report.pdf', content: 'abc' }),
    ]);
    expect(payloads).toEqual([
      {
        id: 'a1',
        fileName: 'report.pdf',
        fileType: 'file',
        content: 'abc',
        path: 'C:/docs/report.pdf',
        size: 3,
      },
    ]);
  });

  it('无 path / 无 content 时省略对应可选字段', () => {
    const payloads = toAttachmentPayloads([makeAttachment()]);
    expect(payloads[0]).not.toHaveProperty('path');
    expect(payloads[0]).not.toHaveProperty('size');
    expect(payloads[0].content).toBe('');
  });

  it('图片 data URL 作为 content 照传（主进程转存 parsed_attachments.content）', () => {
    const payloads = toAttachmentPayloads([
      makeAttachment({ id: 'i1', type: 'image', name: 'shot.png', content: 'data:image/png;base64,AAA' }),
    ]);
    expect(payloads[0].fileType).toBe('image');
    expect(payloads[0].content).toBe('data:image/png;base64,AAA');
    expect(payloads[0].size).toBeGreaterThan(0);
  });

  it('多附件保持顺序（引用编号依赖选择顺序）', () => {
    const payloads = toAttachmentPayloads([
      makeAttachment({ id: 'a1', name: '1.pdf' }),
      makeAttachment({ id: 'a2', name: '2.pdf' }),
    ]);
    expect(payloads.map((p) => p.id)).toEqual(['a1', 'a2']);
  });
});

// ---------------------------------------------------------------------------
// R6 >20 附件渲染层截断（与主进程 sanitizeIncomingAttachments 同口径，
// 消除「正文占位符数 ≠ 落库行数」的不一致）
// ---------------------------------------------------------------------------

describe('R6 发送前附件截断（MAX_ATTACHMENTS_PER_MESSAGE=20，shared 常量单一来源）', () => {
  function makeMany(n: number): Attachment[] {
    return Array.from({ length: n }, (_, i) =>
      makeAttachment({ id: `a${i + 1}`, name: `doc${i + 1}.pdf` })
    );
  }

  it('buildAttachmentSendText 对 25 个附件只拼前 20 个占位符', () => {
    const out = buildAttachmentSendText('批量', makeMany(25));
    expect(out).toContain('[文件: doc20.pdf]');
    expect(out).not.toContain('[文件: doc21.pdf]');
    expect(out).not.toContain('[文件: doc25.pdf]');
    expect((out.match(/\[文件:/g) ?? []).length).toBe(20);
  });

  it('toAttachmentPayloads 同口径截断到 20，且与占位符附件序列一致', () => {
    const many = makeMany(25);
    const payloads = toAttachmentPayloads(many);
    const text = buildAttachmentSendText('批量', many);
    expect(payloads).toHaveLength(20);
    expect(payloads.map((p) => p.fileName)).toEqual(many.slice(0, 20).map((a) => a.name));
    for (const p of payloads) expect(text).toContain(`[文件: ${p.fileName}]`);
  });

  it('20 个以内不截断（零回归）', () => {
    const exactly = makeMany(20);
    expect(toAttachmentPayloads(exactly)).toHaveLength(20);
    expect((buildAttachmentSendText('x', exactly).match(/\[文件:/g) ?? []).length).toBe(20);
    const few = makeMany(3);
    expect(toAttachmentPayloads(few)).toHaveLength(3);
    expect((buildAttachmentSendText('x', few).match(/\[文件:/g) ?? []).length).toBe(3);
  });
});


// ---------------------------------------------------------------------------
// B7 二-6② — 解析结构随附件载荷透传（source_ref 真实页码前提）
// ---------------------------------------------------------------------------

describe('B7 结构透传 — ingestFilePaths / toAttachmentPayloads', () => {
  type FullRes = {
    success: boolean;
    data?: {
      text?: string;
      pageCount?: number;
      pageOffsets?: number[];
      sections?: unknown[];
      tables?: unknown[];
      parseVersion?: number;
    };
  };

  it('ingestFilePaths 从解析产物提取 structure（页码偏移不丢失）', async () => {
    const parse = vi.fn(async (): Promise<FullRes> => ({
      success: true,
      data: {
        text: 'pdf body',
        pageCount: 2,
        pageOffsets: [0, 400],
        sections: [{ title: '章一', path: ['章一'] }],
        tables: [{ index: 1, sectionPath: ['章一'], pageIndex: 1, csv: 'a,b' }],
        parseVersion: 2,
      },
    }));
    const append = vi.fn();
    await ingestFilePaths(['C:/d/p.pdf'], parse as never, append);

    const att = append.mock.calls[0][0] as {
      content?: string;
      structure?: { pageOffsets?: number[]; pageCount?: number; parseVersion?: number };
    };
    expect(att.content).toBe('pdf body');
    expect(att.structure).toBeDefined();
    expect(att.structure!.pageOffsets).toEqual([0, 400]);
    expect(att.structure!.pageCount).toBe(2);
    expect(att.structure!.parseVersion).toBe(2);
  });

  it('解析产物缺 parseVersion → 不携带 structure（旧 mock/异常响应容错）', async () => {
    const parse = vi.fn(async (): Promise<FullRes> => ({
      success: true,
      data: { text: 'x' },
    }));
    const append = vi.fn();
    await ingestFilePaths(['C:/d/p.pdf'], parse as never, append);
    const att = append.mock.calls[0][0] as { structure?: unknown };
    expect(att.structure).toBeUndefined();
  });

  it('toAttachmentPayloads 透传 structure（一物两表：正文与结构分别落库）', () => {
    const structure = {
      pageCount: 2,
      pageOffsets: [0, 400],
      sections: [],
      tables: [],
      parseVersion: 2,
    };
    const payloads = toAttachmentPayloads([
      {
        id: 's1',
        type: 'file',
        name: 'p.pdf',
        content: 'body',
        path: 'C:/d/p.pdf',
        structure,
      },
    ]);
    expect(payloads[0].structure).toEqual(structure);
    expect(payloads[0].content).toBe('body');
  });

  it('无 structure 的附件载荷不含该字段（向后兼容）', () => {
    const payloads = toAttachmentPayloads([
      { id: 's2', type: 'file', name: 'n.md', content: 'x' },
    ]);
    expect(payloads[0]).not.toHaveProperty('structure');
  });
});
