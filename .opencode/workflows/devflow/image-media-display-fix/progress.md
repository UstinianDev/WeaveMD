# 进度：image-media-display-fix（完整 Electron 应用图片加载失败修复）

> 任务名：`image-media-display-fix` | 状态：**已完成** | 日期：2026-08-11
> 需求/计划：同目录 `requirements.md`、`plan.md`

## 根因与修复（一行改动 + 回归单测）

| 项 | 内容 |
|---|---|
| 根因 | `media://C%3A/Users/...` 将盘符 `C:` 编码进 URL **host** 位；scheme 以 `standard:true` 注册时，Chromium 标准 scheme host 规范化拒绝该 URL，**请求不达 handler** → img error → `.inline-image-fallback`（虚线框 + alt "123"） |
| 修复 | `src/main/index.ts` 特权集去掉 `standard:true`（非 standard scheme，URL 原样透传 handler）；特权集下沉 `src/main/media-protocol.ts` 导出 `MEDIA_SCHEME_PRIVILEGES` |
| 回归保护 | `tests/main/mediaProtocol.test.ts` 新增断言：特权集**不含** `standard`（未来加回即红） |
| 未改动 | `toImgSrc` / `decodeMediaUrl` / 渲染层 / 图片工具栏（K4~K6 已实现且通过） |

## 验证证据（2026-08-11 实测）

- **Electron 隔离复现**（真实 toImgSrc/decodeMediaUrl）：
  - `standard:true` 时：盘符+空格+中文、盘符+# → 全部 `ERROR`，handler `request.url=[]`（根因实证）
  - 去掉 `standard` 后：全部 `LOAD:1x1`（修复实证）
- **真机端到端**（Playwright `_electron` 启动构建后真实主进程 + 真实渲染页，注入 `media://C%3A/Users/.../屏幕截图%202026...png`）：**`RESULT:LOAD:1x1`**
- vitest：**718 passed**（41 files，基线 716 + 新增 2）
- `npx tsc --noEmit`：0 error；`npx eslint src/ --ext .ts,.tsx`：0 error
- `npx vite build`：renderer + dist-main + preload 三目标通过；dist-main 产物核验**不含** `standard`
- `npx playwright test`：**54 passed / 5 failed**——5 个全部为 `drag-selection-markers.spec.ts` 既有「当前 RED」跨任务缺陷，未触碰（与基线一致）

## 遗留风险 / 未决

- e2e（renderer-only）仍无法覆盖完整 app media:// 加载；复现/验证方法保留在本任务文档（Electron 隔离脚本 + Playwright `_electron` 真机脚本）。
- `drag-selection-markers` 5 条 e2e 既有 RED，另立任务。
- 未推送远程（无授权）。

## 下一任务建议

`drag-selection-markers e2e RED（5 用例）`（历史遗留）；可考虑把 media:// 真机验证固化为 Playwright `_electron` e2e（本任务已留脚本）。
