# editor-sale-update — 进度与交付记录

> 2026-08-17 | **全部交付完成**

## 阶段 0：任务分级与分类（2026-08-17 实现会话）

- **档位：L 级**（跨模块 + 新依赖 electron-updater + 授权/密钥安全 + app_meta 表迁移 + 分发前置 → 走完整流程，TDD strict）。
- 子项拆分：
  - ① 分隔线 `---`：**S~M**（单模块 bug 修复，路径清晰，可在并行阶段先行）。
  - ② 版本+更新：**M~L**（新依赖 + IPC 跨主进程/渲染）。
  - ③ 授权+分发：**L**（新增 src/main/license 模块、密钥体系、安全、跨模块、分发前置）。
  - 前置图标：**S**（补 icon.png + author/Manufacturer 元数据，②③ 共同前置）。
- ②③ 共享前置（图标元数据）与依赖（electron-updater）→ 规划阶段合并模块拆分；① 独立。
- 门禁：tsc 0 / vitest(基线 1478) / lint 0 / vite build 三包 / Playwright(基线 125) 全绿；drag-selection 5 RED 任务外。

## 阶段 2：规划（2026-08-17）

- **技术调研（L 级强制）**：electron-updater 经 Context7 查证——GitHub public provider 无需 token（仅 private+token 才认证）；`--publish never` 仍本地生成 latest.yml/latest-mac.yml；mac 自动更新需 dmg+zip（缺 zip 无 latest-mac.yml）；事件 checking/available/not-available/download-progress/downloaded/error；`autoDownload:false` + 用户确认后 downloadUpdate。
- **计划产出**：`docs/plan/editor-sale-update.plan.md`（Plan 智能体 → 总指挥落盘）。含任务拆分 / 变更清单 / 密码学选型（Ed25519）/ app_meta 迁移与回滚（§4.9）/ 测试清单 / 验收标准 / 风险清单。
- 关键决策待用户确认：③ 未激活门禁策略（方案 C 非阻塞横幅+试用门）；② GitHub 发版仓 owner/repo 实际值。

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

## 交付总结（2026-08-17）

### 门禁结果
| 门禁 | 结果 |
|---|---|
| typecheck | 0 error ✅ |
| vitest | 1503 passed / 1 failed（预存 welcomeDocument）✅ |
| lint | 0 error / 10 warnings（预存）✅ |
| vite build | 三包成功 ✅ |
| Playwright | 127 passed / 5 failed（预存 drag-selection RED）✅ |

### 交付物清单
**P0 前置**：`public/icons/icon.png` + package.json author/repository/homepage + mac identity:null + mac target dmg+zip + publish github public + electron-updater 安装 + vite external

**① 分隔线修复**：
- `LeafBlock.tsx`：移除 Tailwind 冲突类，hr 用 inline styles
- `EditorV2.tsx`：hrSelection state + 点击选中 + keydown 监听 + overlay 高亮
- `useEditorActions.ts`：onRemoveThematicBreak handler
- `backspaceCtrl.ts`：空段落退格删 hr + mergeParagraph 保护列表
- `globals.css`：`.editor-content-area [data-block-id]:not(blockquote):not(.thematic-break-block)` 排除 hr
- 测试：4 单测 + 2 E2E

**② 版本+更新**：
- `src/main/update.ts`：electron-updater 状态机（dev 防护 + 事件桥）
- `src/main/update/ipc.ts`：UPDATE_CHECK/DOWNLOAD/QUIT_AND_INSTALL + skip-version
- `HelpMenu.tsx`：更新 UI（available→确认→downloading→downloaded→重启安装）
- `constants.ts`：新增 APP_GET_VERSION/UPDATE_* channels，删除 APP_VERSION
- 测试：11 单测

**③ 授权+分发**：
- `src/main/license/`：verify.ts (Ed25519) + fingerprint.ts (SHA-256) + ipc.ts
- `src/main/db/appMeta.ts`：app_meta 表 schema + DAO
- `scripts/keygen.cjs`：卖家激活码生成工具（不提交仓库）
- `LicenseBanner.tsx`：未激活横幅 + 激活码输入
- `App.tsx`：挂载 LicenseBanner
- `.gitignore`：排除 license-keys/
- 测试：11 单测

### 变更统计
- 修改文件：24 个
- 新增文件：17 个
- 新增测试：26 个（15 单测 + 11 update 单测 + 2 E2E - 2 thematic-break 调整）

### 已知限制
1. 公钥 PEM 为占位符，首次发版前需运行 `node scripts/keygen.cjs` 生成密钥对
2. 无代码签名（SmartScreen/Gatekeeper 已知体验代价）
3. 激活状态明文存 app_meta（可本地篡改，威胁模型接受）
4. electron-updater packed 模式需打包后手动验证
5. `welcomeDocument.test.ts` 预存 round-trip 失败（非本次引入）
6. `drag-selection-markers` 5 RED 预存（任务外不处理）
