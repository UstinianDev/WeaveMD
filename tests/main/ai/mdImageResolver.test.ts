// ============================================
// B9 三-3：Markdown 相对路径图片解析（mdImageResolver）
// ============================================
// 覆盖：解析基准 = md 所在目录（非 cwd/userData）、../../ 越界拦截不读工作区外、
// 缺失降级、远程/data 跳过、扩展名白名单、workspaceRoot 选择、五链路注入上下文组装。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildMdImageContext,
  extractMdImageRefs,
  pickWorkspaceRoot,
  resolveMdImage,
  resolveMdImages,
} from '@main/ai/files/mdImageResolver';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('extractMdImageRefs — 图片引用提取', () => {
  it('提取内联图片与 <img>，剥离标题，去重，不误伤普通链接', () => {
    const md = [
      '![架构](img/a.png)',
      '![架构](img/a.png)',
      '![带标题](img/b.png "标题")',
      '![空格](<my pic.png>)',
      '<img src="html/c.png" alt="x">',
      '[普通链接](page.md)',
      '文字 `![代码里的](x.png)` 不应……（按语法仍属图片，允许提取）',
    ].join('\n');
    const refs = extractMdImageRefs(md);
    expect(refs).toContain('img/a.png');
    expect(refs).toContain('img/b.png');
    expect(refs).toContain('my pic.png');
    expect(refs).toContain('html/c.png');
    expect(refs).not.toContain('page.md');
    // 去重：img/a.png 出现两次只保留一次
    expect(refs.filter((r) => r === 'img/a.png')).toHaveLength(1);
  });

  it('无图片引用返回空数组', () => {
    expect(extractMdImageRefs('# 标题\n纯文本')).toEqual([]);
    expect(extractMdImageRefs('')).toEqual([]);
  });
});

describe('resolveMdImage — 基准目录与越界拦截', () => {
  it('解析基准为 md 所在目录（不是 cwd）', () => {
    const r = resolveMdImage('/ws/docs/n.md', 'img/a.png', { checkExists: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.absPath).toBe('/ws/docs/img/a.png');
      // 不随 cwd 漂移
      expect(r.absPath.startsWith(process.cwd())).toBe(false);
      expect(r.name).toBe('a.png');
    }
  });

  it('支持 ./ 与 ../ 前缀（工作区内）', () => {
    const ok1 = resolveMdImage('/ws/docs/n.md', './img/a.png', { checkExists: false });
    expect(ok1.ok && ok1.absPath).toBe('/ws/docs/img/a.png');
    const ok2 = resolveMdImage('/ws/docs/n.md', '../img/a.png', {
      workspaceRoot: '/ws',
      checkExists: false,
    });
    expect(ok2.ok && ok2.absPath).toBe('/ws/img/a.png');
  });

  it('../../ 越界：默认边界为 md 所在目录，出界即拦截（工作区外文件真实存在也不返回路径）', () => {
    // 目标文件真实存在于工作区外：若无拦截逻辑将解析成功，此处必须仍为 escape
    const outsideDir = mkdtempSync(join(tmpdir(), 'weavemd-b9-outside-'));
    const outsidePng = join(outsideDir, 'secret.png');
    writeFileSync(outsidePng, PNG_BYTES);
    try {
      expect(existsSync(outsidePng)).toBe(true);
      const r = resolveMdImage(
        '/ws/docs/n.md',
        outsidePng.replace(/\\/g, '/').replace(/^\//, '/')
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('escape');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('显式 workspaceRoot：根内的 ../ 放行，出根的 ../../ 拦截', () => {
    const inside = resolveMdImage('/ws/docs/deep/n.md', '../../img/a.png', {
      workspaceRoot: '/ws',
      checkExists: false,
    });
    expect(inside.ok && inside.absPath).toBe('/ws/img/a.png');

    const outside = resolveMdImage('/ws/docs/deep/n.md', '../../../etc/a.png', {
      workspaceRoot: '/ws',
      checkExists: false,
    });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.reason).toBe('escape');
  });

  it('Windows 盘符路径同样按分隔符归一并拦截越界', () => {
    const ok = resolveMdImage('C:\\ws\\docs\\n.md', '..\\img\\a.png', {
      workspaceRoot: 'C:\\ws',
      checkExists: false,
    });
    expect(ok.ok && ok.absPath).toBe('C:/ws/img/a.png');

    const esc = resolveMdImage('C:\\ws\\docs\\n.md', '..\\..\\x.png', {
      workspaceRoot: 'C:\\ws',
      checkExists: false,
    });
    expect(esc.ok).toBe(false);
    if (!esc.ok) expect(esc.reason).toBe('escape');
  });

  it('绝对路径引用也必须落在工作区内', () => {
    const ok = resolveMdImage('/ws/docs/n.md', '/ws/img/a.png', {
      workspaceRoot: '/ws',
      checkExists: false,
    });
    expect(ok.ok && ok.absPath).toBe('/ws/img/a.png');

    const esc = resolveMdImage('/ws/docs/n.md', '/etc/a.png', {
      workspaceRoot: '/ws',
      checkExists: false,
    });
    expect(esc.ok).toBe(false);
    if (!esc.ok) expect(esc.reason).toBe('escape');
  });

  it('UNC 路径根不被误折叠（\\\\server\\share 保持双斜杠根）', () => {
    const ok = resolveMdImage('\\\\server\\share\\docs\\n.md', 'img/a.png', {
      checkExists: false,
    });
    expect(ok.ok && ok.absPath).toBe('//server/share/docs/img/a.png');

    // 工作区 = share：share 内的 ../ 放行
    const inside = resolveMdImage('\\\\server\\share\\docs\\n.md', '../img/a.png', {
      workspaceRoot: '\\\\server\\share',
      checkExists: false,
    });
    expect(inside.ok && inside.absPath).toBe('//server/share/img/a.png');

    // 出 share（上溯到 //server）→ 越界拦截
    const esc = resolveMdImage('\\\\server\\share\\docs\\n.md', '../../x.png', {
      workspaceRoot: '\\\\server\\share',
      checkExists: false,
    });
    expect(esc.ok).toBe(false);
    if (!esc.ok) expect(esc.reason).toBe('escape');
  });

  it('md 路径非法（非绝对路径）与空引用返回 invalid', () => {
    const badMd = resolveMdImage('relative/n.md', 'a.png', { checkExists: false });
    expect(badMd.ok).toBe(false);
    if (!badMd.ok) expect(badMd.reason).toBe('invalid');

    const empty = resolveMdImage('/ws/docs/n.md', '   ', { checkExists: false });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('invalid');
  });
});

describe('resolveMdImage — 存在性与格式降级', () => {
  let root: string;
  let docs: string;
  let png: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'weavemd-b9-'));
    docs = join(root, 'docs');
    mkdirSync(docs, { recursive: true });
    png = join(docs, 'real.png');
    writeFileSync(png, PNG_BYTES);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('真实存在的图片解析成功（md 移动后失效则 missing 降级）', () => {
    const ok = resolveMdImage(join(docs, 'n.md'), 'real.png', { workspaceRoot: root });
    expect(ok.ok).toBe(true);

    // md 被移动到其他目录后，旧相对路径失效 → missing（降级提示由调用方处理）
    const moved = resolveMdImage(join(root, 'elsewhere', 'n.md'), 'real.png', {
      workspaceRoot: root,
    });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.reason).toBe('missing');
  });

  it('远程 / data 引用分类返回（不抓取、不读盘）', () => {
    const remote = resolveMdImage(join(docs, 'n.md'), 'https://example.com/a.png');
    expect(remote.ok).toBe(false);
    if (!remote.ok) expect(remote.reason).toBe('remote');

    const data = resolveMdImage(join(docs, 'n.md'), 'data:image/png;base64,AAA');
    expect(data.ok).toBe(false);
    if (!data.ok) expect(data.reason).toBe('data');
  });

  it('svg 与非图片扩展名拒绝（与 vision 白名单同口径）', () => {
    for (const ref of ['a.svg', 'a.txt', 'a.pdf', 'media://x.png']) {
      const r = resolveMdImage(join(docs, 'n.md'), ref, { workspaceRoot: root });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('unsupported');
    }
  });

  it('resolveMdImages 批量解析 + 引用去重', () => {
    const md = '![a](real.png)\n![a](real.png)\n![b](https://x.com/b.png)';
    const list = resolveMdImages(join(docs, 'n.md'), md, { workspaceRoot: root });
    expect(list).toHaveLength(2);
    expect(list[0].ok).toBe(true);
    expect(list[1].ok === false && list[1].reason).toBe('remote');
  });

  it('checkExists:false 时缺失文件也按解析成功返回（纯路径单测口径）', () => {
    const r = resolveMdImage(join(docs, 'n.md'), 'gone.png', {
      workspaceRoot: root,
      checkExists: false,
    });
    expect(r.ok && r.absPath).toBe(join(docs, 'gone.png').replace(/\\/g, '/'));
  });
});

describe('pickWorkspaceRoot — 工作区根选择', () => {
  it('取包含 md 的最长文件树根；无匹配回退 md 所在目录', () => {
    expect(pickWorkspaceRoot('/ws/docs/a/n.md', ['/ws', '/ws/docs'])).toBe('/ws/docs');
    expect(pickWorkspaceRoot('/ws/docs/n.md', ['/other'])).toBe('/ws/docs');
    expect(pickWorkspaceRoot('/ws/docs/n.md')).toBe('/ws/docs');
    expect(pickWorkspaceRoot('/ws/docs/n.md', [])).toBe('/ws/docs');
    // 非前缀命中（/ws2 不是 /ws 的子路径）不误配
    expect(pickWorkspaceRoot('/ws2/docs/n.md', ['/ws'])).toBe('/ws2/docs');
  });
});

describe('buildMdImageContext — 五链路注入组装（B9 三-3）', () => {
  let root: string;
  let docs: string;
  let png: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'weavemd-b9-ctx-'));
    docs = join(root, 'docs');
    mkdirSync(docs, { recursive: true });
    png = join(docs, 'img', 'a.png');
    mkdirSync(join(docs, 'img'), { recursive: true });
    writeFileSync(png, PNG_BYTES);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const mdPath = (): string => join(docs, 'n.md');

  it('注入本地图片 part（绝对路径），路径基准为 md 所在目录', () => {
    const ctx = buildMdImageContext({
      document: '![架构](img/a.png)',
      filePath: mdPath(),
      supportsVision: true,
    });
    expect(ctx.parts).toHaveLength(1);
    expect(ctx.parts[0]).toEqual({
      type: 'image_url',
      image_url: { url: png.replace(/\\/g, '/') },
    });
    expect(ctx.notes).toEqual([]);
    expect(ctx.degraded).toBe(false);
  });

  it('vision 不支持 → 不产 part、显式 degraded（走五链路降级提示）', () => {
    const ctx = buildMdImageContext({
      document: '![架构](img/a.png)',
      filePath: mdPath(),
      supportsVision: false,
    });
    expect(ctx.parts).toEqual([]);
    expect(ctx.degraded).toBe(true);
    expect(ctx.notes.some((n) => n.includes('img/a.png'))).toBe(false);
  });

  it('缺失图片降级提示（不静默）', () => {
    const ctx = buildMdImageContext({
      document: '![丢失](gone.png)',
      filePath: mdPath(),
      supportsVision: true,
    });
    expect(ctx.parts).toEqual([]);
    expect(ctx.notes.some((n) => n.includes('gone.png') && n.includes('缺失'))).toBe(true);
  });

  it('越界拦截 → 提示已拦截', () => {
    const ctx = buildMdImageContext({
      document: '![越界](../../evil.png)',
      filePath: mdPath(),
      folders: [root],
      supportsVision: true,
    });
    expect(ctx.parts).toEqual([]);
    expect(ctx.notes.some((n) => n.includes('evil.png') && n.includes('越出工作区'))).toBe(true);
  });

  it('远程 / data 引用静默跳过（范围外，不产提示噪声）', () => {
    const ctx = buildMdImageContext({
      document: '![远](https://x.com/a.png)\n![内联](data:image/png;base64,AAA)',
      filePath: mdPath(),
      supportsVision: true,
    });
    expect(ctx.parts).toEqual([]);
    expect(ctx.notes).toEqual([]);
  });

  it('注入上限 = 最近 3 张（Q4 同口径），超出省略并提示', () => {
    for (let i = 1; i <= 5; i += 1) {
      writeFileSync(join(docs, `p${i}.png`), PNG_BYTES);
    }
    const doc = [1, 2, 3, 4, 5].map((i) => `![p${i}](p${i}.png)`).join('\n');
    const ctx = buildMdImageContext({ document: doc, filePath: mdPath(), supportsVision: true });
    expect(ctx.parts).toHaveLength(3);
    expect(ctx.notes.some((n) => n.includes('上限'))).toBe(true);
  });

  it('无文档 / 无文件路径 → 空上下文（不误注入）', () => {
    expect(
      buildMdImageContext({ document: undefined, filePath: mdPath(), supportsVision: true })
    ).toEqual({ parts: [], notes: [], degraded: false, unreadable: [] });
    expect(
      buildMdImageContext({ document: '![a](img/a.png)', filePath: undefined, supportsVision: true })
    ).toEqual({ parts: [], notes: [], degraded: false, unreadable: [] });
    expect(
      buildMdImageContext({ document: '纯文本无图', filePath: mdPath(), supportsVision: true })
    ).toEqual({ parts: [], notes: [], degraded: false, unreadable: [] });
  });

  it('存在性与解析一致性：解析成功即文件可读（existsSync 命中）', () => {
    expect(existsSync(png)).toBe(true);
    const r = resolveMdImage(mdPath(), 'img/a.png', { workspaceRoot: root });
    expect(r.ok).toBe(true);
  });
});
