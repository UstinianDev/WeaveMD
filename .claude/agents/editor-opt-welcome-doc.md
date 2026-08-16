# editor-opt-welcome-doc — 内置欢迎文档注入（MainPage/文件树，L 级/TDD strict）

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 需求 req.md §④ | 计划 editor-opt-welcome-doc.plan.md

## 前置依赖

- **③ 已完成**：fileTreeStore 已加 zustand persist（`weavemd_filetree`）。注入判定**不能再用「文件树为空」**（persist 后重启树非空）——改用「树中无 `welcome://` 节点即注入」。
- 先读 `editor-opt-history-filetree.plan.md` 了解 fileTreeStore 现状（persist + restore 已完成）。

## 范围

- **新** `src/render/assets/welcome.md`（`?raw` 资源）：覆盖编辑器**实际支持**的全量 markdown 语法（对照 kernel 逐一核对，只列已实现项）——块级：H1-H3/Setext/段落/分割线/有序无序任务列表/嵌套列表/引用/围栏代码块(带语言)/管道表格/独立图片块/图片对齐；行内：加粗/斜体/三连/删除线/高亮/下划线/行内代码/链接/自动链接/行内图片/转义/行内数学；**不展示** display $$、任意内联 HTML、脚注、原生 HTML 表格。
- **新** `src/render/services/welcomeDocument.ts`：`WELCOME_ID='welcome://welcome.md'` / `isWelcomeFile` / `injectWelcomeDocument()`（`import welcomeMd from '@render/assets/welcome.md?raw'` 构建 IFile → addFile 入 looseFiles → currentFile null 时 openFile）。
- 改 `MainPage.tsx`：挂注入 useEffect（user 就绪后，树中无 welcome:// 节点即注入）。
- 改 `editorStore.ts`：`saveFile` 对 isWelcomeFile 短路 return true（不写盘/DB）。
- 改 `FileTreePanel.tsx`：`handleFileClick` 对欢迎项短路 readDisk。
- 不污染：欢迎项只入内存 store 不写 DB/磁盘；共用 removeFile/closeFile 删除链路。
- 测试（先 RED）：`tests/render/services/welcomeDocument.test.ts`（注入判定/短路/roundtrip）+ `e2e/welcome-doc.spec.ts`（首启注入/删除后重启再注入）。

## 关键实现点

- welcome.md 全文须 markdownToState/stateToMarkdown 往返收敛（作回归 fixture）。
- 判定唯一依据：树中无 welcome:// 节点；不以 currentFile===null 触发。

## 门禁（本模块）

- `npx vitest run tests/render/services/welcomeDocument` 全绿（含先 RED 证据）
- `npm run typecheck` 0 | `npm run lint` 0（本模块文件）| Playwright welcome-doc 全绿
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
