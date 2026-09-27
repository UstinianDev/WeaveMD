# WeaveMD 打包指南

> 本文档说明如何将 WeaveMD 打包为可分发的安装包。

## 前置条件

- Node.js 18+
- npm 9+
- 已配置 `package.json` 中的 build 配置（已完成）

## 打包命令

```bash
npm run build
```

该命令按 npm 生命周期依次执行：

1. `prebuild` → `npm run clean`（`scripts/clean.mjs`）：删除 `dist-main/`、`dist-render/`
   全部生成物。`vite-plugin-electron` 不清空 `outDir`，历史哈希分片会无限累积
   （2026-09-27 实测未清理时 211 个文件约 176MB，其中 `index-*.js` 分片 204 份），
   且 `build.files` 配了 `dist-main/**/*`，不清理会全部打进安装包
2. `vite build` 构建渲染进程与主进程
3. `electron-builder` 打包 Electron 应用
4. `postbuild` → `npm run size`（`scripts/sizeGate.mjs`）：体积门禁断言，
   **任一口径超限即 fail build**（详见下文「体积门禁」）

单独运行体积断言：

```bash
npm run size
```

## 打包产物

打包完成后，产物位于 `release/` 目录：

### Windows

- `WeaveMD Setup x.x.x.exe` — NSIS 安装包
- `latest.yml` — 自动更新配置文件

### macOS

- `WeaveMD-x.x.x.dmg` — DMG 安装包
- `WeaveMD-x.x.x-mac.zip` — ZIP 压缩包（用于自动更新）
- `latest-mac.yml` — 自动更新配置文件

## 分发流程

### 1. 本地打包

```bash
# 清理旧产物
rm -rf release/

# 打包
npm run build
```

### 2. 上传到 GitHub Release

1. 在 [GitHub Releases](https://github.com/UstinianDev/WeaveMD/releases) 创建新的 Release（Tag 格式：`v1.2.0`）
2. 上传以下文件：
   - Windows：`WeaveMD Setup x.x.x.exe`
   - macOS：`WeaveMD-x.x.x.dmg` + `WeaveMD-x.x.x-mac.zip`
3. 发布 Release

### 3. 自动更新

应用内置 `electron-updater`，会自动检测 GitHub Release 中的新版本：

- Windows：读取 `latest.yml`
- macOS：读取 `latest-mac.yml`

用户启动应用时会自动检查更新，也可手动检查（设置 → 关于 → 检查更新）。

## 注意事项

### 无签名打包

当前版本未进行代码签名：

- **Windows**：安装时会显示「未知发布者」警告，用户需点击「仍要运行」
- **macOS**：首次打开需右键 → 打开，或在系统偏好设置中允许

### 版本号管理

版本号在 `package.json` 的 `version` 字段中管理，打包前请确保已更新。

### 平台特定打包

如需只打包特定平台：

```bash
# 仅 Windows
npx electron-builder --win

# 仅 macOS
npx electron-builder --mac

# 仅 Linux
npx electron-builder --linux
```

## 故障排除

### 打包失败

1. 检查 Node.js 版本：`node --version`
2. 清理缓存：`rm -rf node_modules/.cache`
3. 重新安装依赖：`npm install`

### 安装包无法运行

1. 检查系统架构（x64 / arm64）
2. 检查是否被杀毒软件拦截
3. Windows：以管理员身份运行
4. macOS：右键 → 打开

## 相关配置

打包配置位于 `package.json` 的 `build` 字段：

```json
{
  "build": {
    "appId": "com.weavemd.app",
    "productName": "WeaveMD",
    "files": [
      "dist-render/**/*",
      "dist-main/**/*",
      "public/**/*",
      "!node_modules/react-icons/**",
      "!react-icons/**",
      "!node_modules/monaco-editor/**",
      "!monaco-editor/**",
      "!node_modules/@llamaindex/liteparse/liteparse.linux-x64-gnu.node",
      "!node_modules/@llamaindex/liteparse/libpdfium.so",
      "!@llamaindex/liteparse/liteparse.linux-x64-gnu.node",
      "!@llamaindex/liteparse/libpdfium.so",
      "!liteparse/liteparse.linux-x64-gnu.node",
      "!liteparse/libpdfium.so",
      "!node_modules/jieba-wasm/pkg/web/**",
      "!node_modules/jieba-wasm/pkg/deno/**",
      "!node_modules/jieba-wasm/pkg/bundler/**",
      "!jieba-wasm/pkg/web/**",
      "!jieba-wasm/pkg/deno/**",
      "!jieba-wasm/pkg/bundler/**",
      "!node_modules/better-sqlite3/deps/**",
      "!better-sqlite3/deps/**"
    ],
    "mac": {
      "target": ["dmg", "zip"],
      "identity": null
    },
    "win": {
      "target": ["nsis", "msi"]
    },
    "linux": {
      "target": "AppImage"
    },
    "publish": {
      "provider": "github",
      "owner": "UstinianDev",
      "repo": "WeaveMD",
      "private": false
    }
  }
}
```

### files 反向排除说明（doc-pipeline B10 七-1 / 七-2）

electron-builder `^24.13.3` 实测（2026-09-27，`DEBUG=electron-builder` + asar list 双验证）：
`files` 中的 `!` 排除对生产依赖 `node_modules` 生效；node_modules 拷贝的匹配基准
（「依赖目录父目录」与「项目根」两种口径）并存，因此每条排除同时写了
`!node_modules/<path>` 与依赖相对路径两种形式，任一口径命中即生效。

| 排除项 | 体积 | 依据（不改任何功能） |
|---|---|---|
| `react-icons` | ~81.9MB | 渲染层全部为具名导入，Vite/Rollup 按 `sideEffects:false` tree-shake 内联进 `dist-render`；包内副本为死重。剔除后由 `tests/components/IconInventory.test.tsx` 全表回归 + 打包实测图标渲染兜底 |
| `monaco-editor` | ~68.5MB | 运行时验证通过（Q5 唯一判定出口）：完整启动 + 源代码模式（Monaco 实际加载渲染）会话中 asar 副本零加载，`monacoSetup.ts` 已 `loader.config({ monaco })` 使用 Vite 内联副本；无 CDN 兜底请求 |
| liteparse Linux 件（`liteparse.linux-x64-gnu.node` + `libpdfium.so`） | ~31.9MB | Windows 包内 Linux 原生件永不加载；win32 件在 `@llamaindex/liteparse-win32-x64-msvc`（保留）。**注意：构建 Linux AppImage 前须移除这两条排除**，否则 linux 目标缺原生件 |
| `jieba-wasm` 的 `pkg/{web,deno,bundler}` | ~11.7MB | `tokenizer.ts` 动态 `require('jieba-wasm')` 经 package.json `exports` 的 `require`/`node` 条件只解析到 `pkg/nodejs`（实测 `require.resolve` 确认）；保留 nodejs 一份 |
| `better-sqlite3/deps/` | ~9.6MB | `deps/sqlite3/*.c` 为构建期源码，运行期不读取。**绝未排除 `build/Release/*.node`**——`scripts/sizeGate.mjs` 的 `ASAR_REQUIRED` 断言每次打包强制校验其存在，误伤即 fail build |

## 体积门禁（doc-pipeline B10 七-3）

`scripts/sizeGate.mjs`（`postbuild` 自动执行，`npm run size` 可单独运行）：

- **双口径断言**：`release/*.exe`、`release/*.msi` ≤ **500MB**（目标 + 门禁）；
  `release/win-unpacked/` ≤ **1GB**（硬红线）——任一超限 **exit 1，fail build**
- **asar 内容断言**：`ASAR_REQUIRED`（better-sqlite3 原生件必须在位，防排除误伤）
  + `ASAR_FORBIDDEN`（被排除项重新出现 = glob 静默失效，即 fail）
- **top-N 体积贡献者**：asar 内 top 文件 / top 包分组 + win-unpacked top 文件各 10 条，
  便于定位体积回归
- **零网络依赖**：仅本地 `stat` / asar 头解析
- 基线写入脚本注释（2026-09-25：Setup 147.68MB / win-unpacked 602.1MB / app.asar 287.09MB）

> 二-5 Docling PoC 若要转正，必须先重跑本门禁（源文档七-3②）。

## 参考

- [electron-builder 文档](https://www.electron.build/)
- [electron-updater 文档](https://www.electron.build/auto-update)
