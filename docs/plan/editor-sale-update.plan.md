# editor-sale-update — 详细实施计划

> 2026-08-17 | devflow L 级 | Plan 智能体产出，总指挥落盘
> 范围：前置图标 → ①分隔线修复 → ②版本+更新 → ③授权+分发
> 依赖序：**P0 前置 → ①（独立可并行）→ ③ → ②**（②③ 串行，共享 electron-updater 与图标前置）
> 需求来源：`docs/requirements/editor-sale-update.req.md`（已 grill-me 对齐）

## 0. 任务拆分与依赖关系

| 子任务 | 档位 | 前置 | 后置 | 说明 |
|---|---|---|---|---|
| P0 前置图标/元数据/依赖 | S | 无 | ③、②、打包 | `public/icons/icon.png` + package.json `author`/`repository`/`mac.identity` + 安装 electron-updater（`dependencies`） |
| ① 分隔线修复 | S~M | 无 | 无 | bug 修复，独立可并行 |
| ③ 授权+分发 | L | **P0**（打包必需） | ② | 新增 `src/main/license/` + app_meta 建表 + 门禁 + 分发 |
| ② 版本+更新 | M~L | P0（electron-updater + 图标） | — | preload 版本 API + UPDATE_* IPC + 更新状态机 + HelpMenu UI |

**并行性**：① 完全独立，可与 P0/③ 并行。②③ 共享 electron-updater 依赖与图标前置，但相互独立，实现层可并行；验收层 ③ 的「新版本提示→更新」用例需 ② 完成。建议 ① 和 ③ 先并行，② 紧随。

---

## 1. P0 — 前置：图标 / 元数据 / electron-updater 依赖

### 1.1 `public/icons/icon.png`（新增二进制资源）
- 交付一个 PNG 应用图标（**1024×1024 正方形**），立即可建、无明显品牌冲突（纯色/几何图形即可）、背景不透明。
- electron-builder 自动从该 PNG 派生 `.ico`/`.icns`；package.json build 三平台已指向该路径，无需改路径。
- 直接提交静态资产文件，不依赖运行时生成。

### 1.2 `package.json`（编辑已有文件）
- 新增顶层字段（electron-builder 打包必需，避免 MSI/win/mac 打包失败）：
  - `"author": { "name": ..., "email": ..., "url": ... }`
  - `"repository": "..."`（指向公开发版仓，不含源码，仅资产）
  - `"homepage": "..."`（可选）
- `build` 新增：
  - `"publish": { "provider": "github", "owner": "<GH owner>", "repo": "<public assets repo>", "private": false }`——**必须 `private:false`**（否则走 PrivateGitHubProvider 要 token）。
  - `"mac": { ..., "identity": null }`——无签名打包时避免 adhoc 签名找证书失败（已知体验代价：Gatekeeper 拦截）。
- `dependencies` 新增 `"electron-updater": "^6.x"`（**运行时依赖**，必须放 dependencies）。
- `version` 保持 `1.1.0`（后续发版递增）。

### 1.3 `vite.config.ts`（编辑已有文件）
- src/main rollup external 追加 `'electron-updater'`（若 vite-plugin-electron 未自动 externalize）。门禁：`npx vite build` 三包成功。

### P0 验收
- `npm run typecheck` 0；`npx vite build` 三包成功。
- `electron-builder --win nsis` / `--mac dmg`（对应 OS）不再因缺 icon/author 失败。

---

## 2. ① 分隔线 `---` 修复

### 根因回顾（已确认）
- `LeafBlock.tsx:73` 渲染 `<hr>` 无 `.block-content` span，无选中路径。
- globals.css 无 `.thematic-break-block` 显式样式 → 视觉近乎空白。
- `backspaceCtrl.ts` 无 thematic-break 分支；`EditorV2.handleContainerClick` 无 hr 分支。
- thematic-break 是 `contentEditable=false` 独立 `<hr>`，BackspaceAtStart 只能从可编辑 ContentBlock 触发 → 「空段落退格删 hr」与「点击选中删 hr」是两条独立路径，需分别覆盖。

### 2.1 选中态数据结构（`src/render/components/Editor/v2/types.ts`）
新增（对齐 ImageSelection）：
```ts
export interface ThematicBreakSelection {
  blockId: string;
  rect: { top: number; left: number; width: number; height: number };
}
```

### 2.2 点击选中（`EditorV2.tsx`）
- 新增 state `hrSelection`（与 `imageSelection` 并列）。
- `handleContainerClick` 在 img 分支后、`setImageSelection(null)` 前插入 hr 分支：`target.closest('hr.thematic-break-block')` + 校验 `block?.type === 'thematic-break'` → `setHrSelection({blockId, rect})` + `setImageSelection(null)` + `hr.focus()`；return。
- 点击非 hr → `setHrSelection(null)`（与 `setImageSelection(null)` 同处重置）。
- JSX 在 ImageResizeBox 附近新增选中高亮外壳 `.thematic-break-selection`（纯 CSS overlay，pointer-events none，不改内容）。

### 2.3 Backspace/Delete 键盘路由（EditorV2 容器层）
- hr 无 ContentBlock，KeyDown 不走 `handleKeyDown` → 在 `containerRef` 上 `useEffect` 监听 keydown：`hrSelection` 非空且 `Backspace`/`Delete` → `preventDefault` + `stopPropagation` + `onDeleteThematicBreak(blockId)`；`Escape` → 清除选中。
- `useEditorActions.ts` 新增 `onRemoveThematicBreak(blockId)`（走 `applyBlockAction` 统一管线，对齐 image 删除）：
  - 校验块存在且 `type === 'thematic-break'` → `adjacentLeafFocus('prev')` + `removeBlock`；唯一块转空段落（对齐 removeCodeBlock 语义）。
  - 加入 `BlockHandlers` 类型与 `handlers` useMemo。

### 2.4 相邻空段落 Backspace 删 hr（backspaceCtrl.ts）
- `handleBackspaceAtStart` paragraph 分支前插入：空段落 + 前驱 hr → `removeThematicBreakToPrev`（删除 hr 块，光标留空段落开头）。
- `mergeParagraph` 保护列表加入 `thematic-break`（非空段落后不退格把 `---` 并入文本，双保险）。
- 语义边界：**空段落删 hr；非空段落保护**。

### 2.5 `.thematic-break-block` 样式（globals.css）
- 显式样式：`height:0; border:none; border-top:1px solid var(--border-color); margin:1.5rem 0;`（明暗主题均清晰，参考 marktext 深灰横线）。
- `.thematic-break-selection`：`position:absolute; pointer-events:none; z-index:80; border:1px solid var(--accent);` 高亮外壳。
- 若浅色主题下 `--border-color` 过浅，用独立变量两主题分别定义。
- **豁免保持**：不挂 `.block-content`，不改 selectionExport/selection/markdownToState/stateToMarkdown → 改写豁免与文档序叶序计数不回归。

### ① 测试清单
- 单测 `tests/editor/controllers/thematicBreakDelete.test.ts`：
  - `onRemoveThematicBreak` 删除后块数/链表正确；唯一 hr 转空段落。
  - 空段落 + 前驱 hr 退格 → 删 hr，光标 offset 0。
  - 非空段落 + 前驱 hr → 不删不并（保护回归）。
  - `mergeParagraph` 保护列表含 thematic-break。
  - selectionExport 既有覆盖跑通（不回归）。
- e2e：输入 `---` → hr 可见（rect 非空白）；点击 hr → `.thematic-break-selection` 出现；Backspace → hr 消失。

---

## 3. ② 版本 + 更新（electron-updater）

### 3.1 版本号单一来源
- `src/shared/constants.ts`：删除 `APP_VERSION='1.1'`；`IPC_CHANNELS` 新增 `APP_GET_VERSION`/`UPDATE_CHECK`/`UPDATE_DOWNLOAD`/`UPDATE_QUIT_AND_INSTALL`/`UPDATE_EVENT`。
- `ipc-handlers.ts`：`APP_GET_VERSION` → `app.getVersion()`。
- `preload.ts`：新增 `version: { get }` + `update: { check/download/quitAndInstall/onEvent }`（onEvent 对齐 `ai.onStream` 订阅模式）。
- renderer 侧搜索所有 `APP_VERSION` 消费点改走新 API（HelpMenu.tsx:29 等）。

### 3.2 更新状态机（`src/main/update.ts` 单文件）
- `autoUpdater.autoDownload = false`（用户确认才下载）；`autoInstallOnAppQuit = false`。
- 状态：`idle | checking | available | not-available | downloading | downloaded | error | skipped`。
- **dev 模式防护**：`!app.isPackaged` → IPC 返回 `success:false, message:'Update unavailable in dev'`；渲染隐藏/降级入口（e2e mock）。
- main→render 事件桥（`webContents.send(UPDATE_EVENT, payload)`）：checking / update-available(info.version) / update-not-available / download-progress(ProgressInfo) / update-downloaded / error。

### 3.3 IPC handler（`src/main/update/ipc.ts`）
- `UPDATE_CHECK` → checkForUpdates；读 app_meta `updates.skipped_version` 等于新版本 → 返回 `skipped`（不打扰）。
- `UPDATE_DOWNLOAD` → downloadUpdate()。
- `UPDATE_QUIT_AND_INSTALL` → quitAndInstall(false, true)。
- `registerUpdateIpcHandlers()` 在 `registerAllIpcHandlers()` 中调用。

### 3.4 HelpMenu UI
- 版本 label 改 `window.weaveMD.version.get()`。
- 新增更新入口：订阅 `update.onEvent`；状态机驱动 UI：available→确认→downloading(进度)→downloaded→「立即重启安装」；not-available/error→提示+可重试；skipped→不打扰；「跳过此版本」→写 app_meta `updates.skipped_version`。
- 关闭菜单清理订阅。

### ② 测试清单
- 单测：app_meta skipped_version 读写；APP_GET_VERSION；mock autoUpdater 的 UPDATE_CHECK；HelpMenu 各状态 UI（mock window.weaveMD）。
- e2e：mock update API → 发现新版本→确认→下载中→重启安装（纯 UI 流程）。

---

## 4. ③ 授权 + 分发（`src/main/license/`）

### 4.1 模块结构
```
src/main/license/
  ├─ keygen.ts        // 卖家私有：生成密钥对 + 按指纹签发（不随应用分发、不提交）
  ├─ verify.ts        // 应用内嵌公钥验签（verifyLicense）
  ├─ fingerprint.ts   // 机器指纹提取
  ├─ ipc.ts           // registerLicenseIpcHandlers()：激活 / 状态查询
  └─ types.ts         // LicenseStatus 等共享类型
```
- 共享类型放 `src/shared/`（preload/渲染引用）。
- **推荐 keygen 独立为 `scripts/keygen.cjs`**，不引用 src/main 的 verify 模块，减小攻击面。

### 4.2 密码学选型：**Ed25519**（推荐）
- node crypto 原生 `generateKeyPairSync('ed25519')`；`createSign(null).update(payload).end(); sign(privateKey)`；`createVerify(null).update(payload); verify(publicKey, signature)`。
- 公钥 32B / 签名 64B，激活码紧凑可读；本任务仅需验签（离线、不加密），无需 RSA。无三方依赖。
- 备选 RSA-2048：签名 256B 过长，不推荐。

### 4.3 机器指纹（`fingerprint.ts`）
- `fingerprint = sha256(join([os.platform(), os.hostname(), os.userInfo().username, macAddress()]))`
- 首选 `os.networkInterfaces()` 第一张非 internal 网卡 mac；兜底 hostname+username。
- 验签时重算当前 fingerprint，与激活码内嵌 fingerprint 比对 + 验签 → 防一码多用。

### 4.4 激活码格式
- 载荷：`License v1 | fingerprint(hex前16) | base32(signature 64B)`；base32 大小写不敏感无易混字符，5 字符分组 `-` 连接。
- `verifyLicense(code, currentFingerprint)`：解析 → 内嵌公钥验签 → fingerprint 前缀比对，全过才通过。

### 4.5 公钥存放（安全要点）
- 公钥作为**编译期常量**嵌入 `verify.ts`（`const PUBLIC_KEY = '...'`）；私钥**绝不提交**。
- `scripts/keygen.cjs` 生成的 `*.key` 写入 `.gitignore`；`public.key` 由 keygen 脚本 `--emit-const` 输出常量粘贴进 verify.ts。
- 本地离线验签本质可被逆向绕过（风险清单），防护目标是「阻止普通买家/渠道转发扩散」。

### 4.6 激活状态存储（app_meta 表 + DAO）
- `src/main/db/appMeta.ts`：
  - `APP_META_SCHEMA` = `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`。
  - DAO：`getAppMeta(key)` / `setAppMeta(key,value)`（`INSERT ... ON CONFLICT(key) DO UPDATE SET value=..., updated_at=datetime('now')`）。
- 存 key：`license.status` / `license.fingerprint` / `license.activated_at` / `updates.last_check_version` / `updates.skipped_version`（② 共用）。
- **激活码原文不存**（激活即验签通过，减少本地篡改价值）。激活状态明文存 app_meta（可本地篡改，威胁模型接受；不引入 safeStorage 密文，避免过度设计）。

### 4.7 未激活门禁（推荐：**方案 C 非阻塞横幅 + 试用门 + 锁定提示**）
- **启动**：提取 fingerprint + 读 `license.status`。
- **未激活**：
  - 主界面顶部**非阻塞横幅**「未激活，仅用于试用。请点击激活或购买正版」（不硬挡编辑）。
  - 「输入激活码」入口；激活成功 → 去掉横幅。
  - 可选试用期：满后升级为阻塞提示「试用已结束，请输入激活码」（是否启用试用期由用户确认；兜底始终提供手动输入激活码）。
  - 默认（未配置试用期）不硬锁，避免指纹漂移导致不可用。
- **激活后**：横幅消失。

### 4.8 IPC（`src/main/license/ipc.ts`）+ preload
- `LICENSE_STATUS` → `{ success, data: { status } }`（**不下发 fingerprint 原文**）。
- `LICENSE_ACTIVATE(code)`：主进程重算 fingerprint → `verifyLicense` → 通过写 app_meta → `success:true`；失败 `success:false, message:'激活码无效或与当前设备不匹配'`。
- preload `license: { status(); activate(code) }`；`constants.ts` 新增 channel。
- 渲染 UI 挂载调 `license.status()` 渲染横幅/门禁。主进程不做硬门禁（威胁模型接受）。

### 4.9 数据迁移 / 回滚（app_meta 表）
- **现状**：无该表。**模型**：见 4.6。
- **迁移**：`db/index.ts` `runMigrations` 末尾 `database.exec(APP_META_SCHEMA)`（`CREATE TABLE IF NOT EXISTS` 幂等；app_meta 惰性写，读时缺省即默认态，无需 seed）。
- **回滚**：**不 DROP**（丢既有激活/跳过记录）。回滚语义 = 不再读写 + UI 回归默认未激活态；彻底关闭授权则移除门禁调用与 IPC。

### 4.10 分发（win nsis / mac dmg+zip）
- package.json build：win `nsis`（+可选 msi）；mac `target: ["dmg", "zip"]`（**必须加 zip**，否则无 latest-mac.yml 无法 mac 更新）+ `identity: null`；`publish` github public provider。
- **发版流程（手动）**：`npm run build` → `release/` 生成各平台 Installer + `latest.yml`（win）/`latest-mac.yml`（mac）→ 手动上传资产 + yml 到 GitHub public 资产仓 Release tag。
- **暂不签名**：win SmartScreen「未知发布者」；mac Gatekeeper 右键打开。README/docs 记为前提。

### ③ 测试清单
- 单测：keygenVerify（改 fingerprint/签名 → 验签失败）；fingerprint 稳定；appMeta get/set/upsert；migrations 断言含 app_meta；ipc mock 激活成功/失败；门禁 UI mock。
- e2e：mock license → 未激活横幅 → 正确码激活横幅消失；错误码提示。

---

## 5. 门禁（全量验收标准）

| 门禁 | 说明 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run test`（vitest） | 全绿，基线 1478 + 新增用例 |
| `npm run lint` | 0 error |
| `npx vite build` | 三包（main/preload/render）成功；electron-updater 已 external |
| `npx playwright test` | 全绿：新增分隔线/更新/激活用例 + 既有 125 不回归；drag-selection-markers 5 已知 RED 任务外 |
| 打包冒烟 | `electron-builder --win nsis` / `--mac dmg,zip` 可建；`latest.yml`/`latest-mac.yml` 生成 |

---

## 6. 风险清单与已知限制

1. **无代码签名**：win SmartScreen / mac Gatekeeper 拦截或告警（需求已接受）。
2. **本地离线验签可被逆向绕过**：防护目标 = 阻止普通买家/渠道转发扩散，非阻止高级逆向。
3. **激活状态明文可被本地篡改**：本地单机买断场景接受；如需更强未来引入 safeStorage 密文（本任务不引入）。
4. **机器指纹漂移**（换网卡/重装/改用户名 → 原激活失效）：门禁默认非硬锁（横幅），避免不可用；文档注明「重新激活」。
5. **electron-updater dev 模式不可用**：`!app.isPackaged` 防护 + mock 测试。
6. **mac 缺 zip → 无 latest-mac.yml**：已强制加 zip 目标，列入验收。
7. **版本漂移**：升级包版本必须与 package.json 一致（发版时递增 version）。
8. **GitHub public 仓发版**：公开资产可被直接下载——只放资产不放源码，接受。
9. **①改动范围控制**：仅新增 thematic-break 选中/删除/样式/backspace 分支；不碰 selectionExport/markdownToState/stateToMarkdown。
10. **范围外不实现**：在线激活/在线防重放、全平台代码签名、自动化发版 CI、drag-selection-markers 5 RED。
