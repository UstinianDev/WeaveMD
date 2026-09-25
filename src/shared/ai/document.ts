// 文档解析类型与白名单（渲染/主进程共用）

/** 解析产物契约版本：B1 起为结构化产物 v1（回填重建依据，二-6①） */
export const DOCUMENT_PARSE_VERSION = 1;

/** 支持的文档扩展名（7 格式白名单，xlsm/xlsb 不在清单内不做扩格式） */
export const SUPPORTED_DOC_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.md',
  '.xls',
  '.xlsx',
] as const;

/** 文件名是否属于 7 格式白名单（大小写不敏感；上传/IPC 入口校验用） */
export function isSupportedDocFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const idx = lower.lastIndexOf('.');
  if (idx <= 0) return false;
  const ext = lower.slice(idx);
  return (SUPPORTED_DOC_EXTENSIONS as readonly string[]).includes(ext);
}

/** 标题（层级 + 祖先路径） */
export interface IDocumentHeading {
  text: string;
  /** 1-6，对应 markdown # 级数 */
  level: number;
  /** 祖先标题路径（不含自身） */
  path: string[];
}

/** 章节（完整路径，溯源用，二-6①） */
export interface IDocumentSection {
  title: string;
  /** 含自身的完整章节链路 */
  path: string[];
}

/** 表格（全局序号 + Markdown 渲染，二-6①；CSV 两态随 B7 补全） */
export interface IDocumentTable {
  /** 全局序号，1 起 */
  index: number;
  markdown: string;
  /** 所属章节路径 */
  sectionPath: string[];
  /** 页码（PDF 版面细项随 B7 补全） */
  pageIndex?: number;
}

/** 图片引用（全局序号，二-6①；随各格式解析回填） */
export interface IDocumentImage {
  /** 全局序号，1 起 */
  index: number;
  sectionPath: string[];
  pageIndex?: number;
}

/** 文档解析结果（结构化产物） */
export interface IDocumentParseResult {
  text: string;
  fileName: string;
  fileType: string;
  pageCount?: number;
  error?: string;
  headings: IDocumentHeading[];
  sections: IDocumentSection[];
  tables: IDocumentTable[];
  images: IDocumentImage[];
  /** 产物契约版本 */
  parseVersion: number;
  /** 降级提示（如 .doc 走 D 路线/另存为 docx，Q3） */
  degraded?: string;
}
