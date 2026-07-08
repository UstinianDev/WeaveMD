# 窗口控制 (Window) 功能总结

> 模块编号：06 | 优先级：P0 | 最后更新：2026-07-08

---

## 1. 功能概述

Electron 无边框窗口 (frameless) 的窗口管理功能，包含主窗口和启动画面窗口的创建、窗口控制（最小化/最大化/关闭）、拖拽区域管理、单实例锁等。

## 2. 架构位置

```
src/main/window.ts                # 窗口创建与管理（主窗口 + 启动画面）
src/main/index.ts                 # 主进程入口（单实例锁）
src/main/ipc-handlers.ts          # 窗口控制 IPC 处理器
src/main/preload.ts               # 预加载脚本（暴露窗口 API）
src/render/components/Auth/
└── AuthWindowControls.tsx        # 认证页窗口控制按钮
src/render/components/Navbar/
└── TopBar.tsx                    # 主界面窗口控制按钮
src/shared/constants.ts           # IPC 通道常量
```

## 3. 实现逻辑流程

### 3.1 应用启动流程

```
app.whenReady()
  ↓
initDatabase() — 初始化 SQLite
  ↓
registerAllIpcHandlers() — 注册所有 IPC 处理器
  ↓
createMainWindow() — 创建主窗口
  │
  ├── 开发模式: loadURL('http://localhost:5173')
  └── 生产模式: loadFile('dist-render/index.html')
```

### 3.2 窗口控制流程

```
用户在渲染进程点击按钮
  ↓
window.weaveMD.window.minimize()  (或 maximize / close)
  ↓
ipcRenderer.invoke('window:minimize')
  ↓
ipcMain.handle('window:minimize')
  ↓
BrowserWindow.fromWebContents(event.sender)?.minimize()
```

### 3.3 单实例锁流程

```
应用启动
  ↓
app.requestSingleInstanceLock()
  ↓
┌── 获得锁 → 继续初始化
│
└── 未获得锁 → app.quit()
  ↓
后续实例启动时触发 'second-instance'
  ↓
恢复窗口 + 聚焦
```

## 4. 实现细节

### 4.1 主窗口配置

```typescript
// src/main/window.ts
const mainWindow = new BrowserWindow({
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 600,
  frame: false, // 无边框
  backgroundColor: '#0F0F0F',
  show: false, // 准备好后再显示（避免白屏）
  title: 'WeaveMD',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true, // 上下文隔离
    nodeIntegration: false, // 禁用 Node 集成
    sandbox: false, // 允许预加载脚本使用 Node API
  },
});
```

### 4.2 启动画面窗口

```typescript
const splashWindow = new BrowserWindow({
  width: 400,
  height: 500,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  resizable: false,
  skipTaskbar: true,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
  },
});

// 开发模式
splashWindow.loadURL('http://localhost:5173/#/splash');
// 生产模式
splashWindow.loadFile('dist-render/index.html', { hash: '/splash' });
```

### 4.4 IPC 通道

| 通道                  | 实现                                                      | 说明            |
| --------------------- | --------------------------------------------------------- | --------------- |
| `window:minimize`     | `win?.minimize()`                                         | 最小化窗口      |
| `window:maximize`     | `win?.isMaximized() ? win.unmaximize() : win?.maximize()` | 最大化/还原切换 |
| `window:unmaximize`   | `win?.unmaximize()`                                       | 还原窗口        |
| `window:close`        | `win?.close()`                                            | 关闭窗口        |
| `window:is-maximized` | `return win?.isMaximized() ?? false`                      | 检查是否最大化  |

### 4.5 拖拽区域

```css
/* 导航栏区域可拖拽窗口 */
.drag-region {
  -webkit-app-region: drag;
}

/* 菜单和按钮不可拖拽 */
.no-drag {
  -webkit-app-region: no-drag;
}
```

### 4.6 关闭时自动保存

```typescript
// MainPage.tsx — 组件卸载前保存
const flushEditorDraft = useUIStore((s) => s.flushEditorDraft);

useEffect(() => {
  // 注册草稿刷新器
  setEditorDraftFlusher(flushPendingEditorContent);
  return () => {
    // 组件卸载时清空引用
    setEditorDraftFlusher(null);
  };
}, [flushPendingEditorContent]);
```

## 5. 各个窗口的交互

| 窗口         | 用途       | 交互                   |
| ------------ | ---------- | ---------------------- |
| 主窗口       | 应用主界面 | 1280×800, 最小 960×600 |
| 启动画面窗口 | 加载动画   | 400×500, 透明, 置顶    |

## 6. 关键设计决策

1. **无边框窗口**：提供自定义标题栏和窗口控制，实现统一的设计风格
2. **安全隔离**：`contextIsolation: true` 确保渲染进程与预加载脚本隔离
3. **避免白屏**：`show: false` + `ready-to-show` 事件确保窗口准备好后才显示
4. **单实例锁**：防止多个应用实例同时运行
5. **拖拽区域**：使用 CSS `-webkit-app-region` 实现自定义窗口拖拽
