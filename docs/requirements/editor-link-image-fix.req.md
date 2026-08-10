# 链接渲染与本地图片显示修复需求

> 需求编号：REQ-EDIT-LINK-IMAGE | 状态：待确认 | 更新：2026-08-11
> 关联需求：REQUIREMENTS.md EDIT-04（实时格式化渲染）、EDIT-12（超链接交互）、EDIT-13
> 关联模块：docs/modules/04-编辑主区-Editor.md
> 关联规范：SPEC-EDITOR-V2（行内渲染/往返不变量）、SPEC-EDIT-FT2（链接/图片插入）
> 任务名：`editor-link-image-fix`

---

## 1. 背景与现状

用户实测反馈编辑主区两个缺陷（均未解决）：

| # | 缺陷 | 现象 |
| --- | --- | --- |
| P1 | 插入图片显示为"未加载出来的图标" | 全选文本 → 工具栏"插入图片"输入 URL/选本地文件 → 编辑器渲染出 broken image 图标，而非图片本体 |
| P2 | 超链接不渲染 | 插入链接后界面仍是 `[text](url)` 纯 Markdown 原文；hover 无任何提示 |

## 2. 根因分析（代码审查 + 临时测试验证）

### 2.1 图片 broken icon（P1）

两层叠加：

| 层 | 位置 | 行为 |
| --- | --- | --- |
| 渲染层 | `kernel/inlineRenderer.ts` `toImgSrc` | Windows 绝对路径（`D:\a.png` / UNC）转为 `file:///D:/a.png` |
| 安全层 | `src/main/window.ts:32` + `index.html` CSP | dev 模式页面为 `http://localhost:5173`，Chromium `webSecurity`（默认开）阻止 http 页面加载 `file://` 资源；且 CSP `img-src 'self' data:` 连网络图片 `https://…` 一并阻止 |

**验证**：`renderInline('![123](D:\\img\\a.png)')` → `src="file:///D:/img/a.png"`（jsdom 确认）；真实 Electron 下该 src 必然加载失败 → broken icon。

### 2.2 链接不渲染（P2）

| 层 | 位置 | 行为 |
| --- | --- | --- |
| 识别层 | `kernel/inlineLexer.ts` `safeUrl` | `SAFE_URL_RE` 只放行带协议前缀（`https:`/`mailto:`/`file:`/`#`/`/` 等）。`[text](www.baidu.com)` 这类**无协议裸域名**被 `safeUrl` 拒绝 → link token 不识别 → 整段按纯文本渲染 |
| 提示层 | `globals.css:1977` | `a.inline-link:hover::after { content: var(--link-tip) }` 的 `--link-tip` **从未定义** → hover 提示不显示 |

**验证**：`safeUrl('www.baidu.com')` → `null`；`renderInline('[123](www.baidu.com)')` → 原样输出（临时测试，已删）。

### 2.3 已有能力（无需重建）

- 链接渲染为 `<a class="inline-link">`（蓝色下划线）——已实现，仅被 2.2 拦截。
- Ctrl/Cmd+Click 经 IPC `link.openExternal` 打开系统浏览器——已实现（`EditorV2.tsx:78-89`），`href` 取 DOM 属性。
- InsertUrlModal（U5，含"选择文件"IPC `dialog:pick-image`）——已实现。

## 3. 目标（用户已确认）

| # | 目标 | 验收要点 |
| --- | --- | --- |
| G1 | 插入**本地图片正常显示** | 本地绝对路径图片渲染为可显示的 `<img>`（dev/prod 一致），不再 broken icon |
| G2 | 网络图片放行显示 | `https://…` 图片不受 CSP 阻止，正常渲染 |
| G3 | 图片加载失败优雅回退 | 无法加载时回退为占位（alt 文本或地址），不出现 broken 图标 |
| G4 | 无协议链接自动补 `https://` | `[text](www.baidu.com)` 渲染为 `<a href="https://www.baidu.com">`，hover 提示与 Ctrl+Click 打开均可用 |
| G5 | 链接 hover 有提示 | 鼠标悬停链接上方显示 URL 提示 |
| G6 | 源 Markdown 与往返不变量不变 | DOM `textContent` 与源一致；`stateToMarkdown(markdownToState(M)) === M` 保持 |

## 4. 方案设计

### 4.1 本地图片：注册 `media://` 自定义协议（G1/G2/G3）

标准做法（对标 VSCode 等 Electron 应用本地资源加载），替代不可靠的 `file://` 跨协议加载。

**主进程**：
1. `src/main/index.ts` 模块顶层（`app.whenReady` 之前、创建窗口之前）：
   `protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`。
2. 新增 `src/main/media-protocol.ts`：`registerMediaProtocol()` 在 `app.whenReady` 后调用
   `protocol.handle('media', …)`：取 `request.url` 去 `media://` 前缀 → `decodeURIComponent` →
   `pathToFileURL(path)` → `net.fetch` 返回文件流；路径非法/文件不存在回 404。仅在 Windows
   绝对路径 / UNC 生效（其它返回 404）。

**渲染层**：
3. `kernel/inlineRenderer.ts` `toImgSrc`：Windows 绝对路径/UNC 生成 `media://` + `encodeURIComponent(相对化后的正斜杠路径)`（替代 `file://`）；相对路径与网络 URL 保持原样（相对路径经 `src` 由 CSP `'self'` 放行）。

**CSP**：`index.html` `img-src` 由 `'self' data:` 改为 `'self' data: https: http: media:`。

**加载失败回退（G3）**：在编辑容器（EditorV2 根容器）用捕获阶段事件委托监听
`img` 的 `error`，命中 `img.inline-image` 时把该节点替换为占位 `<span class="inline-image-fallback">`（显示 `alt` 文本 + 地址，样式灰显），避免 broken 图标。替换发生在 DOM 层，不改块树/文本，往返不变量不受影响。

### 4.2 链接：放行裸域名 + 自动补协议（G4）

1. `kernel/inlineLexer.ts` `safeUrl`：在现有白名单基础上**放行裸域名**（`www.baidu.com`、
   `baidu.com:8080/x` 等，正则以 `[a-z0-9]([a-z0-9-]*[a-z0-9])?\.` 开头且非危险协议），
   仍拒绝 `javascript:`/`data:text/html`/`vbscript:` 等；Windows 路径/UNC 放行不变。
2. 新增纯函数 `normalizeHref(href)`：无协议且形如域名 → 补 `https://` 前缀；已有协议或
   以 `/`、`./`、`../`、`#` 开头 → 原样。
3. `kernel/inlineRenderer.ts` `renderLink`（及 autolink）：`href` 属性用 `normalizeHref(href)`
   （DOM 上是可打开的完整 URL，Ctrl+Click 的 `openExternal` 无需改）；`.md-syntax` 内
   `](<url>)` 仍用**原始 URL** 转义输出 → `textContent` 与源一致（G6）。

### 4.3 链接 hover 提示（G5）

1. `renderLink` 增加 `data-href` 属性（值为 `normalizeHref(href)`，即补全后可打开的 URL）。
2. `globals.css` `a.inline-link:hover::after` 由 `content: var(--link-tip)` 改为
   `content: attr(data-href)`，补齐定位/背景/圆角/阴影/字号/`pointer-events:none` 样式；
   删除未定义的 `--link-tip` 引用。

### 4.4 明确不动项（回归边界）

- 块树模型、Markdown 双向转换、六条退出规则、撤销/重做、自动保存、查找替换、大纲导航。
- 链接/图片的插入逻辑（`formatCtrl.applyLinkOrImage`）、`unlinkRange`、`link-on-image`。
- 往返不变量：`textContent` 与源一致；序列化输出不变。

## 5. 改动文件清单（预估）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `src/main/index.ts` | 顶层 `registerSchemesAsPrivileged(media)`；whenReady 后调 `registerMediaProtocol()` | 中（启动时序） |
| `src/main/media-protocol.ts`（新增） | `protocol.handle('media')` 映射本地文件 | 中 |
| `src/render/editor/kernel/inlineRenderer.ts` | `toImgSrc` → `media://`；`renderLink` 补 `normalizeHref` + `data-href` | 中 |
| `src/render/editor/kernel/inlineLexer.ts` | `safeUrl` 放行裸域名；新增 `normalizeHref` | 低 |
| `src/render/editor/kernel/index.ts` | 导出 `normalizeHref` | 低 |
| `src/render/components/Editor/v2/EditorV2.tsx` | 容器捕获监听 `img` error → 占位替换 | 中（焦点/渲染时序） |
| `index.html` | CSP `img-src` 放行 `media: https: http:` | 低 |
| `src/render/styles/globals.css` | tooltip `attr(data-href)` + 样式；`.inline-image-fallback` | 低 |
| `tests/` | safeUrl 裸域名矩阵 / normalizeHref / renderInline href 补全 + textContent / toImgSrc → media:// / CSS 静态断言 | — |
| `e2e/` | 链接渲染 href 补全断言；图片本地路径 src → media:// 断言 | — |
| `docs/` | 本需求 + 规划 + modules/04 + SUMMARY 同步 | — |

## 6. 验收标准

- G1：真实 Electron dev 模式，插入本地图片（pickImage 选文件）→ 正常显示图片，无 broken 图标。
- G2：插入 `https://…` 图片 → 正常显示（CSP 放行）。
- G3：图片 src 无效/加载失败 → 回退为占位文本（`.inline-image-fallback`），无 broken 图标。
- G4：`[text](www.baidu.com)` → DOM `a.inline-link[href="https://www.baidu.com"]`；hover 显示提示；
  Ctrl+Click 打开 `https://www.baidu.com`。
- G5：`a.inline-link:hover::after` 内容等于链接完整 URL，样式可见。
- G6：往返不变量与 `textContent` 与源一致（含裸域名链接、本地路径图片）。
- 质量门禁：`tsc --noEmit` + `vitest run` + ESLint(0 error) + `vite build` + `npx playwright test`
  全绿；改动文件 coverage ≥ 80%。

## 7. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| `media://` 协议注册时序（app ready 前） | `registerSchemesAsPrivileged` 放 `index.ts` 顶层，`protocol.handle` 在 whenReady 后；启动冒烟人工验证 |
| `media://` 路径含 `#`/`?`/中文 | `encodeURIComponent` 编码整段路径 + handler `decodeURIComponent`，往返无损；单测覆盖 |
| 图片 onerror 替换影响焦点/光标 | 替换为占位 span 仅当 `img.inline-image` 且 error；不触发块树变更，光标不迁移；E2E 断言 |
| 裸域名放行引入安全风险 | 仍拒绝危险协议；`normalizeHref` 仅补 `https://` 前缀；`openExternal` 走 IPC 白名单 |
| CSP 放行 `media:`/`https:` 被滥用 | 图片来源严格由 `img-src` 限定；不影响其它 `default-src` |
| 回退 | 改动集中在 4 个源文件 + CSS + CSP，可整体 revert；块树与序列化零改动 |

---

> 本需求为链接渲染与本地图片显示修复的设计基线。确认后进入规划阶段；
> 实施偏差回到本需求更新后执行（文档优先）。
