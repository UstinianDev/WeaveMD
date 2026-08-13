# 导出功能 (Export) 功能总结

> 模块编号：10 | 优先级：P1 | 最后更新：2026-08-13（navbar-export 完善为 8 格式）

---

## 1. 功能概述

支持将当前编辑区文件导出为 **8 种格式**：Markdown (.md)、HTML (.html)、PDF (.pdf)、Word (.doc)、Word (.docx)、PNG (.png)、JPG (.jpg)、JPEG (.jpeg)。导航栏导出按钮（⬇️）为下拉菜单（文档/图片两组），通过系统保存对话框选择保存位置。

## 2. 架构位置

```
src/main/export/types.ts          # 导出契约（ExportFormat/ExportRequest/ExportResult + 常量）
src/main/export/exportTemplate.ts # 自包含 HTML 模板 + 导出 CSS（迁移自 .markdown-preview 明色）
src/main/export/imageInline.ts    # media:// 与远程 http(s) 图 → base64 内联（readFile 依赖注入）
src/main/export/exportService.ts  # 8 格式统一分发器 + 隐藏窗口渲染（pdf/png/jpg/jpeg）
src/main/ipc-handlers.ts          # 单一 EXPORT_FILE 通道
src/main/preload.ts               # export.file(req) 桥接
src/shared/constants.ts           # IPC_CHANNELS.EXPORT_FILE
src/render/components/Navbar/ExportMenu.tsx  # 导出下拉（8 项两组）
src/render/hooks/useNavbarActions.ts        # handleExport（flush 草稿 → renderMarkdownToHtml → bridge.file）
src/render/utils/weaveMDBridge.ts           # browser mock export.file
```

## 3. 实现逻辑流程

### 3.1 导出触发流程

```
用户点击导航栏 ⬇ 导出 → 下拉选择格式（8 项两组）
  ↓
useNavbarActions.handleExport(format)
  ↓ flushEditorDraft() 同步草稿 → useEditorStore.content
  ↓ renderMarkdownToHtml(content) → HTML 正文（含 Prism 高亮）
  ↓ window.weaveMD.export.file({ format, content, html, filename })
  ↓ IPC EXPORT_FILE → exportService.exportFile(req, win)
  ↓ 系统保存对话框 → 取消返回 error:'cancelled'（静默）
  ↓ 主进程生成对应格式 → 写盘 → { success, data: { filePath, truncatedPx? } }
```

### 3.2 各格式生成

| 格式 | 生成方式 |
| ---- | -------- |
| md | `fs.writeFileSync(req.content, 'utf-8')` |
| html | `buildExportHtml({ body: 内联后 html, title })` 写盘 |
| doc | 与 html 同模板，扩展名 .doc（Word 兼容） |
| docx | `HTMLtoDOCX(fullHtml, undefined, { orientation:'portrait', margins })` → Buffer 写盘 |
| pdf | 隐藏窗口渲染 → `printToPDF({ printBackground, pageSize:'A4', margins })` |
| png | 隐藏窗口 → `capturePage(rect, { stayHidden })` → `.toPNG()` |
| jpg/jpeg | 同 png → `.toJPEG(92)` |

### 3.3 图片自包含与降采样

导出前 `imageInline.ts` 把 `media://` 本地图（`decodeMediaUrl` → `fs.readFile` → base64）与远程 http(s) 图（`net.fetch`）统一 base64 内联，失败保留原 src。超阈值大图（>8MB）用 **Electron 内置 `nativeImage`** 降采样：长边 >1600px 按比例缩放，再重编码（PNG/GIF/WEBP 等可能透明格式 → PNG 保留 alpha；JPEG/BMP → JPEG q85），显著减小内联体积；解码失败回退原图内联。`shouldDownsampleImage` / `downsampleImage` / `imageNeedsAlpha` 为纯函数，`readFile`/阈值/最大宽/降采样器均依赖注入，可单测。

### 3.4 隐藏窗口渲染（pdf/png/jpg/jpeg）

- 完整 HTML 写临时文件 → 隐藏 BrowserWindow `loadFile` → `executeJavaScript` 等图片 decode + `document.fonts.ready` 并取 `scrollHeight`。
- PDF：`setContentSize(794, height)` → `printToPDF`。
- PNG/JPG：`setContentSize(800, min(height, EXPORT_MAX_HEIGHT))` → `capturePage` → `toPNG/toJPEG(92)`。
- 超长文档（>15000px）png/jpg **截断**并透出 `data.truncatedPx`，渲染层提示。
- `try/finally` 中 `win.destroy()` + 删除临时文件，不泄漏。

### 3.5 反馈

- 导出中：`isLoading` spinner（TopBar 左区）。
- 失败：`error !== 'cancelled'` → 顶部 errorMessage 红色横幅（`export.failed`）。
- 截断：`data.truncatedPx` → 横幅提示 `export.tooLongImage`（导出仍成功）。
- 取消：静默 no-op。

## 4. IPC 契约

| 通道 | 参数 | 返回值 |
| ---- | ---- | ------ |
| `export:file` | `ExportRequest { format, content, html, filename }` | `ExportResult { success, error?, data? }` |

`ExportResult.error`：`'cancelled'` = 用户取消（渲染层静默）；`'failed'` = 转换/IO 失败（渲染层横幅）。

## 5. 关键设计决策

1. **单一 `EXPORT_FILE` 通道**：8 格式共享同一数据载荷与取消/错误语义，分发决策内聚主进程 exportService。
2. **渲染层只传 HTML 正文**：复用 `renderMarkdownToHtml`（含 Prism 高亮），主进程 `buildExportHtml` 统一包裹导出 CSS。
3. **主进程 base64 预内联**：`decodeMediaUrl + fs.readFile` 确定性高、可单测，隐藏窗口只负责渲染。
4. **`html-to-docx` 真实 .docx**：Word 2007+/LibreOffice/Google Docs/WPS 兼容，替代原 HTML 包装伪 .docx。
5. **`readFile` 依赖注入**（imageInline）：vitest 对 `node:fs/promises` 内建模块 mock 在传递导入下不可靠。
6. **自包含导出 CSS**：迁移自 `.markdown-preview` 明色配色，固定色值不依赖应用 CSS 变量。

## 6. 导出格式对比

| 格式 | 扩展名 | 实现方式 | 自包含 | 外部可打开 |
| ---- | ------ | -------- | ------ | ---------- |
| Markdown | .md | 直接写文本 | 是 | 任何文本编辑器 |
| HTML | .html | 完整文档（内嵌 CSS + base64 图） | 是 | 浏览器 |
| PDF | .pdf | printToPDF（A4） | 是 | PDF 阅读器 |
| Word(doc) | .doc | HTML 包装 | 是 | Word |
| Word(docx) | .docx | html-to-docx OOXML | 是 | Word 2007+/LibreOffice/Google Docs |
| PNG | .png | capturePage → toPNG | 是 | 图片查看器 |
| JPG/JPEG | .jpg/.jpeg | capturePage → toJPEG(92) | 是 | 图片查看器 |

## 7. 测试

- `tests/main/export/exportTemplate.test.ts`（13 例）：buildExportHtml 自包含/无 var 引用/body 透传。
- `tests/main/export/imageInline.test.ts`（15 例）：media:// → base64、缺失保留、大图阈值、MIME 映射。
- `tests/main/export/exportService.test.ts`（10 例）：各格式魔数（%PDF / \x89PNG / \xFF\xD8\xFF / PK+word/document.xml）、取消、截断。
- `tests/components/ExportMenu.test.tsx`（4 例）+ `tests/components/useNavbarActionsExport.test.ts`（5 例）：UI 分组/禁用/触发 + handleExport 全路径。
- 覆盖率：导出模块语句 98.66% / 分支 89.55% / 函数 100%。
