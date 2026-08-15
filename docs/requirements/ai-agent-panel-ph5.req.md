# AI 代理面板 — 第 5 期块级改写（需求记录）

> 模块：docs/modules/11-AI代理面板-Agent.md §7 | 状态：已对齐 2026-08-15
> 上一里程碑：第 3+4 期（知识库 + Agent 能力）已交付，门禁全绿（见 docs/plan/ai-agent-panel.status.md）
> 范围裁定：**第 5 期块级改写（AGT-12/13/14/17）**；第 6 期收尾视精力（KB 参数持久化优先）

## 1. 需求清单与验收标准

### 第 5 期：块级改写（选区触发 + 定向块编辑协议 + 红删绿增预览 + 确认写入）

- **AGT-12 @ 文件创作**：编辑器**选区触发为主**（选中文本 → 触发改写）；面板内「@ + 描述」兜底（@ 当前文件树目录 .md）。两条路径共享同一改写管线。
- **AGT-13 块级精准改写**：**定向块编辑协议** —— AI 返回 `[{定位, 新内容}]`，仅替换目标块、其余字节不变；定位失败拒应用。
  - 选区路径：AI 见选区 markdown 片段，返回改写后完整 markdown；主进程解析成块，仅替换选区块区间。
  - 面板 @ 路径：主进程把文档转编号块列表给 AI，AI 返回 `[{blockIndex, newContent}]`，主进程映射校验到真实块。
  - 内部统一为 `EditBlockOp[] = { blockId, newContent }`。
- **AGT-14 红删绿增预览**：diff 预览（红删绿增）→ 用户确认后才经 `stateToMarkdown` 写入编辑器，作为**一次可撤销编辑**（`editorStore.updateContent` 入 undo 栈）。
- **AGT-17 工具调用（写路径）**：写能力（editBlocks）**必经预览确认**；**AI 无直接落盘能力**——主进程改写管线只产 proposal（原文 + 改写后文本 + 块操作），写入一律渲染侧确认后 `updateContent`。

验收：
- 编辑器选中一段文本 → 触发改写 → AI 面板出现改写预览卡片（红删绿增）→ 确认 → 编辑器内容仅目标块变化、其余字节不变、可一次撤销
- 预览期间用户改过文档 → 确认时拒绝应用并提示重新生成（stale 校验）
- 改写结果与原文相同 → 提示「无变化」，不弹预览
- 选区为空 → 改写入口禁用
- 面板 @ 路径：给编号块定位，主进程映射失败拒应用
- 主进程改写管线全程无写盘触发点；写入仅发生在渲染侧确认后

### 非目标（本轮不做 / 延后）

- 第 6 期真 MCP server 管理（context7/firecrawl 拉起、fetchContext7/fetchFirecrawl 工具）——继续延
- 第 6 期 GitHub 自取 writing-shape skill——继续延
- KB 参数持久化（topK/fuse/threshold/置顶/embedding host+model → ai_config）——第 5 期完成后视精力优先做
- editBlocks 注册进 agentLoop 作为会话内可调用工具——**stretch**，精力够才做；即使做，其执行也仅产 proposal 不落盘

## 2. 已对齐问题清单（grill-me 2026-08-15）

| # | 决策 | 结论 |
|---|------|------|
| Q1 | 交付范围 | 选区触发 + 面板 @ 兜底都做，共享管线；完整覆盖 AGT-12 P1 |
| Q2 | 改写入口架构 | **独立一次性改写管线**（`ai:rewrite:preview`）为主交付；`editBlocks` 工具注册为 stretch（仅产 proposal 不落盘） |
| Q3 | 定向块编辑协议 | 选区=整段替换；面板 @=编号块协议；内部统一 `EditBlockOp[]`；定位失败拒应用 |
| Q4 | 预览 UI 位置 | AI 面板内「改写预览卡片」（红删绿增 + 确认/取消），复用 MarkdownMessage/aiMarkdown 安全渲染 |
| Q5 | stale 失效 | 确认时校验 `当前 content === 预览时原文`，不一致拒绝应用并提示重新生成 |
| Q6 | 第 6 期范围 | KB 参数持久化优先（小、独立）；真 MCP / GitHub skill 继续延 |
| Q7 | 活体验证 | 做改写循环真验（DeepSeek key 文件 + env 均在，仿 agent-smoke.cjs harness，key 不打码） |

## 3. 沿用设计（docs/modules/11 已定，不重复询问）

- 两条铁律：① AI 无直接落盘——写路径必经「红删绿增预览 → 用户确认」，确认写入 `updateContent` 可撤销；
  ② 联网/笔记外发必知情同意（改写走 LLM = 联网，复用服务端 consent 闸，改写触发前校验 allowNetwork；不涉 KB 外发则不要求 allowSend）
- 写回基元：`editorStore.updateContent`（undo 栈 49 步）+ `editorInstance.getMarkdown()` + `markdownToState`/`stateToMarkdown` + 块树 `replaceBlock`/`removeBlock`/`insertBlockAfter`/`replaceLeafRange`
- 选区→块端点：`getCrossBlockSelection()`（双端点）+ `getNextLeaf`（中间块枚举）——需新建「选区导出 markdown 片段」组合函数
- 安全渲染：`renderAIMarkdownSafe`（aiMarkdown.tsx HAST→React 白名单，无 dangerouslySetInnerHTML）复用为预览渲染器
- 密钥/网络全主进程；改写走 LLM（remote/ollama 均可用，不依赖 function-calling——选区路径用文本协议）

## 4. 风险与依赖

| 风险/依赖 | 影响 | 缓解 |
|-----------|------|------|
| 本地 qwen3.5:0.8b 故障 | 改写无法本地活验 | 真验走远程 DeepSeek（key 已在）；ollama 改写降级为「提示切换远程」或文本协议可用 |
| 选区 markdown 导出边界 | 选区跨块/含语法标记 | 复用块树切片 + stateToMarkdown；首尾块按 offset 截取 |
| 多块选区改写结构 | LLM 返回 markdown 块数 vs 选区块数 | 返回解析成块替换选区块区间（多段→多块），不强制塌缩 |
| 改写后光标丢失 | UX 劣化 | 确认写入前记录选区；写入后尽力恢复（best-effort，不阻塞第 5 期） |
| stale 覆盖 | 覆盖用户新编辑 | 确认时校验原文一致，不一致拒绝（Q5） |
| 预览 diff 计算 | 渲染侧逐块 diff 成本 | 行级 diff 简化（原文/改写文本逐行对比），预览数据渲染侧构造 |
| 工具测试断言 | WRITE_NAMES 断言需改造 | 加写路径后同步 toolRegistry.test 断言 |
