# ai-file-ops-persist — 状态文档

## 任务分级

- 分类：Bug 修复 × 4
- 档位：M（跨 agentStore + FileTreePanel + DB + 渲染层）
- 裁剪：Bug 类 → 复现分析 → 最小修复

## Bug 清单与修复

### Bug 1：AI 创建的文件重启后丢失

**根因**：`fileTreeStore.restore()` 对 looseFiles 仅检查 `readDisk(path)`，AI 创建的文件只存在于 DB 不在磁盘 → 被剔除。

**修复**：`fileTreeStore.ts` `restore()` 中，`readDisk` 失败时回退 DB 查询 `file.get(file.id, '')`，DB 有则保留并补全 content 缓存。

### Bug 2：AI 新建文档点击无黄色渐变

**根因**：`agentStore.onTool` 中 `addFile({ id: result.fileId })` 使用 UUID，但 `handleFileClick` 打开文件时 `iFile.id = node.path`（路径）。`file.id` ≠ `currentFileId` → `isActive` 永远 false。

**修复**：`agentStore.ts` 中 `addFile` 使用 `diskPath || fileName` 作为 `id` 和 `path`，与 `handleFileClick` 的 `iFile.id = node.path` 一致。

### Bug 3：AI 无法将内容写入本地文件

**根因**：
1. `createFileHandler` 仅写 DB 不写磁盘 → 后续 `readDisk` / `file.write` 无文件实体
2. `editBlocks` 的 `applyEditBlocksProposal` 仅 `updateContent`（内存）不写磁盘

**修复**：
- `createFileHandler.ts`：DB 创建后 `tryWriteToDisk()` 写入 `userData/files/` 目录，返回 `diskPath`
- `agentStore.ts` `applyEditBlocksProposal`：`editBlocks` 确认后调用 `file.write(currentPath, content)` 写入磁盘

### Bug 4：重启后面板工具调用格式报错

**根因**：`ai_messages` 表无 `tool_calls` 列，`appendMessage` 不持久化 toolCalls。重启后 `loadConversation` 返回的消息 `toolCalls === undefined` → `AgentWorkflowCard` 收到空数据。

**修复**：
- `db/index.ts`：幂等补 `tool_calls TEXT DEFAULT NULL` 列
- `db/ai.ts`：`appendMessage` 接受并存储 `toolCalls`；`mapMessageRow` 解析 JSON；新增 `updateLatestAssistantToolCalls`
- `constants.ts`：新增 `AI_MESSAGE_UPDATE_TOOL_CALLS` IPC channel
- `chatHandlers.ts`：注册 handler
- `preload.ts`：暴露 `updateMessageToolCalls` API
- `agentStore.ts`：`appendAssistant` 后调用 IPC 持久化 toolCalls 到 DB

## 变更清单

| 文件 | 变更 |
|------|------|
| `src/render/stores/fileTreeStore.ts` | restore() DB 回退查询 |
| `src/render/stores/agentStore.ts` | addFile 用路径做 id + editBlocks 写磁盘 + appendAssistant 持久化 toolCalls |
| `src/main/ai/tools/createFileHandler.ts` | DB + 磁盘双写 |
| `src/main/db/index.ts` | ai_messages 补 tool_calls 列 |
| `src/main/db/ai.ts` | appendMessage 存 toolCalls + updateLatestAssistantToolCalls |
| `src/main/db/ai.ts` | mapMessageRow 解析 toolCalls |
| `src/main/ai/ipc/chatHandlers.ts` | 注册 updateToolCalls handler |
| `src/main/preload.ts` | 暴露 updateMessageToolCalls |
| `src/shared/constants.ts` | AI_MESSAGE_UPDATE_TOOL_CALLS |
| `src/render/utils/weaveMDBridge.ts` | mock 补 updateMessageToolCalls |
| `src/render/components/Editor/panels/FileTreePanel.tsx` | (上一轮已改) fallback chain |
| `tests/setup.ts` | mock 补 updateMessageToolCalls |
| `tests/main/db/aiDao.test.ts` | INSERT 参数对齐 tool_calls 列 |

## 测试证据

- tsc: 0 new errors (3 pre-existing in ipc.test.ts)
- vitest: 1488/1488 pass (1 pre-existing file failure: ipc.test.ts)
- eslint: 0 new errors (1 pre-existing in db/index.ts)

## 验收标准

- [x] AI 创建文件重启后仍在目录中显示
- [x] AI 新建文档点击有黄色渐变高亮
- [x] AI editBlocks 确认后内容写入磁盘
- [x] AI createFile 同时写 DB + 磁盘
- [x] 重启后工具调用轨迹正常渲染
- [x] 未涉及功能不受影响（1488 tests pass）
