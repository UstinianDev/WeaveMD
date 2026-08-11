# 实现计划：image-media-display-fix

> 任务名：`image-media-display-fix` | 日期：2026-08-11 | 状态：已规划
> 需求：同目录 `requirements.md`（已确认）

## Overview

修复完整 Electron 应用里 media:// 图片加载失败：去掉 `standard:true` 使 scheme 非 standard，`media://C%3A/Users/...` URL 原样透传到 handler。改动最小（仅主进程特权配置），渲染层/URL 契约/既有测试零影响。已用隔离 Electron 脚本实证（见 requirements.md 根因）。

## 设计决策

### D1：去掉 `standard:true`，改为非 standard scheme
- **现状**：`src/main/index.ts` 顶层 `protocol.registerSchemesAsPrivileged([{ scheme:'media', privileges:{ standard:true, secure:true, supportFetchAPI:true, stream:true } }])`。
- **问题**：`standard:true` 使 media 成为层级/权威式 scheme，Chromium 对 URL host 做规范化；`media://C%3A/Users/...` 的 host `C%3A` 解码为 `C:`（非法 host）→ URL 被拒，请求不达 handler。
- **修复**：特权改为 `{ secure:true, supportFetchAPI:true, stream:true }`（无 `standard`）。非 standard scheme 将 URL 当不透明串透传，`media://C%3A/Users/...` 原样到达 handler，`decodeMediaUrl` 契约不变。
- **验证**：Electron 实证，盘符+空格+中文、盘符+# 均 LOAD。
- **安全**：`secure:true` 保持（同 https 上下文，防 mixed-content）；未引入 `bypassCSP`（应用无 CSP，非必要不放开）；不涉及认证/权限，无安全回退。

### D2：特权常量下沉 + 回归单测
- `src/main/media-protocol.ts` 导出 `export const MEDIA_SCHEME_PRIVILEGES = { secure:true, supportFetchAPI:true, stream:true }` + 根因注释（`C%3A` host 被标准 scheme 拒绝）。
- `src/main/index.ts` 改引该常量（保持顶层调用时机不变：`registerSchemesAsPrivileged` 仍须在 app ready 前）。
- 单测 `tests/main/mediaProtocol.test.ts` 追加：`MEDIA_SCHEME_PRIVILEGES` 不含 `standard`，含 secure/supportFetchAPI/stream——**直接防本 bug 回归**（若未来有人加回 `standard`，测试红）。

### D3：不改 renderer / handler
- `toImgSrc`（`media://C%3A/...`）、`decodeMediaUrl`、图片工具栏、直选插入均不动。既有断言（inlineRenderer.test / mediaProtocol.test / imageToolbarV2 / LINK-IMAGE-E5）继续有效。

## 变更清单

| 类型 | 路径 | 职责 |
|---|---|---|
| 修改 | `src/main/media-protocol.ts` | 导出 `MEDIA_SCHEME_PRIVILEGES`（无 standard）+ 根因注释 |
| 修改 | `src/main/index.ts` | `registerSchemesAsPrivileged` 改引共享常量 |
| 测试 | `tests/main/mediaProtocol.test.ts` | 追加特权集断言（无 standard） |
| 文档 | `docs/plan/editor-link-image-fix.plan.md` | A1 特权行 + 非 standard 理由 |
| 文档 | `.opencode/workflows/devflow/image-media-display-fix/*.md` | 本任务 requirements/plan/progress/compliance |

## 分阶段实施顺序

### P1：特权修复（低风险）
- 改 `media-protocol.ts` + `index.ts`。
- 单测追加特权断言。
- **验证**：隔离 Electron 复现脚本（重跑确认 LOAD）；vitest + tsc + eslint + build。

### P2：文档同步 + 门禁
- `docs/plan/editor-link-image-fix.plan.md` 特权行更新；workflow 文档补 progress/compliance。
- 全量门禁：vitest / tsc / eslint / vite build / playwright e2e（除既有 RED）。

## 依赖与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 去掉 standard 影响其他 media:// 使用 | 低 | 应用仅 `<img>` 使用；Electron 实证 LOAD |
| 未来有人加回 standard 导致回归 | 中 | D2 单测直接断言无 standard |
| e2e 仍无法覆盖完整 app media:// | 低 | 隔离 Electron 复现脚本保留为文档证据；文档注明复现方法 |
| 打包产物/主进程需重启才生效 | 低 | dev 下 vite-plugin-electron 自动重启主进程；交付时说明 |

## 成功标准

- [ ] Electron 实证：去 standard 后真实契约函数 LOAD（盘符+空格+中文、盘符+#）
- [ ] vitest 全绿（716 既有 + 新增特权断言）、tsc 0、eslint 0、vite build 通过、e2e 除既有 5 RED 外全绿
- [ ] 硬约束：仅本任务范围；renderer 图片链路/URL 契约未动
