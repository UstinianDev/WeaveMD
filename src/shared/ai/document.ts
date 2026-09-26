// 文档解析类型与白名单（渲染/主进程共用）

/**
 * 解析产物契约版本（回填重建依据，二-6①）。
 * v1：B1 结构化产物（headings/sections/tables/pageCount）。
 * v2：B7 版面细项补全（pageOffsets 真实页码 / metadata 页眉页脚 /
 *     table.csv 两态 / dRoute 多模态轨迹）。
 */
export const DOCUMENT_PARSE_VERSION = 2;

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

/** 表格（全局序号 + Markdown 渲染，二-6①；CSV 两态字段 B7 补全）。 */
export interface IDocumentTable {
  /** 全局序号，1 起 */
  index: number;
  markdown: string;
  /** CSV 两态（二-6②：与 Markdown 同源行列的逗号分隔形态） */
  csv?: string;
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

/** 版面 metadata（二-3②：跨页重复页眉页脚剔除后入此）。 */
export interface IDocumentParseMetadata {
  /** 剔除的页眉页脚原文（去重）。 */
  headersFooters?: string[];
}

/** D 路线（多模态）执行轨迹（二-4②：触发/降级可观测）。 */
export interface IDocumentDRouteInfo {
  triggered: boolean;
  used: boolean;
  /** 触发原因（no-text-layer / column-detect-failed / low-table-confidence）。 */
  reasons?: string[];
  pagesRendered?: number;
  estimatedTokens?: number;
  /** 因页数上限截断的页数。 */
  truncatedPages?: number;
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
  /**
   * 各页 text 起始偏移（二-6②：source_ref 真实页码溯源；
   * pageOffsets[i] = 第 i+1 页在 text 中的起点）。
   */
  pageOffsets?: number[];
  /** 版面 metadata（页眉页脚等）。 */
  metadata?: IDocumentParseMetadata;
  /** D 路线轨迹（触发但未使用时仅 triggered=true）。 */
  dRoute?: IDocumentDRouteInfo;
  /** 降级提示（如 .doc 走 D 路线/另存为 docx，Q3）。 */
  degraded?: string;
}

/**
 * 跨进程传递的解析结构（KB 导入 / 附件落库；不含 text 正文）。
 * 由 extractStructure 从 IDocumentParseResult 提取。
 */
export interface IDocumentStructure {
  pageCount?: number;
  pageOffsets?: number[];
  sections?: IDocumentSection[];
  tables?: Array<{
    index: number;
    sectionPath: string[];
    pageIndex?: number;
    csv?: string;
  }>;
  metadata?: IDocumentParseMetadata;
  parseVersion: number;
}

/** 从解析产物提取可持久化的结构（去掉 text 正文，一物两表）。 */
export function extractStructure(
  result: Partial<IDocumentParseResult> & { parseVersion?: number }
): IDocumentStructure {
  return {
    ...(result.pageCount != null ? { pageCount: result.pageCount } : {}),
    ...(result.pageOffsets ? { pageOffsets: result.pageOffsets } : {}),
    sections: result.sections ?? [],
    tables: (result.tables ?? []).map((t) => ({
      index: t.index,
      sectionPath: t.sectionPath,
      ...(t.pageIndex != null ? { pageIndex: t.pageIndex } : {}),
      ...(t.csv != null ? { csv: t.csv } : {}),
    })),
    ...(result.metadata ? { metadata: result.metadata } : {}),
    parseVersion: result.parseVersion ?? DOCUMENT_PARSE_VERSION,
  };
}

/** parseDocument 可选入参（D 路线需要 userId 解析模型配置）。 */
export interface IDocumentParseOptions {
  /** 当前用户（D 路线读取 ai_config；缺省则触发 D 时直接降级）。 */
  userId?: string;
}
