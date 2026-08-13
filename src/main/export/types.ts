// ============================================
// WeaveMD — Export IPC contract types
// ============================================
// 渲染层/主进程导出功能的共享契约（跨模块并行开发的冻结接口）。
// 渲染层只表达「导出 X 格式」意图，主进程 exportService 负责分发与文件生成。

/** 支持的导出格式 */
export type ExportFormat = 'md' | 'pdf' | 'doc' | 'docx' | 'html' | 'png' | 'jpg' | 'jpeg';

/** 渲染层 → 主进程的导出请求（html 为 renderMarkdownToHtml 的正文片段，全格式共享一次传输） */
export interface ExportRequest {
  format: ExportFormat;
  /** 原始 markdown 内容（md 导出直接落盘） */
  content: string;
  /** 渲染后的 HTML 正文片段（pdf/doc/docx/html/png/jpg/jpeg 复用） */
  html: string;
  /** 导出默认文件名（不含扩展名） */
  filename: string;
}

/** 导出结果；error === 'cancelled' 表示用户取消保存对话框（渲染层静默处理） */
export interface ExportResult {
  success: boolean;
  error?: 'cancelled' | 'failed' | string;
  data?: {
    filePath?: string;
    /** png/jpg 超长文档截断时透出的截断像素数 */
    truncatedPx?: number;
  };
}

/** png/jpg 渲染窗口最大内容高度（Chromium 窗口高度上限保守值），超出则截断 */
export const EXPORT_MAX_HEIGHT = 15000;

/** png/jpg 内容宽度 */
export const EXPORT_IMAGE_WIDTH = 800;

/** 大图 base64 内联体积阈值（字节），超过则降采样 */
export const EXPORT_LARGE_IMAGE_BYTES = 8 * 1024 * 1024;

/** 降采样后图片最大宽度 */
export const EXPORT_MAX_IMAGE_WIDTH = 1600;

/** jpg/jpeg 导出质量 */
export const EXPORT_JPEG_QUALITY = 92;

/** 大图降采样后重新编码的 JPEG 质量 */
export const EXPORT_DOWNSAMPLE_JPEG_QUALITY = 85;
