# 浮动工具栏体验优化与行内格式化增强规范

> 规范编号：SPEC-EDIT-FT2 | 版本：v1.0（已实施，2026-08-08）| 更新：2026-08-08
> 实施证据：[docs/testing/spec-edit-ft2.tdd.md](../testing/spec-edit-ft2.tdd.md)
> 关联需求：REQUIREMENTS.md EDIT-04（实时格式化渲染）、EDIT-13（语法渲染对齐 marktext）
> 关联规范：[SPEC-EDIT-FT](./floating-toolbar-refactor.md)、[SPEC-EDITOR-V2](./editor-v2-architecture.md)
> 参考实现：marktext/marktext（https://github.com/marktext/marktext，格式工具栏与行内格式化行为）
> 适用范围：Normal Mode 编辑主区；不改动块树数据模型、Markdown 双向转换、七类交互控制器、
> 撤销/重做、自动保存、查找替换、大纲导航等既有能力（回归约束见第 6 节）。

---

## 1. 背景与目标

用户实测反馈当前浮动工具栏存在三组问题，本文档给出改进规范。

| 域 | 当前情况 | 问题 | 目标 |
| --- | -------- | ---- | ---- |
| 工具栏视觉 | 选中内容弹出浮动工具栏，设计较差 | ① 字体较小；② 词语间间距较小，影响视觉体验 | ① 字体偏大；② 词语间间距适中；③ 下拉选项上下间距适中 |
| 行内格式化 | 已具备加粗、倾斜、删除线、行内代码、高亮 | ① 同语法可持续叠加嵌套（如加粗可连续套 `**`）；② 应用格式后语法符号未隐藏（如 `**` 灰显可见）；③ 点击高亮渲染为语法格式，非黄色背景 | ① 加粗/倾斜/删除线/行内代码/高亮为**非同语法多重嵌套**模式（Toggle：有→无、无→有）；② 应用后直接渲染为富文本且**无可见语法符号**；③ 高亮渲染后背景为**黄色** |
| 功能完备性 | 工具栏缺少下划线、数学公式、图片、橡皮擦 | 功能不完善，未对标 marktext | ① 功能选项补全，选项位置顺序适当调整；② 功能对标 marktext |

### 1.1 范围约束

- **本次只做**：工具栏视觉规格调整、行内格式化语义修正（toggle / 无嵌套 / 标记隐藏 /
  高亮黄色）、新增四类格式能力、相关样式与测试。
- **不改变**：块树结构与序列化不变量（`stateToMarkdown(markdownToState(M)) === M`）、
  六条退出规则、撤销/重做、自动保存、查找替换、大纲导航、跨块拖选、代码块独立编辑路径。
- **唯一新增依赖**：数学公式渲染需引入 `katex`（离线可用的本地 npm 包，见 4.5.2）。

---

## 2. 现状与根因分析

### 2.1 问题 1：字体小、间距小

**根因**：`FloatingToolbar.tsx` 直接使用 Tailwind 尺寸类：容器 `text-xs`（12px）、`gap-0.5`（2px）、
`px-1.5 py-1`；格式按钮 `w-8 h-7` + `text-xs`；块类型触发器 `text-xs`、`h-7`；下拉选项
`py-1.5` + `text-xs`、菜单 `min-w-[170px]`。整体偏小、选项行距局促。

### 2.2 问题 2①：同语法持续叠加

**根因**：`formatCtrl.formatRange`（formatCtrl.ts:36-74）对选区**无条件包裹**标记——
已加粗文本再次加粗得到 `****text****`；`**a**` 内选中 `a` 点加粗得 `****a****`。
无"已应用则移除"的 Toggle 判定，也未在包裹前清理选区内的同风格标记对。

### 2.3 问题 2②：语法符号未隐藏

**根因**：`inlineRenderer` 按 marktext 范式把标记保留为
`<span class="md-syntax">**</span>` 灰显包裹（`globals.css:1918-1923`，
`color: var(--text-muted)` + `opacity: 0.55`），目的保证 DOM `textContent` 与源文本一致
（编辑/序列化不丢标记，SPEC-EDITOR-V2 13.5 R4）。但用户要求工具栏应用格式后**视觉上**
不出现语法符号。

### 2.4 问题 2③：高亮非黄色

**根因**：`globals.css:1938-1943` 的 `mark` 背景为
`color-mix(in srgb, var(--accent) 25%, transparent)`（主题色 25% 混合），非黄色。

### 2.5 问题 3：功能缺失

**根因**：`FORMAT_BUTTONS`（FloatingToolbar.tsx:55-90）仅 6 项（加粗/斜体/删除线/行内代码/
链接/高亮），缺下划线、数学公式、图片、橡皮擦；`InlineFormatStyle`（formatCtrl.ts:11-17）
与 `MARKERS`（:19-25）未含对应风格；`inlineRenderer` 未实现 `<u>` 与 `$` 标记解析；
`package.json` 无 katex 依赖。

---

## 3. 目标

| 编号 | 目标 | 验收要点 |
| ---- | ---- | -------- |
| G1 | 工具栏字体偏大、词语间距适中、下拉选项上下间距适中 | 计算样式断言：格式按钮字号 ≥ 14px、按钮间距 ≥ 6px、下拉项行距 ≥ 8px；总高度 ≥ 40px |
| G2① | 加粗/倾斜/删除线/行内代码/高亮为**Toggle + 非同语法嵌套** | 对已应用该格式的选区再次点击 → 移除格式；全选包裹区点格式 → 解除；绝不产生 `****…****` 双层同标记 |
| G2② | 应用格式后直接渲染富文本，**无可见语法符号** | 应用后 `.md-syntax` 计算样式不可见（font-size/opacity 归零或透明）；DOM `textContent` 不变，往返不变量保持 |
| G2③ | 高亮渲染为**黄色背景** | `==x==` 计算样式 `backgroundColor` 为黄色（各主题均可见） |
| G3① | 补全下划线、数学公式、图片、橡皮擦；按钮顺序适当调整 | 工具栏含四类新按钮；顺序按 4.6 分组 |
| G3② | 功能对标 marktext | 下划线 `<u>` 富文本渲染；图片插入 `![alt](url)` 并渲染；数学 `$x$` KaTeX 渲染、无可见 `$`；橡皮擦清除选区全部行内格式 |

---

## 4. 方案设计

### 4.1 工具栏视觉规格（G1）

尺寸与间距统一收敛到样式类（globals.css），不再散落 Tailwind 尺寸类，便于主题统一与
E2E 计算样式断言：

| 元素 | 现状 | 目标 |
| ---- | ---- | ---- |
| 工具栏容器 | `text-xs gap-0.5 px-1.5 py-1` | `gap-1.5`~`gap-2`（6-8px）、`px-2 py-1.5`；字号 `text-sm`（14px）起，总高 ≥ 40px |
| 格式按钮 | `w-8 h-7 text-xs` | `w-9 h-8 text-sm`（14px），hover 背景不变 |
| 块类型触发器 | `h-7 text-xs px-1.5` | `h-8 text-sm px-2` |
| 下拉选项 | `py-1.5 text-xs` | `py-2`（8px）`text-sm`；菜单 `min-w-[200px]` |
| 分隔线 | `w-px h-4 mx-1` | `w-px h-5 mx-1` |

- 按钮标签建议与 marktext 一致采用**图标字形**（B/I/U/S/H、`</>`、链接/图片/数学/橡皮擦图标），
  字号与间距满足上表；图标具体字形在实施时经视觉评审确认。
- 保持类名与 `[data-value]` 等选择器稳定（现有 E2E 选择器不破坏，见 6.2）。

### 4.2 行内格式 Toggle 与禁止同语法嵌套（G2①）

`formatCtrl.formatRange` 增加两步逻辑：

```
对 (blockId, style, [s, e)):
  [open, close] = MARKERS[style]; before / selected / after 按现状切分

  Step 1 · Toggle-off：选区恰好被该风格标记包裹时移除
    判定：before 以 open 结尾 且 after 以 close 开头；
          且边界标记"不可延伸"——open 前一字符、close 后一字符不得再与该标记同字符
          （防止 italic '*' 误判 bold '**' 边界）。
    命中：newText = before.slice(0, -open.length) + selected + after.slice(close.length)
          光标 = 移除后内区间起点（保留原选区范围缩小）。
    未命中 → 进入 Step 2。

  Step 2 · Toggle-on：包裹（先清理同风格标记对，杜绝二层嵌套）
    deduped = stripSameStylePairs(selected, style)   // 见 4.2.1
    newText = before + open + deduped + close + after
    光标：折叠光标 → open 与 close 之间；选区 → 包裹后末尾（现状语义）。

  之后 setBlockText + renderBlock（现状不变）。
```

#### 4.2.1 同风格标记对清理

新增内核纯函数 `stripSameStylePairs(text, style)`：复用行内 lexer（与 `inlineRenderer`
同一 token 识别路径，见 4.5.4）扫描 `text`，遇到与 `style` 相同的**完整成对标记**时
丢弃标记、保留内文（同一格式不二次嵌套）。示例：

| 输入 selected | style | 输出 |
| ------------- | ----- | ---- |
| `**already**`（边界未命中走 Step 2 的残例） | bold | `already` |
| `a **b** c` | bold | `a b c` |

> 说明：完整成对清理仅作用于**本次包裹区间内**，不触碰区间外既有格式；部分重叠等
> 混合边界场景按"边界 Toggle + 区间内去重"保守处理，文档列为已知限制（见 7 节）。

#### 4.2.2 按钮 active 态

`FloatingToolbar.activeTest`（FloatingToolbar.tsx:55-90）语义不变（由 `anchorText`
首尾标记判定），但需与 Toggle 判定使用同一"不可延伸"边界规则，避免高亮态与
点击行为不一致。`underline / image / math` 无 activeTest（不常驻高亮）；`eraser` 无。

### 4.3 语法符号视觉隐藏（G2②）

**原则**：标记**继续保留在 DOM 与文本层**（`textContent` 与源一致、序列化往返不变），
仅**视觉隐藏**。修改 `globals.css` 的 `.md-syntax`：

```css
/* v2 行内语法标记：保留在 DOM 保证 textContent 与源一致；视觉上完全隐藏 */
.md-syntax {
  font-size: 0;            /* 不占字符宽度，避免 "**" 隐形空隙 */
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
```

- 仅 `.md-syntax`（行内标记：`**` `*` `~~` `==` `` ` ``、链接 `[`/`](url)`、`<u>`、`$`、
  转义符）隐藏；**块级语法**（列表 `.list-marker`、任务 `.task-checkbox`、标题 `::before`
  提示、引用竖线、代码块围栏）不受影响（不同类名，EDIT-13 语义不变）。
- 作用范围限定编辑器内容区（`.block-content` 内），避免影响其它预览/展示场景。
- 已知权衡：手动编辑时看不到标记边界（如退格会隐形删除标记、破坏该处格式）。
  缓解：① 新增"橡皮擦"显式清除；② 记入第 7 节已知限制。此为满足用户"无语法符号"
  目标的必要取舍，优先级高于 marktext 的灰显标记外观。

### 4.4 高亮渲染为黄色（G2③）

`globals.css` 的 `mark` 改为主题变量驱动的黄色背景：

```css
mark {
  background: var(--highlight-bg);
  color: var(--highlight-text);
  border-radius: 3px;
  padding: 0;
}
```

在 `globals.css` 各主题块（`:root` / `html.dark` / 自定义主题等）新增变量：

| 主题 | `--highlight-bg` | `--highlight-text` |
| ---- | ---------------- | ------------------ |
| 浅色 | `#ffeb3b`（黄） | `#1a1a1a` |
| 深色 | `#5c5400` 或 `rgba(255, 235, 59, 0.35)` | `#fff` / `inherit`（保证可读） |

> 推荐浅色 `#ffeb3b`、深色 `rgba(255, 235, 59, 0.35)`；最终色值实施时按主题对比度微调，
> 但必须满足"视觉为黄色"（E2E 计算样式断言 `backgroundColor` 呈黄色系）。

### 4.5 新增格式能力（G3）

#### 4.5.1 下划线（Underline）

- `InlineFormatStyle` 增 `'underline'`；`MARKERS.underline = ['<u>', '</u>']`。
- `inlineRenderer` 新增 `tryUnderline`：`<u>text</u>`（小写、精确匹配）→
  `<u><span class="md-syntax">&lt;u&gt;</span>…<span class="md-syntax">&lt;/u&gt;</span></u>`，
  置于 `tryAutoLink` 之前的解析顺序（`<u>` 不满足自动链接正则，无冲突）。
- 序列化不变：叶子 `text` 原样保存 `<u>text</u>`，往返不受影响（新增往返用例，见 6.1）。
- 折叠光标：插入 `<u></u>`，光标置中；选区：`<u>` + 选中文本 + `</u>`。

#### 4.5.2 数学公式（Math，需新增依赖 KaTeX）

- **新增依赖**：`katex` + `@types/katex`（本地 npm 包，离线可用；引入 `katex.min.css`）。
- 新增 `kernel/katex.ts`：封装 `katex.renderToString(expr, { throwOnError: false })`；
  返回空/异常时回退字面量（`$expr$` 原样转义），保证 DOM 安全与 textContent 一致。
- `inlineRenderer` 新增 `tryMath`（inline `$…$`，display `$$…$$` 列为后续任务）：

  - 打开判定：`$` 后一字符非空格、非 `$`；前一字符非词字符/`$`（避免 "cost $5" 误判）；
  - 闭合判定：行内下一个 `$`，表达式非空、首尾非空格、不含 `\n`；
  - 输出：`<span class="math-inline">` + KaTeX HTML + `</span>`，两侧 `$` 包 `.md-syntax`；
  - `$` 加入 `ESCAPABLE_CHARS`（`\$` 按字面转义）。
- 按钮：折叠光标插入 `$$` 光标居中；选区包裹 `$…$`。`Ctrl+Shift+M` 快捷键（对标 marktext）。
- 兜底：KaTeX 渲染失败时按字面量渲染 `$expr$`，不抛错、不破坏编辑。

#### 4.5.3 图片（Image）

- `InlineFormatStyle` 增 `'image'`；插入 `![alt](url)`：
  - 选区非空：`alt` = 选中文本，`url` = prompt 输入；
  - 选区为空：`alt` = 默认占位文案，`url` = prompt 输入，光标置于 `(url)` 末尾。
- `inlineRenderer.tryImage` 已支持 `![alt](url)` 渲染（含 `safeUrl` 协议白名单），无需改；
  补充样式 `.inline-image { max-width: 100%; display: inline-block }`（对标 marktext 图片限宽）。
- 剪贴板粘贴图片（IPC）列为后续任务，不在本规范范围。

#### 4.5.4 橡皮擦（清除格式 / Clear Format）

- 新增 `formatCtrl.clearFormat(instance, blockId, start, end)`：
  对选区文本调用内核纯函数 `stripInlineSyntax(text, s, e)`，**剔除全部**已识别行内标记
  （bold / italic / underline / strike / highlight / code / link / math），保留内文，替换选区；
  折叠光标（无选区）时按钮禁用。
- `stripInlineSyntax` 与 4.2.1 的 `stripSameStylePairs` 共用同一"行内 lexer"：
  把 `inlineRenderer.renderFragment` 的 token 识别（`tryXxx` 系列）重构为可复用的
  `kernel/inlineLexer.ts`（纯函数：输入 text + 起始偏移，输出 token 序列），
  `inlineRenderer` 与两个 strip 函数均基于它，保证"渲染识别"与"清除识别"一致。

### 4.6 按钮顺序与分组（G3①）

对齐 marktext 格式能力，按"段落/字符格式 → 对象插入 → 清理"分组：

```
[块类型下拉] | B 加粗 · I 斜体 · U 下划线 · S 删除线 · </> 行内代码 · H 高亮
            | 链接 · 图片 · 数学公式
            | 橡皮擦（清除格式）
```

- 分隔符（`|`）在分组间保留（现状 `w-px h-5 mx-1`）。
- 现状 6 项中"高亮"从链接前移至"字符格式"组（与 marktext 一致），链接/图片/数学归入
  "对象插入"组；橡皮擦单独成组置最右。
- 块类型下拉位置不变（最左侧）。

### 4.7 快捷键扩展（可选，不破坏现有）

`ContentBlock` 快捷键表（ContentBlock.tsx:175-193）新增：

| 键 | 动作 |
| -- | ---- |
| `Ctrl+U` | 下划线 |
| `Ctrl+Shift+M` | 数学公式 |
| `Ctrl+\`（现有） | Source 模式，保持不变 |

> 加粗/斜体/删除线/高亮/代码现状快捷键保持不变。

---

## 5. 改动文件清单（预估）

| 文件 | 改动 | 风险 |
| ---- | ---- | ---- |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | 尺寸/间距、新按钮（下划线/数学/图片/橡皮擦）、按钮分组顺序、格式点击传参（url/alt） | 中 |
| `src/render/components/Editor/v2/types.ts` | `BlockHandlers.onFormat` 选项扩展或新增 `onClearFormat` | 低 |
| `src/render/components/Editor/v2/EditorV2.tsx` | 透传新选项、`clearFormat` 接线 | 低 |
| `src/render/components/Editor/v2/blocks/ContentBlock.tsx` | `Ctrl+U` / `Ctrl+Shift+M` 快捷键 | 低 |
| `src/render/editor/controllers/formatCtrl.ts` | `MARKERS` 增 underline/image/math；toggle 逻辑（4.2）；`clearFormat`（4.5.4）；`InlineFormatStyle` 扩展 | 中 |
| `src/render/editor/kernel/inlineLexer.ts`（新增） | 行内 token 识别复用层（供 renderer / strip 共用） | 中 |
| `src/render/editor/kernel/inlineRenderer.ts` | `tryUnderline`、`tryMath`、`$` 转义、基于 inlineLexer 重构 | 中 |
| `src/render/editor/kernel/katex.ts`（新增） | KaTeX `renderToString` 封装 + 失败回退 | 低 |
| `src/render/editor/kernel/index.ts` | 导出新纯函数 | 低 |
| `src/render/styles/globals.css` | `.md-syntax` 隐藏（4.3）、`mark` 黄色（4.4）、`--highlight-bg/--highlight-text` 各主题变量、`.inline-image` / `.math-inline` / `.floating-toolbar-v2` 尺寸 | 低 |
| `package.json` | 新增 `katex`、`@types/katex` | 低（依赖） |
| `tests/`（见 6.1） | toggle 矩阵 / strip / 下划线 / 数学 / 图片 / 橡皮擦 / 工具栏视觉单测 | — |
| `e2e/`（见 6.2） | 新增用例；现有 `.md-syntax` 断言已确认无，无需改 | — |
| `docs/`（见 8） | 本规范实现记录回写；modules/04、editor-v2-architecture、SUMMARY 同步 | — |

---

## 6. 测试策略与回归约束

### 6.1 Vitest 单元/组件测试

1. **Toggle 矩阵**（formatCtrl）：`text` 无格式 → 应用；已包裹 → 移除（含 `**a**` 选区撤格式）；
   连续两次应用 → 恢复原文（无 `****…****`）；italic `*` 不误判 bold `**` 边界；
   折叠光标插入标记位置正确。
2. **strip 系列**：`stripSameStylePairs`（同风格去重）；`stripInlineSyntax`（橡皮擦清除
   bold/italic/underline/strike/highlight/code/link/math 全类标记，部分标记残体保留）。
3. **inlineRenderer**：`<u>x</u>` → `<u>` 富文本且 `textContent` 含 `<u>x</u>`；
   `$x^2$` → KaTeX HTML（mock katex）；`cost $5` / `$ x$` / 未闭合 `$` → 字面量；
   `\$` 转义；往返不变量（underline/math 文本经 `markdownToState`/`stateToMarkdown` 不变）。
4. **工具栏**：按钮集合与顺序（块下拉 → 6 字符格式 → 3 对象插入 → 橡皮擦）；
   新按钮点击回调参数正确；折叠选区橡皮擦禁用。
5. **样式**：`.md-syntax` 计算样式隐藏（jsdom 可断言 `font-size: 0`）；`mark` 背景变量。

### 6.2 Playwright E2E（真实 Chromium）

| 用例 | 覆盖 |
| ---- | ---- |
| 选中文本 → 工具栏字号 ≥14px、按钮间距 ≥6px、下拉项行距 ≥8px（计算样式断言） | G1 |
| 加粗两次 → 文本回到未加粗；`**a**` 全选点加粗 → 解除；无 `****` 出现 | G2① |
| 应用加粗/斜体/删除线/代码/高亮 → `.md-syntax` 不可见，DOM `textContent` 与源一致 | G2② |
| `==高亮==` → `mark` 计算样式 `backgroundColor` 为黄色系 | G2③ |
| 下划线按钮 → `<u>` 渲染、无 `<u>` 可见；图片按钮 → `![alt](url)` 插入并渲染 | G3 |
| 数学按钮 → `$x^2$` 渲染为 `.katex`、无可见 `$` | G3 |
| 橡皮擦 → 清除选区全部行内格式为纯文本 | G3 |
| 现有 `floating-toolbar.spec.ts` / `editor.spec.ts` / `marktext-rendering.spec.ts` 等不回归 | 回归 |

> 已核实：现有 E2E **未断言** `.md-syntax` 可见性（仅断言标题 `::before`、`.list-marker`
> 等块级语法），故 4.3 隐藏修改不破坏存量断言。

### 6.3 回归门禁

- `tsc --noEmit`、ESLint（0 error）、`vite build` 通过；
- `vitest run` 全量通过（存量 309 例 + 新增）；
- `npx playwright test` 全量通过（存量 30 例 + 新增）；
- 块树序列化/往返不变量、SPEC-EDIT-EXIT 六条退出规则、SPEC-EDIT-CBTP、SPEC-EDIT-FT
  （显示条件 / 转换矩阵）、SPEC-EDIT-DSF（拖选节流）行为零变化。

---

## 7. 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| 隐藏标记后手动编辑看不到边界（退格隐形删标记） | 橡皮擦显式清除；记入已知限制；可选方案 B：`.block-content:focus .md-syntax` 聚焦时灰显（Typora 风格，可在评审时二选一） |
| 数学 `$` 与普通文本（价格 `$5`）冲突 | 保守打开/闭合判定（4.5.2）；`\$` 转义；失败回退字面量 |
| KaTeX 新依赖的体积 / 离线 | 本地 npm 打包、按需 import；渲染失败不抛错 |
| Toggle 边界误判（italic vs bold、部分重叠） | "不可延伸"边界规则 + 单测矩阵；混合边界列为已知限制 |
| 工具栏视觉改动破坏现有 E2E 选择器 | 保持类名与 `[data-value]` 选择器稳定；尺寸仅计算样式断言 |
| 数学块级 `$$…$$`、剪贴板粘贴图片未覆盖 | 明示为本规范范围外，列为后续任务 |
| 回退 | 改动集中在工具栏组件、formatCtrl、inlineRenderer/lexer、CSS，均可整体还原；块树与序列化零改动 |

**已知限制**（实施后回写）：
- 部分重叠 / 混合嵌套边界的 Toggle 采用保守处理，不保证语义级完美；
- 隐藏标记场景下手动删除标记不可见，清理依赖橡皮擦；
- display math（`$$…$$`）、图片粘贴、数学错误 UI 不在本规范范围。

---

## 8. 验收标准

- G1：工具栏字体 ≥ 14px、按钮间距 ≥ 6px、下拉项行距 ≥ 8px、总高 ≥ 40px（E2E 计算样式断言）。
- G2①：对已加粗/斜体/删除线/代码/高亮选区再次点击即解除；绝不出现双层同标记。
- G2②：应用后 `.md-syntax` 视觉隐藏；DOM `textContent` 与源一致，往返不变量保持。
- G2③：高亮 `==…==` 背景为黄色（浅色 `#ffeb3b` 系，深色可读黄），E2E 计算样式断言。
- G3：工具栏含 下划线 / 数学公式 / 图片 / 橡皮擦 四类按钮且分组顺序符合 4.6；
  下划线、图片、数学、橡皮擦功能行为与 marktext 对齐（4.5）。
- 全量回归门禁（6.3）通过；存量 Vitest / E2E 不回归；`tsc` / `eslint` / `vite build` 全绿。

---

> 本规范为浮动工具栏体验优化与行内格式化增强的设计基线。评审确认后实施；实施中的偏差
> 回到本规范更新后执行（文档优先，避免编码错误）。实施风险等级：**L3**（编辑器核心交互
> 修改 + 新增依赖），需人工确认后开工。

---

## 9. 实施记录

> 按里程碑回写（对照 SPEC-EDITOR-V2 13.x 的格式）。实施证据见
> [docs/testing/spec-edit-ft2.tdd.md](../testing/spec-edit-ft2.tdd.md)。

### 9.1 阶段 0~1 内核（2026-08-08）

- 新增依赖 `katex` + `@types/katex`；抽取 `kernel/inlineLexer.ts`
  （`InlineToken`/`tokenizeInline`/`isBoundedWrap`），`inlineRenderer.renderFragment`
  改为消费 lexer（输出逐字节不变，存量 108 行金标准测试守护）。
- `kernel/katex.ts`：`renderMath(expr)` 成功包装 `.math-inline` + 两侧 `.md-syntax` `$`，
  失败回退转义字面量（`throwOnError: false` + try/catch）。
- `kernel/inlineStrip.ts`：`stripSameStylePairs` / `stripInlineSyntax`（与 lexer 同识别规则）。
- `formatCtrl`：`InlineFormatStyle` 扩至 9 种（含 underline/math/image）；`formatRange` 加
  toggle 双形态（形态 A 选区外标记、形态 B 全选包裹区）；`clearFormat` 新增；image 走
  link 式插入分支（`![alt](url)`）。
- `$` 加入 `ESCAPABLE_CHARS`（`\$` 转义）；underline `<u>`/`</u>` 精确小写匹配；
  math 打开/闭合判定（前字符非词字符、表达式非空且首尾非空格、不含 `\n`）。

### 9.2 阶段 2 样式（2026-08-08）

- 5 个主题块新增 `--highlight-bg/--highlight-text`（浅色 `#ffeb3b`/`#1a1a1a`；
  dark/custom `rgba(255,235,59,0.35)`/`#fff`；high-contrast `#ffeb3b`/`#1a1a1a`）。
- `.md-syntax` 改方案 B：默认 `font-size: 0; opacity: 0; user-select: none`（隐藏保留 DOM），
  `.block-content:focus`（含 `:focus-within`）灰显 `opacity: 0.55`。
- `mark` 高亮改用 `var(--highlight-bg)` / `var(--highlight-text)`（黄色系）。
- 工具栏尺寸收敛 globals.css：`.floating-toolbar-v2`（gap 6px、padding 6px 8px、字号 14px）、
  `.ft-btn`（36×32px）、`.block-type-trigger`（高 32px）、`.block-type-option`
  （padding 8px 12px）、`.block-type-menu`（min-width 200px）、`.ft-divider`（1×20px）。
- 新增 `.inline-image` / `.math-inline` 规则。

### 9.3 阶段 3 工具栏（2026-08-08）

- 按钮分组：`CHAR_BUTTONS`（B/I/U/S/</>/H）→ `.ft-divider` → `OBJECT_BUTTONS`
  （🔗/🖼/∑）→ `.ft-divider` → 橡皮擦（⌫）。
- `activeTest` 改用共享 `isBoundedWrap`（与 formatCtrl toggle-off 同边界规则，
  含 italic 不误判 bold `**` 边界）。
- `handleFormat`：link/image 弹 `window.prompt` 后 `onFormat(..., url)`；underline/math 直传；
  橡皮擦 `onClick` → `onClearFormat`（折叠选区防御）。
- 尺寸类从 Tailwind 迁移至 globals.css（保留 `.floating-toolbar-v2`/`.block-type-*`/
  `[data-value]`/`[title]` 选择器，E2E 选择器零变化）。

### 9.4 阶段 4 接线（2026-08-08）

- `types.ts`：`BlockHandlers.onFormat` 补 `url?`；新增 `onClearFormat`。
- `ContentBlock.tsx`：`onFormat` 补 `url?`；`handleFormatShortcut` 增 Ctrl+U（underline）、
  Ctrl+Shift+M（math），置于 z/y 撤销重做之后。
- `EditorV2.tsx`：新增 `onClearFormat` useCallback
  （`formatCtrl.clearFormat`），注册进 handlers 并传给 FloatingToolbar。

### 9.5 已知限制（回写）

- 部分重叠/混合边界（如选区切开 `**`）保守处理：`stripInlineSyntax` 保留跨界残体为字面量。
  （SPEC-EDIT-FT3 已解决「选区覆盖 content + 部分边界标记」的 case B 与跨多个同风格 token
  覆盖标记的逐 token 拆分（C10）；选区不覆盖标记的极端部分重叠仍保守，见
  [SPEC-EDIT-FT3](./floating-toolbar-format-sticky.md) §9.7/§9.8/§9.9。跨风格叠加（加粗再斜体
  生成三连 `***`，lexer 解析 em 内嵌 strong 渲染、解除逐层剥离）已支持，C12。）
- 隐藏标记编辑依赖聚焦灰显边界 + 橡皮擦显式清除（无「标记全隐藏」失焦风险）。
- 列表间互转（bullet→task 等）与 heading→列表/引用/代码块转换：下拉置灰，列为后续任务。
- KaTeX 体积与首屏：仅含 `$` 的块触发 `renderToString`；动态拆包列为后续优化。
- display math（`$$...$$` 块级）与图片粘贴上传在本次范围外。
