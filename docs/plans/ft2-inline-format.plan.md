# 实施计划：SPEC-EDIT-FT2 浮动工具栏体验优化与行内格式化增强（TDD）

> 计划编号：PLAN-EDIT-FT2 | 版本：v0.1 | 日期：2026-08-08
> 规范基线：[docs/specs/floating-toolbar-ux-and-inline-format.md](../specs/floating-toolbar-ux-and-inline-format.md)（SPEC-EDIT-FT2 v0.1）
> 关联规范：SPEC-EDIT-FT、SPEC-EDITOR-V2、SPEC-EDIT-EXIT、SPEC-EDIT-CBTP、SPEC-EDIT-DSF
> 风险等级：**L3**（编辑器核心交互修改 + 新增依赖）→ 已获用户确认
> TDD 工作流：每阶段 = 写测试（RED）→ 最小实现（GREEN）→ 重构 → 证据 → checkpoint commit（实际提交需用户授权，未授权则以证据报告记录，参照既有 DSF/FT 报告惯例）

---

## 0. 已核实基线（2026-08-08 代码审计）

| 项目 | 现状（已核实） | 与 spec 的差距 |
| ---- | ---- | ---- |
| `formatCtrl.ts` | `InlineFormatStyle` 仅 6 项；`MARKERS` 无 underline/math；`formatRange` 无条件包裹（36-74 行），无 toggle/strip/clearFormat | 需新增 toggle（4.2）、stripSameStylePairs（4.2.1）、clearFormat（4.5.4）、underline/math/image 分支 |
| `FloatingToolbar.tsx` | `FORMAT_BUTTONS`（55-90 行）6 项，顺序为 bold/italic/strike/code/**link**/highlight；`onFormat` prop **已含** `url?`（30-36 行）；`handleFormat` 已为 link 弹 prompt（321-334 行）；尺寸用 Tailwind 类（`text-xs gap-0.5` 等） | 需重排分组（4.6）、新增 U/图片/数学/橡皮擦、activeTest 边界规则（4.2.2）、尺寸收敛到 globals.css（4.1） |
| `EditorV2.tsx` | `onFormat` 已透传 `url?` 给 `formatCtrl.formatRange`（197-204 行） | 新增 `onClearFormat` 接线 |
| `types.ts` | `BlockHandlers.onFormat` **无** `url?` 参数（94 行） | 补 `url?`；新增 `onClearFormat` |
| `ContentBlock.tsx` | `styleByKey` 仅 b/i/e（175-179 行）+ Shift+S/H 特判；`onFormat` prop 无 `url?`（37 行） | 新增 Ctrl+U、Ctrl+Shift+M（4.7）；`onFormat` 补 `url?` |
| `inlineRenderer.ts` | `ESCAPABLE_CHARS` 无 `$`（12-29 行）；无 `tryUnderline`/`tryMath`；`tryImage` 已实现（154-159 行）；`renderFragment` 为字符分派循环（229-262 行） | 新增 tryUnderline（置于 tryAutoLink 前）、tryMath、`$` 转义；重构为 inlineLexer 消费 |
| `inlineLexer.ts` | 不存在 | 新增（4.5.4） |
| `katex.ts` | 不存在 | 新增（4.5.2） |
| `globals.css` | `.md-syntax` 灰显常驻（1916-1923 行）；`mark` 为 accent 25% 混色（1938-1943 行）；5 个主题块（:root+light-header/light/dark/custom/high-contrast）无 highlight 变量；无 `.inline-image`/`.math-inline`/工具栏尺寸类 | 方案 B 隐藏+聚焦灰显（4.3）、mark 黄色（4.4）、主题变量、新类 |
| `package.json` | 无 katex | 新增 `katex` + `@types/katex` |
| 测试基线 | Vitest **309 例**（23 文件）；Playwright E2E **30 例**（5 spec）；`vitest.config.ts` 为 `css: false` | — |
| 既有 formatCtrl 测试 | `controllers.test.ts` 374-386 行 2 例（选区加粗、折叠光标插入） | 新 toggle 逻辑下应保持绿（无既有标记场景） |
| 存量 E2E | `editor.spec.ts`/`marktext-rendering.spec.ts` **仅断言块级** `::before`/`.list-marker` 计算样式，**无 `.md-syntax` 可见性断言** | 方案 B 隐藏不破坏存量断言 |

---

## 1. 目标与验收（Testable Guarantees）

每个 G 目标 → 可测试保证（供 RED/GREEN 证据映射）：

| 编号 | 可测试保证（Testable Guarantee） | 测试形态 | RED 证据形态 | GREEN 判据 |
| ---- | ---- | ---- | ---- | ---- |
| **G1** | G1.1 格式按钮计算字号 ≥ 14px | E2E 计算样式 | 旧实现 `fontSize` = 12px | ≥ 14px |
| | G1.2 工具栏容器按钮间距 ≥ 6px（gap） | E2E 计算样式 | 旧实现 gap = 2px | ≥ 6px |
| | G1.3 下拉选项行距 ≥ 8px（padding/line-height） | E2E 计算样式 | 旧实现 py=6px | ≥ 8px |
| | G1.4 工具栏总高 ≥ 40px | E2E 计算样式 | 旧实现 h=28px+padding | ≥ 40px |
| | G1.5 尺寸样式收敛于 globals.css 类（非 Tailwind 尺寸类） | CSS 静态断言 | globals.css 无对应规则 | 规则存在 |
| **G2①** | G2.1 未格式选区点击 → 应用标记（无→有） | formatCtrl 单测 | 旧实现已支持（保持绿） | 包裹正确 |
| | G2.2 已包裹内选区（`**a**` 选 `a`）点击 → 解除（有→无） | formatCtrl 单测 + E2E | 旧实现 `****a****` | 得 `a` |
| | G2.3 全选包裹区（`**a**` 全选）点击 → 解除 | formatCtrl 单测 + E2E | 旧实现不变/双层 | 得 `a` |
| | G2.4 连续两次应用 → 恢复原文，**永不产生 `****…****`** | formatCtrl 单测 + E2E | 旧实现双层 | 无双层 |
| | G2.5 italic `*` 不误判 bold `**` 边界 | formatCtrl 单测 | 误判移除 | `***a***`（不同语法嵌套） |
| | G2.6 activeTest 与 toggle 同边界规则 | 组件单测 | 不一致 | `isBoundedWrap` 共享 |
| **G2②** | G2.7 非聚焦态 `.md-syntax` 计算样式不可见（font-size:0 / opacity:0） | E2E 计算样式 + CSS 静态 | 旧实现 opacity 0.55 灰显 | font-size 0 或 opacity 0 |
| | G2.8 聚焦态 `.md-syntax` 灰显（方案 B：opacity 0.55） | E2E 计算样式 + CSS 静态 | 无此规则 | 灰显规则存在 |
| | G2.9 DOM `textContent` 与源文本一致（标记仍保留于 DOM） | 单测 + E2E | — | 逐字节相等 |
| | G2.10 往返不变量 `stateToMarkdown(markdownToState(M))===M` 保持 | roundTrip 单测 | — | 含新标记用例仍绿 |
| **G2③** | G2.11 `==高亮==` → `mark` 计算背景为黄色系 | E2E 计算样式 + CSS 静态 | 旧实现紫色混色 | `backgroundColor` 黄（浅色 #ffeb3b / 深色 rgba(255,235,59,0.35)） |
| | G2.12 5 个主题块均定义 `--highlight-bg/--highlight-text` | CSS 静态断言 | 无变量 | 齐全 |
| **G3①** | G3.1 工具栏按钮集合与顺序 = 块下拉 → 6 字符格式 → 3 对象插入 → 橡皮擦 | 组件单测 + E2E | 缺 4 按钮/顺序错 | 顺序正确 |
| | G3.2 下划线/图片/数学/橡皮擦按钮可点击且回调参数正确 | 组件单测 | 不存在 | 回调正确 |
| **G3②** | G3.3 `<u>x</u>` 渲染为 `<u>` 富文本且 textContent 保留 | inlineRenderer 单测 + E2E | 转义字面量 | 富文本 |
| | G3.4 `$x^2$` 渲染为 `.math-inline` + KaTeX HTML，`$` 不可见 | inlineRenderer 单测（mock）+ E2E | 字面量 | `.katex` 存在、`$` 隐藏 |
| | G3.5 `cost $5`/`$ x$`/未闭合 `$` → 字面量（不误判） | inlineRenderer 单测 | 误判渲染 | 字面量 |
| | G3.6 `\$` 转义（`$` ∈ ESCAPABLE_CHARS） | inlineRenderer 单测 | 未转义 | escaped literal |
| | G3.7 KaTeX 渲染失败 → 字面量回退（不抛错） | katex 单测 | 抛错 | 回退 |
| | G3.8 图片按钮 → `![alt](url)` 插入且渲染 `.inline-image` | formatCtrl 单测 + E2E | 无 | 插入+渲染 |
| | G3.9 橡皮擦 → 选区全部行内标记清除为纯文本 | formatCtrl 单测 + E2E | 无 | 纯文本 |
| | G3.10 Ctrl+U / Ctrl+Shift+M 快捷键 | 组件单测 | 无效果 | 生效 |

---

## 2. 关键设计决策（规范歧义处定的实现口径）

| # | 决策 | 依据 |
| ---- | ---- | ---- |
| D1 | **Toggle-off 双形态**：形态 A（标记在选区外：`before` 以 open 结尾且 `after` 以 close 开头）+ 形态 B（选区自身含完整包裹标记：`selected` 以 open 开头、close 结尾）。两者均需"边界不可延伸"。 | spec 4.2 只写形态 A，但 G2① 验收"全选包裹区点格式→解除"与 activeTest 一致性要求形态 B（`**a**` 全选时 before/after 为空，形态 A 不命中） |
| D2 | 共享纯函数 `isBoundedWrap(text, open, close): boolean`（含边界不可延伸规则），供 formatCtrl 的 toggle 与 FloatingToolbar 的 activeTest 复用，保证高亮态与点击行为一致（4.2.2） | spec 4.2.2 |
| D3 | `InlineFormatStyle` 扩为 `'bold'\|'italic'\|'strike'\|'highlight'\|'code'\|'link'\|'underline'\|'math'\|'image'`；`MARKERS: Record<Exclude<InlineFormatStyle,'link'\|'image'>, [string,string]>`，underline=`['<u>','</u>']`、math=`['$','$']`；image 走 link 式特判分支 | spec 4.5.1/4.5.2/4.5.3 |
| D4 | toggle 逻辑（Step1/Step2）对**所有带 MARKERS 的风格统一生效**（含 underline/math），超出 spec 明列的 5 类但行为一致、实现免费 | 一致性优先；测试聚焦 spec 明列的 5 类 + underline/math 包裹/插入 |
| D5 | 新增 `onClearFormat(blockId, start, end)` handler（types.ts/EditorV2/ContentBlock），`BlockHandlers.onFormat` 补 `url?`；`FloatingToolbar` 的 `onClearFormat` prop 设为**可选**以保阶段 3 可独立编译，阶段 4 接线为必填 | spec 第 5 节文件清单"选项扩展或新增 onClearFormat" |
| D6 | `kernel/inlineLexer.ts` 定义结构化 token：`InlineToken { type; start; end; openLen; closeLen; contentStart; contentEnd; children?; href?; title?; isImage? }`；`tokenizeInline(text, start=0): InlineToken[]` 返回顶层 token（绝对偏移），嵌套经 `children`（内文以绝对偏移递归）。`inlineRenderer.renderFragment` 改消费 lexer（输出逐字节不变，存量测试为金标准）；`stripSameStylePairs`/`stripInlineSyntax` 基于同一 lexer | spec 4.5.4"渲染识别与清除识别一致" |
| D7 | `stripSameStylePairs(text, style): string`（4.2.1）：去除 text 内该风格全部完整成对标记，保留内文，其余风格不动；`stripInlineSyntax(text, start, end): string`（4.5.4）：剔除 [start,end) 内**完全包含**的全部已识别行内标记，跨界残体保留。`clearFormat(instance, blockId, start, end)`：折叠选区返回 null（no-op） | spec 4.2.1/4.5.4 + 6.1.2"部分标记残体保留" |
| D8 | `katex.ts` 导出 `renderMath(expr: string): string`：`katex.renderToString(expr, { throwOnError: false })` + try/catch → 失败回退转义字面量；成功时外层包装 `<span class="math-inline">…</span>`，两侧 `$` 包 `.md-syntax`；模块内 `import 'katex/dist/katex.min.css'`（vitest `css:false` 下为 no-op） | spec 4.5.2 |
| D9 | **CSS 断言策略**：因 `vitest.config.ts` 为 `css:false`，jsdom 无法加载/计算 globals.css——CSS 规则断言用 `node:fs` 静态读源码（`tests/styles/ft2Css.test.ts`），计算样式断言全部放 Playwright E2E | 已核实 vitest 配置 |
| D10 | 橡皮擦"折叠选区禁用"语义：工具栏本身仅非折叠选区显示（既有 G1 条件），故禁用态为防御性——`clearFormat` 对 `start===end` 返回 null + 按钮 `disabled` 属性双保险 | spec 4.5.4 + 既有显示条件 |
| D11 | 光标语义：形态 A → `s - open.length`（内区间起点）；形态 B → `s`；Step2 折叠 → `s + open.length`（标记间）；选区 → 包裹后末尾（现状）；image 折叠 → 插入串末尾（`(url)` 后）；image 选区 → 插入串末尾 | spec 4.2/4.5.3 |
| D12 | 实施期验证点：真实 KaTeX 渲染 `$x^2$` 后校验 DOM `textContent` 是否含源串（mathml `<annotation>` 可能归一化为 `x^{2}`）；若漂移则 E2E 仅断言 `.katex` 存在与 `$` 不可见，不断言 textContent（记入已知限制），并评估 `output: 'html'` 配置 | 风险 7.5 |
| D13 | `$` 加入 `ESCAPABLE_CHARS` 后 `\$` 输出 `<span class="md-syntax">\$</span>`（与 `\*` 同构）；`tryMath` 打开判定：前字符非词字符且非 `$`，后字符非空格且非 `$`；闭合：下一 `$`，表达式非空、首尾非空格、不含 `\n` | spec 4.5.2 |

---

## 3. 阶段总览（依赖 DAG）

```
阶段0（依赖+lexer抽取）──► 阶段1（内核纯函数）──► 阶段3（工具栏）──► 阶段4（接线）──► 阶段5（E2E+门禁）──► 阶段6（文档）
        │                        │                     （串行链）
        ▼                        ▼
   阶段2（CSS，独立）── 可全程与内核链并行 ──┘
```

- **串行强制**：0→1（lexer 先行）；1→3（工具栏行为依赖 formatCtrl/lexer）；3→4（prop 契约）；1+2+3+4→5→6。
- **可并行**：阶段2 与阶段0/1/3/4 完全并行（仅依赖已固定的 HTML 结构与类名契约，本计划已锁定）；阶段3 可与阶段2 并行（须在阶段1 之后）。
- 阶段预估新增用例：Vitest +60~65（309→约 372），E2E +9（30→39）。

---

## 4. 分阶段任务卡

### 阶段 0：依赖安装 + inlineLexer 抽取（基础设施，行为零变化）

**目标**：新增 `katex`/`@types/katex` 依赖；抽取 `kernel/inlineLexer.ts` 并让 `inlineRenderer` 消费它，**输出逐字节不变**（存量 108 行 inlineRenderer 测试为金标准）。

**测试文件**：
- `tests/editor/kernel/inlineLexer.test.ts`（新增，约 10 例）：
  1. `tokenizeInline('')` → `[]`
  2. `tokenizeInline('**bold**')` → 1 个 strong token：`{type:'strong', start:0, end:8, openLen:2, closeLen:2, contentStart:2, contentEnd:6}`
  3. `*i*` → em；`~~s~~` → del；`==m==` → mark；`` `c` `` → code
  4. `[t](https://x.com)` → link token（href）；`![a](u.png)` → image token（isImage）
  5. `**a *b* c**` → strong 含 children [em]
  6. `\*x\*` → escape token
  7. `**x`（未闭合）→ `[]`
  8. `foo_bar_baz` → 无 em（下划线词内规则）
  9. 绝对偏移正确性（前置文本场景 `ab **bold** cd`）

**生产文件**：
- `package.json`：`katex`（^0.16.x）+ `@types/katex`（devDependencies）→ `npm i katex && npm i -D @types/katex`
- `src/render/editor/kernel/inlineLexer.ts`（新增）：`InlineToken` 类型 + `tokenizeInline(text, start)`；从 `inlineRenderer` 平移 `isWordChar`/`isIntrawordUnderscore`/`findMatching`/`ESCAPABLE_CHARS`/`SAFE_URL_RE`/`safeUrl` 的识别逻辑为结构化 matcher（`matchEscape/matchCode/matchImageLink/matchAutoLink/matchPaired(marker,tag)/matchEmphasis`），**不产 HTML**
- `src/render/editor/kernel/inlineRenderer.ts`：`renderFragment` 改写为消费 `tokenizeInline` 并映射 HTML（token→HTML 映射留在 renderer）；`escapeHtml`/`safeUrl` 可保留或从 lexer 再导出（index 兼容）
- `src/render/editor/kernel/index.ts`：导出 `tokenizeInline`/`InlineToken`（供 strip 与外部复用）

**RED 预期失败点**：`inlineLexer.test.ts` 首跑 `Cannot find module '../../.../inlineLexer'`（模块不存在）→ 实现后断言逐项失败/通过。

**GREEN 判据**：`inlineLexer.test.ts` 全绿 **且** 存量 `inlineRenderer.test.ts` 108 行金标准全绿（**无输出漂移**）；`tsc --noEmit` 通过。

**回归门禁**：`npx vitest run -- tests/editor/kernel/inlineLexer.test.ts tests/editor/kernel/inlineRenderer.test.ts`；`npx tsc --noEmit`

**checkpoint commit**：`chore(ft2): add katex deps and extract inlineLexer (renderer output unchanged)`

**风险/回退**：重构漂移 → 金标准测试兜底；回退 = 还原本 checkpoint（纯抽取，无功能叠加，回退安全）。

---

### 阶段 1：内核纯函数（underline/math/image/clearFormat + toggle）

**目标**：formatCtrl 补齐 toggle/strip/clearFormat/image/underline/math；inlineRenderer 补 tryUnderline/tryMath/`$` 转义；新增 katex.ts；lexer 补 u/math matcher。

**测试文件**：
- `tests/editor/kernel/katex.test.ts`（新增，3 例）：mock `katex`
  1. `renderMath('x^2')` 调用 `renderToString` 且输出含 `<span class="math-inline">`、两侧 `.md-syntax` `$`
  2. `renderToString` 抛错 → 回退字面量（不抛错）
  3. 空表达式 → 回退字面量
- `tests/editor/kernel/inlineRenderer.test.ts`（扩展 +9 例）：IR1~IR9（见 §5.1）
- `tests/editor/kernel/inlineLexer.test.ts`（扩展 +2 例）：`<u>x</u>` → u token；`$x$` → math token
- `tests/editor/controllers/formatCtrl.test.ts`（新增，约 20 例）：TC1~TC14 + ST1~ST8（见 §5.1）
- `tests/editor/kernel/markdownRoundTrip.test.ts`（扩展 +2 例）：`<u>下划线</u>`、`$x^2$` 往返不变

**生产文件**：
- `src/render/editor/kernel/inlineLexer.ts`：新增 `matchUnderline`（`<u>` 精确小写匹配）、`matchMath`（4.5.2 打开/闭合判定）
- `src/render/editor/kernel/inlineRenderer.ts`：`ESCAPABLE_CHARS.add('$')`；`tryUnderline`/`tryMath` 作为 token→HTML 映射加入；dispatch 顺序：escape → inlineCode → image → link → **underline** → autolink → del → mark → emphasis → math（`$` 无冲突位，置于末位即可）
- `src/render/editor/kernel/katex.ts`（新增）：`renderMath(expr)`（见 D8）+ `import 'katex/dist/katex.min.css'`
- `src/render/editor/controllers/formatCtrl.ts`：扩展 `InlineFormatStyle`/`MARKERS`；重写 `formatRange` 加 Step1/Step2 toggle（D1/D11）；新增 `clearFormat(instance, blockId, start, end)`；`stripSameStylePairs`/`stripInlineSyntax` 从 kernel 导入（D7）
- `src/render/editor/kernel/index.ts`：导出 `renderMath`、`stripSameStylePairs`、`stripInlineSyntax`、lexer 相关

**RED 预期失败点**：`renderMath is not a function`；underline/math 渲染仍为转义字面量；toggle 用例得到 `****hello****`（旧实现无条件包裹）；`clearFormat is not a function`。

**GREEN 判据**：新增文件全绿；既有 `controllers.test.ts` formatCtrl 2 例、`inlineRenderer.test.ts` 存量、`markdownRoundTrip.test.ts` 存量全绿（toggle 向后兼容，见基线表）。

**回归门禁**：`npx vitest run -- tests/editor/kernel/katex.test.ts tests/editor/kernel/inlineLexer.test.ts tests/editor/kernel/inlineRenderer.test.ts tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/markdownRoundTrip.test.ts`；`npx tsc --noEmit`；`npx eslint src/render/editor/kernel src/render/editor/controllers/formatCtrl.ts`

**checkpoint commit**：`feat(ft2): inline underline/math/image + format toggle + clearFormat (kernel)`

**风险/回退**：toggle 边界误判（单测矩阵兜底）；`$` 入 ESCAPABLE_CHARS 影响转义语义（无既有 `\$` 用例冲突，roundTrip 兜底）；image 分支光标计算错误（TC13/TC14 兜底）；回退 = 还原本 checkpoint。

---

### 阶段 2：CSS（可并行）

**目标**：方案 B 隐藏+聚焦灰显、mark 黄色、主题变量、工具栏尺寸类、`.inline-image`/`.math-inline`。

**测试文件**：
- `tests/styles/ft2Css.test.ts`（新增，6 例，用 `node:fs` 读 `src/render/styles/globals.css` 源码做静态断言）：CS1~CS6（见 §5.1）

**生产文件**：
- `src/render/styles/globals.css`：
  - 5 个主题块（`:root,html.light-header`、`html.light`、`html.dark`、`html.custom`、`html.high-contrast`）各增 `--highlight-bg`/`--highlight-text`（浅色 `#ffeb3b`/`#1a1a1a`；dark/custom `rgba(255,235,59,0.35)`/`#fff`；high-contrast `#ffeb3b`/`#1a1a1a`）
  - `.md-syntax` 改方案 B：`font-size: 0; opacity: 0; user-select:none; -webkit-user-select:none;` + `.block-content:focus .md-syntax { font-size: inherit; opacity: 0.55; color: var(--text-muted, #888); }`
  - `mark` → `background: var(--highlight-bg); color: var(--highlight-text); border-radius: 3px; padding: 0;`
  - 新增 `.floating-toolbar-v2` 尺寸规则（容器 `gap: 6px; padding: 6px 8px; font-size: 14px;`，按钮 `width: 36px; height: 32px; font-size: 14px;`，`.block-type-trigger` `height: 32px; padding: 0 8px; font-size: 14px;`，`.block-type-option` `padding: 8px 12px; font-size: 14px;`，`.block-type-menu` `min-width: 200px;`，分隔线 `.ft-divider { width: 1px; height: 20px; margin: 0 4px; }`）
  - `.inline-image { max-width: 100%; display: inline-block; }`、`.math-inline { display: inline-block; vertical-align: middle; }`
- `src/render/editor/kernel/katex.ts`：katex.min.css import（若阶段 1 已加则跳过）

**RED 预期失败点**：CS1~CS6 全部断言失败（当前 `.md-syntax` 为 opacity 0.55 常驻灰显、`mark` 为 accent 混色、无主题变量/尺寸类）。

**GREEN 判据**：`ft2Css.test.ts` 全绿；`npx tsc --noEmit` 通过（`node:fs` 类型需 `@types/node` 已存在）。

**回归门禁**：`npx vitest run -- tests/styles/ft2Css.test.ts`；`npx tsc --noEmit`

**checkpoint commit**：`style(ft2): hide md-syntax (focus-gray B), yellow highlight, toolbar sizing`

**风险/回退**：`font-size: 0` 可能影响行高 → 实施期用 E2E 目视/断言确认聚焦灰显正常；katex 字体资源需确认被 vite 打包（构建核对）；回退 = 还原本 checkpoint。

---

### 阶段 3：工具栏组件

**目标**：按钮分组/新按钮/橡皮擦/activeTest 边界/尺寸类迁移。

**测试文件**：
- `tests/components/FloatingToolbarV2.test.tsx`（扩展 +8 例）：TB1~TB8（见 §5.1），复用既有 `setup`/`mockSelection`/rAF stub

**生产文件**：
- `src/render/components/Editor/v2/FloatingToolbar.tsx`：
  - `FormatButton` 增 `group: 'char' | 'object'`；`FORMAT_BUTTONS` 重排：char = bold/italic/**underline**/strike/code/highlight，object = link/**image**/**math**；橡皮擦独立（非 style）
  - 新增 `onClearFormat?: (blockId, start, end) => void` prop（可选）
  - `activeTest` 改用共享 `isBoundedWrap`（从 kernel 导入或在组件内导出纯函数）；italic 补 `!t.endsWith('**')`
  - `handleFormat`：image/math 处理——image 弹 prompt（同 link）后 `onFormat(...,'image',...,url)`；math/underline 直传；橡皮擦按钮 `onClick` → `onClearFormat(blockId, start, end)` + `disabled` 防御（D10）
  - 分组间渲染分隔线（`.ft-divider`）；尺寸类从 Tailwind 迁移到 globals.css 类（保留 `.floating-toolbar-v2`/`.block-type-*`/`[data-value]`/`[title]` 选择器）
  - 按钮 title：加粗/斜体/下划线/删除线/行内代码/高亮/链接/图片/数学公式/橡皮擦；label 字形：B/I/U/S/</>/H/🔗/🖼/∑/⌫（实施时视觉评审）

**RED 预期失败点**：TB1 按钮集合/顺序断言失败（当前 6 按钮、link 在 highlight 前）；TB2~TB5 按钮不存在/回调未触发；TB6 `*a**` 误判激活。

**GREEN 判据**：新增 8 例全绿；既有 `FloatingToolbarV2.test.tsx` 22 例全绿（下拉/映射/矩阵/节流不回归）；`tsc --noEmit` 通过。

**回归门禁**：`npx vitest run -- tests/components/FloatingToolbarV2.test.tsx`；`npx tsc --noEmit`；`npx eslint src/render/components/Editor/v2/FloatingToolbar.tsx`

**checkpoint commit**：`feat(ft2): toolbar groups + underline/image/math/eraser buttons`

**风险/回退**：E2E 选择器稳定性（保留 title/类名，尺寸仅计算样式断言）；prompt 在单测需 `vi.spyOn(window,'prompt')`；prop 契约变更影响 EditorV2 编译 → `onClearFormat` 可选缓解；回退 = 还原本 checkpoint。

---

### 阶段 4：接线（types / EditorV2 / ContentBlock 快捷键）

**目标**：`onFormat` 补 `url?`、新增 `onClearFormat`、Ctrl+U / Ctrl+Shift+M。

**测试文件**：
- `tests/components/EditorV2Format.test.tsx`（新增，约 5 例，参照 `EditorV2Input.test.tsx` 模式）：
  1. 折叠光标 Ctrl+U → `onContentChange` 得 `<u></u>` 插入
  2. 折叠光标 Ctrl+Shift+M → 得 `$$`
  3. 选区 Ctrl+U → `<u>sel</u>`；选区 Ctrl+Shift+M → `$sel$`
  4. Ctrl+U/Ctrl+Shift+M 不触发 undo/redo（z/y 优先保留）
  5. `onFormat` url 透传（通过 ContentBlock 的 onFormat 调用链或 EditorV2 行为验证 image 插入）

**生产文件**：
- `src/render/components/Editor/v2/types.ts`：`BlockHandlers.onFormat` 补 `url?: string`；新增 `onClearFormat: (blockId: string, start: number, end: number) => void`
- `src/render/components/Editor/v2/blocks/ContentBlock.tsx`：`onFormat` prop 补 `url?: string`；`handleFormatShortcut` 增 `key==='u' → 'underline'`、`(e.shiftKey && key==='m') → 'math'`（置于 z/y 特判之后）
- `src/render/components/Editor/v2/EditorV2.tsx`：新增 `onClearFormat` useCallback（`applyAction(instance => formatCtrl.clearFormat(instance, blockId, start, end))`），注册进 `handlers` memo 并传给 `ContentBlock`；`onFormat` 已透传 url（现状保持）

**RED 预期失败点**：EditorV2Format 测试中 Ctrl+U/Ctrl+Shift+M 无效果（当前无此快捷键）；类型错误（BlockHandlers 无 url/onClearFormat）。

**GREEN 判据**：新增测试全绿；既有 `EditorV2Input.test.tsx` 9 例、`EditorV2.test.tsx`/`EditorV2Convert.test.tsx` 不回归；`tsc --noEmit` 通过。

**回归门禁**：`npx vitest run -- tests/components/EditorV2Format.test.tsx tests/components/EditorV2Input.test.tsx tests/components/EditorV2.test.tsx tests/components/EditorV2Convert.test.tsx`；`npx tsc --noEmit`；`npx eslint src/render/components/Editor/v2`

**checkpoint commit**：`feat(ft2): wire onFormat url + onClearFormat + shortcuts (Ctrl+U / Ctrl+Shift+M)`

**风险/回退**：快捷键冲突（Ctrl+U 在 contentEditable 无浏览器默认下划线；ContentBlock 已 `preventDefault`）；BlockHandlers 接口变更影响面（已 grep 仅 EditorV2/ContentBlock/BlockRenderer 消费）；回退 = 还原本 checkpoint。

---

### 阶段 5：E2E + 全量回归门禁

**目标**：新增 E2E 用例（G1 计算样式 / G2 全流程 / G3 新功能）并跑全量门禁。

**测试文件**：
- `e2e/floating-toolbar.spec.ts`（扩展 +9 例）：E1~E8 + 图片 dialog 处理（`page.on('dialog')` 模拟 prompt 输入 URL）

**生产文件**：无（若 E2E 发现缺陷，回到对应阶段修复——TDD 闭环）。

**RED 预期失败点**：E1 旧实现 fontSize=12px/gap=2px/高度不足；E2 旧实现双层 `****`；E3 `.md-syntax` 可见；E4 mark 非黄；E5~E8 新按钮/渲染不存在。

**GREEN 判据**：`npx playwright test e2e/floating-toolbar.spec.ts` 全绿；存量 `editor.spec.ts`/`marktext-rendering.spec.ts`/`exit-behavior.spec.ts`/`cross-block-selection.spec.ts` 全绿（回归零变化）。

**回归门禁（全量）**：`npx tsc --noEmit`；`npm run test`（vitest 全量 309+新增）；`npx eslint src/`（0 error）；`npx vite build`（轻量渲染构建，确认 katex 字体/资源打包）；`npx playwright test`（全量 30+9）

**checkpoint commit**：`test(ft2): e2e computed styles + toggle/image/math/eraser flows`

**风险/回退**：E2E 计算样式断言依赖主题（默认浅色）；`window.prompt` 需 dialog 处理；`.md-syntax` 隐藏后 `toHaveText` 仍含标记（textContent 不变，存量断言安全）；回退 = 各阶段 checkpoint。

---

### 阶段 6：文档回写

**目标**：spec §9 实施记录、模块文档、SUMMARY、TDD 证据报告。

**生产文件（文档）**：
- `docs/specs/floating-toolbar-ux-and-inline-format.md` §9 实施记录（按里程碑回写，含已知限制：部分重叠边界保守处理、隐藏标记编辑依赖橡皮擦、display math/图片粘贴范围外）
- `docs/modules/04-编辑主区-Editor.md`：工具栏按钮组（4.6）、formatCtrl 新能力、快捷键（Ctrl+U/Ctrl+Shift+M）、`.md-syntax` 方案 B、highlight 变量、已知限制、测试计数更新
- `docs/specs/editor-v2-architecture.md`：新增 13.x 实施记录小节（inlineLexer/underline/math/图片/橡皮擦）
- `docs/SUMMARY.md`：Vitest/E2E 计数、门禁更新
- `docs/testing/spec-edit-ft2.tdd.md`（新增）：RED/GREEN 证据表、门禁结果（参照 spec-edit-dsf.tdd.md 格式）

**checkpoint commit**：`docs(ft2): implementation record + module/summary sync`

---

## 5. 测试用例矩阵

### 5.1 Vitest（映射 spec 6.1，文件 → 用例）

**A. Toggle 矩阵（`tests/editor/controllers/formatCtrl.test.ts`，spec 6.1.1）**

| # | 用例 | 输入 → 期望 |
| ---- | ---- | ---- |
| TC1 | 无格式选区应用 | `'hello world'` bold[0,5) → `'**hello** world'`，光标 9 |
| TC2 | 已包裹内选区解除（形态 A） | `'**a**'` bold[2,3) → `'a'`，光标 0 |
| TC3 | 全选包裹区解除（形态 B） | `'**a**'` bold[0,5) → `'a'`，光标 0 |
| TC4 | 连续两次应用恢复原文 | `'**a**'`→bold→`'a'`→bold→`'**a**'`，无 `'****'` |
| TC5 | italic 不误判 bold 边界 | `'**a**'` italic[2,3) → `'***a***'`（嵌套非移除） |
| TC6 | 折叠光标插入标记间 | `'abc'` italic(1,1) → `'a**bc'`，光标 2（与既有测试一致） |
| TC7 | 选区包裹后光标末尾 | `'hello world'` strike[0,5) → `'~~hello~~ world'`，光标 9 |
| TC8 | underline 折叠/选区 | `'ab'` underline(1,1) → `'a<u></u>b'` 光标 3；`'ab'` [0,2) → `'<u>ab</u>'` |
| TC9 | math 折叠/选区 | `'ab'` math(1,1) → `'a$$b'` 光标 2；`'x'` [0,1) → `'$x$'` |
| TC10 | highlight/code 同 toggle | `'==a=='` [0,5) → `'a'`；`` '`a`' `` [0,3) → `'a'` |
| TC11 | 边界 clamp | start>len / end<start 不越界、不抛错 |
| TC12 | link 现状不回归 | `'ab'` link[0,2),url → `'[ab](u)'` 光标正确 |
| TC13 | image 选区非空 | `'hello'` image[0,5),url=`'a.png'` → `'![hello](a.png)'`，光标串末尾 |
| TC14 | image 折叠占位 | `''` image(0,0),url → `'![图片](u)'`，光标 `(url)` 末尾 |

**B. strip 系列（同文件，spec 6.1.2）**

| # | 用例 | 输入 → 期望 |
| ---- | ---- | ---- |
| ST1 | stripSameStylePairs 同风格去重 | `stripSameStylePairs('**already**','bold')` → `'already'` |
| ST2 | 区间内去重 | `stripSameStylePairs('a **b** c','bold')` → `'a b c'` |
| ST3 | 非目标风格保留 | `stripSameStylePairs('*i* **b**','bold')` → `'*i* b'` |
| ST4 | stripInlineSyntax 全类清除 | bold/italic/underline/strike/highlight/code/link/math 混排 → 纯内文 |
| ST5 | 部分标记残体保留 | 边界截断标记（如选区切开 `**`）→ 残 `*` 保留为字面量 |
| ST6 | 图片保留 alt | `'![alt](u)'` → `'alt'` |
| ST7 | clearFormat 端到端 | 应用 bold+highlight 后 `clearFormat` → 纯文本，光标正确 |
| ST8 | clearFormat 折叠 no-op | `clearFormat(instance, id, 2, 2)` → 返回 null |

**C. inlineRenderer（`tests/editor/kernel/inlineRenderer.test.ts` 扩展，spec 6.1.3）**

| # | 用例 | 期望 |
| ---- | ---- | ---- |
| IR1 | `<u>x</u>` | `<u><span class="md-syntax">&lt;u&gt;</span>x<span class="md-syntax">&lt;/u&gt;</span></u>`（精确串） |
| IR2 | `$x^2$`（mock katex） | 含 `<span class="math-inline">`，两侧 `.md-syntax` `$`，mock HTML 注入 |
| IR3 | `cost $5` | 字面量（不误判） |
| IR4 | `$ x$` / 未闭合 `$` | 字面量 |
| IR5 | `\$` | `<span class="md-syntax">\$</span>`（`$` ∈ ESCAPABLE_CHARS） |
| IR6 | katex 异常回退 | mock `renderToString` throw → `$x^2$` 转义字面量，不抛错 |
| IR7 | textContent 一致性 | 含 u/math 文本 `textContent` === 源串（mock katex 输出受控） |
| IR8 | 金标准不回归 | bold/italic/strike/highlight/code/link/image/escape/autolink 既有断言全绿 |
| IR9 | underline 不干扰 autolink | `<https://x.com>` 仍为 autolink；`<u>` 精确匹配小写 |

**D. katex.ts（`tests/editor/kernel/katex.test.ts`，spec 6.1.3）**：KT1 成功包装契约；KT2 失败回退；KT3 空表达式回退（见阶段 1 任务卡）。

**E. roundTrip（`tests/editor/kernel/markdownRoundTrip.test.ts` 扩展，spec 6.1.3）**：RT1 `<u>下划线</u>`；RT2 `$x^2$`；RT3 `![alt](u)`（如存量未覆盖）。

**F. 工具栏（`tests/components/FloatingToolbarV2.test.tsx` 扩展，spec 6.1.4）**

| # | 用例 | 断言 |
| ---- | ---- | ---- |
| TB1 | 按钮集合与顺序 | DOM 顺序：块下拉 → 分隔线 → B/I/U/S/</>/H → 分隔线 → 🔗/🖼/∑ → 分隔线 → ⌫ |
| TB2 | 下划线/数学点击 | `onFormat(blockId,'underline',s,e)` / `onFormat(blockId,'math',s,e)` |
| TB3 | 图片点击 | `vi.spyOn(window,'prompt')` → `onFormat(blockId,'image',s,e,url)` |
| TB4 | 橡皮擦点击 | `onClearFormat(blockId,s,e)` |
| TB5 | italic activeTest 边界 | `*a**` 不激活；`*a*` 激活；`**a**` 不激活 italic |
| TB6 | bold/italic 激活与 toggle 一致 | `**a**` 激活 bold；`==a==` 激活 highlight |
| TB7 | 折叠选区工具栏不显示 | 既有行为保持（橡皮擦可达性依赖显示条件） |
| TB8 | 既有下拉/节流用例不回归 | 22 例存量全绿 |

**G. 样式（`tests/styles/ft2Css.test.ts`，spec 6.1.5，静态源码断言）**

| # | 断言 |
| ---- | ---- |
| CS1 | `.md-syntax` 含 `font-size: 0` 与 `opacity: 0`（默认隐藏） |
| CS2 | `.block-content:focus .md-syntax` 含 `opacity: 0.55`（聚焦灰显） |
| CS3 | `mark` 含 `var(--highlight-bg)` / `var(--highlight-text)` |
| CS4 | 5 个主题块均定义 highlight 变量；浅色 `#ffeb3b`，dark/custom 为 rgba 黄 |
| CS5 | `.floating-toolbar-v2` 含尺寸规则（gap ≥ 6px、按钮 ≥ 14px、高度 ≥ 40px 构成） |
| CS6 | `.inline-image` / `.math-inline` 规则存在 |

### 5.2 Playwright E2E（映射 spec 6.2，`e2e/floating-toolbar.spec.ts` 扩展）

| # | 用例 | 覆盖 |
| ---- | ---- | ---- |
| E1 | 选中文本 → 计算样式：格式按钮 fontSize ≥ 14px、容器 gap ≥ 6px、下拉项 padding/line-height ≥ 8px、总高 ≥ 40px | G1 |
| E2 | 加粗两次 → 文本回原文；`**a**` 全选点加粗 → 解除；无 `****` 出现 | G2① |
| E3 | 应用加粗/斜体/删除线/代码/高亮 → `.md-syntax` font-size 0 / opacity 0；DOM `textContent` 与源一致；块聚焦后 opacity 0.55 | G2② |
| E4 | `==高亮==` → `mark` 计算样式 `backgroundColor` 黄（浅色 `rgb(255,235,59)`） | G2③ |
| E5 | 下划线按钮 → `<u>` 渲染、无可见 `<u>`（.md-syntax 隐藏） | G3 |
| E6 | 图片按钮（dialog 输入 URL）→ `![alt](url)` 插入并渲染 `img.inline-image` | G3 |
| E7 | 数学按钮 → `$x^2$` 渲染为 `.katex`、无可见 `$` | G3 |
| E8 | 橡皮擦 → 清除选区全部行内格式为纯文本 | G3 |
| E9 | 存量 `floating-toolbar.spec.ts` 5 例不回归（选择器/行为零变化） | 回归 |
| E10 | `editor.spec.ts` / `marktext-rendering.spec.ts` / `exit-behavior.spec.ts` / `cross-block-selection.spec.ts` 全绿 | 回归 |

---

## 6. 可并行工作包建议

| 工作包 | 阶段 | 并行性 | 依赖 |
| ---- | ---- | ---- | ---- |
| **包 A（内核）** | 阶段0 → 阶段1 | 串行内部；与包 B 并行 | 无（自身起点） |
| **包 B（样式）** | 阶段2 | **与包 A/C 完全并行** | 仅依赖已固定的 HTML 结构/类名契约（本计划已锁定，无需等代码） |
| **包 C（UI+接线）** | 阶段3 → 阶段4 | 内部串行；与包 B 并行 | 阶段1（formatCtrl 行为、lexer 导出） |
| **包 E（E2E）** | 阶段5 | 收尾 | 包 A+B+C |
| **包 F（文档）** | 阶段6 | 收尾 | 包 E |

**切分建议**：2~3 个执行体并行——
- Body 1：包 A（内核，上下文最重）
- Body 2：包 B（CSS，零依赖，可先启动）→ 完成后接包 C
- 主控：包 E/F 验收与门禁

**注意**：阶段3 的 `FloatingToolbar` 单测需要 `formatCtrl` 行为真实可用（TB2~TB4 依赖 onFormat 语义），故包 C 严格晚于包 A；但包 C 的**测试文件可提前起草**（RED 先行不依赖实现）。

---

## 7. 风险与缓解

| # | 风险 | 缓解 |
| ---- | ---- | ---- |
| 7.1 | KaTeX 体积（~90KB gzip + 字体 woff2）与首屏性能 | 静态按需：仅含 `$` 的块触发 `renderToString`（tryMath 命中才调用）；katex.min.css 随构建打包；阶段5 `vite build` 核对产物；dynamic import 拆包列为后续优化 |
| 7.2 | Toggle 边界误判（italic vs bold、全选/部分重叠） | D1 双形态 + D2 `isBoundedWrap` 共享 + TC5/TC10 矩阵；部分重叠/混合边界列为已知限制（spec 7） |
| 7.3 | 隐藏标记编辑体验（退格隐形删标记） | 方案 B 聚焦灰显（可见边界）+ 橡皮擦显式清除 + 已知限制回写（spec 4.3/7） |
| 7.4 | E2E 选择器稳定性 | 保留 `[title]`/`[data-value]`/`.block-type-*`/`.floating-toolbar-v2` 类名；尺寸仅计算样式断言 |
| 7.5 | 往返不变量/编辑一致性破坏（KaTeX mathml `<annotation>` 可能归一化 `x^{2}`，DOM textContent 与源漂移） | 渲染层不改模型文本（roundTrip RT1~RT3 兜底）；D12 实施期探针验证真实 KaTeX textContent；若漂移 → E2E 仅断言 `.katex` 存在 + 记入已知限制 |
| 7.6 | inlineLexer 重构输出漂移 | 阶段0 独立 checkpoint + 存量 108 行金标准精确串断言兜底 |
| 7.7 | vitest `css:false` 无法计算样式 | D9：CSS 规则用静态源码断言，计算样式全走 E2E 真实 Chromium |
| 7.8 | `window.prompt` 在单测/E2E 挂起 | 单测 `vi.spyOn(window,'prompt')`；E2E `page.on('dialog')` |
| 7.9 | 主题变量遗漏（5 主题块） | CS4 逐一断言浅色/深色/high-contrast |
| 7.10 | `$` 入 ESCAPABLE_CHARS 改变既有转义 | 无既有 `\$` 用例冲突；roundTrip + IR5 兜底 |
| 7.11 | `.md-syntax` font-size:0 影响行高/选区 | 聚焦灰显恢复字体；E2E 目视验证；`user-select:none` 保留 |
| 7.12 | 快捷键冲突 | Ctrl+U（contentEditable 无浏览器默认）；Ctrl+Shift+M 无冲突；ContentBlock 已 preventDefault；z/y 优先逻辑保留 |
| 7.13 | 整体回退 | 改动集中在工具栏/formatCtrl/inlineRenderer+lexer/CSS，各阶段 checkpoint 可独立还原；块树与序列化零改动 |

---

## 8. 验证命令白名单（每阶段应运行项）

| 阶段 | 命令 |
| ---- | ---- |
| 阶段0 | `npx vitest run -- tests/editor/kernel/inlineLexer.test.ts tests/editor/kernel/inlineRenderer.test.ts`；`npx tsc --noEmit` |
| 阶段1 | `npx vitest run -- tests/editor/kernel/katex.test.ts tests/editor/kernel/inlineLexer.test.ts tests/editor/kernel/inlineRenderer.test.ts tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/markdownRoundTrip.test.ts`；`npx tsc --noEmit`；`npx eslint src/render/editor/kernel src/render/editor/controllers/formatCtrl.ts` |
| 阶段2 | `npx vitest run -- tests/styles/ft2Css.test.ts`；`npx tsc --noEmit` |
| 阶段3 | `npx vitest run -- tests/components/FloatingToolbarV2.test.tsx`；`npx tsc --noEmit`；`npx eslint src/render/components/Editor/v2/FloatingToolbar.tsx` |
| 阶段4 | `npx vitest run -- tests/components/EditorV2Format.test.tsx tests/components/EditorV2Input.test.tsx tests/components/EditorV2.test.tsx tests/components/EditorV2Convert.test.tsx`；`npx tsc --noEmit`；`npx eslint src/render/components/Editor/v2` |
| 阶段5（全量门禁） | `npx tsc --noEmit`；`npm run test`（vitest 全量）；`npx eslint src/`（0 error）；`npx vite build`；`npx playwright test`（全量） |
| 阶段6 | 复核 `npm run test` + `npx playwright test` 零回归 |

> 说明：`npm run build`（含 electron-builder）在阶段5 全量门禁末跑一次即可；日常迭代用 `npx vite build`。`npm run lint` 带 `--fix` 会改文件，门禁统一用 `npx eslint <path>`（无 `--fix`）避免意外修改。

---

## 9. 最终验收（对应 spec §8）

- [ ] G1：E2E 计算样式断言通过（字号 ≥14px / 间距 ≥6px / 行距 ≥8px / 总高 ≥40px）
- [ ] G2①：toggle 矩阵 + E2E 通过，绝不产生 `****…****`
- [ ] G2②：`.md-syntax` 默认隐藏、聚焦灰显；`textContent` 与源一致；往返不变量保持
- [ ] G2③：`mark` 黄色背景（浅色 `#ffeb3b` 系、深色可读黄）
- [ ] G3：工具栏含 4 类新按钮且分组顺序符合 4.6；下划线/数学/图片/橡皮擦行为对标 marktext
- [ ] 全量门禁：Vitest（309+新增）全绿；Playwright（30+9）全绿；`tsc`/`eslint`/`vite build` 全绿；SPEC-EDIT-EXIT/CBTP/FT/DSF 行为零变化
- [ ] 文档回写完成（spec §9、modules/04、editor-v2-architecture、SUMMARY、TDD 证据报告）

---

> 本计划为 SPEC-EDIT-FT2 的实施基线，风险等级 **L3**，实施中偏差回到规范与本计划更新后执行（文档优先）。
