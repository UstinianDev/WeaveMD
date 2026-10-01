# 编辑主区 v2 — 数据模型与 Markdown 双向转换（§3-§4）

> 拆分自 [editor-v2-architecture.md](../editor-v2-architecture.md)，原 §3 数据模型 BlockTree v2、§4 Markdown 双向转换；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[editor-v2-architecture.md](../editor-v2-architecture.md)

---

## 3. 数据模型：BlockTree v2

### 3.1 类型定义

```ts
// src/render/editor/kernel/types.ts

export type BlockTypeV2 =
  | 'document' // 根容器
  | 'paragraph' // 叶子块（含文本）
  | 'heading' // 叶子块
  | 'code-block' // 叶子块（围栏代码）
  | 'html-block' // 叶子块（原始 HTML，只读展示）
  | 'thematic-break' // 叶子块（分割线）
  | 'blockquote' // 容器块
  | 'bullet-list' // 容器块
  | 'ordered-list' // 容器块
  | 'task-list' // 容器块
  | 'list-item' // 容器块（列表项，包裹内容）
  | 'table'; // v2 首版为叶子块（原始文本），M4 可选升级为容器块

export interface BlockNodeV2 {
  /** 稳定 ID（构建时生成，重排不变） */
  id: string;
  type: BlockTypeV2;
  /** 父块 ID；根容器的 parent 为 null */
  parentId: string | null;
  /** 兄弟链表（文档顺序） */
  prevId: string | null;
  nextId: string | null;
  /** 容器块的子块 ID 列表；叶子块为 [] */
  childrenIds: string[];
  /** 叶子块文本（唯一文本事实源）；容器块为 null */
  text: string | null;
  /** 块级元数据 */
  meta?: {
    headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    fenceLanguage?: string; // code-block
    listMarker?: '-' | '*' | '+'; // bullet-list
    orderedStart?: number; // ordered-list 起始编号
    orderedDelimiter?: '.' | ')';
    taskChecked?: boolean; // task-list-item
    loose?: boolean; // 列表是否松散
  };
  /** 渲染缓存：行内富文本 HTML（由 inlineRenderer 生成，可为 null 表示待渲染） */
  inlineHtml: string | null;
}

export interface BlockTreeV2 {
  root: BlockNodeV2; // document 根
  blocks: Record<string, BlockNodeV2>;
}

export interface CursorV2 {
  blockId: string;
  /** 相对块文本的偏移（UTF-16 code unit，与 DOM offset 对齐） */
  offset: number;
}

export interface SelectionV2 {
  anchor: CursorV2;
  focus: CursorV2;
}
```

### 3.2 容器块与叶子块划分

| 分类   | 类型                                                                               | 子块规则                          |
| ------ | ---------------------------------------------------------------------------------- | --------------------------------- |
| 容器块 | document / blockquote / bullet-list / ordered-list / task-list / list-item / table | `childrenIds` 非空；自身无 `text` |
| 叶子块 | paragraph / heading / code-block / html-block / thematic-break                     | `text` 非空；`childrenIds` 为空   |

容器嵌套规则（与 CommonMark 对齐）：

- `blockquote` 可包含任意块（含列表、代码块、子引用）。
- `list-item` 至少一个块子节点（通常是 paragraph 或嵌套 list）；`list` 的子节点只能是 `list-item`。
- `table` 在 v2 首版为**叶子块**（text 保存原始 Markdown 文本，整块只读 + 源码编辑）；
  行级容器化结构（table-row / table-cell）留待 M4 可选扩展。

### 3.3 纯函数操作 API（内核层签名）

```ts
// src/render/editor/kernel/blockTree.ts

export function createDocumentTree(): BlockTreeV2;
export function getBlock(tree: BlockTreeV2, id: string): BlockNodeV2 | undefined;
export function getChildren(tree: BlockTreeV2, id: string): BlockNodeV2[];
export function getPrev(tree: BlockTreeV2, id: string): BlockNodeV2 | null;
export function getNext(tree: BlockTreeV2, id: string): BlockNodeV2 | null;
export function getParent(tree: BlockTreeV2, id: string): BlockNodeV2 | null;
export function getFirstLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null; // DFS 首个叶子
export function getLastLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null;
export function getNextLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null; // 文档序下一个叶子
export function getPrevLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null;
export function getAllBlocksInOrder(tree: BlockTreeV2): BlockNodeV2[]; // 文档序（前序）

export function insertBlockAfter(tree: BlockTreeV2, refId: string, node: BlockNodeV2): BlockTreeV2;
export function insertBlockBefore(tree: BlockTreeV2, refId: string, node: BlockNodeV2): BlockTreeV2;
export function appendChild(tree: BlockTreeV2, parentId: string, node: BlockNodeV2): BlockTreeV2;
export function removeBlock(tree: BlockTreeV2, id: string): BlockTreeV2;
export function replaceBlock(tree: BlockTreeV2, id: string, node: BlockNodeV2): BlockTreeV2;
export function setBlockText(tree: BlockTreeV2, id: string, text: string): BlockTreeV2;
export function setInlineHtml(tree: BlockTreeV2, id: string, html: string): BlockTreeV2;
export function updateMeta(
  tree: BlockTreeV2,
  id: string,
  patch: Partial<BlockNodeV2['meta']>
): BlockTreeV2;

/** 将一段文本按块树结构切分：splitLeaf(tree, leafId, offset) → 左右两个叶子 */
export function splitLeaf(tree: BlockTreeV2, leafId: string, offset: number): BlockTreeV2;

/** 把相邻叶子合并（backspace 跨块删除时使用） */
export function mergeLeafIntoPrev(tree: BlockTreeV2, leafId: string): BlockTreeV2;

/** 根据 text 内容决定叶子块应转换成的类型（供控制器查询） */
export function detectBlockConversion(text: string): {
  type:
    | 'paragraph'
    | 'heading'
    | 'bullet-list'
    | 'ordered-list'
    | 'task-list'
    | 'blockquote'
    | 'code-block'
    | 'thematic-break';
  meta?: BlockNodeV2['meta'];
  prefixLength: number;
} | null;
```

所有操作返回新树（结构共享、不可变），保证 React 可直接比较引用触发渲染。

---

## 4. Markdown 双向转换

### 4.1 块检测优先级（markdownToState）

按行/块级规则依次尝试，命中即消费：

````
空白行（跳过，用于块分隔）
→ 围栏代码块（``` / ~~~，含语言标识，直到闭合围栏）
→ HTML 块（<div> 等，可选支持）
→ 表格（| 表头 | 分隔行 | 行 |）
→ ATX 标题（#{1,6} 空格）
→ Setext 标题（下划线 = 或 -，可选支持）
→ 引用块（> 前缀，连续多行合并，支持嵌套 >）
→ 列表（无序 -/*/+ 或有序 1. / 1) ；任务列表 - [x] / - [ ] 优先于无序）
→ 代码块（4 空格缩进，可选支持）
→ 分割线（--- / *** / ___，独立成块）
→ 段落（兜底，连续非空行合并，行内再解析）
````

列表块解析须支持：

- 同一列表容器内连续列表项合并；不同标记（`-` 与 `+`）视为同一列表（marktext 行为：合并）。
- 列表项内缩进 2/4 空格产生嵌套子块（段落缩进 → 子列表 / 代码块）。
- 任务列表 `- [x] text` 转换为 `task-list > task-list-item(checked) > paragraph`。
- 有序列表保留 `start` 与分隔符（`.` 或 `)`）。

### 4.2 转换不变量

对任意 markdown 文本 `M`：

```
stateToMarkdown(markdownToState(M)) === M（按规范化的行尾与块间隔）
```

实现要点：

- 叶子块 `text` 存**纯文本**（不含语法前缀），序列化时按块类型 + meta 重建前缀（如
  `heading` → `#{level} ` + text；`bullet-list > list-item` → `- ` + text）。
- 容器块的嵌套缩进由序列化器按层级计算（列表子项 2 空格/4 空格，与解析器互逆）。
- 块间以空行分隔（loose list 项间空行由 `loose` meta 控制）。
- 代码块序列化：`+ 语言 + 内容 +`；内容含围栏时自动选择更长围栏。

**规范化往返定义（M1 定稿）**：`stateToMarkdown(markdownToState(M)) === M` 对所有
"规范输入"严格成立；非规范输入输出语义等价的规范化形式。已知归一化清单：

| 输入                            | 输出（规范化）                         | 说明                                       |
| ------------------------------- | -------------------------------------- | ------------------------------------------ |
| 块间无空行（`# H\np`）          | 补空行（`# H\n\np`）                   | 块边界显式化                               |
| 标题 closing `#`（`# Title #`） | 剥离（`# Title`）                      | CommonMark 语义                            |
| 无序列表 `*` / `+` 标记         | 统一 `-`                               | marktext 行为                              |
| 分割线 `***` / `___`            | 统一 `---`                             | 语义等价                                   |
| 文档首尾空行                    | 剥离                                   | 无信息量                                   |
| 空文档（纯空白）                | `''`                                   | 无信息量                                   |
| 以围栏代码块收尾的文档          | 块树末尾补空 paragraph（文本输出不变） | 代码块尾随保护空行持久化（SPEC-EDIT-CBTP） |
| 引用内末尾代码块                | 引用尾部序列化出一行裸 `>`             | SPEC-EDIT-CBTP B3 边缘场景，语义等价       |

### 4.3 行内渲染（inlineRenderer）

`text → inlineHtml` 由行内 lexer + renderer 完成，支持：

- 强调/加粗/删除线/下划线/高亮（`*` `**` `~~` `<u>` `==`）
- 行内代码（`` ` ``，含转义与多反引号）
- 链接与图片（`[text](url)` / `![alt](url)`）
- 自动链接（URL / email）
- HTML 转义（`&` `<` `>`）、反斜杠转义
- 任务列表复选标记不属于行内（由块渲染处理）

行内渲染结果存入 `inlineHtml` 缓存；`text` 变化时由控制器失效缓存。
