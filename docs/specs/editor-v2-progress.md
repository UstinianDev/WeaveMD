# 编辑主区 v2 — 实施记录

> 拆分自 [editor-v2-architecture.md](./editor-v2-architecture.md) §13
> 关联文档：[editor-v2-selection-undo.md](./editor-v2-selection-undo.md)（选区/集成/测试/风险）
> 实施分期见 [editor-v2-selection-undo.md §10](./editor-v2-selection-undo.md#10-实施分期)

---

## 13. 实现记录

### 13.1 M1 完成（2026-08-05）

内核纯函数层已按本规范实现并通过测试：

| 文件                                          | 内容                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/render/editor/kernel/types.ts`           | BlockTypeV2 / BlockNodeV2 / BlockTreeV2 / CursorV2 / SelectionV2 / BlockConversionV2 与分型判定 |
| `src/render/editor/kernel/blockTree.ts`       | 不可变块树操作集（链表 + 父子）、`splitLeaf / mergeLeafIntoPrev / detectBlockConversion`        |
| `src/render/editor/kernel/markdownToState.ts` | 块级解析器（围栏/表格/ATX/Setext/引用/列表嵌套/分割线/段落兜底）                                |
| `src/render/editor/kernel/stateToMarkdown.ts` | 逐行序列化器（标记归一化、围栏自动加长、Setext 保留、blockquote 前缀）                          |
| `src/render/editor/kernel/inlineRenderer.ts`  | 行内渲染（强调/代码/链接/图片/自动链接/转义），HTML 转义 + 链接协议白名单                       |

**M1 验证**：`tests/editor/kernel/` 3 个文件 71 例（树操作 15 / 往返 41 / 行内 15）；
全量 `vitest run` 260 例通过；`tsc --noEmit` 无错误。

**实施中记录的偏差（已回写本规范）**：

- 往返不变量细化为"规范化往返"（见 4.2 归一化清单）。
- `table` 首版为叶子块而非容器块（3.2 已更新）。
- 任务列表在 M1 表达为 `bullet-list > list-item(taskChecked)`，`task-list` 容器类型保留备用。

### 13.2 M2 渲染骨架完成（2026-08-06）

渲染层已按第 5 节实施，与 v1 并行、可回退：

| 文件                                                        | 内容                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/render/editor/selection.ts`                            | 光标/选区 DOM 读写（偏移 ↔ 文本节点，排除零宽空格）                                        |
| `src/render/editor/editorInstance.ts`                       | EditorInstance 宿主：内容装载、行内缓存、基础输入/回车拆分/空块退格                        |
| `src/render/components/Editor/v2/EditorV2.tsx`              | v2 入口：树状态、事件路由、DOM 注册表、光标恢复、内容同步                                  |
| `src/render/components/Editor/v2/EditorScrollContainer.tsx` | 滚动视口（容器非 contentEditable）                                                         |
| `src/render/components/Editor/v2/BlockRenderer.tsx`         | 容器/叶子递归分发                                                                          |
| `src/render/components/Editor/v2/blocks/`                   | ContentBlock（唯一 contentEditable）、LeafBlock、CodeBlock、ListItemBlock、BlockquoteBlock |

**接入方式**：`EditorView` Normal Mode 按 `window.__EDITOR_V2__ !== false` 渲染 v2，
设为 `false` 刷新即回退 v1（M4 验收后删除 v1 路径）。v1 文件未改动。

**M2 能力边界**：基础文本输入（行内实时渲染 + 光标恢复）、Enter 拆块（heading 右半转段落）、
空块 Backspace 合并/删除、列表/引用/代码块渲染。结构块退出规则、格式化、快捷键等交互在 M3 扩展。

**M2 验证**：新增测试 12 例（EditorInstance 8 / EditorV2 渲染 4）；
全量 `vitest run` 272 例通过；`tsc --noEmit` 无错误；`vite build` 成功。

### 13.3 M3 交互控制器完成（2026-08-06）

按第 6 节实施全部控制器，交互行为对齐 marktext：

| 控制器                         | 内容                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `controllers/inputCtrl.ts`     | autoPair（`(` `[` `{` `` ` `` `'` `"` 自动补全、光标居中）、文本更新、前缀即时转换触发      |
| `controllers/convertCtrl.ts`   | 升格（paragraph → heading/list/blockquote/code-block/thematic-break）与降格（六条退出规则） |
| `controllers/enterCtrl.ts`     | 代码块换行、列表续行新列表项、空列表项回车退出、标题右半转段落、引用内拆分                  |
| `controllers/backspaceCtrl.ts` | 光标在内容起点即触发：标题转正文、列表项退出、引用降级、空代码块移除、段落合并前块          |
| `controllers/clickCtrl.ts`     | 任务复选框切换（v1 缺失的"可打勾"交互）                                                     |
| `controllers/listCtrl.ts`      | Tab 缩进为前项子列表、Shift+Tab 凸出（嵌套列表空后自动移除）                                |
| `controllers/formatCtrl.ts`    | 文本层格式化（bold/italic/strike/highlight/code/link），取代 execCommand                    |

**接入**：`ContentBlock` 键盘事件（Enter/Backspace/Tab/Shift+Tab/Ctrl+B/I/E/Shift+S/Shift+H）
路由到对应控制器；`EditorV2` 统一执行"操作 → 更新树 → 恢复光标 → 同步内容"。

**实施中修复的内核问题**：`markdownToState` 的 Builder 此前未维护 `prevId/nextId`
兄弟链，导致跨块查找（Tab 缩进、合并前块）失效——已修复并补链；
`insertBlockBefore` 增加节点 detach 处理。

**M3 验证**：新增控制器测试 24 例（含六条退出规则矩阵）；
全量 `vitest run` 291 例通过；`tsc --noEmit` 与 ESLint 无告警；`vite build` 成功。

### 13.4 M4 系统集成完成（2026-08-06）

按第 8、9 节完成系统集成：

| 集成项          | 实现                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 撤销/重做       | 经 `editorStore` content 快照栈（v2 每次编辑序列化同步，天然与 v1 undo 栈兼容）；ContentBlock 拦截 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 并调 store，TopBar 按钮同样生效 |
| 大纲导航        | 新增 `kernel/outline.ts`（`extractHeadingOutline`：DFS 标题 + 序列化行号）；`onNavigateReady` 按 lineNumber/headingIndex → `scrollToBlock`                        |
| 滚动高亮        | EditorScrollContainer 滚动事件 + 视口顶部 +10px 检测 → `onActiveHeadingChange`（与 v1 规则一致）                                                                  |
| 代码块语言/复制 | v2 CodeBlock 语言下拉（别名归一化）+ 复制按钮；`onFenceLanguageChange` 更新 meta                                                                                  |
| 链接打开        | Ctrl/Cmd+Click `a.inline-link` → `window.weaveMD.link.openExternal`（IPC 白名单）                                                                                 |
| 空块占位        | ContentBlock 空文本挂 `data-empty="true"`，复用现有 `::before` 占位符 CSS                                                                                         |
| Find & Replace  | 复用现有 FindReplaceBar（content 文本层），替换 → updateContent → v2 重建树                                                                                       |

**已知限制（记录，后续任务）**：

- v2 Normal 模式暂无查找高亮（替换功能正常；Source 模式高亮由 Monaco 提供）。
- 撤销/重做后光标回到重建树首块（块 ID 重建，位置保持待优化）。
- 段落级 MD Source 视图（v1 `mdSourceBlockId`）未迁移到 v2。
- 跨块鼠标拖选受浏览器编辑宿主边界限制（独立 contentEditable span 无法拖拽跨选；
  退格链已可用，Ctrl+A 可全选；跨块选区层为独立任务）。
- v1 渲染路径与 `src/render/services/` 保留（`window.__EDITOR_V2__ === false` 可回退）；
  v1 退役删除建议作为独立任务，先做手工验收。

**M4 验证**：新增测试 5 例（outline 3 / EditorV2 集成 2）；
全量 `vitest run` 296 例通过；`tsc --noEmit` 与 ESLint 零告警；`vite build` 成功。

**验收清单（REQUIREMENTS EDIT-01~12 对照）**：

| 需求                         | 状态                                                   |
| ---------------------------- | ------------------------------------------------------ |
| EDIT-01 双模式编辑           | ✅ Normal（v2）/ Source（Monaco）                      |
| EDIT-02 块内 contentEditable | ✅ 仅内容块可编辑                                      |
| EDIT-03 Block Tree 数据模型  | ✅ v2 块树（不可变 + 嵌套）                            |
| EDIT-04 实时格式化渲染       | ✅ formatCtrl + inlineRenderer                         |
| EDIT-05 MD Source 切换       | ⚠️ 工具栏入口未迁移（快捷键与源码模式可用）            |
| EDIT-06 段落操作             | ✅ Enter/Backspace 完整规则                            |
| EDIT-07 撤销/重做            | ✅ Ctrl+Z/Y + 按钮                                     |
| EDIT-08 自动保存             | ✅ 1200ms + 切换前 flush                               |
| EDIT-09 代码块               | ✅ 语言下拉 + 复制 + 独立编辑路径                      |
| EDIT-10 空块占位             | ✅ data-empty + CSS ::before                           |
| EDIT-11 结构转换             | ✅ 六种前缀即时转换 + 退出规则                         |
| EDIT-12 超链接               | ✅ Ctrl+Click 外部打开 + 链接对话框（formatCtrl link） |

### 13.5 真实运行缺陷修复（2026-08-06）

用户实测反馈"编辑主区无法输入、markdown 无法实时渲染为富文本"。经排查定位到三个
真实运行缺陷并修复（对齐 marktext 行为）：

| #   | 根因                                                                                                                           | 修复                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 空文档渲染为不可编辑的占位 div（无 contentEditable、无输入处理），新建文件后无法输入                                           | `EditorInstance` 保证文档始终至少一个空 paragraph（marktext scrollPage 语义）；`getMarkdown` 对唯一空段落返回 `''`，保持往返                                        |
| R2  | 每次输入都触发 React 重渲染 + `dangerouslySetInnerHTML` 重写 DOM，打断浏览器编辑状态与 IME                                     | `inputCtrl` 引入 marktext `checkNeedRender` 思路：仅当 autoPair 补全或文本含格式语法标记（`hasFormatSyntax`）时才重渲染；纯文本输入仅同步模型（DOM 已由浏览器更新） |
| R3  | 无 IME 守卫，中文输入（composition）期间每次拼音都重渲染打断组合                                                               | ContentBlock 监听 compositionstart/end，组合期间跳过 input，结束后统一同步                                                                                          |
| R4  | 行内渲染隐藏语法标记（`**bold**` → `<strong>bold</strong>`），DOM textContent 与源文本不一致，在已渲染格式中继续输入会丢失标记 | inlineRenderer 按 marktext 范式保留语法标记：`<span class="md-syntax">**</span>` 灰显包裹，DOM textContent 与源文本始终一致；新增 `.md-syntax` 样式（灰显、不可选） |

**验证**：新增 `tests/components/EditorV2Input.test.tsx` 7 例（空文档输入、逐字符连续输入、
IME 组合、前缀转换、实时加粗渲染、列表转换、标记保留）；
全量 `vitest run` 304 例通过；`tsc --noEmit` 与 ESLint 零告警；`vite build` 成功。

**建议**：运行 `npm run dev` 在真实桌面环境做输入/IME/格式渲染手工验收；
确认无回归后执行 v1 路径退役（独立任务）。

### 13.6 真实 Chromium E2E 验证与最终修复（2026-08-06）

为确认真实浏览器行为（jsdom 无法覆盖 contentEditable/IME/布局语义），引入
Playwright + 真实 Chromium E2E（`e2e/editor.spec.ts`，renderer-only vite 配置
`vite.test.config.ts`，mock Electron API 直达编辑主区）。验证中发现并修复：

| #     | 问题                                                                                  | 修复                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E-1 | 空内容块 span 宽度为 0（仅零宽空格），Playwright 判定不可见；真实浏览器中点击命中困难 | `.block-content { display:inline-block; width:100%; min-height:1.2em; cursor:text }`                                                                        |
| E2E-2 | 块转换替换 DOM 后焦点丢失（旧节点卸载、新节点未注册），后续按键丢失                   | `registerDom` 改 `useLayoutEffect` 同步注册；`inputCtrl` 返回转换后 `focusBlockId`，EditorV2 统一恢复焦点；恢复 effect 改 `useLayoutEffect`（paint 前同步） |

**E2E 覆盖**（6 例全部通过）：

1. 空文档可输入文本
2. `# 标题` 即时渲染为 h1（转换后继续输入内容）
3. `**bold**` 实时渲染为 strong（DOM 保留 `**` 标记）
4. 渲染后继续输入保留 markdown 标记
5. `- item` 即时转换列表
6. 中文输入正常（IME）

**最终验证**：`vitest run` 304 例通过；`tsc --noEmit` 与 ESLint 零告警；
`vite build` 成功；Playwright Chromium E2E 6/6 通过。

**运行 E2E**：`npx playwright test`（自动启动 renderer-only vite server，需要已安装
`@playwright/test` 与 chromium）。

### 13.7 语法渲染对齐 marktext（2026-08-06）

用户对照 marktext 与 WeaveMD 截图，要求块语法渲染形式对齐 marktext 默认主题，且
渲染后的语法符号不可鼠标选中；代码块格式保持不变。经确认仅做**样式层 + 组件微调**
（不改 v2 块树 / 序列化 / 输入链路）：

| 语法          | 对齐方案                                                                                                   | 实现                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| n 级标题提示  | 光标在标题内时左侧显示灰色 `#`×n，失焦塌陷隐藏（对应 muya `MU_GRAY` / `MU_HIDE`）                          | `LeafBlock` 标题加 `data-level`；CSS `h1~h6.heading-block::before` + `:focus-within` 显隐（`font-size:0` 塌陷；伪元素不进入 textContent，不影响序列化/光标偏移，天然不可选中） |
| 无序/有序列表 | marker 深灰色（`--text-sub`，对照截图确认 marktext 为深灰而非浅灰）                                        | `.list-marker { color: var(--text-sub) }`（替代组件内 Tailwind 色值）                                                                                                          |
| 任务复选框    | 18×18 空心圆（深灰 2px 边框），勾选态 accent 背景 + 白色 ✓（对照截图确认 marktext 为圆形）                 | `ListItemBlock` 勾选时加 `task-checkbox--checked` 类；CSS `border-radius: 50%` + `::after` 绘制 ✓；保持 `user-select:none` + `contentEditable={false}`                         |
| 引用          | 3px 绿色竖线（`--quote-bar-color: #42d392`，可按主题覆盖）；文字非斜体（对照截图确认 marktext 引用非斜体） | `BlockquoteBlock` 移除 Tailwind 边框类与 `italic`；CSS `.blockquote-block { border-left: 3px solid var(--quote-bar-color) }`                                                   |
| 代码块        | 格式不变                                                                                                   | `CodeBlock.tsx` 未改动                                                                                                                                                         |

**关键发现/修复**：全局规则 `.editor-content-area [data-block-id] { border: none !important }`
会清除所有块边框（旧 `border-l-4` 引用边框实际从未显示）；改为
`[data-block-id]:not(blockquote)`，仅放行引用竖线，其余块（含代码块）保持原样。

**验证**：新增组件测试 1 例（标题 `data-level` 断言 + `- [x]` 复选框类断言）；
新增 E2E 1 例（标题 marker 聚焦显隐/颜色、复选框尺寸与 accent 背景、引用 3px 绿色竖线、
列表 marker 灰色与 `user-select:none`，真实 Chromium 计算样式断言）。
全量 `vitest run` 305 例通过；`tsc --noEmit` 与 ESLint（0 error，1 个既有 warning）通过；
`vite build` 成功；Playwright Chromium E2E 7/7 通过。

### 13.8 渲染缺陷修复：列表类名冲突 / 标题 marker 换行 / 空标题不可点击（2026-08-06）

用户截图反馈三个问题，逐一定位并修复（均通过真实 Chromium 测量验证）：

| #   | 问题                                                        | 根因                                                                                                                                                                                    | 修复                                                                                                                                                          |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 有序→任务列表区：语法符号与内容不并排，且符号后出现加粗圆点 | v2 列表项类名 `list-item` 与 Tailwind 工具类 `list-item`（`display: list-item`）冲突，覆盖了 `flex`；`display:list-item` 自带原生 marker 小圆点，子元素（marker span / 内容）被垂直堆叠 | 类名改为 `list-item-block`（globals.css 已有该自定义类）；测试与 E2E 选择器同步更新                                                                           |
| 2   | 删除二级标题全部内容后，点击空行无法选中                    | 标题聚焦后 `#` 提示伪元素占据左侧区域（`pointer-events:none`），点击该区域落到 h2 容器（非 contentEditable）导致失焦                                                                    | `LeafBlock` 标题增加点击处理：点击容器任意处（`e.target === currentTarget`）聚焦内容 span 并放置光标（marker 左侧→开头，其余→末尾），对齐 marktext 整行可编辑 |
| 3   | n 级标题 marker（`#`×n）与内容分两行                        | `.block-content` 为 `display:inline-block; width:100%`，前插行内 `::before` 后总宽超 100%，内容 span 被挤到下一行                                                                       | 标题改为 `display:flex; align-items:baseline`；`.block-content` 在标题内 `flex:1 1 auto; width:auto`，marker 与内容始终同排                                   |

**附带修复**：通用空块占位符规则（`[data-empty='true']::before`）会覆盖标题的 `#` 提示
（更高优先级），改为 `:not(.heading-block)` 排除标题，空标题聚焦时仍显示级别提示。

**验证**：新增 `e2e/marktext-rendering.spec.ts` 3 例（标题 marker 并排 / 空标题点击聚焦 /
列表项 flex 与任务项无多余圆点）。全量 `vitest run` 305 例、`tsc --noEmit`、ESLint
（0 error）、`vite build` 均通过；Playwright Chromium E2E 10/10 通过。

### 13.9 列表退出与代码块退出修复（2026-08-06）

用户反馈两类问题并附截图，经真实 Chromium 复现定位并修复：

| #   | 问题                                                                                                          | 根因                                                                            | 修复                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 有序列表 `1. a` + Enter 生成空 `2.`，退格删除 `2.` 后光标仍停留在列表缩进内；再回车导致 `1.` 被删除而内容保留 | `exitListItem` 对非首空项走"合并到前项"分支，空段落被并入上一项，光标留在列表内 | `exitListItem` 增加"空项"分支：末尾空项 → 删除该项并在列表后补空段落，光标移到列表外左边缘（列表保留）；中间空项 → 仅移除该项，光标移到下一项开头。同时修复唯一空项分支的 stale 引用判断（`childrenIds.length === 1`） |
| 2a  | 逐字符输入 ` ```java ` 时第 3 个反引号即触发转换，语言为空、内容变成 `` `java ``，源码模式显示异常            | `FENCE_CONV_RE` 不要求尾随空格，围栏被提前消费；反引号 autoPair 干扰围栏输入    | 围栏即时转换要求尾随空格（与其他前缀一致）；新增 `detectFenceLine` 供 ` ```lang ` + Enter 提交；输入反引号围栏时跳过 autoPair                                                                                          |
| 2b  | 代码块内回车只能增加代码块内空行，无法退出继续输入其他内容；代码块下方无空行                                  | 转换仅替换段落，无尾随空段落；Enter 在 code-block 内恒插入换行                  | 代码块转换后若无后续块，自动在其后插入空段落；代码块内容为空时 Enter 撤销代码块并把光标移到下一内容块                                                                                                                  |

**验证**：新增控制器测试 4 例（围栏尾随空格转换 + 自动补空段落、` ```lang ` 回车提交、
空代码块回车退出、末尾空列表项退出列表），`vitest run` 309 例通过；新增
`e2e/exit-behavior.spec.ts` 4 例（列表退出 / `java 空格提交 / 空代码块回车退出 / `java 回车提交），
Playwright Chromium E2E 14/14 通过；`tsc --noEmit`、ESLint（0 error）、`vite build` 均通过。

### 13.10 引用退出补齐与代码块退格语义修订（2026-08-06）

用户反馈：引用存在与列表相同的问题（无法从空行退出）；代码块后的空行 Backspace 删不掉，
且空代码块 Backspace 会误删整个代码块。真实 Chromium 复现定位并修复：

| #   | 问题                                                | 根因                                                                                          | 修复                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 引用空行无法退出（与列表同源）                      | `enterCtrl` 缺少 blockquote 分支，空引用行回车走通用拆分，新空行仍在引用内                    | `enterCtrl` 新增引用分支：空行回车 → 退出引用（`convertBlockToParagraph`）；非空回车保持引用内拆分。`exitBlockquote` 对末尾空行改为把空段落移到**引用之后**（对齐列表末尾空项行为）                                                                  |
| 2a  | 空代码块 Backspace 一键删除（用户澄清需求）         | 上一版误改为"保留代码块"                                                                      | 恢复 `removeCodeBlock`：空代码块 Backspace 一键删除（光标前块末尾 → 无前块则下一块开头 → 唯一块转空段落）；**Enter 仍为退出**（保留代码块，光标移到下一块）；`mergeParagraph` 增加保护：前块为代码块时禁止文本合并（空段落直接移除，非空段落不处理） |
| 2b  | 代码块后空段落 Backspace 行为（用户澄清：需受保护） | 误实现为"可删除/并入代码块"                                                                   | `mergeParagraph` 对前块为代码块的段落**整体保护**：Backspace 不删除、不并入（对齐 v1 `protectedAfterCodeFence` 语义）；删除代码块本身后，该空行恢复为普通段落可正常合并                                                                              |
| 2c  | 树未变化时焦点恢复失效                              | `applyAction` 中 `setTree` 传入同一引用 → React 跳过重渲染 → `useLayoutEffect` 焦点恢复不执行 | `applyAction` 检测 `instance.tree === prevTree` 时立即恢复焦点（`setCursorAtOffset`）                                                                                                                                                                |

**验证**：控制器测试覆盖空代码块退格删除、代码块后空段落受保护、删除代码块后空段落恢复
可删、引用空行回车退出、引用末尾空行退格移到引用后，`vitest run` 314 例通过；
`e2e/exit-behavior.spec.ts` 7 例（空代码块退格一键删除、代码块后空行 Backspace 受保护
且删除代码块后可删、引用空行回车退出），
Playwright Chromium E2E 17/17 通过；`tsc --noEmit`、
ESLint（0 error）、`vite build` 均通过。

### 13.11 退格链修复与 v2 浮动工具栏（2026-08-06）

**退格链修复**（真实 Chromium 复现定位）：

| 问题                                           | 根因                                                                                                                    | 修复                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 空标题降级为段落后焦点丢失，后续退格无效       | `convertBlockToParagraph` 的 heading/quote 分支用旧块 id 作为焦点目标，而 `replaceBlock` 已把旧 id 移除（注册表查不到） | 焦点改用 `paragraph.id`（新块 id）                                     |
| 列表项降级后光标落在内容末尾而非开头           | `exitListItem` 统一按 `text.length` 计算焦点偏移                                                                        | 提升类分支（唯一项/首项）焦点偏移为 0，对齐 SPEC"光标保持在开头"       |
| 段落前是列表项时退格无反应（无法跳回上一行）   | `mergeParagraph` 要求同父才合并，跨列表边界被跳过                                                                       | 允许跨容器合并到前一个内容块（列表项/引用内容），实现"退格跳回上一行"  |
| `setCursorAtOffset(span, 0)` 光标落在 offset 1 | 循环条件 `charCount >= 0` 在第一个字符后即触发                                                                          | `remaining > 0 && charCount >= remaining`，offset 0 时光标位于文本起点 |

**v2 浮动工具栏**（marktext 风格，新增 `src/render/components/Editor/v2/FloatingToolbar.tsx`）：

- 触发规则与 marktext 一致：文本选区非折叠且位于编辑器内容块内时，出现在选区上方居中；
  收起/滚动/移出编辑器即隐藏（带延迟，允许点击工具栏）。
- 最左侧为**块类型下拉**：正文 / H1-H6（显示当前块类型；转换仅作用于根级 paragraph/heading，
  经 `convertParagraphToBlock` / `convertBlockToParagraph` / `updateMeta` 实现）。
- 其余为行内格式按钮：加粗 / 斜体 / 删除线 / 行内代码 / 链接（prompt URL）/ 高亮，
  复用 `formatCtrl.formatRange`，`onFormat` 增加可选 `url` 参数。
- 选区偏移用 `getCursorOffsets` 取自锚点内容 span；按钮 `onMouseDown` preventDefault 保持选区。

**验证**：`vitest run` 315 例通过（新增列表跨边界合并等）；`e2e/floating-toolbar.spec.ts` 3 例
（选区触发加粗 / 正文→H2 / 级别切换与转回正文）、`e2e/exit-behavior.spec.ts` 扩充至 9 例
（新增列表退格链、标题删除链），Playwright Chromium E2E 22/22 通过；`tsc --noEmit`、
ESLint（0 error，1 个既有 warning）、`vite build` 均通过。

### 13.12 编辑主区技术债清理（2026-08-06）

按代码审查清单（重复/长函数/命名/嵌套/公共逻辑）实施，行为不变（全量门禁通过）：

- **正则单一来源**：六种块前缀正则收进 `kernel/markdownSyntax.ts`（task/ul/ol/bq/fence），
  `blockTree.detectBlockConversion` 直接复用（捕获组统一为富结构），
  `markdownToState` 经 `indented()` 派生解析变体；消除三处漂移。
- **渲染助手**：内核新增 `renderBlock(tree, id, text?)`，统一 11 处
  `setInlineHtml + renderBlockHtml/renderInline` 模式。
- **焦点助手**：内核新增 `adjacentLeafFocus(tree, id, prefer)`，供
  `enterCtrl.moveCaretOutOfEmptyCodeBlock` 与 `backspaceCtrl.removeCodeBlock` 共用。
- **长函数拆分**：`convertParagraphToBlock` 93→64 行（抽出 `buildList`/`buildBlockquote`/
  `ensureTrailingParagraph`）；`exitListItem` 90→~70 行（抽出 `liftChildrenBefore`/
  `createEmptyParagraphAfter`/`exitEmptyListItem`）。
- **命名**：`exitListItem`/`exitBlockquote` 参数 `content` → `leaf`；
  `exitEmptyCodeBlock` → `moveCaretOutOfEmptyCodeBlock`。
- **EditorV2**：抽取 `applyMetaUpdate`（消除 `updateMeta + setTree + syncContent` 重复）。

**验证**：`vitest run` 315 例、Playwright E2E 22/22、`tsc --noEmit`、ESLint（0 error）、
`vite build` 全部通过。

### 13.13 v1 回退退役与跨块鼠标拖选（2026-08-06）

**v1 回退退役**：v2 成为唯一路径，删除 `__EDITOR_V2__` 开关及相关代码：

- 删除 v1 渲染组件（EditorScrollContainer 558 行、FloatingToolbarWYSIWYG 578 行、
  FloatingToolbar 426 行、blocks/、BlockRenderer、Minimap 死代码）与 v1 服务
  （blockTree/blockTreeBuilder/blockTreeSerializer/lineMarkdown/markdownBlockDetector）
  及对应测试；uiStore 移除 v1 块状态机。
- EditorView 由 1920 行重写为薄编排器（约 250 行）：保留 Monaco 主题、Source 模式、
  快捷键、查找替换、大纲导航；Normal 模式导航由 EditorV2 自行注册。

**跨块鼠标拖选**：

- 拖选：mousedown 记录锚点（caretRangeFromPoint），跨入不同 `.block-content` span 时用
  Range API 扩展选区，mouseup 延迟重放（浏览器原生拖选被编辑宿主边界截断并覆盖）。
- 删除：Backspace/Delete 检测跨块选区（`getCrossBlockSelection`）→ 内核
  `deleteLeafRange`（保留前后块区间文本、整块删除中间叶子、清理空容器）。
- 修复按需渲染下的 DOM 陈旧问题：React 状态可能陈旧 + memo 跳过重渲染时，
  `dangerouslySetInnerHTML` 虚拟去重会漏更新，删除后按模型强制同步受影响块 DOM。

**验证**：`vitest run` 226 例（新增 deleteLeafRange 4 例）、新增
`e2e/cross-block-selection.spec.ts`（拖选跨块 + Backspace 删除）、
Playwright Chromium E2E 23/23；`tsc --noEmit`、ESLint（0 error，0 warning）、
`vite build` 全部通过。

### 13.14 行内格式化增强（SPEC-EDIT-FT2，2026-08-08）

**内核**：

- 新增 `kernel/inlineLexer.ts`：`InlineToken` 结构化识别（strong/em/underline/strike/mark/
  code/link/image/autolink/escape/math），`inlineRenderer.renderFragment` 改消费 lexer
  （输出逐字节不变，存量金标准测试守护）；`isBoundedWrap` 供 activeTest 与 toggle-off 共享。
- 新增 `kernel/katex.ts`（`renderMath`，KaTeX + `.math-inline` 包装，失败回退字面量）、
  `kernel/inlineStrip.ts`（`stripSameStylePairs`/`stripInlineSyntax`）。
- `formatCtrl`：`InlineFormatStyle` 扩至 9 种；`formatRange` 双形态 toggle（形态 A 选区外
  标记、形态 B 全选包裹区），永不产生 `****`；新增 `clearFormat`；image 走 `![alt](url)`。
- `$` 入 `ESCAPABLE_CHARS`；math 打开/闭合判定严格化。

**组件/CSS**：

- FloatingToolbar 分组：字符格式（B/I/U/S/</>/H）→ 对象插入（🔗/🖼/∑）→ 橡皮擦（⌫）；
  activeTest 用 `isBoundedWrap`；image/link 弹 prompt；橡皮擦 `onClearFormat`。
- `types.ts`/`ContentBlock`/`EditorV2`：`onFormat` 补 `url?`、新增 `onClearFormat`、
  Ctrl+U / Ctrl+Shift+M 快捷键。
- globals.css：`.md-syntax` 方案 B（默认隐藏、聚焦灰显）、mark 黄色主题变量（5 主题块）、
  工具栏尺寸类（`.floating-toolbar-v2`/`.ft-btn`/`.block-type-*`/`.ft-divider`）、
  `.inline-image`/`.math-inline`。

**验证**：`vitest run` 392 例（新增 inlineLexer/katex/inlineStrip/formatCtrl toggle+
clearFormat/ft2Css/EditorV2Format 等）、Playwright E2E 38/38（含 FT2 新增 8 例）、
`tsc --noEmit`、ESLint（0 error）、`vite build` 全部通过。

### 13.15 图片选中框 + 四角缩放 + 宽度模型（SPEC-EDIT-IMG-W, 2026-08-12）

图片块（image-block）新增**宽度维度**与**可视化缩放交互**，点击图片显示四角缩放手柄，
拖拽实时缩放并提交（独立图持久化到块文本；行内图写会话运行时 map）。不改变
`stateToMarkdown` 序列化（往返不变量保持）。

#### 13.15.1 文本层宽度模型（`kernel/imageBlock.ts`）

`parseImageBlockText` 的返回结构新增 `width` 字段，解析独立图文本中可选的
`style="width:Npx"`（对齐包裹 `<div align="X" style="width:Npx">`）。配套纯函数：

- `wrapImageWidth(text, width|null)`：写入/清除宽度。width 已存在 wrapper → 更新 open tag
  的 style 段内 `width` 值（保留其余属性）；裸图 → 产出 `<div align="left" style="width:Npx">`；
  width null → 剥 style 回到裸 align wrapper（保留 align）。非独立图 / 非法值 → null。
- `wrapImageAlign` 保留 style width（换向不丢 width）。
- **往返不变量**：宽度写进 `block.text` 后经 `stateToMarkdown` 逐字序列化，重载后
  `markdownToState` 重新解析出同一 `width`（`<div align>` 包裹兼容宽度属性）。

#### 13.15.2 独立图宽度提交（`controllers/imageWidthCtrl.ts setImageWidth`）

独立成块图片的宽度持久化到文本：`wrapImageWidth` 重写 `block.text`，段落独立图自动转
image-block，focus 于文本末尾。经 `stateToMarkdown` 同步到磁盘内容。

#### 13.15.3 行内图运行时宽度（会话 map + `applyRuntimeWidths`）

行内（非独立）图片无 `block.text` 内嵌宽度位，改为**会话级运行时 map**
（`BlockWidthMap`：`blockId → { [data-start]:[data-end] → px }`）注入渲染：

- `kernel/inlineRenderer.ts`：`applyRuntimeWidths(html, widthMap)` 按 `data-start/data-end`
  命中 map 的 `<img>` 追加 `style="width:Npx"`（img 已带 style 则合并覆盖 width）；
  注入核心抽为 `applyImgWidth(html, width)`，**独立图渲染 `renderImageBlock` 复用同一注入**
  ——宽度一律落点在 `<img>` 自身（R3，2026-08-13），wrapper div 仅负责对齐。
- EditorV2 持有 `blockWidthMap`（仅会话生效，重载/重建块自然清理，无泄漏）；
  点击选中读 `mapWidth ?? parsed?.width` 作为缩放起点。

#### 13.15.4 选中框与缩放手柄（`components/Editor/v2/ImageResizeBox.tsx` + `resizeMath.ts`）

- 点击独立图或行内图 → 显示 `.image-resize-box`（fixed 覆盖层，`z-[90]` 低于工具栏
  `z-[100]`，`pointer-events:none`，1.5px accent 外轮廓）+ 4 个角手柄
  （`.image-resize-handle`，`data-handle=nw/ne/sw/se`，`pointer-events:auto`，cursor 对角）。
- **手柄角对齐**：手柄定位 `off = -6`，四个角统一用负偏移（west/north `left/top:-6`，
  east/south `right/bottom:-6`）使手柄中心精确落在图片角上。旧实现 east/south 用了正
  `right/bottom`（内缩一个手柄宽 ~9.5px，仅 NW 近似对齐）+ 未补偿 1.5px 边框——已修复
  （E2E 断言四角偏差 ≤1.5px）。
- **拖拽生命周期**（`ImageResizeBox`）：mousedown 手柄记录起始宽与角 → document mousemove
  实时改 `<img style.width>` **并同步直改选中框 DOM**（`boxRef`，`left/top/width/height`
  一次 `getBoundingClientRect` 读取）——**全程不触发 React setState/重渲染**，快速拖拽
  选中框与图片零滞后（height auto 保宽高比）→ mouseup 提交并把 state 同步到最终盒。
- **宽度算术**（`resizeMath.computeResizeWidth(startWidth, dx, dy, corner, min, max)`）：
  横向 east+1 / west-1、纵向 south+1 / north-1，**增量 = 指针位移长度 `√(dx²+dy²)`**
  （方向取主轴向符号）——斜向按对角距离顺滑增长、纯横/纵行为不变，无主轴向切换跳变
  （R1，2026-08-13；旧版取 `max(|dx|,|dy|)`，拖 `(100,50)` 与 `(100,100)` 增量相同，斜向"迟钝"）；
  钳制 `[32px, 容器内容宽]`，非有限输入回落 min。
- **提交/重渲染后重锚定**（R2，2026-08-13）：`ImageResizeBox` 新增 `useLayoutEffect`
  （每次渲染完成、非拖拽期）重查 img 最新 rect，直改 `boxRef` DOM + 变化守卫 `setRect`，
  兜住提交（`setTree`/`setBlockWidthMap`）重渲染后 img 尺寸/位置变化——修复"框比图小/
  框停在旧位置"；滚动重锚定（对齐 ImageToolbar Bug-B 模式）保留。
- **提交分流**：standalone → `onResizeStandalone`（`setImageWidth` 持久化文本）；
  inline → `onResizeInline`（写会话 map 触发重渲染注入）。

#### 13.15.5 工具栏捕获守卫

`FloatingToolbar` 的 document capture mousedown 对 `.image-resize-box` 目标直接放行
（`handleMouseDown` 首段返回），缩放手柄拖拽不被工具栏"点击外部关闭"逻辑中断。

**验证**：`ImageResizeBox` 组件测试（拖拽期同步直改 DOM + R2 提交后重锚定断言）+
`resizeMath` 纯函数单测（欧氏距离对角/钳制/角方向/取整/防御）+ `renderBlockHtml`
宽度注入测试 + E2E `R1·E7` 手柄四角对齐回归、`R1·E8` 对角拖拽按对角距离放大、
`R1·E9` 居中/居右对齐（含带宽度图）、`R1·E10` 松手提交后框与图尺寸/位置一致
（小图放大不回弹）；全量 `vitest run` / Playwright E2E（真实 Chromium）门禁通过。
