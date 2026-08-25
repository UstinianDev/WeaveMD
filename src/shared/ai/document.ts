// 文档解析类型

/** 文档解析结果 */
export interface IDocumentParseResult {
  text: string;
  fileName: string;
  fileType: string;
  pageCount?: number;
  error?: string;
}
