// Mention、附件、图片、文件操作、全局文件类型

/** @ mention 项。 */
export interface IMentionItem {
  type: 'file' | 'folder' | 'skill';
  id: string;
  name: string;
  path?: string;
  description?: string;
}

/** 附件载荷。 */
export interface IAttachmentPayload {
  fileName: string;
  fileType: string;
  content: string;
  pageCount?: number;
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
