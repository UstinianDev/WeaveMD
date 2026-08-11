// ============================================
// WeaveMD Editor v2 — Kernel Types
// ============================================
// 编辑主区 v2 的唯一事实源：块树（BlockTreeV2）。
// 设计蓝本：marktext/muya（TreeNode 双向链表 + 容器/叶子分型）。
// 本文件为纯类型定义，不依赖 React / DOM。

/** 块类型（v2） */
export type BlockTypeV2 =
  /** 根容器 */
  | 'document'
  /** 叶子块：普通段落 */
  | 'paragraph'
  /** 叶子块：标题（ATX 或 Setext 来源） */
  | 'heading'
  /** 叶子块：围栏代码块 */
  | 'code-block'
  /** 叶子块：原始 HTML 块（v2 首版按段落文本保留，类型保留备用） */
  | 'html-block'
  /** 叶子块：分割线 */
  | 'thematic-break'
  /** 容器块：引用 */
  | 'blockquote'
  /** 容器块：无序列表 */
  | 'bullet-list'
  /** 容器块：有序列表 */
  | 'ordered-list'
  /** 容器块：任务列表 */
  | 'task-list'
  /** 容器块：列表项 */
  | 'list-item'
  /**
   * 表格。v2 首版为叶子块（text 保存原始 Markdown 文本，整块只读 + 源码编辑），
   * 行级容器化结构留待 M4 可选扩展。
   */
  | 'table'
  /**
   * 叶子块：独立成块的图片（text 保存整行原始 Markdown 文本，含可选
   * `<div align="left|center|right">` 包裹；对齐由 text 内的 wrapper 表达）。
   */
  | 'image-block';

/** 块级元数据 */
export interface BlockMetaV2 {
  /** heading：1-6 */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** heading：Setext 来源（用于无损往返：text 行 + = 或 - 下划线行） */
  setext?: { char: '=' | '-'; underline: string };
  /** code-block：围栏语言标识 */
  fenceLanguage?: string;
  /** code-block：围栏标记（``` 或 ~~~），默认 ``` */
  fenceMarker?: string;
  /** bullet-list / task-list：列表标记 */
  listMarker?: '-' | '*' | '+';
  /** ordered-list：起始编号 */
  orderedStart?: number;
  /** ordered-list：分隔符 */
  orderedDelimiter?: '.' | ')';
  /** task-list-item：是否勾选 */
  taskChecked?: boolean;
  /** 列表是否松散（项间空行） */
  loose?: boolean;
}

/** 块节点（v2） */
export interface BlockNodeV2 {
  /** 稳定 ID（构建时生成，文档重排不变） */
  id: string;
  type: BlockTypeV2;
  /** 父块 ID；根容器为 null */
  parentId: string | null;
  /** 兄弟链表：前一兄弟 */
  prevId: string | null;
  /** 兄弟链表：后一兄弟 */
  nextId: string | null;
  /** 容器块的子块 ID 列表；叶子块为 [] */
  childrenIds: string[];
  /** 叶子块文本（唯一文本事实源）；容器块为 null */
  text: string | null;
  /** 块级元数据 */
  meta?: BlockMetaV2;
  /** 行内富文本渲染缓存（由 inlineRenderer 生成；null 表示待渲染） */
  inlineHtml: string | null;
}

/** 块树（v2） */
export interface BlockTreeV2 {
  /** 根容器（document） */
  root: BlockNodeV2;
  /** 所有块按 ID 索引 */
  blocks: Record<string, BlockNodeV2>;
}

/** 光标：块 ID + 块文本内偏移（UTF-16 code unit） */
export interface CursorV2 {
  blockId: string;
  offset: number;
}

/** 选区 */
export interface SelectionV2 {
  anchor: CursorV2;
  focus: CursorV2;
}

/** 块转换检测结果（detectBlockConversion） */
export interface BlockConversionV2 {
  type:
    | 'paragraph'
    | 'heading'
    | 'bullet-list'
    | 'ordered-list'
    | 'task-list'
    | 'blockquote'
    | 'code-block'
    | 'thematic-break';
  meta?: BlockMetaV2;
  /** 语法前缀长度（含分隔空格），用于从文本中剥离 */
  prefixLength: number;
}

/** 叶子块类型集合（便于判别） */
export const LEAF_BLOCK_TYPES: readonly BlockTypeV2[] = [
  'paragraph',
  'heading',
  'code-block',
  'html-block',
  'thematic-break',
  'table',
  'image-block',
];

/** 容器块类型集合 */
export const CONTAINER_BLOCK_TYPES: readonly BlockTypeV2[] = [
  'document',
  'blockquote',
  'bullet-list',
  'ordered-list',
  'task-list',
  'list-item',
];

/** 列表容器类型集合 */
export const LIST_BLOCK_TYPES: readonly BlockTypeV2[] = [
  'bullet-list',
  'ordered-list',
  'task-list',
];

export function isLeafBlockType(type: BlockTypeV2): boolean {
  return LEAF_BLOCK_TYPES.includes(type);
}

export function isContainerBlockType(type: BlockTypeV2): boolean {
  return CONTAINER_BLOCK_TYPES.includes(type);
}

export function isListBlockType(type: BlockTypeV2): boolean {
  return LIST_BLOCK_TYPES.includes(type);
}
