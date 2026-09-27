# 编辑主区深度重做规范（Editor v2 Architecture）

> 规范编号：SPEC-EDITOR-V2 | 版本：v0.3（索引页 + 分册）| 更新：2026-09-27
> 关联需求：REQUIREMENTS.md 3.2 编辑器核心（EDIT-01 ~ EDIT-12）
> 参考实现：marktext/marktext（Muya 编辑器内核，MIT License）
> 关联文档：docs/modules/04-编辑主区-Editor.md、docs/specs/markdown-block-exit-rules.md

**分册（渐进式披露，按需加载）：**

| 文档 | 内容 |
|------|------|
| [editor-v2-architecture/01-data-model-conversion.md](./editor-v2-architecture/01-data-model-conversion.md) | §3 数据模型 BlockTree v2 + §4 Markdown 双向转换（不变量与行内渲染） |
| [editor-v2-architecture/02-render-controllers.md](./editor-v2-architecture/02-render-controllers.md) | §5 渲染模型 + §6 事件控制器（input/enter/backspace/click/convert/format/list） |
| [editor-v2-selection-undo.md](./editor-v2-selection-undo.md) | §7 选区 / §8 撤销重做 / §9 集成契约 / §10 实施分期 / §11 测试策略 / §12 风险 |
| [editor-v2-progress.md](./editor-v2-progress.md) | §13 实施记录（13.1~13.15，含分册索引） |

> 本文档为 v2 规范**索引页**：保留 §1 背景与目标、§2 总体架构，其余章节按主题拆为分册。

---

## 1. 背景与目标

### 1.1 v1 现状问题（2026-08-05 v2 重做前的代码审查结论）

> ⚠️ **本表描述的是 v1 编辑器**，是发起 v2 重做的动机，**不是当前状态**。
> v2 已于 `editor-v2-progress.md` §13 实施完成并成为唯一路径（v1 组件见 §13「v1 回退退役」删除清单），
> 表中 `CodeFenceBlock.tsx` / `FloatingToolbarWYSIWYG.tsx` / `EditorScrollContainer.tsx` / `BlockRenderer.tsx`
> 等文件**均已删除**。证据列仅供追溯，读者无需去源码里找它们。

对 `src/render/components/Editor/` 与 `src/render/services/` 的全面审查，确认 v1 编辑主区
存在以下结构性问题：

| #   | 问题                                                                                                                               | 证据                                                                                | 影响                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | 容器级 contentEditable：整个 `editor-content-area` 一个 contenteditable，所有块都是其子元素                                        | `EditorScrollContainer.tsx` 中 `contentEditable` 在容器层，块组件只读渲染           | 光标/选区管理脆弱，必须用 TreeWalker、零宽空格、`focusBlockCursor` setTimeout 等大量 workaround；跨块 DOM 操作（格式化、删除）极易越界 |
| E2  | EditorView 巨型组件：输入/回车/退格/转换/同步/导航/查找全部耦合                                                                    | `EditorView.tsx` 1686 行，30+ 个 useCallback                                        | 逻辑无法独立测试，状态流难以追踪，任何交互改动都牵一发动全身                                                                           |
| E3  | 渲染与模型脱节：块内容依赖 `renderedHtml` 缓存 + `dangerouslySetInnerHTML` 恢复，真实文本只存在于 DOM                              | `BlockNode.renderedHtml`、渲染 effect 依赖 `[version]` 并扫描全部块                 | 出现 O(N²) 重扫、stale ID、缓存失效等复杂状态；序列化依赖 DOM 反推（`domToMarkdown`），无法保证无损                                    |
| E4  | 块模型扁平：所有块都是顶层兄弟，无容器嵌套                                                                                         | `BlockTree.rootBlockIds` 一维数组，`parentId/childrenIds` 未实际使用                | 不支持列表嵌套（子列表/列表内代码块/引用内列表）、表格多行结构等 CommonMark 基本结构                                                   |
| E5  | 代码块是旁路：textarea 独立编辑，与统一编辑模型隔离                                                                                | `CodeFenceBlock.tsx` 中 textarea `onKeyDown` stopPropagation                        | 代码块无法参与统一的块操作（空退、合并、tab），行为与其他块不一致                                                                      |
| E6  | 格式化依赖 `document.execCommand` + Range 直接操作 DOM                                                                             | `FloatingToolbarWYSIWYG.tsx`                                                        | execCommand 已废弃，行为跨平台不一致，且绕过了块模型，破坏 WYSIWYG 一致性                                                              |
| E7  | 块转换规则分散：pending 灰化、回车提交、退格回退逻辑分布在 input/enter/backspace 三个 handler 中，且有双路径（pending + fallback） | `handleBlockInput/handleBlockEnter/handleBlockDelete/handleBlockConvertToParagraph` | 六种块的退出边界条件（SPEC-EDIT-EXIT）与进入规则无法统一验证                                                                           |

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

### 2.3 目录结构（设计目标与实际落地）

> 设计阶段的目标树与最终落地有出入：渲染层统一收进 `v2/`，块组件按叶子/容器职责归并
> （`LeafBlock` 承担段落/标题等叶子块，无 `HeadingBlock`/`ParagraphBlock`/`ContainerBlock`），
> 下表为**当前实际结构**。v1 已退役，其组件与 `blockTreeBuilder.ts`/`blockTreeSerializer.ts`/
> `lineMarkdown.ts` 均已删除。

```
src/render/editor/                    # 内核目录（与 React 解耦）
├── kernel/
│   ├── types.ts                      # BlockNode v2、Cursor、BlockTree 类型
│   ├── blockTree.ts                  # 不可变块树纯函数
│   ├── blockDetection.ts             # 行前缀识别（消费 markdownSyntax）
│   ├── markdownSyntax.ts             # 行前缀解析（正则全含 U+00A0 分隔）
│   ├── markdownToState.ts            # markdown → BlockTree
│   ├── stateToMarkdown.ts            # BlockTree → markdown
│   ├── inlineRenderer.ts / inlineLexer.ts
│   ├── outline.ts                    # 大纲抽取
│   ├── tableCodec.ts                 # 表格编解码
│   └── selection.ts                  # cursor 模型 + DOM 读写
├── controllers/
│   ├── inputCtrl.ts / enterCtrl.ts / backspaceCtrl.ts
│   ├── convertCtrl.ts / clickCtrl.ts / listCtrl.ts
│   ├── formatCtrl.ts / imageFormatCtrl.ts / imageWidthCtrl.ts
│   ├── shared.ts / index.ts
└── editorInstance.ts                 # 组装内核 + 控制器 + 事件中心的宿主

src/render/components/Editor/v2/      # 渲染层
├── EditorV2.tsx                      # v2 入口（状态、事件路由、焦点恢复、撤销）
├── BlockRenderer.tsx                 # 块类型分发
├── EditorScrollContainer.tsx         # 纯容器：滚动 + 事件代理
├── blocks/                           # 叶子块与容器块组件
│   ├── ContentBlock.tsx              # 唯一 contentEditable 表面
│   ├── LeafBlock.tsx                 # 段落 / 标题等叶子块
│   ├── ListItemBlock.tsx / BlockquoteBlock.tsx / CodeBlock.tsx
│   ├── TableBlock.tsx + tableHelpers.ts + useTableEvents.ts
│   └── blocks 类型协同由 types.ts 约束
├── toolbar/FloatingToolbar.tsx       # 文本浮动工具栏
├── image/                            # ImageToolbar + ImageResizeBox
└── InsertUrlModal.tsx
```

---
