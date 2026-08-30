# 08 — IPC 通信机制

> 最后更新：2026-08-30

## 做什么

Electron 主进程与渲染进程之间的安全通信桥梁。使用 `contextBridge` + `ipcRenderer.invoke`/`ipcMain.handle` 模式，共 80+ 个 IPC 通道。

## 架构

```
src/main/ipc-handlers.ts          ← 主进程 IPC 处理器注册（基础通道）
src/main/ai/ipc/                  ← AI 模块 IPC（7 个 handler 文件）
├── shared.ts                     ← AI 共享 handler
├── configConsentHandlers.ts      ← AI 配置/同意
├── chatHandlers.ts               ← Chat/对话
├── kbHandlers.ts                 ← 知识库
├── agentHandlers.ts              ← Agent
├── rewriteHandlers.ts            ← 改写
└── modelConfigHandlers.ts        ← 多模型配置
src/main/preload.ts               ← 预加载脚本（暴露安全 API）
src/shared/constants.ts           ← IPC 通道常量（80+ 通道）
```

## 通道分组

### Auth（4 通道）

| 通道 | 用途 |
|------|------|
| `auth:login` | 用户登录 |
| `auth:register` | 用户注册 |
| `auth:check-username` | 检查账号可用性 |
| `auth:validate-token` | 验证 JWT Token |

### Files（10 通道）

| 通道 | 用途 |
|------|------|
| `file:create` | 创建文件 |
| `file:open` | 系统对话框打开 |
| `file:save` | 保存文件（含历史） |
| `file:delete` | 软删除 |
| `file:list` | 列出用户文件 |
| `file:get` | 获取文件内容 |
| `file:write` | 写文件到磁盘 |
| `file:read` | 从磁盘读文件 |
| `file:delete-disk` | 从磁盘删除 |
| `file:rename` | 重命名文件 |

### History（2 通道）

| 通道 | 用途 |
|------|------|
| `history:list` | 获取文件历史 |
| `history:get` | 获取历史详情 |

### Settings（2 通道）

| 通道 | 用途 |
|------|------|
| `settings:get` | 获取用户设置 |
| `settings:update` | 更新用户设置 |

### Export（1 通道）

| 通道 | 用途 |
|------|------|
| `export:file` | 导出文件（8 格式：md/html/pdf/doc/docx/png/jpg/jpeg） |

### Window（5 通道）

| 通道 | 用途 |
|------|------|
| `window:minimize` | 最小化 |
| `window:maximize` | 最大化 |
| `window:unmaximize` | 还原 |
| `window:close` | 关闭 |
| `window:is-maximized` | 检查状态 |

### Dialog（5 通道）

| 通道 | 用途 |
|------|------|
| `dialog:open-file` | 打开文件 |
| `dialog:save-file` | 保存文件 |
| `dialog:save-file-path` | 保存路径 |
| `dialog:open-folder` | 打开文件夹 |
| `dialog:pick-image` | 选择图片 |

### Folder（3 通道）

| 通道 | 用途 |
|------|------|
| `folder:read` | 递归扫描 |
| `folder:create` | 创建文件夹 |
| `folder:delete` | 删除文件夹 |

### Account（2 通道）

| 通道 | 用途 |
|------|------|
| `account:info` | 获取账号信息 |
| `account:delete` | 删除账号 |

### Link / Clipboard / App / Update（8 通道）

| 通道 | 用途 |
|------|------|
| `link:open-external` | 打开外部链接 |
| `clipboard:read-image` | 读取剪贴板图片 |
| `app:get-version` | 获取应用版本 |
| `update:check` | 检查更新 |
| `update:download` | 下载更新 |
| `update:quit-and-install` | 退出并安装 |
| `update:skip-version` | 跳过版本 |
| `update:event` | 更新事件推送 |

### AI（30+ 通道）

| 通道 | 用途 |
|------|------|
| `ai:get-config` / `ai:set-config` | AI 配置 |
| `ai:get-consent` / `ai:set-consent` | 用户同意 |
| `ai:chat` / `ai:chat-abort` | Chat 对话 |
| `ai:conversation:*` | 对话 CRUD（list/get/create/delete/export/search） |
| `ai:summary:update` | 更新对话摘要 |
| `ai:rewrite:preview` | 改写预览 |
| `ai:list-models` | 模型列表 |
| `ai:embedding:test` / `ai:embedding:create` | Embedding 测试/创建 |
| `ai:search:test` / `ai:search:run` | 搜索测试/运行 |
| `ai:model-configs:*` | 多模型配置 CRUD + 激活 |
| `ai:embedding:get-config` / `ai:embedding:set-config` | Embedding 配置 |
| `ai:search:get-config` / `ai:search:set-config` | 搜索配置 |
| `ai:get:writeMode` / `ai:set:writeMode` | 写模式 |
| `ai:message:edit` / `ai:message:updateToolCalls` | 消息编辑 |
| `ai:stream:*` | 流式推送（chunk/done/error/tool） |

### KB（8 通道）

| 通道 | 用途 |
|------|------|
| `kb:list` | 知识库列表 |
| `kb:import:file` / `kb:import:dir` | 导入 |
| `kb:reindex` | 重建索引 |
| `kb:delete` | 删除 |
| `kb:status` | 状态查询 |
| `kb:get-settings` / `kb:set-settings` | KB 设置 |
| `kb:parse-document` | 文档解析 |

### Agent（15+ 通道）

| 通道 | 用途 |
|------|------|
| `agent:run` / `agent:abort` | 运行/中止 |
| `agent:skills:list` | 技能清单 |
| `agent:task:status` / `agent:task:cancel` | 任务状态 |
| `agent:interaction:question` / `agent:resume:interaction` | 交互暂停/恢复 |
| `agent:retry:task` | 重试任务 |
| `agent:file:rename` / `agent:file:move` / `agent:file:delete` | 文件操作 |
| `agent:global-files:*` | 全局文件 |
| `agent:upload:attachment` / `agent:upload:image` | 上传 |
| `agent:replay:events` / `agent:rollback:snapshot` | 回放/回滚 |

### Mail / Notification（5 通道）

| 通道 | 用途 |
|------|------|
| `mail:get` / `mail:set` | 邮件配置 |
| `mail:send` | 发送邮件 |
| `mail:pick-images` | 选择图片 |
| `notification:send` | 系统通知 |

## 预加载 API 命名空间

```typescript
window.weaveMD = {
  auth: { login, register, checkUsername, validateToken },
  file: { create, open, save, delete, list, get, write, readDisk, deleteDisk, rename },
  history: { list, get },
  settings: { get, update },
  export: { file },  // 单通道，format 参数区分格式
  window: { minimize, maximize, unmaximize, close, isMaximized },
  dialog: { openFile, saveFile, saveFilePath, openFolder, pickImage },
  account: { info, delete },
  folder: { readFolder, createFolder, deleteFolder },
  ai: { getConfig, setConfig, getConsent, setConsent, chat, chatAbort, ... },
  kb: { list, importFile, importDir, reindex, delete, status, ... },
  agent: { run, abort, skillsList, ... },
  mail: { get, set, send, pickImages },
  version: { get },
  update: { check, download, quitAndInstall, skipVersion, onEvent },
  notification: { send },
}
```

## 安全措施

| 特性 | 配置 |
|------|------|
| 上下文隔离 | `contextIsolation: true` |
| 禁用 Node 集成 | `nodeIntegration: false` |
| 有限沙箱 | `sandbox: false`（允许 preload 使用部分 Node API） |

## 注意事项

- AI IPC 已拆分为 `src/main/ai/ipc/` 下 7 个模块，非单一 `ipc-handlers.ts`
- 流式推送使用 `webContents.send`（main→render 单向），非 invoke/handle
- 所有处理器包裹在 try-catch 中，统一 `IpcResponse<T>` 响应格式
