# editor-package-distribute — 需求交接文档

> 2026-08-17 | 从 editor-sale-update 简化而来：去掉激活码，专注打包分发

## 变更背景

原 editor-sale-update 包含 ③ 授权+分发（激活码验签）。决策调整：
- **去掉激活码**：不搞离线激活，安装包直接可用
- **防扩散**：首次启动弹一次「支持正版」提示（可关闭，不阻塞功能）
- **打包**：win nsis + mac dmg，暂不签名
- **远期**：赚差不多就开源

## 任务范围

### T1 清理 license 模块（删除已实现代码）

删除以下文件/代码（③ agent 已实现，需回滚）：

**删除文件**：
- `src/main/license/verify.ts`
- `src/main/license/fingerprint.ts`
- `src/main/license/ipc.ts`
- `src/shared/license.ts`
- `scripts/keygen.cjs`
- `src/render/components/License/LicenseBanner.tsx`
- `tests/main/license/keygenVerify.test.ts`
- `tests/main/license/fingerprint.test.ts`
- `e2e/fixtures/mockApi.ts`（可保留，不删除）

**修改文件（移除 license 相关）**：
- `src/shared/constants.ts`：删除 `LICENSE_STATUS` / `LICENSE_ACTIVATE` channel
- `src/main/preload.ts`：删除 `license` namespace
- `src/main/ipc-handlers.ts`：删除 `registerLicenseIpcHandlers` 调用和 import
- `src/main/db/index.ts`：保留 `app_meta` 表（update 跳过版本仍需），但删除 license 相关注释
- `src/render/App.tsx`：删除 `LicenseBanner` import 和挂载
- `tests/setup.ts`：删除 license mock
- `.gitignore`：保留 `license-keys/` 条目（无害）或删除

**保留**：
- `src/main/db/appMeta.ts`（update 跳过版本用）
- `src/main/update.ts` + `src/main/update/ipc.ts`（② 版本更新）
- 所有 E2E 测试中的 `license: { status: async () => ok({ status: 'activated' }) }` mock（无害，保留即可）

### T2 首次启动弹窗（购买提示）

**需求**：首次启动显示「支持正版」提示，含购买信息，可关闭，不阻塞功能。

**实现要点**：
- `src/render/components/Purchase/PurchasePrompt.tsx`：模态弹窗或顶部横幅
- 内容：「感谢使用 WeaveMD！如需持续更新和支持，请通过淘宝购买正版。」+ 淘宝链接（占位）
- 用 `app_meta` 记录 `purchase.prompt_dismissed = 'true'`（关闭后不再弹）
- 挂载到 `App.tsx`（替代 LicenseBanner 的位置）
- 不阻塞编辑器使用

**验收**：首次启动弹窗可见；点击关闭后不再弹；重启后仍不弹。

### T3 打包 win nsis + mac dmg

**前置（已完成）**：
- `public/icons/icon.png` ✅
- `package.json` author/repository/homepage ✅
- `package.json` build.mac.target: ["dmg", "zip"] ✅
- `package.json` build.mac.identity: null ✅
- `package.json` build.publish: github public ✅
- `electron-updater` 依赖 ✅

**打包流程文档**：
- 写一份 `docs/guide/packaging.md`，说明：
  1. `npm run build` 生成 `release/` 目录
  2. win：`release/WeaveMD Setup x.x.x.exe`（nsis）
  3. mac：`release/WeaveMD-x.x.x.dmg` + `release/WeaveMD-x.x.x-mac.zip`
  4. `latest.yml`（win）/ `latest-mac.yml`（mac）自动生成
  5. 手动上传到 GitHub public 仓 Release tag
  6. 无签名：win SmartScreen「未知发布者」/ mac 右键打开

**验收**：
- `npm run build` 在 Windows 上生成 nsis 安装包
- 打包产物可安装运行
- `latest.yml` 生成

## 门禁

| 门禁 | 说明 |
|---|---|
| typecheck | 0 error |
| vitest | 全绿（删除 license 测试后基线回落） |
| lint | 0 error |
| vite build | 三包成功 |
| Playwright | 全绿（125 基线不回归） |

## 范围外

- Mac 代码签名（暂不签名）
- 自动化发版 CI
- 在线激活 / 授权服务
- drag-selection-markers 5 RED
