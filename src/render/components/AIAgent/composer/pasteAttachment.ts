// ============================================
// Composer 粘贴与附件批量解析（B2 一-1/一-2/一-3）
// 纯函数抽取：AIPanelComposer 的 handlePaste / handleUploadFile 核心逻辑，
// 便于单测（图片双兜底照 ContentBlock.tsx 已验证范式）。
//
// 批次边界（B2）：
// - 图片粘贴只接入附件 pending 流程：以 data URL 临时引用进 chips，
//   落盘 userData/attachments 随 B6，正文占位符方案随 B3（本批次不进消息表）。
// - 文件内容一律由解析层（KB_PARSE_DOCUMENT）产出，此处不使用 readFileSync。
// ============================================

import type { EditorView } from '@tiptap/pm/view';

import {
  extractStructure,
  isSupportedDocFile,
  IMAGE_UPLOAD_EXTS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type IDocumentStructure,
  type IAttachmentPayload,
  type IDocumentParseResult,
} from '@shared/ai';

// R6/R5：常量抽到 shared（主进程与渲染层同口径），re-export 兼容既有引用
export { IMAGE_UPLOAD_EXTS };

/** 附件类型（文件/图片） */
export interface Attachment {
  id: string;
  type: 'file' | 'image';
  name: string;
  /** 解析产物文本（文件）或 data URL 临时引用（图片，B6 落盘前的内存通道） */
  content?: string;
  /** 本地路径（系统对话框/粘贴文件的 Electron path） */
  path?: string;
  /** 解析结构（二-6②：页码/章节/表格序号 → 主进程落 structure_json） */
  structure?: IDocumentStructure;
}

/** handleComposerPaste 依赖注入（组件传 React setter，单测传 mock） */
export interface ComposerPasteDeps {
  /** 追加附件（id 由实现方生成） */
  addAttachment: (att: Omit<Attachment, 'id'>) => void;
  /** Electron 剪贴板图片兜底（clipboard:read-image），缺省无此通道 */
  readElectronImage?: () => Promise<string | null>;
  /** 有本地路径的文档批量解析（KB_PARSE_DOCUMENT 逐个） */
  parsePaths?: (paths: string[]) => Promise<void>;
  /** 图片被拒绝时的原因提示（svg/格式不支持，五-2②） */
  onImageRejected?: (reason: string) => void;
}

/**
 * 图片上传前校验（五-2②）：svg 矢量图不可直喂 vision → 拒绝并给出可读原因；
 * 其他非白名单扩展名同样拒绝。返回 ok=true 表示可继续。
 */
export function validateImageAttachment(fileName: string): { ok: boolean; reason?: string } {
  const raw = (fileName.split('.').pop() ?? '').toLowerCase();
  const ext = raw.replace(/^\./, '');
  if (ext === 'svg') {
    return { ok: false, reason: '不支持 SVG 图片，请另存为 PNG 后重试' };
  }
  if (!IMAGE_UPLOAD_EXTS.includes(ext)) {
    return { ok: false, reason: '不支持的图片格式（支持 png/jpg/jpeg/gif/webp/bmp）' };
  }
  return { ok: true };
}

/** KB_PARSE_DOCUMENT 同构返回（结构化产物取 text + structure 字段） */
export interface ParseLikeResponse {
  success: boolean;
  data?: Partial<IDocumentParseResult>;
}

/** 生成附件 id（组件与粘贴通道共用） */
export function genAttachmentId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 图片 MIME → 扩展名（未知默认 png） */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  return map[mime] ?? 'png';
}

/**
 * 从剪贴板提取图片 blob（照 ContentBlock.tsx extractImageBlob）：
 * 方式1 DataTransferItem.getAsFile（标准路径）；方式2 DataTransfer.files 降级。
 */
function extractImageBlob(dt: DataTransfer): File | null {
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      if (dt.items[i].kind === 'file' && dt.items[i].type.startsWith('image/')) {
        const file = dt.items[i].getAsFile();
        if (file) return file;
      }
    }
  }
  if (dt.files) {
    for (let i = 0; i < dt.files.length; i++) {
      if (dt.files[i].type.startsWith('image/')) {
        return dt.files[i];
      }
    }
  }
  return null;
}

/** Electron 31 的 File 携带本地路径（浏览器/FileReader 场景为 undefined） */
type FileWithPath = File & { path?: string };

/**
 * Composer 粘贴处理（TipTap editorProps.handlePaste 签名）。
 * 返回 true = 已处理（阻止默认，防文本重复插入）；false = 交给默认粘贴。
 *
 * 分支顺序：link-preview → 图片双兜底 → 7 格式文件 → URL 文本 →
 * 纯文本（false）→ 空剪贴板 Electron 图片兜底。
 */
export function handleComposerPaste(
  view: EditorView,
  event: ClipboardEvent,
  deps: ComposerPasteDeps
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return false;

  // Edge text/link-preview：插入原始 URL 而非 HTML 标题
  const linkPreview = clipboardData.getData('text/link-preview');
  if (linkPreview) {
    try {
      const preview = JSON.parse(linkPreview) as { url?: string };
      if (preview.url) {
        const { tr } = view.state;
        tr.insertText(preview.url);
        view.dispatch(tr);
        return true;
      }
    } catch {
      // JSON 解析失败，继续其他处理
    }
  }

  // 图片双兜底方式1：clipboardData 内的图片项（浏览器内复制/截图）
  const imageBlob = extractImageBlob(clipboardData);
  if (imageBlob) {
    const name = `clipboard-${Date.now().toString(36)}.${extFromMime(imageBlob.type)}`;
    const check = validateImageAttachment(name);
    if (!check.ok) {
      // svg 等不可投喂 vision 的格式：拒绝并提示（不断批，防文本重复插入）
      deps.onImageRejected?.(check.reason ?? '不支持的图片格式');
      return true;
    }
    const reader = new FileReader();
    reader.onload = () => {
      deps.addAttachment({
        type: 'image',
        name,
        content: String(reader.result ?? ''),
      });
    };
    reader.readAsDataURL(imageBlob);
    return true; // 同步阻止默认，防文本重复插入
  }

  // DataTransfer.files：7 格式白名单文档（图片已在上方处理）
  const docFiles = Array.from(clipboardData.files ?? []).filter(
    (f) => !f.type.startsWith('image/') && isSupportedDocFile(f.name)
  );
  if (docFiles.length > 0) {
    const withPath: string[] = [];
    const textFiles: File[] = [];
    for (const f of docFiles) {
      const localPath = (f as FileWithPath).path;
      if (localPath) {
        withPath.push(localPath);
      } else if (/\.(txt|md)$/i.test(f.name)) {
        // 无本地路径的文本类：浏览器内存读取（临时通道，B3 统一持久化）
        textFiles.push(f);
      }
      // 无路径二进制（pdf/docx/xls 等）：无法交解析层解析，跳过且不断批
    }
    if (withPath.length > 0) {
      void deps.parsePaths?.(withPath);
    }
    for (const f of textFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        deps.addAttachment({
          type: 'file',
          name: f.name,
          content: String(reader.result ?? ''),
        });
      };
      reader.readAsText(f);
    }
    return true; // 阻止默认（文件路径文本不得重复插入正文）
  }

  // 纯文本是否为 URL：插入原文
  const plainText = clipboardData.getData('text/plain');
  if (plainText && /^https?:\/\/\S+$/i.test(plainText.trim())) {
    const { tr } = view.state;
    tr.insertText(plainText.trim());
    view.dispatch(tr);
    return true;
  }
  if (plainText) return false; // 普通文本走默认粘贴

  // 图片双兜底方式2：无文本可插入时同步接管，Electron 剪贴板异步读图
  // （截图工具/文件管理器复制的图片在部分环境不透出 clipboardData 项）
  if (deps.readElectronImage) {
    void deps
      .readElectronImage()
      .then((dataUrl) => {
        if (dataUrl) {
          const name = `clipboard-${Date.now().toString(36)}.png`;
          const check = validateImageAttachment(name);
          if (!check.ok) {
            deps.onImageRejected?.(check.reason ?? '不支持的图片格式');
            return;
          }
          deps.addAttachment({
            type: 'image',
            name,
            content: dataUrl,
          });
        }
      })
      .catch(() => {
        /* 无图片 → 静默 */
      });
    return true;
  }

  return false;
}

/**
 * 发送正文构造（一-4②）：附件只拼 `[文件: xxx]` / `[图片: xxx]` 占位符，
 * 绝不拼接解析正文 —— 正文随 IPC 载荷入 parsed_attachments（一物两表），
 * 彻底避免打爆 agentHelpers 的 CONTEXT_WINDOW=64000。
 * R6：按 MAX_ATTACHMENTS_PER_MESSAGE 截断（与主进程落库同口径）。
 */
export function buildAttachmentSendText(text: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return text;
  const parts = [text];
  for (const att of attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    parts.push(att.type === 'image' ? `[图片: ${att.name}]` : `[文件: ${att.name}]`);
  }
  return parts.join('\n\n');
}

/** 正文 UTF-8 字节数（附件 size 元数据，缺省无正文时不算）。 */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Attachment → 发送链路 IPC 载荷（一物两表入参）：
 * content = 解析产物（或图片 data URL），主进程写 parsed_attachments.content；
 * 轻量元数据（id/fileType/path/size）最终落 attachments_json。
 * R6：按 MAX_ATTACHMENTS_PER_MESSAGE 截断（与占位符文本同口径）。
 */
export function toAttachmentPayloads(attachments: Attachment[]): IAttachmentPayload[] {
  return attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).map((att) => ({
    id: att.id,
    fileName: att.name,
    fileType: att.type,
    content: att.content ?? '',
    ...(att.path ? { path: att.path } : {}),
    ...(att.content ? { size: byteLength(att.content) } : {}),
    ...(att.structure ? { structure: att.structure } : {}),
  }));
}

/**
 * 路径数组逐个走解析层（一-1②/一-2②）：
 * - 保持输入（=用户选择）顺序串行解析；
 * - 单文件失败（success:false 或抛异常）不断批，失败项 content 为空仍入附件。
 */
export async function ingestFilePaths(
  paths: string[],
  parse: (path: string, fileName: string) => Promise<ParseLikeResponse | undefined>,
  append: (att: Omit<Attachment, 'id'>) => void
): Promise<void> {
  for (const path of paths) {
    const name = path.split(/[/\\]/).pop() || path;
    let content: string | undefined;
    let structure: IDocumentStructure | undefined;
    try {
      const res = await parse(path, name);
      if (res?.success && typeof res.data?.text === 'string') {
        content = res.data.text;
        // 二-6②：结构（页码偏移/章节/表格序号）随附件保留，发送时落 structure_json
        if (typeof res.data.parseVersion === 'number') {
          structure = extractStructure(res.data);
        }
      }
    } catch {
      // 单文件解析失败不断批（一-1②）
    }
    append({ type: 'file', name, path, content, ...(structure ? { structure } : {}) });
  }
}
