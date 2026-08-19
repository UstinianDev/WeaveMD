# 编辑主区 v2 — 选区/撤销/集成/测试/风险

> 拆分自 [editor-v2-architecture.md](./editor-v2-architecture.md) §7-§12
> 关联文档：[editor-v2-progress.md](./editor-v2-progress.md)（实施记录）

---

## 7. 光标与选区

### 7.1 模型

- 光标 = `{ blockId, offset }`（文本偏移），选区 = `{ anchor, focus }`。
- 偏移与 DOM `Text` 节点 offset 一致（UTF-16 code unit）；行内渲染节点（strong/em 等）在
  读偏移时按"文本节点展开"映射，写偏移时按 TreeWalker 定位。
- 零宽空格仅用于空内容块占位（`​`），偏移计算排除之。

### 7.2 DOM 同步（selection.ts）

```ts
export function getCursorOffsets(contentEl: HTMLElement): { start: number; end: number };
export function setCursorAtOffset(contentEl: HTMLElement, offset: number): void;
export function setSelectionRange(contentEl: HTMLElement, start: number, end: number): void;
export function getBlockFromSelection(): string | null; // 返回 data-block-id
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

| 组件            | v2 适配                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OutlinePanel    | 标题树仍由 `extractOutline(content)` 生成；导航改为"查找 heading 块 → 滚动到其 ContentBlock"；高亮由滚动位置检测（复用 v1 的 +10px 规则） |
| Minimap         | 遍历块树计算块类型色带（替代 v1 DOM 扫描），点击导航同大纲                                                                                |
| FindReplaceBar  | 仍在 `content` 文本层工作（searchEngine 复用）；替换后 `updateContent → 重建块树`，v2 保持"整树重建"简单路径（性能见 12 节风险）          |
| FloatingToolbar | 选区来自 DOM；格式化改走 formatCtrl（文本层操作），工具栏 UI 不变                                                                         |
| StatusBar       | 光标位置由 v2 cursor 事件提供（块 → 行号映射）                                                                                            |

### 9.4 模式切换

```
Normal → Source：flush DOM → 块树 → stateToMarkdown → editorStore.content → Monaco
Source → Normal：content → markdownToState → 块树 → 渲染
```

切换必须幂等且无损（满足 4.2 不变量）。

---

## 10. 实施分期

| 阶段 | 内容                                                                                 | 交付物                                                                                                        | 风险                               |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| M1   | 内核数据模型 + 双向转换 + 行内渲染（纯函数）                                         | `kernel/types.ts`、`blockTree.ts`、`markdownToState.ts`、`stateToMarkdown.ts`、`inlineRenderer.ts` + 单元测试 | 低：纯函数，不触碰 UI              |
| M2   | 渲染骨架：新块组件 + ContentBlock + EditorScrollContainer 重构 + EditorView 接入     | 渲染层重构，双模式可切换、可编辑基础文本                                                                      | 中：首次 UI 切换，保留旧实现可回退 |
| M3   | 核心交互控制器：input / enter / backspace / click / format / list + 块转换与退出规则 | 控制器 + 集成测试（jsdom 模拟输入）                                                                           | 高：编辑行为回归面大               |
| M4   | 系统集成：撤销/重做、大纲/Minimap/查找适配、代码块编辑、自动保存 flush、v1 服务退役  | 全量测试 + 手工验收清单                                                                                       | 中：跨模块联调                     |

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

| 风险                                    | 缓解                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| 编辑交互回归面大（光标、IME、跨块选择） | 新旧并行开关；M3 按交互矩阵逐项验收；IME 用 `isComposed` 守卫并补中文输入测试 |
| 大文档性能（10000+ 行）                 | 局部渲染（只渲染受影响块）；行内渲染缓存；find/replace 重建整树仅限低频操作   |
| 序列化无损性破坏用户数据                | M1 属性测试 + 语料库快照测试；保存仍走 markdown 文本，任何时刻可回退 v1       |
| 与 v1 功能差距（MD Source、空块占位等） | M2-M4 逐项对照 REQUIREMENTS EDIT-01~12 验收清单                               |
| 工作量大                                | 分期实施、每期独立可交付；文档先行确保设计一致                                |
