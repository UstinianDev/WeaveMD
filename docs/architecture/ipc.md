# IPC 通信机制

> 最后更新：2026-09-09
> 详细文档：[08-IPC通信机制.md](../modules/08-IPC通信机制.md)

## 通信模型

```
渲染进程 ←→ contextBridge (preload.ts) ←→ 主进程 (ipc-handlers.ts)
```

- 渲染进程不能直接访问主进程数据库
- 所有 IPC 通信通过 `contextBridge` 暴露的 API
- IPC handler 必须验证调用来源和参数合法性

## 通道分组（9 组，80+ 通道）

| 组 | 通道数 | 说明 |
|----|--------|------|
| 文件 | ~10 | CRUD + 导入/导出 |
| AI Chat | ~5 | 聊天/模型列表 |
| AI Agent | ~15 | 代理循环/工具/事件 |
| AI KB | ~10 | 知识库索引/搜索 |
| 搜索 | ~5 | 搜索配置/测试 |
| 设置 | ~10 | 配置读写 |
| 窗口 | ~5 | 最大化/最小化/关闭 |
| 认证 | ~5 | 登录/注册/Token |
| 系统 | ~10 | 更新/通知/路径 |

## AI Agent IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `ai:agent:run` | render → main | 启动 Agent |
| `ai:agent:abort` | render → main | 中断 Agent |
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
