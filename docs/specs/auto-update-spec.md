# 自动更新规范

> 版本：1.0 | 日期：2026-09-16 | 作者：WeaveMD

## 1. 概述

WeaveMD 使用 `electron-updater` (v6.x) 实现 Windows (NSIS) 自动更新，发布到 GitHub Releases。

## 2. 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (HelpMenu.tsx)                                     │
│  用户点击 "检查更新" → IPC UPDATE_CHECK                       │
│  接收 UPDATE_EVENT → 更新 UI 状态                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────────────┐
│  Main Process                                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ update.ts                                                │ │
│  │  initAutoUpdater()     — 初始化（app.whenReady 调用）     │ │
│  │  checkForUpdates()     — 检查更新（含版本比较）           │ │
│  │  checkForUpdatesAndNotify() — 检查 + 广播事件             │ │
│  │  downloadUpdate()      — 下载更新                        │ │
│  │  quitAndInstall()      — 退出并安装                      │ │
│  │  sendEvent()           — 广播 UpdateEvent 到所有 Renderer │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ update/ipc.ts                                            │ │
│  │  registerUpdateIpcHandlers() — IPC 通道注册              │ │
│  │  通道：UPDATE_CHECK / UPDATE_DOWNLOAD /                    │ │
│  │        UPDATE_QUIT_AND_INSTALL / UPDATE_SKIP_VERSION     │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ electron-updater (node_modules)                           │ │
│  │  NsisUpdater → GitHubProvider                             │ │
│  │  1. 获取 Atom Feed: releases.atom                         │ │
│  │  2. 解析最新 tag                                          │ │
│  │  3. 下载 latest.yml                                       │ │
│  │  4. 版本比较 (semver.gt)                                  │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 3. 关键设计决策

### 3.1 静态 import（非动态）

```typescript
// ✅ 正确 — 静态 import，模块加载时完成
import { autoUpdater } from 'electron-updater';

// ❌ 错误 — 动态 import，失败时 autoUpdater 为 null，静默失效
void import('electron-updater').then((mod) => { ... });
```

**原因**：`electron-updater` 是纯 JS 模块（无 native deps），静态 import 安全。动态 import 失败时无错误信号，`checkForUpdates` 静默返回 `not-available`。

### 3.2 版本比较守卫

```typescript
// 在 checkForUpdates() 中必须比较版本
const currentVersion = app.getVersion();
const latestVersion = result.updateInfo?.version;
if (latestVersion && currentVersion === latestVersion) {
  return { state: 'not-available' };
}
```

**原因**：`autoUpdater.checkForUpdates()` 只要有 GitHub release 就返回 UpdateCheckResult，不判断是否比当前版本新。必须手动比较。

### 3.3 `allowPrerelease = true`

使 electron-updater 能匹配 prerelease 版本，扩大版本匹配范围。

### 3.4 超时保护

```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error('Update check timed out (30s)')), 30_000);
});
const result = await Promise.race([autoUpdater.checkForUpdates(), timeoutPromise]);
```

防止网络不通时永久挂起。

### 3.5 跳过版本

通过 `appMeta` 持久化跳过的版本号。`checkForUpdatesAndNotify` 返回后，IPC handler 检查是否已跳过该版本，若跳过则广播 `not-available` 覆盖结果。

### 3.6 错误信息透传

`checkForUpdates()` 的 catch 分支将 `err.message` 写入 `UpdateEvent.error` 字段。Renderer 的 HelpMenu 将错误信息拼接到 UI 文案后（`检查更新失败: <原因>`），方便诊断。

## 4. 数据流

### 4.1 IPC 通道

| 通道 | 方向 | 用途 |
|------|------|------|
| `UPDATE_CHECK` | Renderer → Main | 触发检查更新 |
| `UPDATE_DOWNLOAD` | Renderer → Main | 触发下载 |
| `UPDATE_QUIT_AND_INSTALL` | Renderer → Main | 退出并安装 |
| `UPDATE_SKIP_VERSION` | Renderer → Main | 跳过指定版本 |
| `UPDATE_EVENT` | Main → Renderer | 推送更新状态事件 |

### 4.2 UpdateEvent 结构

```typescript
interface UpdateEvent {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; transferred: number; total: number };
  error?: string;
}
```

### 4.3 UI 状态机

```
idle ──[点击检查]──→ checking ──┬──→ available ──[下载]──→ downloading ──→ downloaded ──[安装]──→ (重启)
                                ├──→ not-available (idle)
                                └──→ error (idle, 显示错误信息)
```

## 5. 构建与发布

### 5.1 构建

```bash
# 完整构建（推荐）
npm run build

# 或分步
npx vite build          # 编译源码到 dist-main/ + dist-render/
npx electron-builder --win  # 打包 NSIS/MSI
```

**关键**：`electron-builder --win` 不编译源码，只打包 `dist-main/` 和 `dist-render/`。修改源码后必须先 `vite build`，否则打包产物包含旧代码。

### 5.2 发布

```bash
release.bat <版本号>
```

或手动：

```bash
gh release create v<version> \
  release/WeaveMD-Setup-<version>.exe \
  release/WeaveMD-Setup-<version>.exe.blockmap \
  release/WeaveMD-<version>.msi \
  release/latest.yml \
  --repo UstinianDev/WeaveMD
```

### 5.3 Release 必须包含的文件

| 文件 | 用途 |
|------|------|
| `WeaveMD-Setup-<version>.exe` | NSIS 安装包 |
| `WeaveMD-Setup-<version>.exe.blockmap` | 增量更新块映射 |
| `WeaveMD-<version>.msi` | MSI 安装包（备选） |
| `latest.yml` | electron-updater 版本元数据 |

### 5.4 package.json publish 配置

```json
"build": {
  "publish": {
    "provider": "github",
    "owner": "UstinianDev",
    "repo": "WeaveMD",
    "private": false
  }
}
```

## 6. 故障排查

| 现象 | 可能原因 | 排查方法 |
|------|----------|----------|
| 检查更新无反应 | `initAutoUpdater` 未调用或 `app.isPackaged=false` | 开发模式正常（dev mode 跳过），确认打包版本 |
| "检查更新失败: Cannot find latest.yml" | GitHub release 缺 `latest.yml` 或已删除 | `gh release view v<version> --json assets` 检查 |
| "检查更新失败: timed out" | 网络不通 GitHub | 检查防火墙/代理，`ping github.com` |
| 已最新版却显示有新版本 | `checkForUpdates` 缺版本比较守卫 | 确认 `app.getVersion() === latestVersion` 分支存在 |
| DevTools 无日志 | 主进程 console.log 不显示在 Renderer DevTools | 从命令行启动 `WeaveMD.exe` 看 stdout |

## 7. 已知限制

- macOS/Linux 未适配（仅 Windows NSIS）
- 无强制更新策略（如安全更新）
- 无后台静默下载选项
- 无增量更新（使用完整安装包）

## 8. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-09-16 | 1.0 | 初始版本：静态 import + 版本比较守卫 + 超时保护 + 错误透传 |