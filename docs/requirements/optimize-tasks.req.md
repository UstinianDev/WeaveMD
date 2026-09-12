# WeaveMD 优化任务需求文档

## 任务 1.1：修复浮动工具栏图片导出

### 问题描述
通过浮动工具栏"插入图片"功能插入的图片，导出为 8 种格式时显示为图标（broken image），而非图片本身。

### 根本原因分析

**问题链路**：
1. `DIALOG_PICK_IMAGE` IPC 处理器返回本地路径 `D:\photos\image.png`
2. `insertImageFromSelection()` 调用 `escapeImagePathForMarkdown()` 仅编码空格为 `%20`
3. markdown 源码写入 `![alt](D:\photos\image.png)`
4. 导出时 `renderMarkdownToHtml()` 将其转换为 `<img src="D:\photos\image.png" alt="alt">`
5. `inlineMediaImages()` 只处理 `media://` 和 `http(s)://` 前缀，不处理本地路径
6. 最终导出的 HTML 中图片 src 仍然是原始的本地路径

**关键差异**：
- Ctrl+V 粘贴：剪贴板图片 → `FileReader.readAsDataURL()` → `data:image/png;base64,...` → 导出时无需处理
- 浮动工具栏：`dialog.showOpenDialog()` → `D:\photos\image.png` → 导出时需要读取本地文件

### 修复方向

**方案 A：在 `ipc-handlers.ts` 中将本地路径转换为 `data:image` base64 格式再返回**
- 优点：一次转换，后续无需处理
- 缺点：大图会导致 IPC 传输数据量大

**方案 B：在 `formatCtrl.insertImageFromSelection()` 中将本地路径转换为 `media://` 协议**
- 优点：与现有渲染逻辑一致
- 缺点：需要修改编辑器内核

**方案 C：在 `imageInline.ts` 中增加对本地路径的处理**
- 优点：最小改动，只影响导出模块
- 缺点：需要处理 URL 编码的路径

**推荐方案**：方案 C - 在 `imageInline.ts` 中增加对 Windows 绝对路径的处理

### 验收标准
1. 通过浮动工具栏插入的图片，导出为 HTML/PDF/DOCX 等格式时能正常显示
2. 导出的图片清晰度与编辑器显示一致
3. 不影响 Ctrl+V 粘贴图片的导出功能

---

## 任务 1.2：确保导出图片清晰度

### 问题描述
导出的图片清晰度应与编辑器中显示一致。

### 当前配置
- `EXPORT_MAX_HEIGHT = 15000`
- `EXPORT_IMAGE_WIDTH = 800`
- `EXPORT_LARGE_IMAGE_BYTES = 8MB`
- `EXPORT_MAX_IMAGE_WIDTH = 1600`
- `EXPORT_JPEG_QUALITY = 92`

### 验收标准
1. JPEG quality 92 满足"肉眼无明显差异"的要求
2. 大图降采样时的宽度限制（1600px）足够

---

## 任务 1.3：扩展 safeUrl 白名单

### 问题描述
当前 `safeUrl()` 白名单不支持 `data:image/svg+xml`、`data:image/avif` 等格式。

### 当前白名单
```typescript
const SAFE_URL_RE = /^(https?:|mailto:|file:|data:image\/(png|jpe?g|gif|webp);base64,|#|\/|\.\/|\.\.\/)/i;
```

### 需要扩展支持
- `data:image/svg+xml;base64,`
- `data:image/avif;base64,`

### 验收标准
1. 扩展后的正则能正确匹配所有支持的图片格式
2. 不影响现有功能

---

## 任务 2.1：视图切换按钮

### 问题描述
将视图切换从下拉菜单改为独立 Toggle 按钮。

### 实现要点
1. 在 `TopBar.tsx` 中添加独立 Toggle 按钮
2. 按钮图标根据 `isSourceCodeMode` 状态动态切换
3. 点击时调用 `uiStore.toggleSourceCodeMode()`

### 验收标准
1. 按钮位于导航栏左侧（AI 按钮旁边）
2. 富文本模式显示代码图标（`</>`），源代码模式显示文档图标（📄）
3. 点击直接切换，无需确认

---

## 任务 3.1：修复 Edge 粘贴问题

### 问题描述
Edge 浏览器复制网址粘贴到 Composer 后，显示为网站的简单内容摘要。

### 根本原因
Edge 将 URL 包装为 `<a href="...">标题</a>` 格式，并添加 `text/link-preview` MIME 类型。

### 解决方案
在 `AIPanelComposer.tsx` 中添加 `editorProps.handlePaste` 处理器，优先检测 `text/link-preview` 格式。

### 验收标准
1. Edge 粘贴网址后显示原始 URL，而非摘要
2. Chrome 粘贴功能不受影响

---

## 任务 3.2：网址链接标签

### 问题描述
粘贴网址后，应自动转换为可点击的链接。

### 实现要点
1. 添加 TipTap Link 扩展
2. 配置 `autolink: true`、`linkOnPaste: true`
3. 实现悬浮预览卡片

### 验收标准
1. 粘贴纯 URL 时自动转为链接
2. 点击链接在浏览器中打开
3. 链接样式与 Codex 风格一致

---

## 任务 3.3：URL 搜索提示

### 问题描述
检测到 URL 后，应在 UI 上显示显式提示，用户可选择是否搜索该链接。

### 验收标准
1. 消息下方显示"检测到链接：[URL]"提示
2. 点击后显示"搜索此链接"、"忽略"两个按钮
3. 搜索结果作为可折叠卡片呈现

---

*文档创建时间：2026-09-12*
