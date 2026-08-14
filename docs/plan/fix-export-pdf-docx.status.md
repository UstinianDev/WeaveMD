# fix-export-pdf-docx — 导出 Bug 修复状态

## 分级（阶段 0）

- **请求类型**：Bug 修复
- **影响面**：跨模块 — 主进程导出服务（src/main/export/）、渲染层导航导出入口（useNavbarActions）、html-to-docx 第三方库行为、导出 HTML 模板
- **定档**：**M**（半天内，1~3 模块：exportService / imageInline / exportTemplate）
- **裁剪**：Bug → 复现测试 → 最小修复短路径（已跳过完整拷问/调研/规划，直接复现定位）

## 复现与根因（阶段 1，已完成）

用真实 Electron 环境（隐藏 BrowserWindow + printToPDF + html-to-docx + python-docx 校验）复现，全部根因确认：

| 症状 | 根因 | 证据 |
|---|---|---|
| PDF 导出失败 | `printToPDF` `margins` 单位是**英寸**（electron.d.ts 注释 "pixels" 误导）。传 `24` 英寸远超 A4 → 抛 `margins must be less than or equal to pageSize` | Electron 实测 val=0.4/1/2 OK，5/10/24 FAILED |
| 有图 docx 图片丢失 | `imageInline.applyReplacements` 的 replace 回调返回 `${prefix}src="..."` **漏掉 `<img` 前缀** → 内联产物 `<p> src="data:..."`，img 标签被破坏 | 实测内联产物 `<img` index=-1 |
| 有图 docx 导出失败 | html-to-docx 内置 image-size **不支持 AVIF/WEBP** → `sizeOf` 抛 `unsupported file type` → 整个导出 reject | 实测 avif/webp data URI FAILED；huge-png OK |
| docx 打开报错 | html-to-docx 生成的 `[Content_Types].xml` 只声明 `png`/`jpeg`；**GIF/SVG 等 media 无 content type** → Word 报 "word中打开文件出现错误" | python-docx 严格校验：png OK，svg/gif 抛 KeyError |

## 修复实现（阶段 2~5，已完成）

1. **PDF**：`exportService.ts` printToPDF `margins` 改 `{ marginType:'custom', top:0.4, bottom:0.4, left:0.4, right:0.4 }`（英寸）；`exportTemplate.ts` 移除 `@media print { @page { margin: 0 } }`。
2. **img 标签**：`imageInline.ts` applyReplacements 三分支补回 `<img` 前缀。
3. **docx 图片格式（P3/P4）**：方案历经两轮演进——
   - 初版 `normalizeDocxImages`（nativeImage 重编码）实测无效：nativeImage 仅支持 PNG/JPEG，GIF/WebP/AVIF/SVG 均空图。
   - 二版窗口转码（BrowserWindow+canvas）实测不可行：Electron `BrowserWindow.destroy()` 阻塞主进程事件循环（已知限制 electron#18358/#1400），destroy 后 `HTMLtoDOCX`（内部 timer）永不 resolve。
   - **终版（无窗口）**：`exportService.ts` 新增 `stripUnsupportedDocxImages`（移除 AVIF，image-size 无探测器会抛错导致导出失败）+ `fixDocxContentTypes`（jszip 补 `[Content_Types].xml` 中 gif/svg/webp 等 media 的 content type，否则 Word 打开报错）。真实 WebP 有 image-size 探测器，无需处理。
4. **测试**：补 imageInline 标签完整性、PDF margins 回归、strip/fixDocx 单测。

## 变更文件（实际）

- `src/main/export/exportService.ts` — margins + stripUnsupportedDocxImages + fixDocxContentTypes + docx 三步流程
- `src/main/export/imageInline.ts` — applyReplacements 修复
- `src/main/export/exportTemplate.ts` — 移除 @page margin
- `tests/main/export/exportService.test.ts` / `exportTemplate.test.ts` / `imageInline.test.ts` — 回归测试

## 验证证据（阶段 6，独立真实 Electron + python-docx）

- **PDF**：真实隐藏窗口 printToPDF 含 PNG 图 → success，`%PDF-` 魔数（修复前 100% 失败 "margins must be ≤ pageSize"）
- **docx-PNG**：python-docx OPEN OK，inline_shapes=1
- **docx-GIF**：python-docx OPEN OK，inline_shapes=1，`[Content_Types].xml` 已补 gif 声明（修复前 KeyError）
- **docx-SVG**：python-docx OPEN OK（content type 已补 svg+xml）
- **docx-AVIF**：success=true，AVIF 被移除不抛错，PNG 保留
- 主窗口存活时 destroy 导出窗口后事件循环正常（验证 destroy 阻塞仅发生在全窗口关闭时，真实应用无影响）
- 门禁：tsc OK / vitest 912 passed / eslint 0 errors（8 既有 warnings）/ vite build OK / E2E 71 passed（5 个既有 RED 拖选测试，非本次引入）

## 遗留问题

- AVIF 图 docx 导出被静默移除（导出成功但缺图，无 UI 提示）
- SVG 图 docx 可打开，但 Word 对 `svg+xml` media 的显示表现未在真实 Word 验证
- 渲染层 `export.tooLongImage` 等提示逻辑未扩展覆盖 AVIF 移除场景

## 状态

- [x] 阶段 0 分级
- [x] 阶段 1 复现与根因（全部确认）
- [x] 阶段 2~5 修复实现
- [x] 阶段 6 测试与质量门禁
- [x] 阶段 7 合规核对（改动限目标文件，命名/安全/导入规范合规）
- [x] 阶段 8 交付核对（diff 与变更清单一致，无计划外改动）
