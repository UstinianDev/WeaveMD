# agent-perf-optimize — 阶段 2 实施计划

> 基于：Anthropic Prompt Cache 博客（2026-04-30）+ Claude Code compact/ 源码 + toolResultStorage 源码

## 核心设计原则（来自 Anthropic 博客）

1. **前缀匹配决定一切**：任何前缀变更都会使后续所有缓存失效
2. **静态在前、动态在后**：Static system prompt + Tools → CLAUDE.md → Session context → Conversation
3. **用消息而非系统提示变更**：动态信息通过 `<system-reminder>` 追加到 user message
4. **绝不中途增删工具**：用 `defer_loading` 替代移除，用 Tool 自身模拟状态切换
5. **Fork 必须共享父前缀**：压缩用相同 system prompt + tools + context，末尾追加压缩指令

---

## S7 — Prompt 前缀稳定性（先执行，基础性变更）

### 目标
重构 `agentPromptBuilder.ts` 的提示组装，按 4 层稳定性排列（从最稳定到最动态）。

### 方案
当前系统提示包含动态内容（文件列表快照、文档上下文）混在中间，破坏前缀缓存。
改为：
1. **第 1 层（全局稳定）**：工具定义（字母序 + 确定性顺序）——从不变化
2. **第 2 层（会话稳定）**：系统角色、行为规则、Skills 描述——会话内不变
3. **第 3 层（项目稳定）**：CLAUDE.md 规范——项目切换时变
4. **第 4 层（动态 → 迁移到消息）**：文件列表快照、文档上下文——从系统提示中移除，改为 `<system-reminder>` 追加到 user message

### 变更文件
- `agentPromptBuilder.ts`：分层重组 + 动态信息迁移
- `agentLoop.ts`：在 `prepareAgentContext` 中将文件快照和文档上下文作为 user message 追加
- 确保工具定义字母序排列

---

## S5 — 工具延迟加载

### 目标
将 24 个工具分为核心工具（始终加载完整 schema）和延迟工具（仅发送名称 stub），通过工具搜索按需加载。

### 方案
1. 在 `CORE_TOOLS` 数组中为每个工具加 `deferLoading?: boolean` 标记
2. 核心工具（5 个）：listFiles, readFile, searchKB, editBlocks, ask_question_card — 完整 schema
3. 延迟工具（19 个）：仅发送名称 + `defer_loading: true` 标记
4. 延迟工具通过 LLM 自然选择触发：当 LLM 选择调用延迟工具时，先拦截 → 加载完整 schema → 重新发送请求
5. **不新增 ToolSearchTool**（简化方案，WeaveMD 工具数少，不需要搜索层），改用 API 原生 `tool_choice` + 拦截重发

### 变更文件
- `toolRegistry.ts`：`CORE_TOOLS` 添加 deferLoading + 拆分
- `agentPromptBuilder.ts`：组装时区分核心/延迟工具
- `agentLoop.ts`：工具调用拦截 + schema 补齐 + 重发

---

## S6 — 大结果持久化

### 目标
参照 Claude Code `toolResultStorage.ts`，实现两级预算控制。

### 方案
1. 单工具阈值：40,000 字符（~10,000 tokens），超过时写入 `<projectDir>/tool-results/` 返回摘要
2. 单轮聚合预算：150,000 字符（~37,500 tokens），超过时从最大结果开始持久化
3. 结果替换确定性：同一工具结果在所有后续 API 调用中使用相同替换内容

### 变更文件
- 新建 `src/main/ai/agent/toolResultStorage.ts`
- `agentToolExecutor.ts`：executeOneTool 后处理大结果
- 新建 `tests/main/ai/toolResultStorage.test.ts`

---

## S8 — 上下文压缩复用缓存

### 目标
参照 Claude Code compact 模式，压缩时复用父会话前缀以保持缓存命中。

### 方案
1. `summarizeViaLlm` 改为复用父会话的 system prompt + 工具定义作为前缀
2. 在当前 messages 末尾追加压缩指令作为 user message
3. API 看到相同前缀 → 缓存命中

### 变更文件
- `contextManager.ts`：`summarizeViaLlm` 改为 cache-safe fork 模式
- `agentLoop.ts`：传入父会话的 system prompt 和工具定义

---

## 实施顺序

```
S7 (Prompt 稳定性) → 并行 [S5 (延迟加载), S6 (大结果), S8 (压缩缓存)]
                     → 验收（tsc + vitest）
```