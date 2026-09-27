# IPC 通信机制

> 最后更新：2026-09-27
> 详细文档：[08-IPC通信机制.md](../modules/08-IPC通信机制.md)

## 通信模型

```
渲染进程 ←→ contextBridge (preload.ts) ←→ 主进程 (ipc-handlers.ts)
```

- 渲染进程不能直接访问主进程数据库
- 所有 IPC 通信通过 `contextBridge` 暴露的 API
- IPC handler 必须验证调用来源和参数合法性

## 通道分组（11 组，111 通道）

常量表 `src/shared/constants.ts` 的 `IPC_CHANNELS` 共 111 条：

| 组 | 通道数 | 说明 |
|----|--------|------|
| AI | 64 | Agent / 知识库 / 配置 / 事件推送（24 个子域注释块） |
| 文件与历史 | 16 | 文件 CRUD、历史、目录、导出 |
| 认证与账号 | 6 | 登录 / 注册 / Token / 多账号 |
| 应用与更新 | 6 | 版本检测、更新、通知 |
| 窗口 | 5 | 最大化 / 最小化 / 关闭 |
| 对话框 | 5 | 打开 / 保存 / 上传文件选择 |
| 邮件 | 4 | 问题反馈邮件 |
| 设置 | 2 | 配置读写 |
| 剪贴板 / 链接 / 通知 | 3 | 剪贴板、外链、系统通知 |

## AI Agent IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `agent:run` | render → main | 启动 Agent |
| `agent:abort` | render → main | 中断 Agent |
| `ai:stream:chunk` | main → render | 流式文本块 |
| `ai:stream:tool` | main → render | 工具调用事件 |
| `ai:stream:done` | main → render | 完成 |
| `ai:stream:error` | main → render | 错误 |
| `agent:interaction:question` | main → render | 交互提问 |
| `agent:resume:interaction` | render → main | 提交答案 |
| `agent:retry:task` | render → main | 重试任务 |

## 事件持久化

`agentEventStore.ts` 提供：

| 函数 | 说明 |
|------|------|
| `persistAndSend` | 先写 SQLite 再推 IPC |
| `persistOnly` | 仅持久化（交互事件用） |
| `replayFromSeq` | 从指定序列号回放事件 |

渲染侧 `visibilitychange` 事件触发 `replayFromSeq(lastSeq)` 补发丢失事件。

## 安全规则

- 渲染进程不能直接访问主进程数据库
- 所有 IPC 通信通过 `contextBridge` 暴露的 API
- IPC handler 必须验证调用来源和参数合法性
- API key 使用 `safeStorage` 加密存储
