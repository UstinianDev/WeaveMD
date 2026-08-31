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

该命令会：
1. 运行 `vite build` 构建渲染进程
2. 运行 `electron-builder` 打包 Electron 应用

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
    "mac": {
      "target": ["dmg", "zip"],
      "identity": null
    },
    "win": {
      "target": "nsis"
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

## 参考

- [electron-builder 文档](https://www.electron.build/)
- [electron-updater 文档](https://www.electron.build/auto-update)
