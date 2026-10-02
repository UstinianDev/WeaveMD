# IPC 通信机制

> 最后更新：2026-10-01
> 详细文档：[08-IPC通信机制.md](../modules/08-IPC通信机制.md)

## 通信模型

```
渲染进程 ←→ contextBridge (preload.ts) ←→ 主进程 (ipc-handlers.ts)
```

- 渲染进程不能直接访问主进程数据库
- 所有 IPC 通信通过 `contextBridge` 暴露的 API
- IPC handler 必须验证调用来源和参数合法性

## 通道分组（11 组，119 通道）

常量表 `src/shared/constants.ts` 的 `IPC_CHANNELS` 共 119 条（较 2026-09-27 的 111 条 **+8**，来自 agent-memory-optimize 三批）：

| 组 | 通道数 | 说明 |
|----|--------|------|
| AI | 72 | Agent / 知识库 / 配置 / 记忆 / 提炼草稿 / 事件推送（27 个子域注释块） |
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
| `ai:memory:list` | render → main | 自动记忆列表（第二批 C3） |
| `ai:memory:delete` | render → main | 删除单条记忆（物理 DELETE，UI 二次确认） |
| `ai:memory:similar:list` | render → main | 相似合并建议列表（第三批 D5 防线二） |
| `ai:memory:similar:accept` | render → main | 采纳合并（服务端重算相似组后动手） |
| `ai:memory:similar:reject` | render → main | 驳回合并（写 `merge_skip`） |
| `ai:skilldraft:list` | render → main | 提炼技能草稿列表（第三批 D3） |
| `ai:skilldraft:approve` | render → main | 采纳草稿 → `status: active` 进入生效目录 |
| `ai:skilldraft:reject` | render → main | 驳回草稿 |

> 上述 8 条新增通道的 handler 落在 `src/main/ai/ipc/memoryHandlers.ts`（前 5 条，复用 `registerMemoryHandlers`）
> 与 `src/main/ai/ipc/skillDraftHandlers.ts`（后 3 条）。鉴权四条照抄 C3 范式：
> `isTrustedSender(event)` + JWT 解 `userId`（`sha256(userData)` 派生）+ `findById` + fail-closed 返回 `unauthorized`，
> 参数校验不过不落策略层。

**任务 8 补注（子任务并行调度）**：**无新增通道**。链内并行分支仍走既有流通道——
工具事件 `ai:stream:tool`、完成 `ai:stream:done`、错误 `ai:stream:error`、交互
`agent:interaction:question` / `agent:resume:interaction` 均不变；分支的流式增量
在主进程侧收敛（分支不直推 `ai:stream:chunk`，波次空闲时按支补发聚合文本，见
`agent-tool-runtime.md` §15.4），`ai:stream:subtask_done` 载荷形状不变（按收敛逐支落显）。
**主进程串行化派发**：调度、结果聚合、级联与停链全部发生在 runAgentFlow 主线程串行段
（`subtaskScheduler.runScheduledLoop` 波次驱动），分支间无跨进程/跨线程共享写；
交互由 `BranchInteractionGate` 在主线程逐个串行处理（复用 waiting_interaction 原语）。

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
