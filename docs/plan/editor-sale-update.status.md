# editor-sale-update — 进度与交接记录

> 2026-08-17 | grill-me 需求对齐（已完成，非实现）| 本文件为**下一会话交接输入**

## 状态

- **需求交接文档**：`docs/requirements/editor-sale-update.req.md`（3 项，含根因/现状、决策、验收标准、范围外）。
- 3 项已 grill-me 对齐（两轮 AskUserQuestion）：
  - ① 分隔线 `---`：**可见化 + 点击选中删除**（根因：globals.css 无样式 + 无选中/删除路径）。
  - ② 版本 + 更新：**GitHub Releases public 仓（只放资产不放源码）**；版本号改 `app.getVersion()`；electron-updater + 用户确认式更新。
  - ③ 买断售卖：**本地离线激活码验签**（私钥生成/公钥验签/绑机器指纹）+ **暂不签名**；按 win/mac 分发。
- **前置阻塞（③ 必须先处理）**：`public/icons/icon.png` 缺失 + 缺 `author`/Manufacturer 元数据 → win/mac 打包失败（上一任务遗留）。
- 任务外既有阻塞（本任务不处理）：drag-selection-markers 5 RED。

## 下一会话 devflow-core 提示词（用户直接复制）

```
剩余任务：3 项——分隔线修复 + 版本更新 + 买断售卖分发（新开会话）。

【交接背景】grill-me 已对齐需求，见 docs/requirements/editor-sale-update.req.md
（含根因/现状与决策）。当前工作树含未提交改动（editor-optimization-batch 5 项已交付未提交）。

【本次范围】devflow L 级走完整流程（grill-me 已对齐，可直接进规划）：
① 分隔线（bug）：--- 渲染空白+无法选中删除。根因=globals.css 无 .thematic-break-block 样式
   + backspaceCtrl/clickCtrl 无 thematic-break 分支。修复：补明暗可见样式 + 点击 hr 选中→
   Backspace/Delete 删除（对齐 code-block/image-block 删除路径）。保持 selection/改写豁免不回归。
② 版本+更新（功能）：帮助菜单版本号改主进程 app.getVersion()（读 package.json，消除
   constants.ts:147 硬编码双源）；引入 electron-updater，UPDATE_CHECK/DOWNLOAD/QUIT_AND_INSTALL
   IPC + preload；更新源=GitHub Releases public 仓（只放 latest.yml+安装包资产，不放源码，
   无需 token）；新版本提示+用户确认才下载安装；可跳过（记录已跳过版本）。
③ 买断售卖分发（功能）：新增 src/main/license/ 本地离线激活码验签（私钥生成工具卖家私有、
   应用内嵌公钥验签、绑机器指纹、防一码多用）；未激活门禁；新增 app_meta 表存激活/跳过版本；
   按 win(nsis)+mac(dmg) 分发；暂不签名（SmartScreen/Gatekeeper 已知体验代价）。
   【前置】必须先补 public/icons/icon.png + package.json author/Manufacturer 元数据（否则打包失败）。

【参考】②③ 同依赖 electron-updater+图标前置，可合并或 ②→③ 串行；① 独立可先行。
门禁 tsc 0/vitest(基线1478)/lint 0/vite build 三包/Playwright(基线125) 全绿；
drag-selection 5 RED 任务外不处理。需求细节见 req.md。
```

## 分级建议（供下会话阶段 0 参考）

- ① 分隔线：S~M（单模块 bug 修复，路径清晰）。
- ② 版本+更新：M~L（新依赖 electron-updater + IPC + 跨主进程/渲染）。
- ③ 授权+分发：**L**（新增授权模块、密钥体系、安全、跨模块、分发前置）。
- 前置图标：S（补 icon.png + author 元数据，① 前先做或并入 ③）。
