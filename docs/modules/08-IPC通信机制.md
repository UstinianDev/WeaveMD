# IPC 通信机制 功能总结

> 模块编号：08 | 优先级：P0 | 最后更新：2026-08-03

---

## 1. 功能概述

Electron 主进程与渲染进程之间的安全通信桥梁。使用 `contextBridge` + `ipcRenderer.invoke`/`ipcMain.handle` 模式，实现渲染进程对主进程功能的安全调用。共 30+ 个 IPC 通道，覆盖认证、文件、历史、设置、导出、窗口、对话框及文件夹操作。

## 2. 架构位置

```
src/main/ipc-handlers.ts    # 主进程 IPC 处理器注册（418行）
src/main/preload.ts         # 预加载脚本（暴露安全 API）
src/shared/constants.ts     # IPC 通道常量定义（30+ 个通道）
```

## 3. 安全架构

```
┌──────────────────────────────┐
│    渲染进程 (React)           │
│  window.weaveMD.*            │
│  (不能直接访问 Node.js)       │
└──────────┬───────────────────┘
           │ contextBridge
           ▼
┌──────────────────────────────┐
│    预加载脚本 (preload.ts)    │
│  ipcRenderer.invoke()        │
│  (有限的 Node.js 权限)        │
└──────────┬───────────────────┘
           │ IPC
           ▼
┌──────────────────────────────┐
│    主进程 (ipc-handlers.ts)   │
│  ipcMain.handle()             │
│  (完整的 Node.js + 系统权限)  │
└──────────┬───────────────────┘
           │ 直接调用
           ▼
┌──────────────────────────────┐
│    数据库 / 文件系统          │
└──────────────────────────────┘
```

## 4. IPC 通道总览

### 4.1 认证相关 (6个)

| 通道                  | 方向        | 参数                                 | 返回值                       | 用途           |
| --------------------- | ----------- | ------------------------------------ | ---------------------------- | -------------- |
| `auth:login`          | render→main | `{ username, password, rememberMe }` | `IpcResponse<LoginResponse>` | 用户登录       |
| `auth:register`       | render→main | `{ username, password }`             | `IpcResponse<{ userId }>`    | 用户注册       |
| `auth:check-username` | render→main | `username: string`                   | `UsernameCheckResponse`      | 检查账号可用性 |
| `auth:validate-token` | render→main | `token: string`                      | `IpcResponse<IUserPublic>`   | 验证 JWT Token |
| `account:info`        | render→main | `userId: string`                     | `IpcResponse<AccountInfo>`   | 获取账号信息   |
| `account:delete`      | render→main | `userId: string`                     | `IpcResponse<void>`          | 删除账号       |

### 4.2 文件相关 (9个)

| 通道               | 方向        | 参数                          | 返回值                                 | 用途               |
| ------------------ | ----------- | ----------------------------- | -------------------------------------- | ------------------ |
| `file:create`      | render→main | `{ userId, name }`            | `IpcResponse<IFile>`                   | 创建文件           |
| `file:list`        | render→main | `userId: string`              | `IpcResponse<IFile[]>`                 | 列出用户文件       |
| `file:get`         | render→main | `{ fileId, userId }`          | `IpcResponse<IFile>`                   | 获取文件内容       |
| `file:save`        | render→main | `{ fileId, content, userId }` | `IpcResponse<IFile>`                   | 保存文件（含历史） |
| `file:delete`      | render→main | `{ fileId, userId }`          | `IpcResponse<void>`                    | 软删除文件         |
| `file:write`       | render→main | `{ filePath, content }`       | `IpcResponse<void>`                    | 写文件到磁盘       |
| `file:read`        | render→main | `filePath: string`            | `IpcResponse<{ path, name, content }>` | 从磁盘读文件       |
| `file:delete-disk` | render→main | `filePath: string`            | `IpcResponse<void>`                    | 从磁盘删除文件     |

### 4.3 历史版本相关 (2个)

| 通道           | 方向        | 参数                 | 返回值                           | 用途         |
| -------------- | ----------- | -------------------- | -------------------------------- | ------------ |
| `history:list` | render→main | `fileId: string`     | `IpcResponse<IHistoryEntry[]>`   | 获取文件历史 |
| `history:get`  | render→main | `{ fileId, userId }` | `IpcResponse<{ file, history }>` | 获取历史详情 |

### 4.4 设置相关 (2个)

| 通道              | 方向        | 参数                                        | 返回值                   | 用途         |
| ----------------- | ----------- | ------------------------------------------- | ------------------------ | ------------ |
| `settings:get`    | render→main | `userId: string`                            | `IpcResponse<ISettings>` | 获取用户设置 |
| `settings:update` | render→main | `{ userId, theme, language, customColors }` | `IpcResponse<ISettings>` | 更新用户设置 |

### 4.5 导出相关 (3个)

| 通道          | 方向        | 参数                    | 返回值                      | 用途          |
| ------------- | ----------- | ----------------------- | --------------------------- | ------------- |
| `export:md`   | render→main | `{ content, filename }` | `IpcResponse<{ filePath }>` | 导出 Markdown |
| `export:docx` | render→main | `{ content, filename }` | `IpcResponse<{ filePath }>` | 导出 Word     |
| `export:pdf`  | render→main | `{ content, filename }` | `IpcResponse<{ filePath }>` | 导出 PDF      |

### 4.6 窗口控制相关 (5个)

| 通道                  | 方向        | 参数 | 返回值    | 用途            |
| --------------------- | ----------- | ---- | --------- | --------------- |
| `window:minimize`     | render→main | -    | `void`    | 最小化窗口      |
| `window:maximize`     | render→main | -    | `void`    | 最大化/还原切换 |
| `window:unmaximize`   | render→main | -    | `void`    | 还原窗口        |
| `window:close`        | render→main | -    | `void`    | 关闭窗口        |
| `window:is-maximized` | render→main | -    | `boolean` | 检查是否最大化  |

### 4.7 对话框相关 (4个)

| 通道                    | 方向        | 参数                       | 返回值                                 | 用途                               |
| ----------------------- | ----------- | -------------------------- | -------------------------------------- | ---------------------------------- |
| `dialog:open-file`      | render→main | -                          | `IpcResponse<{ path, name, content }>` | 打开文件对话框                     |
| `dialog:save-file`      | render→main | `{ defaultName, filters }` | `IpcResponse<{ filePath }>`            | 保存文件对话框                     |
| `dialog:save-file-path` | render→main | `{ defaultName }`          | `IpcResponse<{ filePath }>`            | 保存路径选择（含 createDirectory） |
| `dialog:open-folder`    | render→main | -                          | `IpcResponse<{ folderPath }>`          | 打开文件夹对话框                   |

### 4.8 文件夹相关 (3个)

| 通道            | 方向        | 参数                         | 返回值                         | 用途           |
| --------------- | ----------- | ---------------------------- | ------------------------------ | -------------- |
| `folder:read`   | render→main | `folderPath: string`         | `IpcResponse<IFileTreeNode[]>` | 递归扫描文件夹 |
| `folder:create` | render→main | `{ parentPath, folderName }` | `IpcResponse<void>`            | 创建磁盘文件夹 |
| `folder:delete` | render→main | `folderPath: string`         | `IpcResponse<void>`            | 删除磁盘文件夹 |

## 5. 预加载 API 定义

```typescript
// src/main/preload.ts
export interface WeaveMDApi {
  auth: {
    login(username: string, password: string, rememberMe: boolean): Promise<unknown>;
    register(username: string, password: string): Promise<unknown>;
    checkUsername(username: string): Promise<unknown>;
    validateToken(token: string): Promise<unknown>;
  };
  file: {
    create(userId: string, name: string): Promise<unknown>;
    open(): Promise<unknown>; // 系统对话框打开 .md
    save(fileId: string, content: string, userId: string): Promise<unknown>;
    delete(fileId: string, userId: string): Promise<unknown>;
    list(userId: string): Promise<unknown>;
    get(fileId: string, userId: string): Promise<unknown>;
    write(filePath: string, content: string): Promise<unknown>; // 写磁盘
    readDisk(filePath: string): Promise<unknown>; // 读磁盘
    deleteDisk(filePath: string): Promise<unknown>; // 删磁盘文件
  };
  history: {
    list(fileId: string): Promise<unknown>;
    get(fileId: string, userId: string): Promise<unknown>;
  };
  settings: {
    get(userId: string): Promise<unknown>;
    update(userId: string, settings: Record<string, unknown>): Promise<unknown>;
  };
  export: {
    md(content: string, filename: string): Promise<unknown>;
    docx(content: string, filename: string): Promise<unknown>;
    pdf(content: string, filename: string): Promise<unknown>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    unmaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
  };
  dialog: {
    openFile(): Promise<unknown>;
    saveFile(options: {
      defaultName: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }): Promise<unknown>;
    saveFilePath(options: { defaultName: string }): Promise<unknown>; // 保存路径选择
    openFolder(): Promise<unknown>; // 打开文件夹对话框
  };
  account: {
    info(userId: string): Promise<unknown>;
    delete(userId: string): Promise<unknown>;
  };
  folder: {
    readFolder(folderPath: string): Promise<unknown>; // 递归扫描
    createFolder(parentPath: string, folderName: string): Promise<unknown>; // 创建磁盘文件夹
    deleteFolder(folderPath: string): Promise<unknown>; // 删除磁盘文件夹
  };
}

// 通过 contextBridge 暴露到渲染进程
contextBridge.exposeInMainWorld('weaveMD', api);
```

## 6. 实现细节

### 6.1 通道常量定义

```typescript
// src/shared/constants.ts
export const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_CHECK_USERNAME: 'auth:check-username',
  AUTH_VALIDATE_TOKEN: 'auth:validate-token',

  // Files
  FILE_CREATE: 'file:create',
  FILE_OPEN: 'file:open',
  FILE_SAVE: 'file:save',
  FILE_DELETE: 'file:delete',
  FILE_LIST: 'file:list',
  FILE_GET: 'file:get',
  FILE_WRITE: 'file:write',
  FILE_READ: 'file:read',
  FILE_DELETE_DISK: 'file:delete-disk',

  // History
  HISTORY_LIST: 'history:list',
  HISTORY_GET: 'history:get',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Export
  EXPORT_MD: 'export:md',
  EXPORT_DOCX: 'export:docx',
  EXPORT_PDF: 'export:pdf',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_UNMAXIMIZE: 'window:unmaximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // Dialog
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',
  DIALOG_SAVE_FILE_PATH: 'dialog:save-file-path',
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',

  // Account
  ACCOUNT_INFO: 'account:info',
  ACCOUNT_DELETE: 'account:delete',

  // Folder
  FOLDER_READ: 'folder:read',
  FOLDER_CREATE: 'folder:create',
  FOLDER_DELETE: 'folder:delete',
} as const;
```

### 6.2 通用响应格式

```typescript
interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
```

### 6.3 处理器注册模式

```typescript
// 所有处理器在应用启动时统一注册
export function registerAllIpcHandlers(): void {
  // Auth handlers
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, { username, password, rememberMe }) => {
    // ... 登录逻辑
  });

  // File handlers
  ipcMain.handle(IPC_CHANNELS.FILE_SAVE, async (_event, { fileId, content, userId }) => {
    // ... 保存逻辑
  });

  // All other handlers...
}
```

## 7. 安全措施

| 安全特性       | 配置                     | 说明                            |
| -------------- | ------------------------ | ------------------------------- |
| 上下文隔离     | `contextIsolation: true` | 渲染进程与预加载脚本隔离        |
| 禁用 Node 集成 | `nodeIntegration: false` | 渲染进程无法直接访问 Node.js    |
| 有限的沙箱     | `sandbox: false`         | 允许预加载脚本使用部分 Node API |
| 类型安全 API   | TypeScript 接口          | 预加载 API 有完整类型定义       |

## 8. 关键设计决策

1. **invoke/handle 模式**：使用双向通信模式，渲染进程等待主进程返回结果
2. **通道常量集中管理**：所有 IPC 通道名称在 `constants.ts` 中定义，避免硬编码
3. **统一响应格式**：所有 IPC 响应使用 `IpcResponse<T>` 泛型接口
4. **安全隔离**：通过 `contextBridge` 暴露有限的 API，不直接暴露 `ipcRenderer`
5. **错误处理**：每个 IPC 处理器都包裹在 try-catch 中，确保错误信息传递到渲染进程
