# navbar-export — 状态跟踪

> task slug：`navbar-export`（顶部导航栏导出功能完善）

## 阶段 0：任务分级与分类

- **请求**：将顶部导航栏的导出功能完善，可将当前编辑主区文件导出为 pdf、doc、docx、html、png、jpg、jpeg。
- **①类型**：功能开发
- **②跨模块**：是 — 渲染层 UI（TopBar 下拉 + 导出动作）→ preload（IPC 桥）→ 主进程（多格式转换）；可能新增依赖（docx）
- **③档位**：**L** — 多模块 / 新 API surface / 可能新依赖

**裁剪路径**：L → 全部阶段，TDD strict，强制技术调研与规划。

## 现状（探索结论）

| 格式 | 现状 |
|------|------|
| md | 已有 `EXPORT_MD`（写原始文本） |
| pdf | 已有但粗陋：隐藏窗口 + `<pre>` 转义文本，非真实 markdown 渲染 |
| docx | 伪实现：HTML 包装存成 `.doc`，非真实 docx |
| doc / html / png / jpg / jpeg | 不存在 |
| UI | TopBar 导出按钮（⬇️）为无下拉占位符 |

复用资产：
- `src/render/services/markdown.ts` — `renderMarkdownToHtml()`（unified + Prism 高亮 + 表格包裹）
- `globals.css` `.markdown-preview` — 完整 markdown 打印样式（含 Prism token 配色、主题变体）
- `NavMenu` + `Dropdown` — 下拉菜单统一模式（NAV-09 要求 .navbar-menu-trigger 统一）
- `useEditorStore` 内容 + `flushEditorDraft`（uiStore）取最新草稿

## 阶段记录

### 阶段 1：需求对齐（grilling）— 完成
- 三轮回合全部确认，产出 `docs/requirements/navbar-export.req.md`（R1~R8 + 验收标准 + 已对齐问题 D1~D10）。
- 关键结论：保留 md（共 8 格式）；docx 真实 OOXML 引入 `html-to-docx`；doc 用 HTML 包装；png/jpg 全页长图（白底 ~800px 宽、jpg 92）；无文件禁用；flush 草稿后取内容；图片 base64 内联；失败 errorMessage/成功不打扰/导出中 spinner；UI 分组；超长文档截断+提示。

### 阶段 2.0：技术调研 — 完成
- **Electron capturePage**：`contents.capturePage([rect,{stayHidden}])` → NativeImage → `.toPNG()` / `.toJPEG(quality 0-100)`。全页截图 = 隐藏窗口 + `setContentSize(contentW, min(contentH, 上限))` 后 capture。渲染完成用 `ready-to-show`。
- **Electron printToPDF**：`printBackground:true`、`pageSize:'A4'`、`margins`、`preferCSSPageSize`、`generateDocumentOutline`（实验性，可给标题建 PDF 书签）。`@page` CSS 会覆盖 orientation。
- **html-to-docx**（npm）：`await HTMLtoDOCX(html, header, options, footer)` → Buffer（Node）；兼容 Word 2007+/LibreOffice/Google Docs/WPS；无 node-gyp；可用 CSS 控制页面。

### 阶段 2：规划 — 完成
- Plan 智能体产出 `docs/plan/navbar-export.plan.md`：变更清单（8 格式 + IPC 单一 EXPORT_FILE + 隐藏窗口 + base64 内联 + 验收标准）+ 分步实施顺序（A/B/C）+ 风险表。
- 契约冻结（总指挥落盘）：`src/main/export/types.ts`（ExportFormat/ExportRequest/ExportResult + 常量）、`constants.ts`（EXPORT_FILE）、`preload.ts`（export.file）、`weaveMDBridge.ts`（export.file mock + EXPORT_MIME）。
- typecheck 基线：仅 ipc-handlers.ts 3 处 EXPORT_MD/DOCX/PDF 报错（波次间已知中间态，Wave 2 修复）。

### 阶段 3：并行执行 — 进行中
Wave 1：
- ✅ P2 renderer（完成）：`ExportMenu.tsx` + `TopBar.tsx` + `handleExport` + i18n + UI 测试（9/9 绿）。顺带修正 `tests/setup.ts` 过期 export mock。
- ✅ P1 main foundation（中断后修复）：`exportTemplate.ts`（自包含 CSS 迁移）+ `imageInline.ts` + 单测 28/28 绿。
  - P1 因 socket 超时中断，总指挥接管修复：发现 vitest 对 `node:fs/promises` 内建模块 mock 在传递导入下不可靠（`importOriginal` 展开与简单工厂均无法拦截 `imageInline.ts` 的命名导入），改为 **readFile 依赖注入**（`ImageInlineDeps`），测试注入 mock，全绿。
Wave 2：
- ⚠️ P3 智能体 2 次 socket 中断（未产生实质改动），总指挥**直接接管实现**（偏差已记录）：
  - 安装 `html-to-docx@^1.8.0`（最新版，我调研的 ^1.9.0 不存在）；vite.config main external 追加。
  - `src/main/export/exportService.ts`（8 格式分发器 + 隐藏窗口渲染 + 截断 + 临时文件/窗口清理）。
  - `ipc-handlers.ts` 迁移为单一 `EXPORT_FILE`。
  - `html-to-docx.d.ts`（包无类型，补声明）。
  - `tests/main/export/exportService.test.ts`（10 例：写盘/魔数/docx PK/取消/截断）。
  - typecheck 全绿；export 测试 38/38。

### 阶段 4~5：核心实现（TDD strict）— 完成
- 契约冻结 + Wave1（P2 渲染层 / P1 主进程基础）+ Wave2（总指挥接管 exportService+IPC）+ 全量验证。

### 阶段 5：全量测试与质量门禁
- tsc：✅ 全绿
- vitest：✅ 54 文件 / 892 用例全绿
- eslint：✅ 0 error（8 个既有 warning：useContentSync/useEditorActions react-hooks）
- vite build：✅ main 83kB / preload 3.27kB / render 全打包
- E2E：✅ 71 passed；5 failed 全部为 `drag-selection-markers.spec.ts` 既有已知 RED（规格名标注「当前 RED」，选区含标记问题，与导出无关）
- `npm run build`（electron-builder）失败：better-sqlite3 原生模块 Windows 文件锁 EBUSY —— **环境问题**，与改动无关，vite build 已验证打包。

### 阶段 7：合规核对 — 审查 + R6 补实现
- git-diff-reviewer：**0 阻断**；IPC 三层契约一致、错误语义正确、资源清理规范、测试覆盖验收标准、规范/安全合规、范围控制。
- **重要缺口（R6）**：审查发现降采样仅计数未实现 → **用户选择「补实现全格式降采样」**。已用 **Electron 内置 `nativeImage`**（零新依赖）实现：`downsampleImage`（长边>1600px 缩放 + PNG 保留 alpha/JPEG q85 重编码）、`imageNeedsAlpha`、`ImageInlineDeps` 扩展阈值/最大宽/降采样器注入。export 测试 48/48 绿，typecheck 全绿。
- 已修复：临时文件名加随机后缀（NIT）；plan.md 回写 3 处实现偏差（隐藏窗口策略 / 降采样 / 依赖版本 ^1.8.0）。
- 文档同步完成：REQUIREMENTS §3.5（EXP-01~09）+ R6/D7 更新、TECH_STACK（§2.6 导出 + html-to-docx）、模块文档 10（8 格式重写 + 3.3 降采样）、SUMMARY 索引行。

### 阶段 8：交付核对 — 完成
- 计划变更清单 vs 实际 diff：全部对应 ✓；额外 `html-to-docx.d.ts`（包无类型，必要补充）；`tests/setup.ts` 导出 mock 契约更新（本任务范围）。
- 无旧导出 API 残留（EXPORT_MD/DOCX/PDF 全库清除）✓。
- 清理 git-diff-reviewer 自动写入的过时 agent-memory 产物 ✓。
- 工作树中 `docs/modules/04`、`.claude/CLAUDE.md`、`docs/plan.md`、`docs/plans/*`、`docs/requirements.devflow.md`、`docs/testing/spec-edit-ft2/3/4` 等为**任务前既存改动**，非本任务，未触碰。

## 最终交付状态

**功能**：导航栏导出下拉 8 格式（md/pdf/doc/docx/html/png/jpg/jpeg）分组；无文件禁用；导出中 spinner；失败 errorMessage；取消静默；超长 png/jpg 截断提示；图片 base64 内联 + 大图 nativeImage 降采样。

**验证**：tsc ✅ / vitest 902 ✅ / eslint 0 err ✅ / vite build ✅ / E2E 71 ✅（5 例既有已知 RED，drag-selection-markers） / 导出模块覆盖率 98.54% stmts · 90.12% branch · 100% funcs。

**残余风险**：
1. `npm run build`（electron-builder 打包）因 better-sqlite3 原生模块 Windows 文件锁 EBUSY 失败 —— **环境问题**，非代码问题；vite build 已验证打包正确。
2. `html-to-docx` 对复杂 Prism/CSS 保真度有限（Word 中代码高亮会退化为纯文本，标题/列表/表格基本保留）——集成测试已断言 docx 结构有效（PK + word/document.xml）。
3. png/jpg 超长截断（>15000px）为 Chromium 窗口高度保守上限。
4. 未执行 git 提交/推送（需用户授权）。
