# WeaveMD — ④ 内置全量 markdown 语法欢迎文档（每次启动注入）实施规划

需求来源：`docs/requirements/editor-optimization-batch.req.md` 第 94-118 行（L 级任务）
规划日期：2026-08-16

---

## 1. 现状分析

### 1.1 当前启动空态链路
- `MainPage.tsx:160-177`：`currentFile ? <EditorView> : <空态提示>`。`currentFile` 初始为 null，且 `fileTreeStore` 无 persist、`looseFiles`/`folders` 初始为空数组。
- 文件树由 `FileTreePanel.tsx` 渲染：`folders.length === 0 && looseFiles.length === 0` 时显示 `sidebar.noFiles` 空文案（L193-198）。
- 用户进入「文件」模块的三条路径均需用户主动操作（`useNavbarActions`）：`handleOpenFile`、`handleOpenFolder`、`handleNewFile`。
- 因此首次进入（未打开任何文件/文件夹）时，左侧文件树为空 + 编辑区为 📝 空态，正是需求要「优先展示欢迎文档」的触发点。

### 1.2 欢迎注入机制的选择依据（已核对代码）
- `fileTreeStore.addFile`（L100-103）：加入 `looseFiles`，纯内存、无持久化。这正是「可独立删除、重启重建」的理想挂载点。
- `removeFile`（L105-109）与 `handleTrashFile`（L66-76）：删除仅移出 `looseFiles`，不碰磁盘；删当前文件则 `closeFile()` 回空态。删除欢迎项走这一既有链路即可。
- `editorStore.openFile`（L32-40）：直接以 `file.content` 作为编辑区内容，不读盘。欢迎文档可纯内存 `IFile` 注入编辑区。
- `editorStore.saveFile`（L54-105）：以 id 是否含 `/` 或 `\` 判定磁盘/DB 型。欢迎项 id 为 `welcome://` 特殊串则不含分隔符，保存会走 DB，需短路。

### 1.3 关键结论：欢迎项必须「只读注入、不落盘」
为避免「不污染用户真实文件」且「避免 save 走 DB」，欢迎文档设计为：
- 不可持久化：欢迎项只活在内存 store，不写 DB、不写磁盘。
- 编辑可弃：允许自由编辑（真实可编辑教程），但不通过 saveFile 持久化；切换/关闭时 dirty 不走保存。
- 重新进入可恢复：每次启动若判定「该注入」，再从打包资源重建。

---

## 2. 欢迎注入机制方案（含「可删除但重启再注入」的确切判定）

### 2.1 语义定义（「每次启动注入」）
- 注入触发：应用进入主界面（App phase 到 main、user 就绪）后，文件树（looseFiles + folders）为空时注入。
- 注入判定（唯一依据）：`looseFiles.length === 0 && folders.length === 0`（与 FileTreePanel 空态判定一致）。不依赖「是否存在欢迎项」「是否曾删除」——looseFiles/folders 均无持久化，每次启动天然全空。
- 删除后重启再次注入：删除欢迎项 → removeFile 移出 looseFile；若树内无其他内容 → 重启后树为空 → 再次注入。判定自然成立，无需记录删除状态。

### 2.2 注入执行位置
- 在 `MainPage.tsx` 新增 useEffect（user 就绪 + 文件树为空时）调用新增 `injectWelcomeDocument()`。
- 服务逻辑：
  1. 读 `useFileTreeStore.getState()`。
  2. 若树空：用 `import welcomeMd from '@render/assets/welcome.md?raw'` 构建 IFile（id `welcome://welcome.md`，name 欢迎文档.md，content welcomeMd）；`addFile({id,name,path:id,content:welcomeMd})`；若 currentFile 为 null 则 `openFile(welcomeFile)`。
  3. 一次性执行，不设 interval。

### 2.3 防反复注入
- 注入后 looseFiles 非空，useEffect 不再重复注入。
- 用户 closeFile 仅置空 currentFile，looseFiles 仍含欢迎项 → 树非空 → 不重复注入。
- 不要把 currentFile===null 单独作为触发，否则关闭编辑区会重复注入。判定唯一是「文件树为空」。

### 2.4 不污染真实文件/文件夹
- id 用 `welcome://` 前缀（与磁盘路径、DB UUID 天然区分），可识别、可独立删除。
- 不写 DB（不调 file.save 建行）、不写磁盘（不调 file.write）。
- saveFile 对欢迎项短路：isWelcomeFile 时 return true，短路放 saveFile 开头。
- name 固定「欢迎文档.md」，首段落注明用途。

### 2.5 与同类编辑器对比（L 级调研）
- Typora：首启加载真实 .md 示例（可编辑可保存、位于用户目录）。不采用——会写入用户工作目录，违反「不污染」。
- VS Code：Welcome 为隔离虚拟只读页，不写入用户工作区，可经命令重开。借鉴「隔离虚拟入口」+「可再次调出」两点。
- 结论：采用「VS Code 式隔离内存欢迎项 + Typora 式可编辑教程内容」的中和方案。

### 2.6 帮助菜单入口（可选增强，纳入本次变更）
- HelpMenu.tsx 设置下方新增「欢迎文档」：清除当前 tree 中欢迎项（若存在）→ 重新调用 injectWelcomeDocument()。
- 非必需，失控可拆 FSR（本规划列「可选、默认做」）。

---

## 3. welcome.md 内容大纲 —— 以编辑器实际支持语法为准

以下清单逐一对照内核源代码核对通过（markdownToState.ts / inlineLexer.ts / inlineRenderer.ts / imageBlock.ts / katex.ts / tableCodec.ts）。

### 3.1 块级语法（markdownToState.ts 判定）
1. 一级标题 `# 标题`（ATX_HEADING_RE L11）
2. 二级标题 `## 二级`（同上）
3. 三级标题 `### 三级`（支持 #1-6，展示 1/2/3）
4. Setext 标题 标题 + `===` / `---`（SETEXT_UNDERLINE_RE L36 + parseParagraph L504-522）
5. 段落 普通文本（parseParagraph）
6. 分割线 `---`（THEMATIC_BREAK_RE L14-15 + parseThematicBreak）
7. 无序列表 `- item`（UL_ITEM_RE L22）
8. 有序列表 `1. item`（OL_ITEM_RE L25，支持 `.` 与 `)`）
9. 任务列表 `- [ ] do` / `- [x] done`（TASK_ITEM_RE L18）
10. 嵌套列表 缩进 2 空格的子项（parseListItemContent L421-470）
11. 引用 `> text`（BLOCKQUOTE_RE L38）
12. 围栏代码块（带语言）三角反引号 + `js`（FENCE_OPEN_CORE_RE L31 + parseFence L300-328）
13. 表格 表头 + `---` 分隔 + 数据行（TABLE_SEPARATOR_RE L46 + parseTable L331-343）
14. 独立图片块 整行 `![alt](src)`（parseImageBlockText imageBlock L42-75）
15. 图片对齐 wrapper `<div align="center">图</div>`（wrapImageAlign imageBlock L95-104）
16. 代码块后保护空段（appendTrailingParagraphIfLast SPEC-EDIT-CBTP）

### 3.2 行内语法（inlineLexer.ts tokenizeInline / inlineRenderer.ts）
17. 加粗 `**bold**`（matchEmphasis → strong）
18. 斜体 `*italic*`（matchEmphasis → em）
19. 三连加粗+斜体 `***both***`（matchEmphasis canTriple L469-495）
20. 删除线 `~~strike~~`（matchPaired → del L323-341）
21. 高亮 `==highlight==`（matchPaired → mark）
22. 下划线 `<u>under</u>`（matchUnderline L261-277）
23. 行内代码 单反引号（matchCode L180-196）
24. 链接 `[text](url)` 带 title（matchLink → renderLink）
25. 自动链接 `<https://example.com>`（matchAutoLink L305-321）
26. 行内图片 `![alt](src)`（matchImage → inline-image）
27. 反斜杠转义 `\*raw\*`（matchEscape + ESCAPABLE_CHARS L59-77）
28. 行内数学 `$E=mc^2$`（matchMath L280-302 + renderMath katex.ts）
29. 图片缩放 `<div align="left" style="width:200px">` 内嵌图（wrapImageWidth / applyImgWidth inlineRenderer L209-221）

### 3.3 明确不展示的语法
- display 数学 `$$...$$`：matchMath 拒绝 `$` 后紧跟 `$`（L285），注释「display $$…$$ 列为后续任务」。只展示 `$...$`。
- 内联 HTML 块：仅 `<u>` 与图片 `<div align>` wrapper 白名单识别，其他 HTML 无法安全渲染。
- 脚注 `[^1]`：内核无脚注 token。
- 原生 HTML 表格：仅 markdown 管道表格受支持。
- 图片拖动缩放是 UI 交互（非语法）：用 `<div align style="width">` 语法串展示「静态缩放」能力。

### 3.4 welcome 图片内容落地
- 方案 A（推荐）：图片/图片缩放条目用「语法示例原文 + 文字说明」而非真实内嵌图（避免 media:// 路径换算与构建资源）；图片真机渲染由既有用例（media-protocol + Playwright image-resize）覆盖。
- 方案 B：打包 1 张内置示例图 + 运行时换算 media:// path。成本高。
- 决策：采用方案 A。真机可视化如需增强可在后续 FSR 补内置示例图。

---

## 4. 变更清单

### 4.1 变更文件

| 文件 | 变更 | 说明 |
|------|------|------|
| src/render/assets/welcome.md | 新增 | 欢迎/教程正文，经 ?raw 导入 |
| src/render/services/welcomeDocument.ts | 新增 | injectWelcomeDocument()、WELCOME_ID、isWelcomeFile(id) |
| src/render/pages/MainPage.tsx | 修改 | 新增 useEffect：user 就绪 + 文件树空时注入 |
| src/render/stores/editorStore.ts | 修改 | saveFile 对欢迎项短路 return true |
| src/render/components/Editor/panels/FileTreePanel.tsx | 修改 | handleFileClick 对欢迎项跳过 readDisk |
| src/render/components/Navbar/HelpMenu.tsx | 修改（可选） | 新增「欢迎文档」菜单项 |
| tests/render/services/welcomeDocument.test.ts | 新增 | 单测（RED→GREEN） |

### 4.2 欢迎项打开路径（消除磁盘读取依赖）
- handleFileClick 顶部短路：`isWelcomeFile(node.id)` 时 → 用 node.content 构造 IFile openFile 并返回，不执行 readDisk（path 为 welcome://，file.read 必失败）。
- 注入时 IFileNode.content 必须携带完整 welcome.md 正文（addFile 支持 content 字段 L21）。

### 4.3 数据不落盘约束复核
- 不经过 FILE_CREATE/FILE_SAVE → 不入 DB files 表。
- 不经过 FILE_WRITE → 不写磁盘。
- 不经过 reindexAfterSave（KB-06 只挂保存后）。
- 删除只在内存 removeFile。

---

## 5. 实施步骤（先写测试 RED → GREEN）

1. [RED] 写 tests/render/services/welcomeDocument.test.ts：
   - welcome.md 可解析、含 §3 关键语法标记（标题/强调/列表/引用/代码/表格/数学/删除线/高亮/下划线/图片缩放等）→ 防漂移。
   - 空树时注入：looseFiles 含 1 个 welcome:// 项 + editorStore.currentFile 已打开。
   - 非空树时注入不生效。
   - saveFile 对欢迎项短路返回 true 且未调用 file.save / file.write（mock 断言）。
   - isWelcomeFile 判定正确。
2. 新增 src/render/assets/welcome.md：按 §3 撰写，覆盖全部 29 项已支持语法。
3. 新增 src/render/services/welcomeDocument.ts：实现三要素。
4. 改 MainPage.tsx：挂 useEffect 注入。
5. 改 editorStore.ts：saveFile 短路。
6. 改 FileTreePanel.tsx：handleFileClick 短路。
7. [可选] 改 HelpMenu.tsx：加「欢迎文档」菜单项。
8. [GREEN] 跑 `npx vitest run` 相关用例全绿。
9. [回归] 门禁：tsc 0 / lint 0 / vitest 全量 / Playwright（新增首启注入用例）全绿。

---

## 6. 验收标准（映射需求 112-117 行）

| 需求项 | 验收点 |
|--------|--------|
| 内置欢迎文档资源 | 存在 src/render/assets/welcome.md，可被 ?raw 导入 |
| 启动空态自动注入 | 首次进入（文件树空）：编辑区展示欢迎文档 + 左侧出现「欢迎文档.md」；内容覆盖 §3 全部 29 项语法 |
| 内容覆盖全部实现语法 | 含标题/段落/强调/列表/引用/代码块/表格/图片/图片缩放/链接/删除线/高亮/下划线/行内代码/自动链接/转义/数学 KaTeX 等 |
| 删除后重启再次注入 | 删除欢迎项 → 重启（树空）→ 欢迎项再现 |
| 不污染用户文件 | 欢迎项可识别（welcome://）、可独立删除；不写 DB/磁盘；saveFile 短路不报错 |
| 门禁 | tsc 0 / vitest 全绿 / lint 0 / Playwright（首启注入 + 删除复现）全绿 |

### 回归范围
- tests/services/markdown.test.ts（welcome 内容经 remark 渲染不抛错）
- tests/editor/kernel/*（welcome 全文经 markdownToState / stateToMarkdown 往返收敛——作 fixture）
- tests/stores/editorStore.test.ts（saveFile 短路不破坏既有保存）
- e2e/editor.spec.ts / e2e/marktext-rendering.spec.ts（首启注入 + 编辑不污染）
- 新增 e2e/welcome-doc.spec.ts：启动空态注入 → 编辑区可见欢迎内容 → 删除欢迎项回空态 → 重启再造。

---

## 7. 风险与缓解

| 风险 | 说明 | 缓解 |
|------|------|------|
| welcome 含未实现语法 | 展示未支持语法误导 | §3 逐条对照内核；测试断言 welcome 仅含白名单标记 |
| welcome 全文往返不收敛 | 大段代码块/图片块触发 markdownToState 边界 | welcome 末尾以普通段落收尾；作往返回归 fixture |
| saveFile 短路影响真实保存 | 误伤非欢迎文件 | isWelcomeFile 只匹 welcome:// 前缀 |
| 重复注入 / 关闭后又注入 | 判定过宽反复弹出 | 判定唯一是「文件树为空」，不以 currentFile===null 触发 |
| FileTreePanel 点击欢迎项 readDisk 失败 | 无磁盘路径 | handleFileClick 短路用 node.content 打开 |
| media:// 内置图路径换算复杂 | 需主进程换算 resourcePath | 用「语法原文 + 文字说明」替代真实内嵌图（方案 A） |
| 帮助菜单入口扩大范围 | 非必需变更 | 列为可选增强，失控拆 FSR |
| window 全局 mock 依赖 | 单测需 fake window.weaveMD | 沿用 tests/stores/editorStore.test.ts 既有 mock 先例 |

---

## 附：核心改动函数签名

- welcomeDocument.ts：
  - 常量：WELCOME_ID = 字符串 welcome://welcome.md
  - 函数：isWelcomeFile(id) → id.startsWith(welcome://)
  - 函数：injectWelcomeDocument() → Promise<boolean>（幂等，树空才注入）
- editorStore.saveFile 开头：若 currentFile.id 且 isWelcomeFile(currentFile.id) → set({ isDirty: false }) 并 return true。
- FileTreePanel.handleFileClick 开头：若 isWelcomeFile(node.id) → openFile(makeWelcomeIFile(node)) 并 return。
