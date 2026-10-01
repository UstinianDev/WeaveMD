# 编辑主区 v2 实施记录 — 分册 1（13.1~13.6：M1~M4 内核与集成）

> 拆分自 [editor-v2-progress.md](../editor-v2-progress.md)，原 §13.1~§13.6；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[editor-v2-progress.md](../editor-v2-progress.md)

---

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

渲染层已按第 5 节实施（当时与 v1 并行，v1 已于 §13.13 退役）：

| 文件                                                        | 内容                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/render/editor/kernel/selection.ts`                            | 光标/选区 DOM 读写（偏移 ↔ 文本节点，排除零宽空格）                                        |
| `src/render/editor/editorInstance.ts`                       | EditorInstance 宿主：内容装载、行内缓存、基础输入/回车拆分/空块退格                        |
| `src/render/components/Editor/v2/EditorV2.tsx`              | v2 入口：树状态、事件路由、DOM 注册表、光标恢复、内容同步                                  |
| `src/render/components/Editor/v2/EditorScrollContainer.tsx` | 滚动视口（容器非 contentEditable）                                                         |
| `src/render/components/Editor/v2/BlockRenderer.tsx`         | 容器/叶子递归分发                                                                          |
| `src/render/components/Editor/v2/blocks/`                   | ContentBlock（唯一 contentEditable）、LeafBlock、CodeBlock、ListItemBlock、BlockquoteBlock |

**接入方式**：`EditorView` Normal Mode 直接渲染 v2 —— 当时的 `window.__EDITOR_V2__` 双路开关
已于 §13.13 随 v1 退役一并删除，**现无回退路径，v2 是唯一渲染路径**。

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
- v1 渲染路径与 `src/render/services/` 当时暂留待手工验收，**已在 §13.13 完成退役删除**。

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

**建议**：运行 `npm run dev` 在真实桌面环境做输入/IME/格式渲染手工验收。
（该建议的后半段「执行 v1 路径退役」已在 §13.13 于 2026-08-06 完成。）

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
