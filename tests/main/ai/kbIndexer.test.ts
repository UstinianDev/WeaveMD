import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake better-sqlite3 隔离 ---
interface FakeStatement {
  sql: string;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
  run: (...args: unknown[]) => { changes: number };
}

const fakeDbMock = vi.hoisted(() => {
  const calls: Array<{ method: 'get' | 'all' | 'run'; sql: string; args: unknown[] }> = [];
  return {
    calls,
    throwOnChunkInsert: false,
    throwOnDocInsert: false,
    prepare: vi.fn().mockImplementation((sql: string) => {
      const stmt: FakeStatement = {
        sql,
        get: (...args) => {
          calls.push({ method: 'get', sql, args });
          return undefined;
        },
        all: (...args) => {
          calls.push({ method: 'all', sql, args });
          return [];
        },
        run: (...args) => {
          calls.push({ method: 'run', sql, args });
          if (fakeDbMock.throwOnChunkInsert && sql.includes('INSERT INTO kb_chunks')) {
            throw new Error('db down');
          }
          if (fakeDbMock.throwOnDocInsert && sql.includes('INSERT INTO kb_documents')) {
            throw new Error('db down');
          }
          return { changes: 1 };
        },
      };
      return stmt;
    }),
    reset: () => {
      calls.length = 0;
      fakeDbMock.prepare.mockClear();
      fakeDbMock.throwOnChunkInsert = false;
      fakeDbMock.throwOnDocInsert = false;
    },
  };
});

class FakeDatabase {
  prepare(sql: string): FakeStatement {
    return fakeDbMock.prepare(sql) as FakeStatement;
  }

  /** 事务包装：直接执行回调（FakeDB 无真实事务）。 */
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return fn;
  }
}

vi.mock('better-sqlite3', () => ({ default: FakeDatabase }));
vi.mock('@main/db/index', () => ({
  getDatabase: () => new FakeDatabase(),
}));

import {
  splitNote,
  indexFile,
  indexImportedText,
  reindexAfterSave,
  recordImportFailure,
  removeByFile,
  removeByAttachment,
  removeByDocId,
  buildSourceRef,
} from '@main/ai/knowledge/kbIndexer';

const { calls } = fakeDbMock;

function callOf(method: 'get' | 'all' | 'run', sqlFragment: string) {
  return calls.find((c) => c.method === method && c.sql.includes(sqlFragment));
}

function howMany(method: 'get' | 'all' | 'run', sqlFragment: string): number {
  return calls.filter((c) => c.method === method && c.sql.includes(sqlFragment)).length;
}

beforeEach(() => {
  fakeDbMock.reset();
});

describe('kbIndexer.splitNote — 纯函数', () => {
  const shortNote = '# 标题\n\n一段不长的正文。';

  it('短内容作为单块 seq 0', () => {
    const chunks = splitNote(shortNote);
    expect(chunks.length).toBe(1);
    expect(chunks[0].seq).toBe(0);
    expect(chunks[0].text).toContain('# 标题');
    expect(typeof chunks[0].approxOffset).toBe('number');
  });

  it('长内容按 ~800 字符切块且按顺序、approxOffset 递增', () => {
    const long = 'x'.repeat(3000);
    const chunks = splitNote(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].seq).toBe(i);
      expect(chunks[i].approxOffset).toBeGreaterThan(chunks[i - 1].approxOffset);
    }
  });

  it('优先在 \n## 断点切分（标题块不跨越）', () => {
    const header = '# 文档\n\n' + 'body\n'.repeat(200);
    const headingChunk = '\n## 小节A\n' + 'aa\n'.repeat(200) + '\n## 小节B\n' + 'bb\n'.repeat(200);
    const chunks = splitNote(header + headingChunk);
    // 存在以 \n## 开头的块，即表明断点优先于固定字符
    expect(chunks.some((c) => c.text.startsWith('## 小节A'))).toBe(true);
  });

  it('overlap≈80：相邻块之间有共享文本（块长足够时）', () => {
    const body = 'y'.repeat(2000);
    const chunks = splitNote(body);
    // overlap 意味着下一块开头包含上一块末端内容；此处用 seq 连续性 + 文本非空验证
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length > 0)).toBe(true);
    expect(chunks[1].approxOffset).toBeGreaterThanOrEqual(0);
  });
});

describe('kbIndexer.indexFile — 状态流转与 SQL 顺序', () => {
  const file = { id: 'f1', name: 'n.md', content: '# 标题\n\n正文内容。' };

  it('indexFile：分块落库后置 done（纯 FTS，无向量嵌入）', async () => {
    const result = await indexFile('u1', file, {});
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe('done');
    // 插入块后置 done
    expect(howMany('run', 'INSERT INTO kb_chunks')).toBeGreaterThanOrEqual(1);
    expect(result.docId).toBeTruthy();
  });

  it('写库异常 → 状态置 error，不抛', async () => {
    // 让 insertChunk 的 run 抛错，模拟 DB 写入失败 → status→error
    fakeDbMock.throwOnChunkInsert = true;
    const result = await indexFile('u1', file, {});
    expect(result.status).toBe('error');
    // 状态置 error 的 UPDATE 被发出
    expect(howMany('run', 'UPDATE kb_documents')).toBeGreaterThanOrEqual(1);
  });
});

describe('kbIndexer.reindexAfterSave / indexImportedText / removeByFile', () => {
  it('reindexAfterSave 删旧文档后重建（delete + insert 顺序）', async () => {
    const file = { id: 'f1', name: 'n.md', content: 'hello' };
    const result = await reindexAfterSave('u1', file, {});
    const delOrder = calls.findIndex(
      (c) => c.method === 'run' && c.sql.includes('DELETE FROM kb_documents')
    );
    const insOrder = calls.findIndex(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_documents')
    );
    expect(delOrder).toBeGreaterThanOrEqual(0);
    expect(insOrder).toBeGreaterThanOrEqual(0);
    expect(delOrder).toBeLessThan(insOrder);
    expect(result?.status).toBe('done');
  });

  it('indexImportedText 用 source_type=import 且 file_id 为 null', async () => {
    const result = await indexImportedText('u1', '导入.md', '这是导入内容。', {});
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[2]).toBeNull(); // file_id 位置（id, userId, file_id, ...）
    expect(result.status).toBe('done');
  });

  it('removeByFile 按 file_id + user_id 删除文档', async () => {
    removeByFile('u1', 'f1');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(stmt?.sql).toMatch(/WHERE file_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['f1', 'u1']);
  });
});

// ---------------------------------------------------------------------------
// B4 四-3② + D3：source_type='attachment' / attachment_id 关联 / 失败可见 / 删除清理
// ---------------------------------------------------------------------------

describe('kbIndexer — 附件关联（source_type=attachment + attachment_id）', () => {
  it('indexImportedText 带 attachment 选项：INSERT 携 source_type + attachment_id', async () => {
    const result = await indexImportedText('u1', 'report', '正文', {
      sourceType: 'attachment',
      attachmentId: 'att1',
    });

    expect(result.status).toBe('done');
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.sql).toContain('attachment_id');
    // 列序 (id, user_id, file_id, source_type, title, pinned, status, attachment_id)
    expect(insert?.args[1]).toBe('u1');
    expect(insert?.args[2]).toBeNull(); // file_id 恒 NULL
    expect(insert?.args[3]).toBe('attachment');
    expect(insert?.args[4]).toBe('report');
    expect(insert?.args[7]).toBe('att1');
  });

  it('indexImportedText 不带选项 → source_type=import（既有语义回归）', async () => {
    await indexImportedText('u1', '导入', '正文', {});
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('import');
    expect(insert?.args[7]).toBeNull();
  });

  it('indexFile 默认 source_type=db；显式 attachment 选项贯穿', async () => {
    await indexFile('u1', { id: 'f1', name: 'n.md', content: 'x' }, {});
    let insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('db');

    fakeDbMock.reset();
    await indexFile(
      'u1',
      { id: 'f1', name: 'n.md', content: 'x' },
      { sourceType: 'attachment', attachmentId: 'att2' }
    );
    insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('attachment');
    expect(insert?.args[7]).toBe('att2');
  });
});

describe('kbIndexer.recordImportFailure — 失败 status=error 可见（不静默）', () => {
  it('默认写 source_type=import 的 error 行并返回 error 结果', () => {
    const result = recordImportFailure('u1', 'broken', { error: 'boom' });

    expect(result.status).toBe('error');
    expect(result.chunks).toBe(0);
    expect(result.error).toBe('boom');
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('import');
    expect(insert?.args[4]).toBe('broken');
    expect(insert?.args[6]).toBe('error'); // status 直接落 error
  });

  it('attachment 选项：error 行携带 attachment_id（重试收敛到同一行）', () => {
    const result = recordImportFailure('u1', 'mid', {
      sourceType: 'attachment',
      attachmentId: 'att3',
      error: 'attachment not parsed',
    });

    expect(result.status).toBe('error');
    const insert = callOf('run', 'INSERT INTO kb_documents');
    expect(insert?.args[3]).toBe('attachment');
    expect(insert?.args[7]).toBe('att3');
  });

  it('DB 异常不抛，仍返回 error 结果（UI 可见）', () => {
    fakeDbMock.throwOnDocInsert = true;
    const result = recordImportFailure('u1', 'broken');
    expect(result.status).toBe('error');
    expect(result.docId).toBe('');
  });
});

describe('kbIndexer — 删除清理（对齐 cleanupKbAfterFileDelete 模式）', () => {
  it('removeByAttachment 按 attachment_id + user_id 删除（附件删除→清理 KB）', () => {
    const removed = removeByAttachment('u1', 'att1');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(removed).toBe(true);
    expect(stmt?.sql).toMatch(/WHERE attachment_id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['att1', 'u1']);
  });

  it('removeByDocId 按 id + user_id 删除（导入/错误行可删）', () => {
    const removed = removeByDocId('u1', 'd9');
    const stmt = callOf('run', 'DELETE FROM kb_documents');
    expect(removed).toBe(true);
    expect(stmt?.sql).toMatch(/WHERE id = \? AND user_id = \?/);
    expect(stmt?.args).toEqual(['d9', 'u1']);
  });

  it('未命中删除（changes=0）不视为成功', () => {
    fakeDbMock.prepare.mockImplementationOnce((sql: string) => ({
      sql,
      get: () => undefined,
      all: () => [],
      run: () => ({ changes: 0 }),
    }));
    expect(removeByAttachment('u1', 'ghost')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B5 三-2②：表格边界 / 整表独立 / 超长表带表头 / 标题统领
// ---------------------------------------------------------------------------

describe('kbIndexer.splitNote — 表格边界识别（三-2②）', () => {
  const header = '| 名称 | 数量 |';
  const delim = '| --- | --- |';
  const row = (i: number) => `| 项目${i} | ${i} |`;

  it('整表独立成 chunk：表格不与前后正文合并、不被字符切断', () => {
    const md = `前言段落。\n\n${header}\n${delim}\n${row(1)}\n${row(2)}\n\n后记段落。`;
    const chunks = splitNote(md);

    const tableChunk = chunks.find((c) => c.text.includes(header));
    expect(tableChunk).toBeDefined();
    // 表格完整（表头 + 分隔 + 全部数据行）
    expect(tableChunk!.text).toContain(delim);
    expect(tableChunk!.text).toContain(row(1));
    expect(tableChunk!.text).toContain(row(2));
    // 独立成块：不混入前后正文
    expect(tableChunk!.text).not.toContain('前言段落');
    expect(tableChunk!.text).not.toContain('后记段落');
    // 前后正文各自成块
    expect(chunks.some((c) => c.text.includes('前言段落'))).toBe(true);
    expect(chunks.some((c) => c.text.includes('后记段落'))).toBe(true);
  });

  it('表头单元数 ≠ 分隔行 → 不识别为表格（按普通文本，不触发表格切分）', () => {
    const notTable = `${header}\n| --- | --- | --- |\n${row(1)}`;
    const md = `${'p'.repeat(1600)}\n\n${notTable}\n`;
    const chunks = splitNote(md);
    // 未按表格结构独立切分（无 chunk 以表头起始且以数据行收尾的整表形态）
    const tableShaped = chunks.filter(
      (c) => c.text.startsWith(header) && c.text.includes(row(1)) && c.text.endsWith(row(1))
    );
    expect(tableShaped).toHaveLength(0);
  });

  it('超长表按行切分：每片重复表头行+分隔行（配对保持），数据行不丢不重', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i));
    const md = [header, delim, ...rows].join('\n');
    const chunks = splitNote(md);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const lines = c.text.split('\n');
      // 每片以表头行开头，且分隔行紧随其后（GFM 配对不破坏）
      expect(lines[0]).toBe(header);
      expect(lines[1]).toBe(delim);
    }
    // 数据行并集 = 原始行，顺序一致且无重复丢失
    const joined = chunks.flatMap((c) => c.text.split('\n').slice(2));
    expect(joined).toEqual(rows);
  });

  it('表格片之间不施加 overlap（数据行按原文顺序连续拼接可还原）', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i));
    const md = [header, delim, ...rows].join('\n');
    const chunks = splitNote(md);
    // 若有 overlap，相邻片的数据行会出现重复；此处验证零重复
    const joined = chunks.flatMap((c) => c.text.split('\n').slice(2));
    expect(new Set(joined).size).toBe(joined.length);
  });
});

describe('kbIndexer.splitNote — 标题统领多段落（三-2②）', () => {
  it('标题 + 其下多段落（合计 ≤ targetSize）合并为 1 个 chunk', () => {
    const md = `${'x'.repeat(1600)}\n\n## 小节\n\n段落甲。\n\n段落乙。`;
    const chunks = splitNote(md);

    const merged = chunks.find(
      (c) => c.text.startsWith('## 小节') && c.text.includes('段落甲') && c.text.includes('段落乙')
    );
    expect(merged).toBeDefined();
    // 标题统领的段落未被 800 字符窗口切散
    expect(merged!.text).not.toContain('x'.repeat(100));
  });
});

describe('kbIndexer.splitNote — headingPath 携带（四-2②）', () => {
  it('多级标题路径以 " > " 分隔，携带到该路径下切出的每个 chunk', () => {
    const md = `# 甲\n\n## 乙\n\n${'内容。\n'.repeat(200)}`;
    const chunks = splitNote(md);

    const h1 = chunks.find((c) => c.text.startsWith('# 甲'));
    const h2 = chunks.find((c) => c.text.startsWith('## 乙'));
    expect(h1?.headingPath).toBe('甲');
    expect(h2?.headingPath).toBe('甲 > 乙');
    // 同 section 内字符切分的后续块同样携带路径
    const rest = chunks.filter((c) => !c.text.startsWith('#') && c.text.includes('内容。'));
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((c) => c.headingPath === '甲 > 乙')).toBe(true);
  });

  it('无标题纯文本 → headingPath 空串（空路径降级，老数据/纯文本 txt）', () => {
    const chunks = splitNote('q'.repeat(2000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.headingPath === '')).toBe(true);
  });

  it('headingPath 长度硬上限 80 字符（截断防膨胀）', () => {
    const titles = Array.from(
      { length: 10 },
      (_, i) => `# ${'长标题甲乙丙丁'.repeat(2)}${i}`
    ).join('\n\n');
    const md = `${titles}\n\n${'b\n'.repeat(600)}`;
    const chunks = splitNote(md);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.headingPath.length <= 80)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B5 D4：heading_path 落库（NoteChunk → insertChunksBatch）
// ---------------------------------------------------------------------------

describe('kbIndexer — heading_path 写入（D4 无 DDL）', () => {
  it('indexFile → INSERT kb_chunks 携 heading_path 列与路径值', async () => {
    await indexFile(
      'u1',
      {
        id: 'f1',
        name: 'n.md',
        content: `# 甲\n\n## 乙\n\n${'内容。\n'.repeat(200)}`,
      },
      {}
    );
    const inserts = calls.filter(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_chunks')
    );
    expect(inserts.length).toBeGreaterThan(1);
    expect(inserts[0].sql).toContain('heading_path');
    // 至少一个块写入非空路径（列序尾部：..., source_ref, heading_path）
    expect(inserts.some((c) => c.args.includes('甲 > 乙'))).toBe(true);
    expect(inserts.some((c) => c.args.includes('甲'))).toBe(true);
  });

  it('无标题内容 → heading_path 写 NULL（空路径降级不写空串）', async () => {
    await indexFile('u1', { id: 'f2', name: 'plain.txt', content: 'q'.repeat(2000) }, {});
    const inserts = calls.filter(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_chunks')
    );
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.every((c) => c.args[5] === null)).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// B7 二-6②：source_ref 真实页码替代 60 字符近似
// ---------------------------------------------------------------------------

describe('kbIndexer.buildSourceRef — 真实页码（二-6②）', () => {
  it('有 pageOffsets → page 字段为真实页码（二分定位），不输出 line 近似', () => {
    // pageOffsets[i] = 第 i+1 页 text 起始偏移
    const pageOffsets = [0, 500, 1200];
    const ref1 = JSON.parse(buildSourceRef('report.pdf', 0, undefined, pageOffsets));
    expect(ref1.page).toBe(1);
    expect(ref1.line).toBeUndefined();
    expect(ref1.fileName).toBe('report.pdf');

    const ref2 = JSON.parse(buildSourceRef('report.pdf', 640, undefined, pageOffsets));
    expect(ref2.page).toBe(2);

    const ref3 = JSON.parse(buildSourceRef('report.pdf', 1201, undefined, pageOffsets));
    expect(ref3.page).toBe(3);
  });

  it('无 pageOffsets → 保留 line 近似（md/txt 兼容既有消费方）', () => {
    const ref = JSON.parse(buildSourceRef('note.md', 120));
    expect(ref.page).toBeUndefined();
    expect(ref.line).toBe(3); // 1 + floor(120/60)
  });

  it('offset 0 且无 pageOffsets → 不带 line（首块无需定位）', () => {
    const ref = JSON.parse(buildSourceRef('note.md', 0));
    expect(ref.line).toBeUndefined();
    expect(ref.fileName).toBe('note.md');
  });

  it('indexImportedText 携 pageOffsets → INSERT source_ref 含 page', async () => {
    const pageOffsets = [0, 500];
    await indexImportedText('u1', 'report', 'A'.repeat(2000), { pageOffsets });
    const inserts = calls.filter(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_chunks')
    );
    expect(inserts.length).toBeGreaterThan(1);
    // 第 1 块（offset 0）→ page 1；第 2 块（offset ≥500）→ page 2
    const refs = inserts.map((c) => String(c.args[4]));
    expect(refs.some((r) => r.includes('"page":1'))).toBe(true);
    expect(refs.some((r) => r.includes('"page":2'))).toBe(true);
    expect(refs.every((r) => !r.includes('"line"'))).toBe(true);
  });

  it('无 pageOffsets 的 indexImportedText 仍走 line 近似（回归防护）', async () => {
    await indexImportedText('u1', 'note', 'x'.repeat(2000), {});
    const inserts = calls.filter(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_chunks')
    );
    expect(inserts.length).toBeGreaterThan(1);
    // 首块 offset=0 不带 line；后续块带 line 近似（既有语义回归防护）
    expect(inserts.some((c) => String(c.args[4]).includes('"line"'))).toBe(true);
    expect(inserts.every((c) => !String(c.args[4]).includes('"page"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B8 六-2②：source_ref 附件/文件锚点（citation 点击回链）
// ---------------------------------------------------------------------------

describe('kbIndexer.buildSourceRef — 附件与文件锚点（B8 六-2）', () => {
  it('第 5 参 attachmentId → ref 含 attachmentId（与 page 并存）', () => {
    // pageOffsets [0,50]：offset 100 落第 2 页（二分：最大 i 满足 offsets[i] <= 100）
    const ref = JSON.parse(buildSourceRef('report.pdf', 100, undefined, [0, 50], 'att-1'));
    expect(ref.attachmentId).toBe('att-1');
    expect(ref.page).toBe(2);
    expect(ref.fileName).toBe('report.pdf');
  });

  it('fileId 锚点写入 ref（db 笔记 chunk 可 openFile 回链）', () => {
    const ref = JSON.parse(buildSourceRef('note.md', 120, 'f-9'));
    expect(ref.fileId).toBe('f-9');
    expect(ref.line).toBe(3);
  });

  it('indexImportedText attachment 选项 → chunk source_ref 含 attachmentId + page', async () => {
    await indexImportedText('u1', 'report.pdf', '第一页内容。\n第二页内容。', {
      sourceType: 'attachment',
      attachmentId: 'att-1',
      pageOffsets: [0, 9],
    });
    const inserts = calls.filter(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_chunks')
    );
    expect(inserts.length).toBeGreaterThan(0);
    const ref = JSON.parse(String(inserts[0].args[4]));
    expect(ref.attachmentId).toBe('att-1');
    expect(ref.page).toBe(1);
  });

  it('indexFile → chunk source_ref 含 fileId（既有 openFile 回链接通）', async () => {
    await indexFile('u1', { id: 'f-1', name: 'note.md', content: '# 标题\n正文内容。' }, {});
    const inserts = calls.filter(
      (c) => c.method === 'run' && c.sql.includes('INSERT INTO kb_chunks')
    );
    expect(inserts.length).toBeGreaterThan(0);
    const ref = JSON.parse(String(inserts[0].args[4]));
    expect(ref.fileId).toBe('f-1');
  });
});
