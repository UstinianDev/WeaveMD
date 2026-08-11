# 需求：image-media-display-fix（完整 Electron 应用图片加载失败修复）

> 任务名：`image-media-display-fix` | 日期：2026-08-11 | 状态：已确认（grill-me 三问定位 + Electron 实证复现）

## 背景与问题

**用户报告**：输入 123 → 选中 123 → 浮动工具栏「图片」→ 选文件后，123 未被图片覆盖，出现"虚线框 + 灰白色 123 占位"。

**grill-me 定位（用户三问确认）**：
1. 文件选择框弹出了 ✓ → 新版直选流程在运行（非旧版两段式）
2. 源码为 `![123](C:\...真实路径...)` ✓ → 真实路径已正确写入（非空 src）
3. 全新启动过 ✓ → 排除旧构建/主进程未重启

→ 结论：**完整 Electron 应用里 media:// 图片加载失败**，`.inline-image-fallback`（alt="123"）替代显示。

## 根因（Electron 实证复现，隔离脚本）

**`media://C%3A/Users/...` 把盘符 `C:` 编码为 `C%3A` 放在 URL 的 host 位**。该 scheme 以 `standard:true` 注册（`src/main/index.ts`），Chromium 标准 scheme URL 规范化**直接拒绝 host 含 `%3A`（解码为 `:`，非法 host）的 URL**——**请求根本不发出**（`protocol.handle` 收不到 `request`），img 同步 error → fallback。

- 复现脚本（`media://` + 真实 `toImgSrc`/`decodeMediaUrl` + `standard:true`）：`img.onerror`，handler `request.url=[]`
- 对照验证：去掉 `standard:true`（非 standard scheme，URL 原样透传）后，盘符+空格+中文、盘符+# 路径均 **LOAD:1x1 成功**

**为什么 e2e 没抓到**：e2e 是 renderer-only vite server（无主进程 handler），media:// 404→fallback 被当作预期环境行为；本 bug 只在**完整 Electron（有 media:// handler）**下暴露。

## 目标

1. 完整应用里，选本地图插入 → **图片真实显示**（不再 fallback 虚线占位）。
2. 修复改动最小化：URL 形态（`media://C%3A/Users/...`）、`decodeMediaUrl`、渲染层 `toImgSrc` **全部保持**；仅调整主进程 scheme 特权。
3. 点击图片 → 图片工具栏（修改图片/内联图片/居左/居中/居右/移除图片，中文）——**该能力已实现**（K4~K6 + LINK-IMAGE-E5 已过），图片能显示后自然可用；本任务不重做。

## 范围

### 在内
- `src/main/index.ts`：media scheme 特权去掉 `standard:true`（改引共享常量）。
- `src/main/media-protocol.ts`：导出 `MEDIA_SCHEME_PRIVILEGES` 常量（`secure` / `supportFetchAPI` / `stream`，无 `standard`）+ 根因注释（防回归）。
- 回归单测：断言特权集不含 `standard`。
- 文档：`docs/plan/editor-link-image-fix.plan.md` 特权行同步；本任务 workflow 文档（requirements/plan/progress/compliance）。

### 不在内
- URL 形态重构（如改 `media://localhost/<path>`）——非必要，非 standard 已验证可行。
- 图片工具栏、直选插入、对齐等已实现功能的重做。
- `drag-selection-markers` 既有 5 e2e RED（跨任务，不动）。

## 成功标准

1. 隔离 Electron 复现：去掉 `standard` 后，真实 `toImgSrc`/`decodeMediaUrl` 对盘符+空格+中文、盘符+# 路径 → `LOAD`。
2. 门禁全绿：vitest（既有 716 + 新增）、tsc 0 error、eslint 0 error、vite build 通过、e2e 除既有 RED 外全绿。
3. 硬约束：仅本任务范围；未改动 renderer 图片链路/URL 契约。
