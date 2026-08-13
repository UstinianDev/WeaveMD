# navbar-export — 实施计划

> task slug：`navbar-export` | 档位：L | 输入：`docs/requirements/navbar-export.req.md` | 状态：实施中（2026-08-13）

> ## 实现偏差（2026-08-13，合规审查回写）
> 1. **隐藏窗口策略**：§2.2 计划「模块级复用池 + 空闲惰性销毁 + data:text/html 加载」→ 实际实现为「**每次导出新建隐藏窗口 + try/finally destroy + 临时文件 loadFile**」（正确性优先，规避 data URL 长度上限与大图 payload）。
> 2. **大图降采样（R6）**：§3.2 计划「OffscreenCanvas 缩放到 ≤1600px」→ 实际实现改用 **Electron 内置 `nativeImage`**（主进程内联前降采样：长边>1600px 按比例缩放，PNG 保留 alpha / 其他 JPEG q85），**已补实现**（用户确认选择）。零新依赖。
> 3. **依赖版本**：A 节计划 `html-to-docx@^1.9.0`（不存在）→ 实际安装 **^1.8.0**（npm 最新版）。

> 进度（2026-08-13 渲染层 P2 UI，task slug：navbar-export 渲染层）：
> - 已完成 A4（`ExportMenu.tsx` + TopBar 占位替换）+ B2（`useNavbarActions.handleExport`）+ 三语言 i18n export.* 键。
> - 已交付测试 `tests/components/ExportMenu.test.tsx`（4 例，8 项/分组/disabled/onExport）+ `tests/components/useNavbarActionsExport.test.ts`（5 例，mock export.file 验证无文件早退/成功/失败/cancelled/截断），vitest 全绿（9/9）。
> - 依赖冻结契约 `src/main/export/types.ts`（ExportFormat/ExportRequest/ExportResult）与 `preload.ts`（weaveMD.export.file 单方法）。
> - 主进程 `imageInline.ts` 测试（tests/main/export/imageInline.test.ts 4 例失败）与 `ipc-handlers.ts` EXPORT_MD/DOCX/PDF 类型错误属并行协作方中间态，非本层归因。

---

## 1. 变更清单（精确路径 + 改动要点）

### A. 新增依赖
- **`package.json`**：`dependencies` 增加 `html-to-docx: ^1.9.0`（纯 JS + Buffer，无原生依赖）。
- **`vite.config.ts`**：main 构建 `rollupOptions.external` 数组追加 `'html-to-docx'`；electron-builder 默认把 dependencies 的 node_modules 打进 asar，天然满足。

### B. 主进程 `src/main/export/`（新建目录，4 个新文件）
| 文件 | 要点 |
|------|------|
| `types.ts` | `ExportFormat`（`'md'|'pdf'|'doc'|'docx'|'html'|'png'|'jpg'|'jpeg'`）、`ExportRequest { format, content, html, filename }`、`ExportResult { success, data?, error? }`（error `'cancelled'` 区分取消 vs 失败）、`MAX_HEIGHT = 15000`、大图阈值常量 |
| `exportTemplate.ts` | `buildExportHtml({ body, title }) => string`：`<!DOCTYPE html>` + head（meta + `<style>` 内嵌导出 CSS）+ `<body class="markdown-export">`。导出 CSS 从 globals.css `.markdown-preview`（426 行起）视觉迁移，`var(--x)` 全部替换为固定色值（白底 `#fff`/文字 `#1a1a1a`/代码 `#f6f8fa` + Prism 明色 token 配色），自包含。含 `@media print { @page { margin: 0 } }` |
| `imageInline.ts` | `inlineMediaImages(html) => Promise<{ html, oversizedCount }>`：正则扫 `src="media://..."` → `decodeMediaUrl` → `fs.readFile` → base64 data URI 回填；远程 http(s) 用 `net.fetch` → arrayBuffer → base64（失败保留原 src）；大图体积阈值判定（纯函数可单测） |
| `exportService.ts` | 分发器 `exportFile(req, parentWin) => Promise<ExportResult>`；按 format 路由；隐藏窗口池（惰性创建/复用/空闲惰性销毁）；`buildExportHtml` 只渲染一次复用于 pdf/png/jpg/docx/doc |

### C. 主进程改造
- **`src/main/ipc-handlers.ts`**：删除 426~482 行三个 `EXPORT_MD/DOCX/PDF` handler，替换为单一 `EXPORT_FILE`，try/catch 委托 `exportFile()`；取消返回 `{ success:false, error:'cancelled' }`。
- **`src/main/preload.ts`**：`WeaveMDApi.export` 改为 `file(req)` 单方法（`ipcRenderer.invoke(IPC_CHANNELS.EXPORT_FILE, req)`）。
- **`src/shared/constants.ts`**：删 `EXPORT_MD/DOCX/PDF`，加 `EXPORT_FILE: 'export:file'`。

### D. 渲染层
- **`src/render/components/Navbar/ExportMenu.tsx`**（新建）：NavMenu 下拉，8 项两组（文档 md/pdf/doc/docx/html + 图片 png/jpg/jpeg）+ 分隔线；`disabled: !currentFile || isLoading`；i18n 键 `export.format.*`。
- **`src/render/hooks/useNavbarActions.ts`**：新增 `handleExport(format)`：flush 草稿 → 取 content → `renderMarkdownToHtml` → basename → `window.weaveMD.export.file` → 失败 errorMessage（`error !== 'cancelled'`）。
- **`src/render/components/Navbar/TopBar.tsx`**：238~247 行占位按钮替换为 `<ExportMenu onExport={handleExport} disabled={...} />`。
- **`src/render/utils/weaveMDBridge.ts`**：browser mock `export` 改为 `file(req)` 单方法，按 format 分派下载。
- **`src/render/i18n/zh-CN.json` / `zh-TW.json` / `en.json`**：新增 `export.document`、`export.image`（分组标题）、`export.format.md/pdf/doc/docx/html/png/jpg/jpeg`、`export.failed`、`export.tooLongImage` 三语言。

## 2. 模块设计

### 2.1 IPC 通道取舍：单一 `EXPORT_FILE`
理由：8 格式共享同一数据载荷（content + html + filename）与错误/取消语义；分发决策内聚在主进程 exportService；IPC payload 未增大（html 只发一次）；`weaveMD.export.*` 在渲染层无调用方（已 grep 确认），重构无破坏面；单一 `ExportRequest` 类型编译期覆盖 8 格式。

### 2.2 主进程隐藏窗口
`exportService` 模块级 `let hiddenWin` 惰性创建（`show:false`, `nodeIntegration:false, contextIsolation:true`），连续导出复用；渲染 `data:text/html` → `ready-to-show` → `executeJavaScript` 等 `document.fonts.ready` + 取 `scrollHeight` → `setContentSize(contentWidth, min(contentHeight, MAX=15000))`。清理用 `win.destroy()`（非 close，规避事件挂起）；空闲惰性销毁。

### 2.3 图片 base64 内联（取舍：主进程预内联）
渲染层 `renderMarkdownToHtml` 输出含 `media://` 原样 src；**主进程** `imageInline.ts` 用 `decodeMediaUrl` + `fs.readFile` 预内联（确定性高、可单测），隐藏窗口只负责把自包含 HTML 渲染成位图/PDF，不做 executeJavaScript 二次处理。渲染层不做任何图片网络操作。

## 3. 关键实现细节

### 3.1 超长文档 png/jpg 截断
`contentHeight > MAX_HEIGHT(15000)` → `setContentSize(800, MAX)`、capture 前 MAX 像素 → 结果透出 `data.truncated` → 渲染层 `setErrorMessage(t('export.tooLongImage', { px }))`（横幅提示，导出仍成功）。

### 3.2 大图降采样
体积阈值 `LARGE_IMAGE_BYTES = 8MB`。超阈值 PNG 在隐藏窗口渲染前用一次 `executeJavaScript`（`OffscreenCanvas`/`Image`）缩放到宽 ≤ 1600px 后以 JPEG 重新内联；阈值判定为纯函数可单测。

### 3.3 PDF 生成
`printToPDF({ printBackground:true, pageSize:'A4', margins, preferCSSPageSize:true, generateDocumentOutline:true })`（书签映射标题）。

## 4. 验收标准（映射需求 3.1~3.3）

### 4.1 格式有效性（落盘后验证，新增主进程测试）
| 格式 | 验证 |
|------|------|
| md | 文本 = 原始 markdown |
| html | 含 `<!DOCTYPE html>`、渲染正文、内嵌 CSS、`data:image` |
| pdf | 首 4 字节 `25 50 44 46`（`%PDF`） |
| png | 魔数 `89 50 4E 47` |
| jpg/jpeg | 魔数 `FF D8 FF` |
| doc | 首字节 `<!DOCTYPE html>`（Word 兼容） |
| docx | 首字节 `PK` 且 buffer 内含 `word/document.xml` 子串（避免新依赖） |

新增测试：`tests/main/export/exportService.test.ts`、`exportTemplate.test.ts`、`imageInline.test.ts`。参照 `tests/main/ipcDialogs.test.ts` 的 electron mock 范式。

### 4.2 UI 验收
下拉 8 项两组 + 分隔线；三语言文案正确；无文件禁用；点击触发对应导出；导出中 isLoading。

### 4.3 交互验收
取消静默 no-op；空文档可导出；失败 errorMessage；超长截断 + tooLongImage 横幅。

## 5. 分步实施顺序（并行边界）

- **阶段 A**（并行，互不阻塞）：A1 `types.ts` + `imageInline.ts`（纯函数先可单测）；A2 `exportTemplate.ts` + CSS 迁移；A3 i18n 三语言 + weaveMDBridge mock；A4 `ExportMenu.tsx` + TopBar 占位替换（临时 handleExport）。
- **阶段 B**（依赖 A）：B1 `exportService.ts` + ipc-handlers/preload/constants 接 `EXPORT_FILE`；B2 `useNavbarActions.handleExport`；B3 主进程导出测试套件。
- **阶段 C**（集成）：全链路联调 + 超长截断/降采样 + 全量测试。

并行不变量：A 阶段新文件以 `ExportFormat`/`ExportRequest`（A1）为唯一跨作者契约，先在 types.ts 冻结签名。

## 6. 风险与取舍

| 风险 | 应对 |
|------|------|
| html-to-docx 对 Prism/CSS 保真度 | docx 走精简结构，不强求 token 彩色；集成测试只断言 zip 内正文，不追求像素一致；效果差退回 doc(HTML) 兜底 |
| capturePage 高度上限 | MAX_HEIGHT=15000，超限截断 + 横幅 |
| IPC 大 payload | html 单次传输；单张超大图阈值降采样兜底 |
| 隐藏窗口泄漏 | `win.destroy()` + 空闲惰性销毁 |
| browser mock 无法产真实二进制 | 价值在渲染层调用链/分组 UI/取消 no-op/errorMessage，格式有效性只在主进程测试 |
| html-to-docx 打包 | dependencies + main external 追加 |
