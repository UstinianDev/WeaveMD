# AI 代理面板 — 功能清单与交付记录

> 从 SUMMARY.md §5 拆出，保留完整交付记录。架构与设计见 [../modules/11-AI代理面板-Agent.md](../modules/11-AI代理面板-Agent.md)。
> 需求编号：AGT-01~19 / KB-01~05（docs/REQUIREMENTS.md 3.7 / 3.8）

## 交付时间线

### 第 1/2 期（2026-08-14）

ai_* 4 表 DDL + kb_* 预留、`ai:*` IPC + preload、设置面板 AI Tab（safeStorage 加密 key）、
知情同意页、导航栏 AI 按钮、llmClient（统一 OpenAI 兼容双后端 + SSE 流式）、
右侧 AI 面板（Chat 全功能 + Agent 占位）、会话持久化；远程 DeepSeek 后端真连验证通过。

### 第 3+4 期（2026-08-15）

- **知识库**：kb DAO + FTS5 虚拟表 `kb_chunks_fts` + 触发器（CJK 前缀匹配注意）、
  kbIndexer（分块/状态流转/保存防抖重嵌入/删除清理）、kbSearch（FTS5 BM25 召回 + 拒答 0.6 + 置顶 ×1.5 + 出处）
- **Agent 能力**：toolRegistry（listFiles/readFile/searchKB/runSkill，只读无写工具）、
  agentLoop（≤6 轮函数调用循环，后端恒 remote、无降级）、skillLoader（3 内置技能 + 用户扩展 SKILL.md）、
  intentRouter（规则启发式 6 类 + 候选提问卡片）、contextManager（/4 估算 + 80% 压缩）
- **渲染**：AgentTab 全功能、安全富文本（HAST→React，无 dangerouslySetInnerHTML）、
  ToolCallTrace/IntentCard/KnowledgeBaseSettings、AI 面板 i18n（77 键/文件）

### 第 5 期块级改写（2026-08-15）

- 选区触发（FloatingToolbar「AI 改写」→ 面板 composer 描述）+ 面板 @ 兜底
- 定向块编辑协议：内部统一 `EditBlockOp[]`；面板 @ 走编号块映射校验、定位失败拒应用
- 红删绿增预览（`rewriteDiff` 行级 LCS + `RewritePreviewCard`）→ 确认 `updateContent` 入 undo 栈一次可撤销
- stale 校验（确认时 content===原文，不一致拒应用）
- **铁律一落地**：主进程只产 LLM 文本（薄代理 `rewrite.ts`），块级替换在渲染侧（`blockEdit.ts`，只算不写）

### 第 6 期收尾（2026-08-15）

- **KB 参数持久化**：topK/fuse/threshold/置顶权重 → ai_config 幂等迁移（`pragma_table_info` 探测 + 逐列 ADD）
- 新增 `kb:get-settings`/`kb:set-settings` IPC；agentStore.init 拉取 + setKbSettings async
- 主进程消费修正：KB_STATUS 探针用持久化值、AGENT_RUN 以持久化 kbSettings 为默认兜底
- 真库三态实证：`scripts/kb-migration-smoke.cjs`（新库/既有库/重复执行，退出码 0）
- **stretch editBlocks**：toolRegistry 第 5 个工具 `editBlocks`，`executeTool` 仅产 `{applied:false,proposed}` 不落盘

### 第 7 期体验重构（2026-08-15，7 批全部）

- **A4** 选区改写叶序错位修复（DOM 序含容器块 → 改用 content 解析叶序=位置+文本对齐）
- **A1** 当前文档上下文注入（agentLoop system prompt + 截断）+ rewrite 意图补词 + 从 0 到 1 整篇写
- **A2** 混合类型工具栏（mouseup 弹 AI 改写）
- **A3** 选区改写 → 覆盖块整块渐变蓝高亮（`.rewrite-highlight` 纯 CSS overlay）+ 左端取消胶囊
- **B1** `/ @` 自动补全（`AGENT_SKILLS_LIST` 只读 IPC + `CompletionMenu`）
- **B2** 命名「智能体」（仅文案 + i18n）
- **B3** 双 Tab 合并单面板 + 模式下拉（`activeMode` 域隔离）
- **C1** 视觉美化（字号 ≥13px、composer 收紧、CSS 变量体系）

### 后端收敛 remote-only（2026-08-16）

- 彻底去除 ollama：`ChatBackend` 收敛为 `'remote'`；主进程删 `probeOllama`/AI_HEALTH/`embeddingClient.ts` 整文件
- KB 降级仅 FTS5（删向量召回）；后端固定远程、必须填 key；DB 遗留列读时收敛
- ModelForm 新增「当前提供商」状态行 + 断开连接
- composer 草稿提升到 AIAgentPanel 跨视图保留
- AI 面板字号整体放大一档

## 两条铁律

1. **AI 无直接落盘能力**——写路径必经「红删绿增预览 → 用户确认 → `updateContent` 入 undo 栈」
2. **联网/笔记外发必须用户知情同意**——consent 分层：联网闸 allowNetwork + KB 外发闸 allowSend

## 延期项（如实标注）

- 真 MCP server 管理（fetchContext7/fetchFirecrawl 工具）
- GitHub 自取 `writing-shape` 技能

## 门禁记录

| 阶段 | typecheck | vitest | lint | Playwright | vite build |
|------|-----------|--------|------|------------|------------|
| 第 5 期 | 0 | 88/1229 | 0 | ai 14/14 | ✓ |
| 第 6 期 | 0 | 90/1261 | 0 | ai 14/14 | ✓ |
| 第 7 期 | 0 | 93/1338 | 0 | ai 24/24 | ✓ |
