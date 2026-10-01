# 浮动工具栏体验优化与行内格式化增强 — 实施记录（§9）

> 拆分自 [floating-toolbar-ux-and-inline-format.md](../floating-toolbar-ux-and-inline-format.md)，原 §9 实施记录（阶段 0~4、已知限制、R4/R5 修复）；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[floating-toolbar-ux-and-inline-format.md](../floating-toolbar-ux-and-inline-format.md)

---

## 9. 实施记录

> 按里程碑回写（对照 SPEC-EDITOR-V2 13.x 的格式）。实施证据见
> [docs/testing/spec-edit-ft2.tdd.md](../../../testing/spec-edit-ft2.tdd.md)。

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
  [SPEC-EDIT-FT3](../floating-toolbar-format-sticky/01-implementation-record.md) §9.7/§9.8/§9.9。跨风格叠加（加粗再斜体
  生成三连 `***`，lexer 解析 em 内嵌 strong 渲染、解除逐层剥离）已支持，C12。）
- 隐藏标记编辑依赖聚焦灰显边界 + 橡皮擦显式清除（无「标记全隐藏」失焦风险）。
- 列表间互转（bullet→task 等）与 heading→列表/引用/代码块转换：下拉置灰，列为后续任务。
- KaTeX 体积与首屏：仅含 `$` 的块触发 `renderToString`；动态拆包列为后续优化。
- display math（`$$...$$` 块级）与图片粘贴上传在本次范围外。

### 9.6 链接场景工具栏左置（R4）+ 插入链接回车修复（R5）（2026-08-12）

#### 9.6.1 R4：链接命中时工具栏定位到链接正左方

当选区（含折叠光标）命中链接 token（`selection.inLink`）时，工具栏不再「上方居中」，
而是定位到**目标链接内容盒正左方**（贴近 8px，垂直居中于链接盒），避免遮挡待编辑的链接文本。

- **纯函数参数**：`toolbarState.computeToolbarState` 新增可选第 6 参 `linkRect`（`{top,left,width,height}`）。
  选定 `useLinkRect = inLink && linkRect !== null` 时，`left` 按
  `clamp(linkRect.left - toolbarWidth - 8, …)`、`top` 按
  `clamp(linkRect.top + height/2 - toolbarHeight/2, …)` 计算（viewport 内钳制）。
  `inLink` 为假或缺省 `linkRect` 沿用原「上方居中」算法（非链接场景零回归）。
- **DOM 查询**：FloatingToolbar `flushSelection` 经 `getLinkRect(sel, container)` 从选区
  startContainer 上溯 `closest('a.inline-link')` 取 `getBoundingClientRect()`；找不到（非链接/
  不在编辑器内）→ null。折叠光标命中链接与覆盖链接文本的选区统一走该路径。
- **滚动重锚定（仅链接命中）**：`linkSelectedRef` 标记当前显式工具栏为链接命中；滚动时
  仅链接命中场景重查链接 rect 并 `recompute`（不隐藏，工具栏跟随链接），非链接场景沿用
  既有「滚动隐藏」规则。
- **折叠光标在链接内不再显示工具栏**（2026-08-13 修复）：点击链接内容不再弹出
  「块类型 | 解链」（原「解链-only」形态已移除）。解链改由**选中链接文本**后经
  非折叠工具栏的「移除链接」完成。
- 非折叠选区命中链接时：完整工具栏左置 + 「移除链接」按钮。
- **代码块内行内格式禁用**（2026-08-13 修复）：代码块为 raw 纯文本，行内格式不渲染，
  工具栏字符/对象格式按钮（加粗/链接/图片/橡皮擦等）在 `code-block` 内全部禁用；
  `formatCtrl.formatRange` / `insertImageFromSelection` 对代码块直接返回 null 兜底。
- **链接内回车不损坏链接**（2026-08-13 修复）：`enterCtrl` 拆块时若折叠光标严格落在
  link token 内（`token.start < offset < token.end`），把拆点吸附到 token 末尾，
  保证 `[label](url)` 不被拆成两半（`splitAndFocusNewLeaf` 与 `enterInListItem` 共用
  `snapSplitOffset`）。

#### 9.6.2 R5：InsertUrlModal 输入框回车直接确认

`InsertUrlModal` 输入框 `onKeyDown` 对 Enter 改为
`e.preventDefault(); e.stopPropagation(); handleConfirm();`。

**根因**：此前 Enter 走默认行为，输入框失焦触发浏览器的 `selectionchange`，可能在编辑器
恢复选区前把陈旧选区（回车提交前）写入 `FloatingToolbar` 状态（`latestSelectionRef`），
导致按下回车而未点「确定」时，已选中的待包裹文本被旧选区覆盖而**丢失**。阻断事件冒泡后，
`handleConfirm` 直接以最新选区调用 `onFormat`，修复该竞态。空 URL 分支不变
（`handleConfirm` 内部仍对空值提示"URL 不能为空"）。
