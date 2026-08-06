# 编辑主区深度重做规范（Editor v2 Architecture）

> 规范编号：SPEC-EDITOR-V2 | 版本：v0.2（草案，待评审后实施）| 更新：2026-08-05
> 关联需求：REQUIREMENTS.md 3.2 编辑器核心（EDIT-01 ~ EDIT-12）
> 参考实现：marktext/marktext（Muya 编辑器内核，MIT License）
> 关联文档：docs/modules/04-编辑主区-Editor.md、docs/specs/markdown-block-exit-rules.md

---

## 1. 背景与目标

### 1.1 现状问题（代码审查结论）

对 `src/render/components/Editor/` 与 `src/render/services/` 的全面审查，确认当前编辑主区
存在以下结构性问题：

| # | 问题 | 证据 | 影响 |
| - | ---- | ---- | ---- |
| E1 | 容器级 contentEditable：整个 `editor-content-area` 一个 contenteditable，所有块都是其子元素 | `EditorScrollContainer.tsx` 中 `contentEditable` 在容器层，块组件只读渲染 | 光标/选区管理脆弱，必须用 TreeWalker、零宽空格、`focusBlockCursor` setTimeout 等大量 workaround；跨块 DOM 操作（格式化、删除）极易越界 |
| E2 | EditorView 巨型组件：输入/回车/退格/转换/同步/导航/查找全部耦合 | `EditorView.tsx` 1686 行，30+ 个 useCallback | 逻辑无法独立测试，状态流难以追踪，任何交互改动都牵一发动全身 |
| E3 | 渲染与模型脱节：块内容依赖 `renderedHtml` 缓存 + `dangerouslySetInnerHTML` 恢复，真实文本只存在于 DOM | `BlockNode.renderedHtml`、渲染 effect 依赖 `[version]` 并扫描全部块 | 出现 O(N²) 重扫、stale ID、缓存失效等复杂状态；序列化依赖 DOM 反推（`domToMarkdown`），无法保证无损 |
| E4 | 块模型扁平：所有块都是顶层兄弟，无容器嵌套 | `BlockTree.rootBlockIds` 一维数组，`parentId/childrenIds` 未实际使用 | 不支持列表嵌套（子列表/列表内代码块/引用内列表）、表格多行结构等 CommonMark 基本结构 |
| E5 | 代码块是旁路：textarea 独立编辑，与统一编辑模型隔离 | `CodeFenceBlock.tsx` 中 textarea `onKeyDown` stopPropagation | 代码块无法参与统一的块操作（空退、合并、tab），行为与其他块不一致 |
| E6 | 格式化依赖 `document.execCommand` + Range 直接操作 DOM | `FloatingToolbarWYSIWYG.tsx` | execCommand 已废弃，行为跨平台不一致，且绕过了块模型，破坏 WYSIWYG 一致性 |
| E7 | 块转换规则分散：pending 灰化、回车提交、退格回退逻辑分布在 input/enter/backspace 三个 handler 中，且有双路径（pending + fallback） | `handleBlockInput/handleBlockEnter/handleBlockDelete/handleBlockConvertToParagraph` | 六种块的退出边界条件（SPEC-EDIT-EXIT）与进入规则无法统一验证 |

### 1.2 重做目标

1. **统一数据模型**：文档的唯一事实源是"块树"，DOM 只是块树的投影；编辑操作修改块树后按需局部渲染。
2. **块内 contentEditable**：只有叶子块的内容区（如段落文本、标题文本）可编辑，块结构与 DOM 一一对应，光标管理收敛到"内容块"。
3. **控制器分层**：按 muya 范式拆分 input / enter / backspace / click / format / list 控制器，每个控制器只负责一类交互，可独立测试。
4. **支持嵌套结构**：容器块（列表、引用、表格）可以嵌套叶子块与容器块，覆盖 CommonMark + GFM 主要结构。
5. **Markdown 双向无损转换**：`markdown → 块树` 与 `块树 → markdown` 互为逆操作（SPEC-EDITOR-V2 4 节），序列化不依赖 DOM。
6. **兼容现有集成面**：保持 `EditorView` 对外 props 与 `editorStore/uiStore` 契约不变，导航、查找、自动保存、模式切换继续工作。

### 1.3 参考架构：marktext / muya

本规范的设计蓝本为 marktext 的 Muya 编辑器内核（`@marktext/muya@0.0.6`，MIT），其核心范式：

- **块树**：`TreeNode` 双向链表 + 父子树；`ContainerBlock`（block-quote / list / list-item）与
  `LeafBlock`（heading / paragraph / codeBlock 等，含 `ContentBlock` 子块）分型；
  DOM 节点与块实例一一对应（`domNode[BLOCK_DOM_PROPERTY] = block`）。
- **状态单一事实源**：`ContentState` 持有块树；内容块 `text` 为唯一文本事实，编辑通过
  `jsonState` 操作（path 定位 + ot-text 操作）同步。
- **事件中心**：`EventCenter` 统一注册/注销 DOM 监听（带 eventId），内容块监听
  input/keydown/keyup/click/blur/focus/composition*，控制器各自处理。
- **输入管线**：`inputHandler → autoPair → text 更新 → checkNeedRender → update → setSelection
  → convertIfNeeded`；`convertIfNeeded` 用正则检测列表/标题/引用/代码/分割线前缀后执行块转换。
- **行内渲染**：`inlineRenderer`（lexer + token renderer 系列）负责把 text 渲染为富文本 DOM。

WeaveMD 不整体移植 muya（其为 Vue 无关的 1000+ 文件 JS 库，依赖 katex/mermaid/vega 等），
而是**照搬其架构范式与交互行为**，用 React + TypeScript 实现等价内核。

---

## 2. 总体架构

### 2.1 分层

```
┌────────────────────────────────────────────────────────────┐
│ 集成层（React 组件与 store 适配）                            │
│  EditorView（对外契约不变）                                 │
│  OutlinePanel / Minimap / FindReplaceBar / StatusBar       │
│  editorStore / uiStore                                     │
├────────────────────────────────────────────────────────────┤
│ 控制器层（Editor Controllers，纯逻辑，可独立测试）           │
│  inputCtrl · enterCtrl · backspaceCtrl · clickCtrl         │
│  formatCtrl · listCtrl · cursorCtrl                        │
├────────────────────────────────────────────────────────────┤
│ 内核层（Editor Kernel，与 React 无关）                      │
│  blockTree（不可变块树 + 纯函数操作）                       │
│  markdownToState / stateToMarkdown（无损双向转换）          │
│  inlineRenderer（text → 富文本 HTML 片段）                 │
│  selection（cursor 模型与 DOM 同步）                       │
├────────────────────────────────────────────────────────────┤
│ 渲染层（React 组件，纯投影）                                │
│  EditorScrollContainer → BlockRenderer → 各块组件          │
│  LeafBlock 内容区（contentEditable）                       │
└────────────────────────────────────────────────────────────┘
```

### 2.2 数据流总览

```
用户输入 → 内容块 DOM input 事件
  → 控制器读取 DOM 文本与光标
  → 控制器调用内核纯函数修改 blockTree（不可变）
  → 事件通知 React 更新（最小局部渲染）
  → React 重渲染受影响块，恢复光标
  → 内容变更经 editorStore 同步 → 自动保存
```

**关键约束**：

- 块树是唯一事实源；DOM 永不反向驱动模型（控制器读取 DOM 仅用于获取光标偏移与临时文本）。
- 内容块的重渲染必须保留光标：由 `cursorCtrl` 在渲染后恢复。
- 块树更新采用不可变风格（每次操作返回新树），但与 v1 的"版本号 + 全量 effect 扫描"
  不同，v2 由控制器精确指定受影响块集合，按需渲染。

### 2.3 目标目录结构（新增/重构）

```
src/render/editor/                    # 新内核目录（与 React 解耦）
├── kernel/
│   ├── types.ts                      # BlockNode v2、Cursor、BlockTree 类型
│   ├── blockTree.ts                  # 不可变块树纯函数
│   ├── markdownToState.ts            # markdown → BlockTree
│   ├── stateToMarkdown.ts            # BlockTree → markdown
│   ├── inlineRenderer.ts             # text → 行内富文本 HTML
│   └── selection.ts                  # cursor 模型 + DOM 读写
├── controllers/
│   ├── inputCtrl.ts
│   ├── enterCtrl.ts
│   ├── backspaceCtrl.ts
│   ├── clickCtrl.ts
│   ├── formatCtrl.ts
│   └── listCtrl.ts
└── editorInstance.ts                 # 组装内核 + 控制器 + 事件中心的宿主

src/render/components/Editor/         # 渲染层（重构）
├── EditorView.tsx                    # 保持对外 props，内部换用 editorInstance
├── EditorScrollContainer.tsx         # 纯容器：滚动 + 事件代理
├── BlockRenderer.tsx                 # 块类型分发
├── blocks/                           # 各块组件（容器块 + 叶子块）
│   ├── ContainerBlock.tsx            # list / blockquote / table 容器
│   ├── HeadingBlock.tsx              # 叶子块，内含 ContentBlock
│   ├── ParagraphBlock.tsx
│   ├── CodeBlock.tsx                 # 代码块（contentEditable 化，替代 textarea 旁路）
│   ├── ListItemBlock.tsx
│   ├── BlockquoteBlock.tsx
│   ├── TableBlock.tsx
│   └── ContentBlock.tsx              # 通用可编辑内容区
└── panels/                           # OutlinePanel / Minimap / FindReplaceBar 适配层
```

`src/render/services/` 下 v1 的 `blockTree.ts / blockTreeBuilder.ts / blockTreeSerializer.ts /
lineMarkdown.ts / markdown.ts / searchEngine.ts` 保留到 M4 完成后再退役，过渡期不与 v2 混用。

---

## 3. 数据模型：BlockTree v2

### 3.1 类型定义

```ts
// src/render/editor/kernel/types.ts

export type BlockTypeV2 =
  | 'document'            // 根容器
  | 'paragraph'           // 叶子块（含文本）
  | 'heading'             // 叶子块
  | 'code-block'          // 叶子块（围栏代码）
  | 'html-block'          // 叶子块（原始 HTML，只读展示）
  | 'thematic-break'      // 叶子块（分割线）
  | 'blockquote'          // 容器块
  | 'bullet-list'         // 容器块
  | 'ordered-list'        // 容器块
  | 'task-list'           // 容器块
  | 'list-item'           // 容器块（列表项，包裹内容）
  | 'table';              // v2 首版为叶子块（原始文本），M4 可选升级为容器块

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
    fenceLanguage?: string;      // code-block
    listMarker?: '-' | '*' | '+'; // bullet-list
    orderedStart?: number;       // ordered-list 起始编号
    orderedDelimiter?: '.' | ')';
    taskChecked?: boolean;       // task-list-item
    loose?: boolean;             // 列表是否松散
  };
  /** 渲染缓存：行内富文本 HTML（由 inlineRenderer 生成，可为 null 表示待渲染） */
  inlineHtml: string | null;
}

export interface BlockTreeV2 {
  root: BlockNodeV2;             // document 根
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

| 分类 | 类型 | 子块规则 |
| ---- | ---- | -------- |
| 容器块 | document / blockquote / bullet-list / ordered-list / task-list / list-item / table | `childrenIds` 非空；自身无 `text` |
| 叶子块 | paragraph / heading / code-block / html-block / thematic-break | `text` 非空；`childrenIds` 为空 |

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
export function getFirstLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null;   // DFS 首个叶子
export function getLastLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null;
export function getNextLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null;   // 文档序下一个叶子
export function getPrevLeaf(tree: BlockTreeV2, id: string): BlockNodeV2 | null;
export function getAllBlocksInOrder(tree: BlockTreeV2): BlockNodeV2[];            // 文档序（前序）

export function insertBlockAfter(
  tree: BlockTreeV2,
  refId: string,
  node: BlockNodeV2
): BlockTreeV2;
export function insertBlockBefore(
  tree: BlockTreeV2,
  refId: string,
  node: BlockNodeV2
): BlockTreeV2;
export function appendChild(tree: BlockTreeV2, parentId: string, node: BlockNodeV2): BlockTreeV2;
export function removeBlock(tree: BlockTreeV2, id: string): BlockTreeV2;
export function replaceBlock(tree: BlockTreeV2, id: string, node: BlockNodeV2): BlockTreeV2;
export function setBlockText(tree: BlockTreeV2, id: string, text: string): BlockTreeV2;
export function setInlineHtml(tree: BlockTreeV2, id: string, html: string): BlockTreeV2;
export function updateMeta(tree: BlockTreeV2, id: string, patch: Partial<BlockNodeV2['meta']>): BlockTreeV2;

/** 将一段文本按块树结构切分：splitLeaf(tree, leafId, offset) → 左右两个叶子 */
export function splitLeaf(tree: BlockTreeV2, leafId: string, offset: number): BlockTreeV2;

/** 把相邻叶子合并（backspace 跨块删除时使用） */
export function mergeLeafIntoPrev(tree: BlockTreeV2, leafId: string): BlockTreeV2;

/** 根据 text 内容决定叶子块应转换成的类型（供控制器查询） */
export function detectBlockConversion(text: string): {
  type: 'paragraph' | 'heading' | 'bullet-list' | 'ordered-list' | 'task-list' | 'blockquote' | 'code-block' | 'thematic-break';
  meta?: BlockNodeV2['meta'];
  prefixLength: number;
} | null;
```

所有操作返回新树（结构共享、不可变），保证 React 可直接比较引用触发渲染。

---

## 4. Markdown 双向转换

### 4.1 块检测优先级（markdownToState）

按行/块级规则依次尝试，命中即消费：

```
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
```

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
- 代码块序列化：``` + 语言 + 内容 + ```；内容含围栏时自动选择更长围栏。

**规范化往返定义（M1 定稿）**：`stateToMarkdown(markdownToState(M)) === M` 对所有
"规范输入"严格成立；非规范输入输出语义等价的规范化形式。已知归一化清单：

| 输入 | 输出（规范化） | 说明 |
| ---- | -------------- | ---- |
| 块间无空行（`# H\np`） | 补空行（`# H\n\np`） | 块边界显式化 |
| 标题 closing `#`（`# Title #`） | 剥离（`# Title`） | CommonMark 语义 |
| 无序列表 `*` / `+` 标记 | 统一 `-` | marktext 行为 |
| 分割线 `***` / `___` | 统一 `---` | 语义等价 |
| 文档首尾空行 | 剥离 | 无信息量 |
| 空文档（纯空白） | `''` | 无信息量 |

### 4.3 行内渲染（inlineRenderer）

`text → inlineHtml` 由行内 lexer + renderer 完成，支持：

- 强调/加粗/删除线/下划线/高亮（`*` `**` `~~` `<u>` `==`）
- 行内代码（`` ` ``，含转义与多反引号）
- 链接与图片（`[text](url)` / `![alt](url)`）
- 自动链接（URL / email）
- HTML 转义（`&` `<` `>`）、反斜杠转义
- 任务列表复选标记不属于行内（由块渲染处理）

行内渲染结果存入 `inlineHtml` 缓存；`text` 变化时由控制器失效缓存。

---

## 5. 渲染模型

### 5.1 组件树

```
EditorScrollContainer（滚动视口）
└── <div data-editor-root>（非 contentEditable）
    └── BlockRenderer(root)
        ├── ContainerBlock（blockquote / list / list-item / table）
        │   └── 递归 BlockRenderer 子块
        └── LeafBlock（paragraph / heading / code-block / thematic-break）
            └── ContentBlock（唯一 contentEditable 区域）
```

### 5.2 contentEditable 边界

- **仅叶子块的内容区**为 `contenteditable="true"`（`ContentBlock`，`span.mu-content` 等价物）。
- 容器块、语法装饰（列表标记、引用竖线、代码围栏）、表格外壳一律 `contenteditable="false"`。
- 列表项文本 = 列表项内 paragraph 的 ContentBlock；列表标记由列表项渲染（`::marker` 或装饰 span）。
- 代码块 v2 改为 contentEditable 内容区（含语法高亮渲染层），替代 v1 textarea 旁路；
  编辑仍通过独立路径（不参与前缀检测），但可参与统一的块合并/空退逻辑。

### 5.3 DOM ↔ 块绑定

- 每个块组件根元素带 `data-block-id`。
- `ContentBlock` 的 DOM 节点通过 `editorInstance.domRegistry`（`Map<id, HTMLElement>`）注册，
  供光标读写与滚动定位使用；卸载时注销。
- 不把块实例挂到 DOM 属性上（React 惯例），所有跨块查找走注册表 + 块树。

### 5.4 更新策略

- 控制器修改块树后返回受影响块 ID 集合，`EditorView` 只对这些块调用 `setBlockTree` 相关更新。
- `ContentBlock` 使用受控渲染：React 渲染 `inlineHtml`，但**输入中的文本变化不触发 React 重渲染**
  （DOM 已由浏览器修改），由 `input` 事件控制器读取 DOM 文本 → 更新块树 → 若行内渲染结果变化
  才重渲染该块并恢复光标（muya 的 `checkNeedRender` 策略）。

---

## 6. 事件控制器

所有控制器为纯逻辑模块，输入 `(editorInstance, event, ctx)`，通过 `editorInstance.dispatch` 修改
块树。事件注册集中在 `editorInstance`：内容块统一监听 input/keydown/keyup/click/blur/focus/
compositionstart/compositionend，按事件类型路由到对应控制器。

### 6.1 inputCtrl（输入）

处理 `input` 与 `compositionend`：

1. `isComposed` 期间跳过（compositionstart 置位，compositionend 手动调用一次）。
2. 读取内容块 DOM 文本（排除渲染节点）与光标。
3. **autoPair**（自动配对，配置可开关）：
   - `(` `[` `{` `` ` `` `'` `"` 输入时自动补右侧，光标留在中间；
   - 成对删除：`deleteContentBackward` 删除 `(` 时若下一字符是 `)` 则一并删除。
4. 更新块树 `text`；若行内渲染结果变化（`checkNeedRender`），重渲染该块。
5. 调用 `detectBlockConversion(text)`，若检测到块级前缀且前缀以换行/块首开始，执行
   `convertIfNeeded`（见 6.5 块转换）。
6. 同步 `editorStore.content`（经防抖序列化，见 9.1）。

### 6.2 enterCtrl（回车）

内容块 `Enter`（非 shift）：

1. 读取光标偏移，`splitLeaf` 拆分为前后两个叶子（`paragraph` 文本）。
2. 特殊分支：
   - 列表项内 paragraph 为空：在列表项后创建新列表项（`- ` / 按序编号）或退出列表
     （见 6.5 空列表项回退，对接 SPEC-EDIT-EXIT）。
   - 代码块内：换行（插入 `\n` 到 text，不拆块）。
   - 标题内：拆分为段落（后段为 paragraph，非标题）。
3. 光标移到新叶子起点。

`Shift+Enter`：软换行，向 text 插入 `\n`（渲染为 `<br>`）。

### 6.3 backspaceCtrl（退格）

内容块 `Backspace` 优先级（与 SPEC-EDIT-EXIT 对齐并扩展）：

1. 有选区（非折叠）：删除选区文本（浏览器默认，不干预）。
2. 光标在文本起点：
   a. 叶子在列表项内且为首个内容：删除列表标记 → 列表项转 paragraph（或列表项移除后
      列表缩级），对应"撤销圆点/数字/复选框"；
   b. 叶子在引用块内且为唯一内容：引用块降级为 paragraph；
   c. 空 paragraph 块：与前一叶子合并（跨块时 `mergeLeafIntoPrev`；跨容器时降级容器）；
   d. 标题：降级为 paragraph（内容保留）；
   e. 代码块空内容：移除代码块（对应 SPEC-EDIT-EXIT 五）。
3. 光标在文本中间：浏览器默认删除。
4. 特殊 token（行内数学 `$$` 等，v2 可选）：成对删除。

### 6.4 clickCtrl（点击）

- 点击叶子块：浏览器默认放置光标。
- 点击列表标记/引用竖线/代码围栏等装饰区：光标定位到对应内容块起点（不选中装饰）。
- 点击任务复选框：切换 `taskChecked`（v1 缺失的"可打勾"交互）。
- 点击链接：`Ctrl/Cmd+Click` 经 IPC 打开外部；普通点击定位光标。
- 点击代码块语言徽标：不进入编辑（保持 v1 行为），语言切换走工具栏下拉。

### 6.5 块转换（convertIfNeeded）

统一由 `detectBlockConversion(text)` 驱动，取代 v1 的 pending 灰化 + 双路径提交：

| 输入前缀 | 转换 | 说明 |
| ------- | ---- | ---- |
| `# ` ~ `###### ` | heading(level) | 前缀随回车/输入即时提交；删除前缀字符（含空格）→ 回 paragraph |
| `- ` / `* ` / `+ ` | bullet-list > list-item > paragraph | 后续行 Enter 续行 |
| `1. ` / `1) ` | ordered-list（start=1, delimiter） | 续行自动递增 |
| `- [ ] ` / `- [x] ` | task-list > task-list-item > paragraph | checked 由标记决定 |
| `> ` | blockquote > paragraph | 连续 `>` 续行 |
| ` ``` lang` | code-block(lang) | 完整围栏自动闭合；空内容 Backspace 退出 |
| `---` / `***` / `___` | thematic-break | 独立成块 |

**v2 移除 v1 的 pendingTypeChange 机制**：前缀输入即时转换块类型（marktext 行为），
删除语法前缀时即时降级。块内不渲染灰色前缀；语法标记由块渲染提供（列表标记/引用竖线）。

**空块回退规则**（与 SPEC-EDIT-EXIT 保持一致）：

- 空列表项 Backspace → 列表项转 paragraph（若为列表末项，列表容器一并移除）。
- 空列表项 Enter → 退出列表（转 paragraph）并保留新空段落。
- 空引用块 Backspace / Enter → 转 paragraph。
- 空标题 Backspace → 转 paragraph。
- 空代码块 Backspace → 移除代码块（唯一块时转空 paragraph）。

### 6.6 formatCtrl（格式化）

取代 `document.execCommand`：

- 对折叠光标：插入成对标记（`**` `*` `~~` `` ` `` `==` 等），光标置于中间。
- 对选区：解析选区文本与行内 token，生成带标记的新文本，替换选区（在 `text` 层操作，
  而非 DOM range 操作）。
- 链接：打开链接对话框（v1 Modal 复用），生成 `[text](url)`。
- 列表缩进/凸出（Tab / Shift+Tab）：移动 list-item 在列表容器中的嵌套层级（listCtrl）。

### 6.7 listCtrl（列表操作）

- Tab：列表项缩进（成为上一列表项的子列表项）；Shift+Tab：凸出。
- 列表项内 Enter 续行；空项 Enter/Backspace 退出列表。
- 有序列表续行编号递增；删除中间项后编号按 `start + index` 重算。

---

## 7. 光标与选区

### 7.1 模型

- 光标 = `{ blockId, offset }`（文本偏移），选区 = `{ anchor, focus }`。
- 偏移与 DOM `Text` 节点 offset 一致（UTF-16 code unit）；行内渲染节点（strong/em 等）在
  读偏移时按"文本节点展开"映射，写偏移时按 TreeWalker 定位。
- 零宽空格仅用于空内容块占位（`\u200B`），偏移计算排除之。

### 7.2 DOM 同步（selection.ts）

```ts
export function getCursorOffsets(contentEl: HTMLElement): { start: number; end: number };
export function setCursorAtOffset(contentEl: HTMLElement, offset: number): void;
export function setSelectionRange(
  contentEl: HTMLElement,
  start: number,
  end: number
): void;
export function getBlockFromSelection(): string | null;   // 返回 data-block-id
```

`cursorCtrl` 保证：任何块树修改触发的重渲染完成后，调用 `setCursorAtOffset` 恢复光标。

### 7.3 跨块选择

- 内容块之间跨块选择：浏览器原生支持（各内容块相邻）；`selectionchange` 监听器聚合当前选区
  对应的块集合，供浮动工具栏显示。
- v2 首版不在模型层支持跨块选区编辑（仅工具栏作用于当前选区所在块），保持与 v1 一致的
  交互范围，M4 再评估跨块格式化。

---

## 8. 撤销/重做

### 8.1 策略

v2 采用**块树快照栈**（简单、可靠），替代 v1 的 content 快照：

- 每次"原子编辑"（Enter / Backspace 块操作 / 块转换 / 格式化 / 粘贴）前压入当前块树快照。
- 栈上限 50 条（与 v1 一致），跨会话持久化仍由 `editorStore.undoStack` 承担（快照序列化为
  markdown 字符串，与 v1 格式兼容）。
- `undo/redo` 恢复块树快照并整体重渲染 + 光标定位。

### 8.2 与 editorStore 集成

`editorStore.undo/redo` 继续作为对外 API；v2 内部把"块树快照"序列化为 markdown 存入栈，
恢复时反序列化回块树（保证与旧 undo 栈数据兼容）。

---

## 9. 与现有模块的集成契约

### 9.1 editorStore（不变）

- `content`：v2 每次编辑后经 `stateToMarkdown` 序列化并 `updateContent`（沿用 1200ms
  自动保存；切换文件/关闭前 flush）。
- `saveFile` / `openFile` / `closeFile` / `undo` / `redo` / `pushUndo` 对外不变。
- 打开文件：`content → markdownToState → 块树`；切换源码模式：`stateToMarkdown(块树) → Monaco`。

### 9.2 uiStore（不变）

- `isSourceCodeMode`：切换前 flush DOM 编辑（读取所有内容块 DOM → 块树 → 序列化）。
- `isFindReplaceOpen`、`outlineWidth`、`historyPanelWidth`：与编辑内核无耦合，保持不变。
- `markdownBlockState.mdSourceBlockId`（v1 的段落 MD 源码视图）：v2 保留此能力，由
  ContentBlock 切换为只读 `<pre>` 展示 `text`。

### 9.3 周边组件适配

| 组件 | v2 适配 |
| ---- | ------- |
| OutlinePanel | 标题树仍由 `extractOutline(content)` 生成；导航改为"查找 heading 块 → 滚动到其 ContentBlock"；高亮由滚动位置检测（复用 v1 的 +10px 规则） |
| Minimap | 遍历块树计算块类型色带（替代 v1 DOM 扫描），点击导航同大纲 |
| FindReplaceBar | 仍在 `content` 文本层工作（searchEngine 复用）；替换后 `updateContent → 重建块树`，v2 保持"整树重建"简单路径（性能见 12 节风险） |
| FloatingToolbar | 选区来自 DOM；格式化改走 formatCtrl（文本层操作），工具栏 UI 不变 |
| StatusBar | 光标位置由 v2 cursor 事件提供（块 → 行号映射） |

### 9.4 模式切换

```
Normal → Source：flush DOM → 块树 → stateToMarkdown → editorStore.content → Monaco
Source → Normal：content → markdownToState → 块树 → 渲染
```

切换必须幂等且无损（满足 4.2 不变量）。

---

## 10. 实施分期

| 阶段 | 内容 | 交付物 | 风险 |
| ---- | ---- | ------ | ---- |
| M1 | 内核数据模型 + 双向转换 + 行内渲染（纯函数） | `kernel/types.ts`、`blockTree.ts`、`markdownToState.ts`、`stateToMarkdown.ts`、`inlineRenderer.ts` + 单元测试 | 低：纯函数，不触碰 UI |
| M2 | 渲染骨架：新块组件 + ContentBlock + EditorScrollContainer 重构 + EditorView 接入 | 渲染层重构，双模式可切换、可编辑基础文本 | 中：首次 UI 切换，保留旧实现可回退 |
| M3 | 核心交互控制器：input / enter / backspace / click / format / list + 块转换与退出规则 | 控制器 + 集成测试（jsdom 模拟输入） | 高：编辑行为回归面大 |
| M4 | 系统集成：撤销/重做、大纲/Minimap/查找适配、代码块编辑、自动保存 flush、v1 服务退役 | 全量测试 + 手工验收清单 | 中：跨模块联调 |

**实施原则**：

- 每阶段独立可验收，M1 完成前不写任何渲染代码。
- M2 起采用"新旧并行"：新渲染路径经开关（如 `window.__EDITOR_V2__`）启用，旧路径保留，
  M4 通过验收后删除旧路径与 v1 services。
- 每个 M 阶段结束运行 `tsc --noEmit` + `vitest run`，新增行为必须带测试。

---

## 11. 测试策略

### 11.1 内核测试（M1，纯函数）

- 转换往返：`stateToMarkdown(markdownToState(M)) === M` 属性测试（覆盖标题/列表嵌套/任务/
  引用/代码块/表格/分割线/转义）。
- 块树操作：insert/remove/split/merge 的链表与父子不变量。
- 行内渲染：token 边界（代码内星号不解析、链接括号、HTML 转义）。

### 11.2 控制器测试（M3，jsdom）

- 模拟 contentEditable input 事件与 Selection，验证块转换/退出规则（覆盖 SPEC-EDIT-EXIT
  全部六条）。
- Enter/Backspace 在列表、引用、代码块、标题中的行为矩阵。

### 11.3 回归测试

- 现有 `tests/`（189 例）保持通过；涉及 v1 服务的用例在 M4 迁移后更新。

---

## 12. 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| 编辑交互回归面大（光标、IME、跨块选择） | 新旧并行开关；M3 按交互矩阵逐项验收；IME 用 `isComposed` 守卫并补中文输入测试 |
| 大文档性能（10000+ 行） | 局部渲染（只渲染受影响块）；行内渲染缓存；find/replace 重建整树仅限低频操作 |
| 序列化无损性破坏用户数据 | M1 属性测试 + 语料库快照测试；保存仍走 markdown 文本，任何时刻可回退 v1 |
| 与 v1 功能差距（MD Source、空块占位等） | M2-M4 逐项对照 REQUIREMENTS EDIT-01~12 验收清单 |
| 工作量大 | 分期实施、每期独立可交付；文档先行确保设计一致 |

---

> 本规范为编辑主区 v2 的设计基线。评审确认后按第 10 节分期实施，实施中发现的偏差
> 回到本规范更新后执行（文档优先，避免编码错误）。

---

## 13. 实现记录

### 13.1 M1 完成（2026-08-05）

内核纯函数层已按本规范实现并通过测试：

| 文件 | 内容 |
| ---- | ---- |
| `src/render/editor/kernel/types.ts` | BlockTypeV2 / BlockNodeV2 / BlockTreeV2 / CursorV2 / SelectionV2 / BlockConversionV2 与分型判定 |
| `src/render/editor/kernel/blockTree.ts` | 不可变块树操作集（链表 + 父子）、`splitLeaf / mergeLeafIntoPrev / detectBlockConversion` |
| `src/render/editor/kernel/markdownToState.ts` | 块级解析器（围栏/表格/ATX/Setext/引用/列表嵌套/分割线/段落兜底） |
| `src/render/editor/kernel/stateToMarkdown.ts` | 逐行序列化器（标记归一化、围栏自动加长、Setext 保留、blockquote 前缀） |
| `src/render/editor/kernel/inlineRenderer.ts` | 行内渲染（强调/代码/链接/图片/自动链接/转义），HTML 转义 + 链接协议白名单 |

**M1 验证**：`tests/editor/kernel/` 3 个文件 71 例（树操作 15 / 往返 41 / 行内 15）；
全量 `vitest run` 260 例通过；`tsc --noEmit` 无错误。

**实施中记录的偏差（已回写本规范）**：

- 往返不变量细化为"规范化往返"（见 4.2 归一化清单）。
- `table` 首版为叶子块而非容器块（3.2 已更新）。
- 任务列表在 M1 表达为 `bullet-list > list-item(taskChecked)`，`task-list` 容器类型保留备用。

### 13.2 M2 渲染骨架完成（2026-08-06）

渲染层已按第 5 节实施，与 v1 并行、可回退：

| 文件 | 内容 |
| ---- | ---- |
| `src/render/editor/selection.ts` | 光标/选区 DOM 读写（偏移 ↔ 文本节点，排除零宽空格） |
| `src/render/editor/editorInstance.ts` | EditorInstance 宿主：内容装载、行内缓存、基础输入/回车拆分/空块退格 |
| `src/render/components/Editor/v2/EditorV2.tsx` | v2 入口：树状态、事件路由、DOM 注册表、光标恢复、内容同步 |
| `src/render/components/Editor/v2/EditorScrollContainer.tsx` | 滚动视口（容器非 contentEditable） |
| `src/render/components/Editor/v2/BlockRenderer.tsx` | 容器/叶子递归分发 |
| `src/render/components/Editor/v2/blocks/` | ContentBlock（唯一 contentEditable）、LeafBlock、CodeBlock、ListItemBlock、BlockquoteBlock |

**接入方式**：`EditorView` Normal Mode 按 `window.__EDITOR_V2__ !== false` 渲染 v2，
设为 `false` 刷新即回退 v1（M4 验收后删除 v1 路径）。v1 文件未改动。

**M2 能力边界**：基础文本输入（行内实时渲染 + 光标恢复）、Enter 拆块（heading 右半转段落）、
空块 Backspace 合并/删除、列表/引用/代码块渲染。结构块退出规则、格式化、快捷键等交互在 M3 扩展。

**M2 验证**：新增测试 12 例（EditorInstance 8 / EditorV2 渲染 4）；
全量 `vitest run` 272 例通过；`tsc --noEmit` 无错误；`vite build` 成功。

### 13.3 M3 交互控制器完成（2026-08-06）

按第 6 节实施全部控制器，交互行为对齐 marktext：

| 控制器 | 内容 |
| ------ | ---- |
| `controllers/inputCtrl.ts` | autoPair（`(` `[` `{` `` ` `` `'` `"` 自动补全、光标居中）、文本更新、前缀即时转换触发 |
| `controllers/convertCtrl.ts` | 升格（paragraph → heading/list/blockquote/code-block/thematic-break）与降格（六条退出规则） |
| `controllers/enterCtrl.ts` | 代码块换行、列表续行新列表项、空列表项回车退出、标题右半转段落、引用内拆分 |
| `controllers/backspaceCtrl.ts` | 光标在内容起点即触发：标题转正文、列表项退出、引用降级、空代码块移除、段落合并前块 |
| `controllers/clickCtrl.ts` | 任务复选框切换（v1 缺失的"可打勾"交互） |
| `controllers/listCtrl.ts` | Tab 缩进为前项子列表、Shift+Tab 凸出（嵌套列表空后自动移除） |
| `controllers/formatCtrl.ts` | 文本层格式化（bold/italic/strike/highlight/code/link），取代 execCommand |

**接入**：`ContentBlock` 键盘事件（Enter/Backspace/Tab/Shift+Tab/Ctrl+B/I/E/Shift+S/Shift+H）
路由到对应控制器；`EditorV2` 统一执行"操作 → 更新树 → 恢复光标 → 同步内容"。

**实施中修复的内核问题**：`markdownToState` 的 Builder 此前未维护 `prevId/nextId`
兄弟链，导致跨块查找（Tab 缩进、合并前块）失效——已修复并补链；
`insertBlockBefore` 增加节点 detach 处理。

**M3 验证**：新增控制器测试 24 例（含六条退出规则矩阵）；
全量 `vitest run` 291 例通过；`tsc --noEmit` 与 ESLint 无告警；`vite build` 成功。
