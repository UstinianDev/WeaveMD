# 编辑器内核架构

> 最后更新：2026-09-09
> 详细规格：[editor-v2-architecture.md](../specs/editor-v2-architecture.md)

## 核心设计原则

- **仅叶子块内容 span 可编辑**：`ContentBlock` 是唯一的 `contentEditable` 表面
- **不可变块树**：修改时创建新树（cloneTree 精准化，仅修改路径上的节点）
- **无损双向转换**：MD → 块树 → MD 往返不变式（规范化往返）
- **React-free 内核**：纯 TypeScript，无 React 依赖

## 块树数据结构

```
BlockTreeV2
├── BlockNodeV2 (container: heading/quote/list/table)
│   ├── BlockNodeV2 (leaf: paragraph/code-block/...)
│   └── BlockNodeV2 (leaf)
└── BlockNodeV2 (leaf: paragraph/hr/...)
```

| 类型 | 说明 |
|------|------|
| `BlockTypeV2` | 块类型枚举（heading/paragraph/code-block/list/quote/table/hr/task-list） |
| `BlockNodeV2` | 块节点（type + children + content + metadata） |
| `BlockTreeV2` | 块树（root 节点 + 版本号） |
| `CursorV2` | 光标位置（blockId + offset） |
| `SelectionV2` | 选区（start + end + isCollapsed） |

## 内核模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 块树操作 | `kernel/blockTree.ts` | splitLeaf / mergeLeafIntoPrev / detectBlockConversion |
| MD→块树 | `kernel/markdownToState.ts` | 块级解析器（围栏/表格/ATX/Setext/引用/列表/分割线/段落） |
| 块树→MD | `kernel/stateToMarkdown.ts` | 逐行序列化器（标记归一化、围栏自动加长） |
| 行内渲染 | `kernel/inlineRenderer.ts` | 强调/代码/链接/图片/自动链接/转义 |
| 选区管理 | `kernel/selection.ts` | 跨块选区支持 |

## 交互控制器

| 控制器 | 文件 | 职责 |
|--------|------|------|
| 输入 | `controllers/inputController.ts` | 输入处理 |
| Enter | `controllers/enterController.ts` | Enter 键行为（拆块/列表延续） |
| 退格 | `controllers/backspaceController.ts` | 退格行为（合并/降级） |
| 转换 | `controllers/convertController.ts` | 前缀即时转换（`# ` / `- ` / `1. ` 等） |
| 点击 | `controllers/clickController.ts` | 点击事件（checkbox/链接） |
| 列表 | `controllers/listController.ts` | 列表行为（缩进/退出） |
| 格式化 | `controllers/formatController.ts` | 格式化操作 |

## 前缀即时转换

输入后立即转换：

| 前缀 | 转换为 |
|------|--------|
| `# ` | H1 |
| `## ` | H2 |
| `- ` / `* ` | 无序列表 |
| `1. ` | 有序列表 |
| `- [ ] ` | 任务列表 |
| `> ` | 引用 |
| ` ```lang ` | 代码块 |

## 退格降级（六条退出规则）

在内容起点按退格触发块类型降级：

1. H1 → H2 → H3 → ... → 段落
2. 无序列表 → 段落
3. 有序列表 → 段落
4. 任务列表 → 段落
5. 引用 → 段落
6. 代码块 → 段落

详细规则：[markdown-block-exit-rules.md](../specs/markdown-block-exit-rules.md)

## 性能优化

- `cloneTree` 精准化（仅修改路径上的节点）
- `tokenizeInline` LRU 缓存（256 条）
- outline 脏标记（避免重复计算）
- React.memo 补全
- Prism/KaTeX code splitting

## 语法外观

对齐 marktext 风格：

- 标题 `#`×n 光标提示（深灰）
- 深灰列表 marker
- 引用绿色竖线
- 圆形任务复选框
- 代码块语法高亮（Prism）
- 数学公式渲染（KaTeX）
