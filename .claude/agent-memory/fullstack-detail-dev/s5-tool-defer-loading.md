---
name: s5-tool-defer-loading
description: S5 工具延迟加载完整实现：defer_loading 标记、stub/full schema 切换、agentLoop 拦截重发、测试覆盖
metadata:
  type: reference
---

## S5 工具延迟加载

### 架构合约

- **5 核心工具** (defer_loading = falsy): listFiles, readFile, searchKB, editBlocks, ask_question_card
- **19 延迟工具** (defer_loading: true): 其余全部
- CORE_TOOLS 数组每个 ToolDef 标记 defer_loading 字段
- defineCoreTools() 返回字母序排序（S7 兼容）
- deferredSchemaMap / deferredToolNames 模块级常量 O(1) 查找

### API

- `isDeferredTool(name)` → boolean
- `getDeferredToolSchema(name)` → ToolDef | undefined (完整 schema)
- `getToolStub(name)` → ToolDef | undefined (轻量 stub：name+description+空parameters)
- `buildToolListForPrompt(tools)` → ToolDef[] (延迟工具→stub, 核心保留完整)

### agentLoop 拦截流程

```
while (deferredRetryCount <= 3):
  streamChatCompletionWithRetry(tools=ctx.tools) → tool_calls
  if no tool_calls → break (正常路径)
  if deferredRetryCount < 3 && hasDeferredTool:
    替换 stub → full schema in ctx.tools
    deferredRetryCount++ → continue (重发)
  else → break (正常执行)
```

- 重发上限 3 次（while 条件 ≤3, retry 条件 <3）
- 每次重试重置 accumulatedToolCalls / assistantContent / executor
- round 计数器不因重试递增

### 关键牵连

- agentToolSelector.ts 在工具筛选后调用 buildToolListForPrompt() 转换 stub
- agentLoop.ts 导入 isDeferredTool / getDeferredToolSchema
- 测试 mock 需包含 buildToolListForPrompt / isDeferredTool / getDeferredToolSchema
- defineCoreTools() 必须 sort（S7 字母序），否则缓存前缀不稳定