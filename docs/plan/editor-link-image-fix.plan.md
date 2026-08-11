# 链接渲染与本地图片显示修复 — 实施计划

> 计划编号：PLAN-EDIT-LINK-IMAGE | 状态：待实施 | 更新：2026-08-11
> 需求：[REQ-EDIT-LINK-IMAGE](../requirements/editor-link-image-fix.req.md)
> 任务名：`editor-link-image-fix`

## 总览

修复两个编辑主区缺陷（P1 图片 broken icon / P2 链接不渲染），分 4 个垂直切片推进。

**根因**（已确认）：
- 图片：`toImgSrc` 把 Windows 绝对路径转 `file:///`，dev 页面 http + Chromium webSecurity + CSP `img-src 'self' data:` 三重阻止 → broken icon。
- 链接：`safeUrl` 拒绝无协议裸域名 → link token 不识别 → 纯文本；`--link-tip` 未定义 → tooltip 失效。

**关键架构约束**：
1. `forceSyncBlockDom`（useDomRegistry.ts:32-40）用 `el.innerHTML = display` 回填 DOM → img 占位替换是**瞬态**的（下次重渲染被模型覆盖）。符合 G3"不显示 broken"，无反馈循环。
2. `openExternal` IPC 白名单 `^https?:\/\/`（ipc-handlers.ts:556-560）→ `normalizeHref` 必须补 `https://` 才能打开。

## media:// 协议契约（Worker 对齐）

- 渲染层生成：`media://` + `encodeURIComponent(正斜杠归一化的 Windows 绝对路径)`
  - 盘符：`media://C%3A/Users/me/a.png`；UNC：`media://%2F%2Fserver%2Fshare%2Fa.png`
  - `/`→`%2F`、`:`→`%3A`、空格/中文/`#`/`?` 全部编码，天然避歧义
- handler 解析：`request.url.slice('media://'.length)` → `decodeURIComponent` 一次还原 → 校验 Windows 绝对路径/UNC → `net.fetch(pathToFileURL(decoded))`；非法 404
- 不做二次编码；不用 `file://`

## 实施步骤

### 切片 A：主进程 media:// 协议
- A1 `src/main/index.ts`：顶层（app ready 前、窗口创建前）`protocol.registerSchemesAsPrivileged([{ scheme:'media', privileges: MEDIA_SCHEME_PRIVILEGES }])`；whenReady 内、createMainWindow 前调 `registerMediaProtocol()`
  - **⚠️ 2026-08-11 修正（image-media-display-fix）**：原 `standard:true` 已移除。根因：media 作为标准（层级）scheme 时，Chromium 对 host 做规范化，本契约把盘符编码进 host（`media://C%3A/Users/...`，host 解码为 `C:` 非法）→ 请求被拒、图片加载失败（完整应用实测 handler 收不到 request，触发 `.inline-image-fallback`）。改为非 standard 后 URL 原样透传，`decodeMediaUrl` 契约不变。特权集现由 `media-protocol.ts` 导出 `MEDIA_SCHEME_PRIVILEGES = { secure, supportFetchAPI, stream }`（无 standard），回归单测见 `tests/main/mediaProtocol.test.ts`。
- A2 新增 `src/main/media-protocol.ts`：`registerMediaProtocol()` + `decodeMediaUrl()`；`app.isReady()` 断言；`net.fetch(pathToFileURL(p))` 返回流；catch → 404

### 切片 B：渲染层 media:// 生成 + 链接放行/补协议
- B1 `src/render/editor/kernel/inlineLexer.ts`：
  - 新增 `BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#][^\s]*)?$/i`（需 ≥1 点，拒 `javascript:`/`data:`/`vbscript:`）
  - `safeUrl` 增加 `BARE_DOMAIN_RE.test(trimmed)` 放行
  - 新增导出 `normalizeHref(href)`：`SAFE_URL_RE` 命中 → 原样；`BARE_DOMAIN_RE` 命中 → `https://`+原；否则原样
- B2 `src/render/editor/kernel/inlineRenderer.ts`：
  - `toImgSrc`：Windows 绝对路径/UNC → `media://` + `encodeURIComponent(正斜杠路径)`（不再 file://）；相对/网络原样
  - `renderLink`：href 与 data-href 均用 `normalizeHref(href)`；`.md-syntax` 内 `](url)` 保持**原始** `token.href`（textContent 与源一致）
- B3 `src/render/editor/kernel/index.ts`：导出 `normalizeHref`

### 切片 C：CSP + img error 回退
- C1 `index.html`：`img-src` → `'self' data: https: http: media:`
- C2 `src/render/components/Editor/v2/EditorV2.tsx`：根容器加 `onErrorCapture`，命中 `img.inline-image` error → 判重后 `replaceWith(span.inline-image-fallback)`（alt 或 src 或 `[图片加载失败]`）；不触块树、不改文本

### 切片 D：tooltip CSS + 占位样式
- D1 `src/render/styles/globals.css`：`a.inline-link:hover::after { content: attr(data-href); ... }`（替换 `var(--link-tip)`，删残留引用）；新增 `.inline-image-fallback` 样式

## 变更清单

| 类型 | 文件 | 内容 |
| --- | --- | --- |
| 新增 | `src/main/media-protocol.ts` | media 协议 handler |
| 修改 | `src/main/index.ts` | registerSchemesAsPrivileged + registerMediaProtocol 时序 |
| 修改 | `src/render/editor/kernel/inlineLexer.ts` | safeUrl 放行裸域名 + normalizeHref |
| 修改 | `src/render/editor/kernel/inlineRenderer.ts` | toImgSrc→media://、renderLink normalizeHref+data-href |
| 修改 | `src/render/editor/kernel/index.ts` | 导出 normalizeHref |
| 修改 | `index.html` | CSP img-src |
| 修改 | `src/render/components/Editor/v2/EditorV2.tsx` | onErrorCapture 占位回退 |
| 修改 | `src/render/styles/globals.css` | tooltip attr(data-href) + .inline-image-fallback |
| 测试 | `tests/editor/kernel/inlineLexer.test.ts` | safeUrl/normalizeHref 矩阵 |
| 测试 | `tests/editor/kernel/inlineRenderer.test.ts` | toImgSrc media://、href 补全、textContent |
| 测试 | `tests/editor/kernel/markdownRoundTrip.test.ts` | 裸域名链接/本地图往返不变量 |
| E2E | `e2e/floating-toolbar.spec.ts` | 链接补协议、图片 media://、占位回退 |
| 文档 | `docs/modules/04` + `SUMMARY` | 同步 |

## 验收标准（可验证）

| 目标 | 断言 |
| --- | --- |
| G1 本地图 | 单测 `toImgSrc('C:\\a.png')` → `media://C%3A/a.png`；E2E img src 以 media:// 起；人工 dev 插本地图正常显示 |
| G2 网络图 | CSP 含 `https: http: media:`；E2E https src 正常 |
| G3 失败回退 | E2E error 后出现 `.inline-image-fallback` 且无 broken img |
| G4 链接补协议 | `normalizeHref('www.baidu.com')==='https://www.baidu.com'`；renderInline 含 href/data-href 补全 + `.md-syntax` 保留原始；E2E `a.inline-link[href="https://www.baidu.com"]` |
| G5 tooltip | CSS 静态断言 `content: attr(data-href)` 且无 `--link-tip`；E2E ::after content == href |
| G6 不变量 | textContent === 源；roundTrip(M)===M（含裸域名/本地图） |

质量门禁：tsc + vitest + eslint(0) + vite build + playwright E2E 全绿；改动文件 coverage ≥ 80%。

## 风险与回退

| 风险 | 缓解 | 回退 |
| --- | --- | --- |
| media:// 注册时序 | 顶层注册 + app.isReady 断言 + 冒烟 | 改回 file://+CSP 放行 file: |
| 路径特殊字符 | encodeURIComponent 整段 + 单测覆盖 # ? 中文 空格 | file:// 方案 |
| onerror 影响光标 | 仅命中 img.inline-image + 判重 + DOM 层静态替换 | 移除事件委托 |
| 裸域名安全 | BARE_DOMAIN_RE 强约束 + normalizeHref 仅补 https + openExternal 白名单 | 收紧仅 www. |
| CSP 滥用 | 仅扩 img-src，default-src 不动 | 回退 'self' data: |
| DOM 占位瞬态 | 判重防循环；E2E 在重渲染前断言 | 模型层持久化（超出范围） |
| 既有 file:// 断言变红 | 测试同步更新 | 保留兼容分支（不推荐） |

## 实施顺序

推荐两个并行 worker（文件无交集）：
- Worker-1：切片 A + C（主进程协议、index.ts、index.html CSP、EditorV2 onerror）
- Worker-2：切片 B + D（kernel lexer/renderer/index、globals.css）

测试随各切片落地（TDD）；最后统一全量门禁 + 人工冒烟。
