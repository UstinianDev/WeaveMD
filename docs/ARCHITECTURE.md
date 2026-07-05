# WeaveMD — 架构设计

> 本章节为占位文档，将在开发过程中逐步完善。

## 分层架构
```
展示层 (React Components)     — Shadcn/ui, 页面/组件
业务逻辑层 (Hooks & Stores)   — Zustand, 自定义 hooks
数据访问层 (Services & IPC)   — IPC invoke, localStorage
主进程层 (Electron Main)      — 窗口管理, SQLite, 文件系统
```

## IPC 通信
- `contextBridge` 暴露安全 API 到渲染进程
- 所有数据库操作通过 `ipcMain.handle` / `ipcRenderer.invoke` 异步调用
- 主进程持有数据库连接，渲染进程无直接 DB 访问

## 数据隔离
- 每个操作携带 `user_id` 参数
- 切换账号时清除旧 store 状态，加载新账号数据