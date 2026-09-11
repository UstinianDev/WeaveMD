# WeaveMD 优化需求文档

> 任务 slug: `optimize-outline-aiheading-composer`
> 分级: L 级（跨模块 · 涉新依赖 · 多功能）
> 创建: 2026-09-11

---

## 一、优化项清单

| # | 优化项 | 模块 | 优先级 |
|---|--------|------|--------|
| 1 | Outline 数据源统一为 v2 块树 | 编辑主区 | P0 |
| 2 | Agent 输出标题自动编号 | AI 渲染层 | P1 |
| 3 | Composer /@ 标签化交互 | AI 输入组件 | P2 |
| 4 | 文件清理 | 桌面文件 | P3 |

---

## 二、需求 1：Outline 数据源统一

### 2.1 现状

- `OutlinePanel.tsx` 使用 v1 `extractOutline(content)`（基于 remark-parse MDAST），产出 `OutlineItem[]`（树形，有 children）
- `EditorV2.tsx` 使用 v2 `extractHeadingOutlineCached(tree)`（基于块树），产出 `OutlineItemV2[]`（扁平，无 children）
- 两套行号计算逻辑不同，导致目录区点击标题后跳转位置与编辑主区不匹配

### 2.2 目标

统一 OutlinePanel 的数据源为 v2 块树，消除 v1/v2 行号偏差。

### 2.3 验收标准

- [ ] OutlinePanel 接收 v2 `OutlineItemV2[]` 作为数据源
- [ ] 点击目录区标题，编辑主区滚动到正确位置（偏差 ≤1 行）
- [ ] 编辑时 outline 实时更新
- [ ] 切换文件时 outline 重置
- [ ] Source Code Mode 下 outline 保持兼容（可用 v1 行号但统一为 `OutlineItemV2` 格式）

### 2.4 已对齐问题

1. **树形 vs 扁平**：v2 是扁平列表，OutlinePanel 当前渲染树形结构（有展开/折叠）。需要在 OutlinePanel 内部从扁平列表重建树形结构，或改为扁平渲染（带缩进）。
   - **决策**：保持树形渲染，OutlinePanel 内部用 `level` 字段重建树。

2. **数据流路径**：EditorV2 计算 v2 outline → 通过回调传递到 MainPage → MainPage 作为 state → 作为 props 传给 OutlinePanel。

3. **Source Mode 兼容**：EditorView 的 Source Mode 下，需从 Monaco 行号提取 outline，但统一返回 `OutlineItemV2[]` 格式。

---

## 三、需求 2：Agent 标题自动编号

### 3.1 现状

- `aiMarkdown.tsx` 的 `buildProps()` 仅设置 `className="ai-heading-{N}"`，无编号逻辑
- CSS 中 `.ai-markdown hN` 标签选择器控制样式，className 冗余

### 3.2 目标

在 AI 输出的 markdown 标题前自动添加编号，提升结构化阅读体验。

### 3.3 编号规则（固定映射）

| 标题级别 | 编号格式 | 示例 |
|----------|----------|------|
| h1 | 中文数字 + 顿号 | 一、二、三、…… |
| h2 | 阿拉伯数字 + 点 | 1. 2. 3. …… |
| h3 | 层级数字 | 1.1 1.2 2.1 …… |
| h4 | 带圈数字 | ① ② ③ …… |
| h5/h6 | 不编号 | — |

### 3.4 验收标准

- [ ] h1-h4 标题自动添加对应格式编号
- [ ] 编号 span 使用 `className="ai-heading-number"` 独立样式
- [ ] 已有编号检测：标题文本以中文数字+顿号、阿拉伯数字+点、带圈数字开头时，跳过自动编号
- [ ] 同级标题递增，跨父级重置（如 h2 从 1→2 时，h3 计数器重置）
- [ ] 中文数字支持到至少 20（一到二十），超出用阿拉伯数字
- [ ] 不影响现有 heading 样式

### 3.5 已对齐问题

1. **实现位置**：在 `hastToReact()` 处理 h1-h6 节点时，调用 `addHeadingNumbering()` 函数插入编号 span。
2. **计数器状态**：需要一个 `HeadingCounter` 对象在遍历 HAST 树时维护，通过闭包或参数传递。
3. **列表结构化**：当前已正确渲染，无需额外处理。

---

## 四、需求 3：Composer /@ 标签化交互

### 4.1 现状

- 使用原生 `<textarea>` + 纯文本 token（`@{filename}`、`/skillname`）
- 标签以纯文本形式存在，无法整体选中/删除
- `MentionTagOverlay`、`InputTag`、`MentionList` 组件存在但未被主 composer 使用

### 4.2 目标

将 textarea 重写为 contentEditable，实现标签的可视化、整体操作和更好的交互体验。

### 4.3 技术选型

- **ProseMirror + TipTap**：成熟的 React 富文本编辑方案
- 核心依赖：`@tiptap/react`、`@tiptap/starter-kit`、`@tiptap/pm`、`@tiptap/suggestion`

### 4.4 验收标准

- [ ] `/skill` 和 `@file` 标签以 chip 形式可视化渲染
- [ ] 点击标签选中整个节点
- [ ] Backspace 删除整个标签（非单字符）
- [ ] `/` 和 `@` 触发自动补全菜单
- [ ] 自动补全菜单支持键盘导航和选择
- [ ] Enter 发送，Shift+Enter 换行
- [ ] 中文 IME 输入正常（拼音、仓颉）
- [ ] 发送时从 ProseMirror state 解析标签，保持 7 条路由优先级不变
- [ ] 标签视觉风格：Codex 风格（圆角 chip + 背景 + 图标 + 删除按钮）

### 4.5 已对齐问题

1. **标签 Node 定义**：`skillTag` 和 `mentionTag` 作为自定义 Node，不可编辑，点击选中整体。
2. **IME 兼容**：ProseMirror 原生支持 composition events，但标签名含空格时需特殊处理。
3. **自动补全**：使用 `@tiptap/suggestion` 插件，适配现有 CompletionMenu 和 MentionList。
4. **发送路由**：从 ProseMirror state 遍历节点提取标签，保持 sendRoutes 逻辑不变。

---

## 五、需求 4：文件清理

- 删除 `C:\Users\lenovo\Desktop\优化方向\Markdown_全语法完整参考.md`

---

## 六、端到端连通性要求

用户明确要求：**最后必须保证功能模块端与端之间的连通性。**

验证清单：
- [ ] Outline：EditorV2 → MainPage state → OutlinePanel → 点击 → EditorV2 滚动
- [ ] 标题编号：Agent 输出 markdown → parseAIMarkdown → hastToReact → 带编号的 heading DOM
- [ ] Composer 标签：输入 / 或 @ → 补全菜单 → 选择 → chip 渲染 → 发送 → sendRoutes 解析
