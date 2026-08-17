# editor-sale-update — 需求交接文档（3 项：分隔线修复 / 版本更新 / 买断售卖分发）

> 2026-08-17 | grill-me 已对齐（两轮 AskUserQuestion 确认）
> 本文件为**新会话交接输入**：用户以 `/devflow-core` 启动，提示词见 `docs/plan/editor-sale-update.status.md`。
> 建议 slug：`editor-sale-update`。3 项中①独立可先行；②③强耦合（同依赖 electron-updater + 图标前置），建议合并或 ②→③ 串行。

## 需求总览

| # | 类型 | 需求 | 已对齐决策 |
|---|---|---|---|
| ① | bug 修复 | 编辑区 `---` 分隔线渲染空白 + 无法选中删除 | **可见化 + 点击选中删除** |
| ② | 功能 | 帮助菜单版本号 + 新版本提示 + 点击实时更新 | **GitHub Releases public 仓（只放资产不放源码）** |
| ③ | 功能/分发 | 淘宝/拼多多买断售卖：按 win/mac 发安装包，包更新，不开源不建下载站 | **本地离线激活码验签（私钥生成/公钥验签/绑机器指纹）+ 暂不签名** |

---

## ① 分隔线 `---` 渲染空白 + 无法删除（bug）

### 根因（已查证）
- `LeafBlock.tsx:73`：渲染原生 `<hr contentEditable={false}>`，**无 `.block-content` span** → 选区/点击落不到它。
- globals.css **无 `.thematic-break-block` 样式定义**（全仓库唯一引用在 LeafBlock.tsx:73），仅 Tailwind `border-t border-[var(--border-color)]` 一条极细线 → 视觉近乎空白。
- `backspaceCtrl.ts:24-49` **无 thematic-break 分支**（只处理 code-block/heading+list-item+blockquote/paragraph）；`clickCtrl.ts:10-19` 仅任务复选框 toggle；EditorV2 `handleContainerClick`(:201) 不特判 hr → **没有任何选中/删除路径**。
- `mergeParagraph`（backspaceCtrl.ts:44,59）保护列表含 code-block/image-block，**未含 thematic-break**。
- selection.ts `nearestContentSpan`（:131-135）依赖 `span.block-content` → hr 天然豁免（selectionExport.ts:46-48 已把 thematic-break 排除在改写外），改动需保持该豁免。

### 决策（已对齐）
**可见化 + 点击选中删除**：
- 补 `.thematic-break-block` 显式样式（明暗主题可见的清晰横线，用 `--border-color`，可参考 marktext 深灰横线）。
- 新增 thematic-break 点击选中：点击 hr（data-block-id 命中）→ 标记选中态（高亮外壳），Backspace/Delete 走块树删除路径（对齐 code-block/image-block 删除）。

### 验收标准
- `---` 渲染为明暗主题清晰可见的分隔线（非空白）。
- 点击 hr 可选中（有高亮反馈）；Backspace/Delete 删除该块。
- 相邻空段落 Backspace 可删 hr（对齐其它块删除路径）。
- 跨块拖选/改写/大纲对 thematic-break 的既有豁免行为不回归（文档序叶子计数不破坏）。
- 门禁：tsc 0 / vitest 全绿（新增 thematic-break 选中删除单测）/ lint 0 / Playwright（新增分隔线选中删除用例）全绿。

---

## ② 帮助菜单版本号 + 新版本提示 + 实时更新（功能）

### 现状（已查证）
- `HelpMenu.tsx:29` 版本来自 `src/shared/constants.ts:147` **硬编码 `'1.1'`**，与 package.json `1.1.0` 不同步（改包版本不改界面）。
- **无 electron-updater**（node_modules 无，依赖无）；无 update IPC；主进程无 `app.getVersion()` 通道；preload 无 version/update API。
- release 无 mac/linux 产物；`public/icons/icon.png` 缺失（三平台 icon 均指向它）。
- `src/main/db/` 无 app 级元数据表（`settings` 是 user_id UNIQUE 不适合 app 全局状态）。

### 决策（已对齐）
**GitHub Releases public 仓（只放资产，不放源码）**：
- 建 GitHub **public 仓库，只放编译产物资产 + latest.yml，不放任何源码**（不算开源源码；electron-updater 无需 token 即可检查更新）。
- 版本号改为主进程 `app.getVersion()`（读 package.json）经 preload 暴露，消除硬编码双源漂移。
- 引入 `electron-updater`：`UPDATE_CHECK` / `UPDATE_DOWNLOAD` / `UPDATE_QUIT_AND_INSTALL` IPC + preload 桥接。
- 新版本提示：用户可**确认是否更新**（点击才下载/安装，非静默强制）。

### 验收标准
- 帮助菜单显示版本与 package.json 一致（`app.getVersion()` 单一来源）。
- 有新版本时帮助菜单出现「发现新版本」提示；点击 → 用户确认 → 下载 → 提示重启安装 → 更新完成。
- 无新版本时不打扰；用户可跳过（记录"已跳过版本"）。
- 更新失败（网络/下载中断）明确提示、可重试，不影响当前使用。
- 门禁：tsc 0 / vitest 全绿 / lint 0 / vite build 三包成功（electron-updater 主进程 external）/ Playwright（更新 UI 流程 mock）全绿。

---

## ③ 淘宝/拼多多买断售卖：授权 + 分发 + 更新（功能/分发）

### 现状（已查证）
- 纯本地单机；**零授权/零防扩散**——任何拿到安装包的人都能运行、无限转发。
- 登录为本地 JWT（secret 由 `sha256(userData)` 派生，ipc-handlers.ts:33-40），无激活码/机器码/许可证。
- 打包：win nsis+msi、mac dmg、linux AppImage（package.json:77-91）；`public/icons/icon.png` 缺失。
- 唯一远程依赖为 AI API（按需填 key）。

### 决策（已对齐）
**本地离线激活码验签（买断）**：
- **私钥/公钥方案**：卖家持私钥生成激活码（绑机器指纹），应用内嵌公钥离线验签，与现有本地 JWT 同思路、**无需服务器**。
- 激活码 = 机器指纹签名，防一码多用/防重放；首次启动输入激活码激活，存激活状态。
- 未激活 → 门禁（降级只读/试用或锁定，实现期定）。
- **分发**：按买家 OS（win nsis 安装包 / mac dmg）发对应产物；**暂不代码签名**（Windows SmartScreen「未知发布者」警告、mac 右键打开或 Gatekeeper 拦截——作为已知体验代价记录）。

### 关键实现约束
- 新增 `src/main/license/` 模块（密钥对生成工具 + 激活码校验 + 机器指纹提取）+ IPC（激活/状态查询）+ preload。
- 激活码生成是**卖家私有工具**（CLI/脚本），不随应用分发、不提交仓库。
- 新增 app 级元数据表（`app_meta(key,value,updated_at)`）存激活状态/上次检查版本/已跳过版本（不污染 `history`/`settings`）。
- **前置阻塞**：`public/icons/icon.png` 缺失导致 win/mac 打包失败——本任务分发必须先补图标 + `author`/Manufacturer 元数据（上一任务遗留）。
- 授权 key/激活状态存储强度参考 AI key（safeStorage）；不 hardcode。

### 验收标准
- 卖家可用私钥工具生成激活码；应用内公钥验签通过才完全可用（未激活门禁生效）。
- 同一激活码在不同机器失效（机器指纹绑定）；本机激活后重启保留。
- win nsis + mac dmg 产物可构建（补图标后）；按 OS 分发。
- 新版本：买家点帮助新版本提示 → 确认 → 更新到新版本（electron-updater 链路，与 ② 同一套）。
- 无开源：仓库无源码；激活码工具不外发。
- 门禁：tsc 0 / vitest 全绿 / lint 0 / vite build 三包成功 / Playwright（激活流程 mock）全绿。

---

## 范围外 / 另开任务
- 在线激活服务 / 在线防重放（本任务仅离线验签）。
- 全平台代码签名（本任务暂不签名，作为已知体验代价）。
- 自动化发版 CI（GitHub Actions 自动构建 release）——本任务可手动发版。
- 任务外既有阻塞（另开）：drag-selection-markers 5 RED。

## 门禁总则
- `npm run typecheck` 0 error | `npm run test` 全绿（当前基线 1478）| `npm run lint` 0 error | `npx vite build` 三包成功 |
  `npx playwright test` 全绿（新增用例 + 既有 125 不回归；drag-selection-markers 5 已知 RED 为任务外）。
- 任务外既有阻塞（本任务 ③ 需先处理）：electron-builder MSI/win/mac 缺 `public/icons/icon.png` + `author` 元数据。
