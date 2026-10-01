# 编辑主区 v2 — 渲染模型与事件控制器（§5-§6）

> 拆分自 [editor-v2-architecture.md](../editor-v2-architecture.md)，原 §5 渲染模型、§6 事件控制器；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[editor-v2-architecture.md](../editor-v2-architecture.md)

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

| 输入前缀              | 转换                                   | 说明                                                          |
| --------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `# ` ~ `###### `      | heading(level)                         | 前缀随回车/输入即时提交；删除前缀字符（含空格）→ 回 paragraph |
| `- ` / `* ` / `+ `    | bullet-list > list-item > paragraph    | 后续行 Enter 续行                                             |
| `1. ` / `1) `         | ordered-list（start=1, delimiter）     | 续行自动递增                                                  |
| `- [ ] ` / `- [x] `   | task-list > task-list-item > paragraph | checked 由标记决定                                            |
| `> `                  | blockquote > paragraph                 | 连续 `>` 续行                                                 |
| ` ``` lang`           | code-block(lang)                       | 完整围栏自动闭合；空内容 Backspace 退出                       |
| `---` / `***` / `___` | thematic-break                         | 独立成块                                                      |

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
