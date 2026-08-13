# navbar-export — 导出功能完善需求

> task slug：`navbar-export` | 档位：L | 状态：已对齐（2026-08-13）

## 1. 需求清单

### R1 格式范围
将顶部导航栏导出功能完善为支持 **8 种格式**：md、pdf、doc、docx、html、png、jpg、jpeg。

### R2 导出入口 UI
- 顶部导航栏导出按钮（⬇️）改为 `NavMenu` 下拉（符合 NAV-09 `.navbar-menu-trigger` 统一样式）。
- 下拉含 8 个格式项，**分两组**：文档类（md/pdf/doc/docx/html）+ 图片类（png/jpg/jpeg），组间分隔线。
- 格式名走 i18n 键 `export.format.xxx`，中/英/繁三语言。

### R3 无打开文件行为
编辑区无打开文件时导出按钮**禁用**（灰置）。

### R4 导出内容基准
- 导出前 `flushEditorDraft()` 同步 WYSIWYG 草稿到 `editorStore.content`，取**最新内容**（不强制落盘）。
- 默认导出文件名 = 当前文件 basename（去扩展名）。

### R5 各格式实现
| 格式 | 扩展名 | 实现 |
|------|--------|------|
| md | .md | 写原始 markdown 文本 |
| html | .html | 自包含 HTML：渲染正文（复用 `renderMarkdownToHtml`）+ 内嵌导出 CSS + base64 图片，可独立打开 |
| pdf | .pdf | 隐藏 BrowserWindow 加载渲染 HTML → `printToPDF` |
| png | .png | 隐藏窗口渲染 → `capturePage` → NativeImage `toPNG` |
| jpg | .jpg | 同上 → `toJPEG`（质量 ~92） |
| jpeg | .jpeg | 与 jpg 相同 |
| doc | .doc | HTML 包装存为 .doc（Word 兼容，无新依赖） |
| docx | .docx | **真实 OOXML**，经 `html-to-docx` 转换（新增依赖） |

### R6 图片处理
导出前将 `media://` 等应用内协议图片 **base64 内联**，保证各导出格式自包含、外部可查看。对超大图（>8MB）设体积阈值，用 **Electron 内置 nativeImage** 降采样（长边 >1600px 按比例缩放，PNG 保留透明 / 其他重编码 JPEG q85），避免导出文件爆炸。

### R7 反馈与状态
- 导出中：TopBar `isLoading` spinner 启用，结束后复位。
- 失败：沿用顶部 errorMessage 红色横幅（含原因）。
- 成功：不额外打扰（保存对话框即反馈）。

### R8 失败场景
- 用户取消保存对话框：**静默 no-op**，不报错不提示。
- 空文档：允许导出（md/html/pdf/doc/docx 空内容合法；png/jpg 生成空白小图）。
- 超长文档（png/jpg 受 Chromium 窗口高度上限 ~15000px）：**截断导出 + 顶部横幅提示**「文档过长，图片仅截取前 N 像素」。

## 2. 技术路线（已对齐）

- **渲染层**：复用 `src/render/services/markdown.ts` 的 `renderMarkdownToHtml()` 将当前内容转为 HTML 正文（含 Prism 高亮），与预览一致。
- **主进程**：新增 `src/main/export/` 模块统一分发 8 种格式；新增**导出专用 HTML 模板 + 打印 CSS**（自包含，视觉迁移自 globals.css `.markdown-preview`）；PDF/PNG/JPG 用隐藏 BrowserWindow 渲染。
- **IPC**：扩展 `src/shared/constants.ts` / `src/main/preload.ts` / `src/render/utils/weaveMDBridge.ts`（含 browser mock）。
- **新依赖**：`html-to-docx`（真实 .docx 转换）。
- **IPC 通道形态**（统一带 format 参数 or 按格式拆通道）：由规划阶段确定。

## 3. 验收标准

### 3.1 格式有效性（落盘后验证）
| 格式 | 验证 |
|------|------|
| md | 文本内容 = 原始 markdown |
| html | 自包含：含 `<!DOCTYPE html>`、渲染正文、内嵌 CSS、base64 图 |
| pdf | 以 `%PDF` 开头 |
| png | 以 `\x89PNG` 开头 |
| jpg/jpeg | 以 `\xFF\xD8\xFF` 开头 |
| doc | 以 `<!DOCTYPE html>` 开头（Word 可打开） |
| docx | 以 `PK` 开头且含 `word/document.xml` |

### 3.2 UI 验收
- 下拉含 8 项分两组，三语言文案正确。
- 无文件时禁用；有文件时可用。
- 点击各格式触发对应导出。
- 导出期间 isLoading 显示，结束后复位。

### 3.3 交互验收
- 取消保存对话框静默 no-op。
- 空文档可导出（不报错）。
- 转换失败显示红色 errorMessage。
- 超长文档图片导出截断 + 提示。

## 4. 已对齐问题清单

| # | 问题 | 结论 |
|---|------|------|
| D1 | md 是否保留 | 保留（EXP-01 既有需求） |
| D2 | docx 真实度 | 真实 OOXML，引入 `html-to-docx`（新增依赖） |
| D3 | doc 方案 | HTML 包装（Word 兼容，无依赖） |
| D4 | png/jpg 形态 | 全页长图（白底、内容宽 ~800px、jpg 质量 92） |
| D5 | 无文件行为 | 禁用 |
| D6 | 导出内容基准 | flush 草稿后最新内容；文件名=basename |
| D7 | 图片处理 | base64 内联 + 大图阈值降采样（nativeImage，>8MB 且长边>1600px 缩放） |
| D8 | 反馈 | 失败 errorMessage；成功不打扰；导出中 spinner |
| D9 | UI 分组 | 文档/图片两组 + 分隔线 |
| D10 | 超长文档 | png/jpg 截断 + 提示 |
