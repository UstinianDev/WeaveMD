// ============================================
// WeaveMD — Markdown 相对路径图片解析（doc-pipeline B9 三-3）
// ============================================
// - 解析基准恒为 **md 文件所在目录**（不是 cwd、不是 userData）；
// - 越界拦截：解析结果必须落在工作区根（workspaceRoot，缺省 = md 所在目录）内，
//   `../../` 出界一律返回 escape，**不读工作区外文件**（判定先于存在性检查）；
// - 图片缺失 / md 移动后相对路径失效 → missing 结构化降级，由调用方出提示（不静默）；
// - `buildMdImageContext` 把解析结果组装成五链路（B6 agentMedia）可注入的图片 part 上下文。
// 路径运算自实现（分隔符归一 + 段折叠）：与 B8 通道校验同因——测试环境 path 模块为
// posix 语义，`path.isAbsolute('C:\\')` 会误判，故不依赖 path 模块的平台语义。
// 范围外：`imageIndexer`/`images_vec` 图片向量不动（后续，三-3②）；远程/data 引用不抓取。

import { existsSync } from 'fs';

import { KEEP_RECENT_IMAGES } from '../contextManager';
import { buildImageParts } from '../agent/agentMedia';
import type { ContentPart } from '../llm/llmClient';

/** 可注入 vision 的图片扩展名（与 imageStorage.ALLOWED_IMAGE_EXTS 同口径，svg 拒绝）。 */
const MD_VISION_IMAGE_EXTS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
]);

/** 单篇 md 一次注入的图片上限（与 Q4 压缩保留口径一致：最近 N 张）。 */
export const MAX_MD_IMAGES = KEEP_RECENT_IMAGES;

/** 拒绝原因（结构化降级，调用方据此出提示）。 */
export type MdImageRejectReason =
  | 'escape' // 越界：解析结果出工作区根
  | 'missing' // 文件不存在（含 md 移动后相对路径失效）
  | 'remote' // http(s) 远程引用（范围外，不抓取）
  | 'data' // data: URL（非本地文件）
  | 'unsupported' // 非图片扩展名 / svg / 其他非本地 scheme（media: 等）
  | 'invalid'; // md 路径非绝对 / 引用为空等

export interface MdImageResolved {
  ok: true;
  /** 原始引用文本 */
  ref: string;
  /** 归一化后的绝对路径（正斜杠） */
  absPath: string;
  /** 文件名（含扩展名） */
  name: string;
}

export interface MdImageRejected {
  ok: false;
  ref: string;
  reason: MdImageRejectReason;
}

export type MdImageResolution = MdImageResolved | MdImageRejected;

export interface ResolveMdImagesOptions {
  /** 越界判定的边界根；缺省 = md 文件所在目录。 */
  workspaceRoot?: string;
  /** 是否做存在性检查（默认 true；纯路径单测可关）。 */
  checkExists?: boolean;
}

// ---------------------------------------------------------------------------
// 路径运算（分隔符归一，不依赖 path 模块平台语义）
// ---------------------------------------------------------------------------

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 绝对路径判定：posix 根 / UNC / Windows 盘符。 */
function isAbsoluteLike(p: string): boolean {
  const n = normalizeSlashes(p);
  return n.startsWith('/') || /^[a-zA-Z]:\//.test(n);
}

/** 折叠 `.` / `..` 段；绝对路径越根的 `..` 停在根（与操作系统语义一致）。 */
function collapsePath(p: string): string {
  const n = normalizeSlashes(p);
  let root = '';
  let rest = n;
  if (n.startsWith('//')) {
    // UNC（\\server\share 归一后为 //server/share），根保留双斜杠
    root = '//';
    rest = n.slice(2);
  } else {
    const drive = /^([a-zA-Z]:)\//.exec(n);
    if (drive) {
      root = `${drive[1]}/`;
      rest = n.slice(drive[0].length);
    } else if (n.startsWith('/')) {
      root = '/';
      rest = n.slice(1);
    }
  }
  const out: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
      } else if (!root) {
        out.push('..'); // 相对路径保留越界段
      }
      // 绝对路径：越根的 .. 停在根（/.. = /）
      continue;
    }
    out.push(seg);
  }
  const body = out.join('/');
  if (!root) return body;
  return body ? `${root}${body}` : root;
}

/** 取父目录（绝对路径入参）。 */
function dirName(p: string): string {
  const n = normalizeSlashes(p);
  const idx = n.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return '/';
  const dir = n.slice(0, idx);
  return /^[a-zA-Z]:$/.test(dir) ? `${dir}/` : dir;
}

/** 取文件名（含扩展名）。 */
function nameOf(p: string): string {
  const n = normalizeSlashes(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/** target 是否落在 root 内（root 自身算内部）。 */
function isWithin(root: string, target: string): boolean {
  const r0 = collapsePath(root);
  const r = r0.length > 1 && r0.endsWith('/') ? r0.slice(0, -1) : r0;
  const t = collapsePath(target);
  if (r === '/' || r === '') return t.startsWith('/');
  if (/^[a-zA-Z]:\/?$/.test(r)) return t.toLowerCase().startsWith(`${r.replace(/\/$/, '')}/`.toLowerCase());
  return t === r || t.startsWith(`${r}/`);
}

/** base 目录 + 引用 → 折叠后的绝对路径。 */
function resolveFrom(baseDir: string, ref: string): string {
  const n = normalizeSlashes(ref);
  if (isAbsoluteLike(n)) return collapsePath(n);
  return collapsePath(`${normalizeSlashes(baseDir)}/${n}`);
}

/** 引用分类：本地路径 / 远程 / data / 其他 scheme / 非法。 */
function classifyRef(
  normRef: string
): 'path' | 'remote' | 'data' | 'unsupported' | 'invalid' {
  if (normRef.startsWith('#')) return 'invalid';
  if (normRef.startsWith('/') || /^[a-zA-Z]:\//.test(normRef)) return 'path';
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normRef);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === 'http' || name === 'https') return 'remote';
    if (name === 'data') return 'data';
    if (name.length === 1) return 'invalid'; // 盘符相对引用（C:foo）
    return 'unsupported'; // media:/file: 等非本地可读引用
  }
  return 'path';
}

// ---------------------------------------------------------------------------
// 引用提取
// ---------------------------------------------------------------------------

/** 提取 md 中的图片引用（内联 `![]()` 含 <> 与标题形态 + `<img src>`），去重保序。 */
export function extractMdImageRefs(mdContent: string): string[] {
  if (!mdContent) return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined): void => {
    const v = (raw ?? '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    refs.push(v);
  };

  const inlineRe = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g;
  for (const m of mdContent.matchAll(inlineRe)) {
    push(m[1] ?? m[2]);
  }
  const htmlRe = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  for (const m of mdContent.matchAll(htmlRe)) {
    push(m[1] ?? m[2]);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// 单引用解析
// ---------------------------------------------------------------------------

/**
 * 解析单个图片引用：基准 = md 所在目录；越界 / 缺失 / 远程 / 格式分别结构化返回。
 * 越界判定先于存在性检查——工作区外文件即使存在也不读、不返回路径。
 */
export function resolveMdImage(
  mdFilePath: string,
  ref: string,
  opts: ResolveMdImagesOptions = {}
): MdImageResolution {
  const rawRef = (ref ?? '').trim();
  if (!mdFilePath || !isAbsoluteLike(mdFilePath)) {
    return { ok: false, ref: rawRef, reason: 'invalid' };
  }
  if (!rawRef) return { ok: false, ref: rawRef, reason: 'invalid' };

  const normRef = normalizeSlashes(rawRef);
  const kind = classifyRef(normRef);
  if (kind === 'invalid') return { ok: false, ref: rawRef, reason: 'invalid' };
  if (kind === 'remote') return { ok: false, ref: rawRef, reason: 'remote' };
  if (kind === 'data') return { ok: false, ref: rawRef, reason: 'data' };
  if (kind === 'unsupported') return { ok: false, ref: rawRef, reason: 'unsupported' };

  const baseDir = dirName(mdFilePath);
  const root = opts.workspaceRoot && isAbsoluteLike(opts.workspaceRoot)
    ? opts.workspaceRoot
    : baseDir;
  const abs = resolveFrom(baseDir, normRef);

  // 越界拦截（先于存在性检查）
  if (!isWithin(root, abs)) return { ok: false, ref: rawRef, reason: 'escape' };

  const name = nameOf(abs);
  if (!MD_VISION_IMAGE_EXTS.has(extOf(name))) {
    return { ok: false, ref: rawRef, reason: 'unsupported' };
  }
  if (opts.checkExists !== false && !existsSync(abs)) {
    return { ok: false, ref: rawRef, reason: 'missing' };
  }
  return { ok: true, ref: rawRef, absPath: abs, name };
}

/** 批量解析（引用已在 extract 阶段去重）。 */
export function resolveMdImages(
  mdFilePath: string,
  mdContent: string,
  opts: ResolveMdImagesOptions = {}
): MdImageResolution[] {
  return extractMdImageRefs(mdContent).map((ref) => resolveMdImage(mdFilePath, ref, opts));
}

/**
 * 工作区根选择：取文件树中**包含该 md 的最长根**（最具体、拦截边界最紧）；
 * 无匹配回退 md 所在目录（散装文件的目录即其工作区）。
 */
export function pickWorkspaceRoot(mdFilePath: string, folders?: string[]): string {
  const mdDir = dirName(mdFilePath);
  if (!folders || folders.length === 0) return mdDir;
  const containing = folders
    .filter((f) => !!f && isAbsoluteLike(f) && isWithin(f, mdFilePath))
    .map((f) => collapsePath(f))
    .sort((a, b) => b.length - a.length);
  return containing[0] ?? mdDir;
}

// ---------------------------------------------------------------------------
// 五链路注入上下文（B6 agentMedia 复用）
// ---------------------------------------------------------------------------

export interface MdImageContext {
  /** 待追加到当前轮消息 content 的图片 part（vision 不支持时为空） */
  parts: ContentPart[];
  /** 降级提示文本（缺失 / 越界 / 格式不支持 / 超上限），由调用方随消息注入 */
  notes: string[];
  /** 有图但模型不支持 vision → 调用方注入 VISION_DEGRADED_NOTICE */
  degraded: boolean;
  /** 解析成功但读取失败的文件名（竞态兜底） */
  unreadable: string[];
}

export interface BuildMdImageContextInput {
  /** 当前文档 markdown 全文（载荷 currentDocument） */
  document?: string;
  /** 当前文档磁盘路径（载荷 currentFileRef.path）——解析基准 */
  filePath?: string;
  /** 文件树根目录列表（workspaceRoot 候选） */
  folders?: string[];
  supportsVision: boolean;
}

/**
 * md 文档图片 → 当前轮注入上下文（三-3②「图片可被 Agent 看到，走五链路」）：
 * - 解析（基准 md 目录、越界拦截）→ 复用 B6 `buildImageParts`（vision 门控 / gif 首帧 / 缺失兜底）；
 * - 远程 / data 引用静默跳过（范围外，不制造提示噪声）；
 * - 缺失 / 越界 / 格式不支持 → notes 显式降级提示；
 * - 注入上限 MAX_MD_IMAGES（Q4 同口径），超出省略并提示。
 */
export function buildMdImageContext(input: BuildMdImageContextInput): MdImageContext {
  const empty: MdImageContext = { parts: [], notes: [], degraded: false, unreadable: [] };
  const { document, filePath } = input;
  if (!document || !filePath) return empty;
  if (!isAbsoluteLike(filePath)) return empty;

  const resolutions = resolveMdImages(filePath, document, {
    workspaceRoot: pickWorkspaceRoot(filePath, input.folders),
  });
  if (resolutions.length === 0) return empty;

  const notes: string[] = [];
  const okOnes = resolutions.filter((r): r is MdImageResolved => r.ok);
  const rejected = resolutions.filter((r): r is MdImageRejected => !r.ok);

  const chosen = okOnes.slice(0, MAX_MD_IMAGES);
  if (okOnes.length > chosen.length) {
    notes.push(`【提示】文档内本地图片超出本次注入上限（${MAX_MD_IMAGES} 张），其余已省略。`);
  }

  for (const r of rejected) {
    if (r.reason === 'remote' || r.reason === 'data') continue; // 远程/data 范围外，静默跳过
    if (r.reason === 'missing') {
      notes.push(`【提示】文档引用的图片缺失或已移动，未注入：${r.ref}`);
    } else if (r.reason === 'escape') {
      notes.push(`【提示】文档引用的图片路径越出工作区，已拦截：${r.ref}`);
    } else if (r.reason === 'unsupported') {
      notes.push(`【提示】文档引用的图片格式不支持，未注入：${r.ref}`);
    }
    // invalid（空引用/非法 md 路径）不提示
  }

  if (chosen.length === 0 && notes.length === 0) return empty;

  const attachments = chosen.map((r, i) => ({
    id: `md-img-${i}`,
    type: 'image' as const,
    name: r.name,
    path: r.absPath,
  }));
  const built = buildImageParts(attachments, { supportsVision: input.supportsVision });
  const unreadable = [...built.unreadable];
  for (const name of unreadable) {
    notes.push(`【提示】文档引用的图片不可读，未注入：${name}`);
  }

  return {
    parts: built.parts,
    notes,
    degraded: built.degraded,
    unreadable,
  };
}
