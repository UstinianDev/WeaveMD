// Mention、附件、图片、文件操作、全局文件类型

import type { IDocumentStructure } from './document';

/** @ mention 项。 */
export interface IMentionItem {
  type: 'file' | 'folder' | 'skill';
  id: string;
  name: string;
  path?: string;
  description?: string;
}

/** 附件解析状态（一-4 三态流转：pending → processing → done | error）。 */
export type AttachmentParseStatus = 'pending' | 'processing' | 'done' | 'error';

/**
 * 附件载荷（发送链路 IPC）：解析产物随 content 行进，主进程白名单降级为
 * IAttachmentMeta 写 attachments_json（一物两表，正文不入消息表）。
 */
export interface IAttachmentPayload {
  fileName: string;
  fileType: 'file' | 'image';
  content: string;
  pageCount?: number;
  /** composer 侧附件 id（幂等键：Agent 任务重试复用同一 id） */
  id?: string;
  /** 本地文件路径（系统对话框/粘贴文件的 Electron path） */
  path?: string;
  /** 字节数（正文 UTF-8 编码长度，可空） */
  size?: number;
  parseStatus?: AttachmentParseStatus;
  /**
   * 解析结构（二-6②：页码/章节/表格序号 + parseVersion，供 source_ref 真实页码）。
   * 由 renderer 从 KB_PARSE_DOCUMENT 产物提取（extractStructure），主进程白名单校验后落库。
   */
  structure?: IDocumentStructure;
}

/**
 * ai_messages.attachments_json 轻量元数据（一-4②：只存 id/type/name/path/size/parseStatus，
 * 解析正文存 parsed_attachments.content）。`thumb` 仅渲染层存活态（data URL），
 * 主进程序列化时白名单剔除，不落库。
 */
export interface IAttachmentMeta {
  id: string;
  type: 'file' | 'image';
  name: string;
  path?: string;
  size?: number;
  parseStatus?: AttachmentParseStatus;
  /** 附件失败的人类可读原因（svg 拒绝 / 超限 / 落盘失败），三态渲染展示用 */
  error?: string;
  /** 渲染层存活态缩略图（data URL），不持久化 */
  thumb?: string;
}

/** 图片载荷。 */
export interface IImagePayload {
  fileName: string;
  mimeType: string;
  base64: string;
  width?: number;
  height?: number;
}

/** Agent 文件操作（proposal 模式）。 */
export interface IAgentFileOp {
  type: 'rename' | 'move' | 'delete';
  fileId: string;
  fileName: string;
  target?: string;
}

/** 全局 Agent 文件内容。 */
export interface IGlobalAgentFiles {
  soul: string;
  memory: string;
  style: string;
}
