# TODO

> 最后更新：2026-10-04

## 已完成

> 2026-10-04 精简：只留里程碑索引。**逐任务的交付细节、门禁数字、Q 裁定已入 git 历史**；
> 现行任务的过程文档见 [SUMMARY](./SUMMARY.md) §devflow 产出。

| 里程碑 | 时间 | 一句话 |
|---|---|---|
| **ai-core-perf** | 2026-10-03 | 性能优化（AI 代理多意图 / 自动记忆 / 任务队列 / 内置工具 + 文档解析）：13 瓶颈，实施 9 放弃 4；`analyzePdfLayout` 4.2×、`toolsForIntent` 46.7×、记忆策略读取 −92% |
| **agent-kb-ux** | 2026-10-03 | KB 可见性与交互增强（R2 composer KB 开关接线 · R3 导入授权贯通 · R5 会话楷体）；R4「复制文件地址」交付后经用户裁定整体删除 |
| **agent-multi-intent** | 2026-10-01 ~ 10-03 | 多意图识别与执行 13 任务（P0 5 结构化拆分/链 + P1 6 追踪/报告/三层路由/并行调度 + P2 2）+ 2 连通性修复 |
| **agent-memory-optimize 第三批** | 2026-09-30 ~ 10-01 | P2 远期能力 6 项 + D7 范围扩张（FTS 删除路径整体报错回滚）+ D6.1 向量召回 |
| **agent-memory-optimize 第二批** | 2026-09-29 ~ 09-30 | P1：记忆策略 Ledger（衰减/合并/容量）+ 后台提取 + 读写工具 |
| **agent-memory-optimize 第一批** | 2026-09-28 ~ 09-29 | P0：`agent_memory` 单表 + 双时间 + FTS5 trigram |
| **doc-pipeline** | 2026-09-26 ~ 09-27 | 文档处理流水线 B1~B11（7 格式解析 / PDF 版面还原 / 多模态 D 路线 / 附件结构落库 / 文档四工具） |
| **agent-cost-optimize** | 2026-09-23 ~ 09-24 | Agent 成本与缓存（结果预算 / 缓存断点 / anthropic 分流基建） |
| **agent-md-kb-optimize** | 2026-09-18 | Markdown 与知识库优化 |
| **agent-perf-optimize** | 2026-09-16 ~ 09-17 | S1~S16（流式推测执行 / 工具延迟加载 / 大结果持久化 / Prompt 前缀稳定 / 基准套件 / A/B 框架） |
| **perf-agent-arch** | 2026-09-15 | Agent/KB/写控制三模块性能扫描（结论：JS 层非瓶颈，延迟在 LLM 往返） |
| **agent-ux-optimize** | 2026-09-14 | Agent 面板体验优化 |
| **四模块全局重构** | 2026-09-13 | 编辑器 / AI 面板 / 导航 / 设置四模块结构重整 |
| **Bug 修复与体验优化** | 2026-09-11 ~ 09-12 | 一批交互缺陷修复 |
| **Agent/KB 架构演进** | 2026-09-07 ~ 09-10 | 意图路由 / 工具系统 / KB 索引架构奠基 |
| **历史里程碑** | 2026-08-06 ~ 08-31 | 编辑器内核、认证、导出、打包等早期建设 |

## 待开发

| 优先级 | 任务 | 说明 |
|------|------|------|
| 🔲 | vision 开关设置页 UI | `vision_override` 三态列与读写通道已通（D8），缺设置页开关；当前只能改库 |
| 🔲 | anthropic 主循环分流 | `ai_config.protocol=anthropic` 时主循环仍按 OpenAI 形状调用（agent-cost-optimize 已建 `anthropicClient` 与 6 处非工具调用点分流，主循环未分流）——另立 issue |
| 🔲 | OCR | doc-pipeline 决策基线明确本期无 OCR，无文本层 PDF 只能走 D 路线多模态 |
| 🔲 | 图片向量 | `images_vec` 表与 `imageIndexer` 已在，附件图片未接入 embedding |
| 🔲 | 拖拽上传 | 粘贴与选择器双入口已交付，拖拽未实现 |
| 🔲 | write_mode 完整接线 | 附件写路径按 manual 确认语义实现（B11 记录），全局 write_mode 接线未补 |
| 🔲 | v2 Normal 查找高亮 | 编辑模式查找结果高亮，替代 Monaco 查找 |
| 🔲 | 撤销/重做后光标定位优化 | 当前光标回到重建树首块，需恢复到操作位置 |
| 🔲 | 段落级 MD Source 视图迁移 | v2 编辑器迁移 Monaco Source 视图 |
| 🔲 | 真 MCP server 管理 | 外部 MCP server 注册与生命周期管理 |

## 已知问题

| 问题 | 影响范围 |
|------|------|
| `allowSend` 无可达设置入口（R2） | **已解除 @agent-kb-ux（2026-10-03，三态闸）**：`checkKbEgressGate` 使 `ConsentOverlay` 生产可达，`filterKbEgressResults` 生产执行（详见 [kb-indexing-egress](./specs/knowledge/kb-indexing-egress.md) §8 R1/R2 解除记录）；`ai.settings.allowSend` 为孤儿 i18n 键（仍无 `t()` 调用方） |
| Linux AppImage 与 liteparse 排除互斥（R9） | `build.files` 排除 Linux 原生件是 Windows 瘦身手段，执行 Linux 打包前须先移除这两条排除（见 [packaging](./guide/packaging.md)） |
| `AI_CHAT` 附件/入 KB 链休眠 | 主进程 `ChatReqPayload` 有 `attachments`/`uploadToKb`，preload 类型缺字段，渲染层零调用方（**有意废弃，不得恢复**） |
| anthropic 主循环不分流 + 丢 `tool` 行 | `protocol=anthropic` 时主循环仍走 OpenAI 形状；`anthropicClient.ts:217-234` / `anthropicCompat.ts:89-105` 静默丢 `tool` 角色与 `tool_calls`（agent-memory **R4**，agent-memory 另立 issue 范围） |
| `AI_CHAT` 读到空 assistant 行 | 主进程 `chatHandlers.ts:345-353` 不透传 `tool_calls`，本批新形状会送 `content:''`；渲染层零调用点**当前不可达**（agent-memory **R3**，第二/三批均未处理，留后续批次） |
| `AI_CONVERSATION_GET` 未校验 `event.sender` | 以渲染进程传入 `userId` 为权威（`chatHandlers.ts:73-83`）——既有问题，agent-memory 阶段 7 A7 提出、非本批引入，第二/三批均未处理，留后续批次 |
| `getMessagesByConversationPaginated` 已无 `src/` 调用点 | 本批 P0-5 接线改用 `getRecentMessagesByRounds` 后成死代码（`db/ai.ts:948`）；`e2e/ai-agent-panel.spec.ts:371` 残留 `updateMessageToolCalls` mock（无行为影响，改动需重跑 E2E） |
| fake DB 未验真实 `transaction()`/`iterate()` 语义 | better-sqlite3 在系统 Node 下 ABI 不兼容，vitest 只能用 fake；本批按 plan 未新增 cjs，`scripts/agent-smoke.cjs` 需 Electron + 真实 key 未跑 |
| xlsx@0.18.5 依赖漏洞 | SheetJS 官方源修复版未发 npm，跟踪上游发布后再升级 |
| v2 Normal 模式无查找高亮 | 编辑主区（Normal 模式） |
| 撤销/重做后光标回到重建树首块 | 编辑主区（撤销/重做操作） |
| 段落级 MD Source 视图未迁移 | 编辑主区（Source 模式） |
| **E2E 基线恒为 31 failed / 104 passed / 1 skipped（exit 1）** | 已用干净树对照实验确认是**既有接受态**（改动前后失败用例集合逐条一致）。判 E2E 门禁要**比对失败集合**，不是要求全绿。详见 `ai-core-perf.delivery.md` §3.1 |
| 选区改写链路零 E2E 覆盖 | document scope 的预览/应用/撤销/stale/unchanged/失败条已覆盖；选区侧因 `startSelectionRewrite` 无调用方而不可测 |
| `searchMode:'vector'` 无向量即拒答 | `kbSearch.ts:508` FTS5 分支只认 `fts5\|hybrid`，`vector` 模式不传 `queryVector`（未开 HyDE）→ 候选空 → `:683` 规范拒答，**无关键词兜底**；`kbSearch.ts:443` JSDoc 称「无 queryVector 降级 FTS5+标题」对 `vector` 不成立（agent-memory-2 A4 实测发现，降级只在默认 hybrid 路径成立） |
| KB 搜索缓存键缺参 | `searchCache.ts:118-124` 键只含 `topK/currentFileId/threshold/searchMode`，**不含 `pinnedWeight` 与 `queryVector`**；且仅 `kbIndexer` 索引事件触发失效、设置变更不失效 → 3min TTL 内改置顶权重或切换向量开关会复用旧排序（A4 实测发现） |
| `rankCandidates` 死参数 | `kbSearchFts.ts:193-198` 的 `pinnedWeight` 形参函数体内零使用（×1.5 只在 `applyWeighting`），既有用例 `:165` 已注明分工 |
| 记忆提取节流状态不持久化 | `memoryWriter.ts` 的 `Map<conversationId, {turn,lastEnqueuedTurn}>` 为进程内，**重启后节流失效**（首轮即提取）且会话数增长不回收；跨重启节流需加落库字段（涉迁移，agent-memory-2 C2 明令不改） |
| pending 提取任务可能被 supersede 吞掉 | `agentTaskQueue` 既有语义：新 agent 任务 `enqueue` 会顶掉同会话仍 pending 的后台提取任务 → 一次提取可能被跳过（agent-memory-2 C2 复用队列不改该语义，Gate C 后评估实际频率） |
| `MEMORY_EVICT_MAX_AGE_DAYS=90` 无实测依据 | `memoryPolicy.ts` 的时间衰减阈值为无数据的保守取值，注释已标「待实测校准（建议按 active 行 written_at 距今 P90）」 |
| 同组多条 manual 记忆会并存 | `mergeConflicts` 按「manual 恒免」绝对口径执行 → 组内多条 manual 行不关闭（短期不可达：**全仓尚无写入 `source='manual'` 的调用点**——C3 是可见性入口非写入方，`memoryWrite` 恒 `'auto'`）；届时若需「组内只留一条」再改 |
| **全仓 IPC handler 均无 `event.sender` 校验** | `SECURITY.md` 明确「IPC handler 必须验证调用来源和参数」，但核查确认**此前零落实**（`chatHandlers.ts:73-83` 以渲染进程传入 `userId` 为权威即其一）；`memoryHandlers.ts` 是**第一个**按该规则落地的范式（`isTrustedSender` + JWT + `findById` + fail-closed）。其余 handler 待逐个补齐——**既有问题，非 agent-memory-2 引入** |
| `getJwtSecret` 存在双份副本 | `memoryHandlers.ts` 与 `ipc-handlers.ts` 各一份 `sha256(userData)` 推导（导入会成循环 + 拉大测试 import 图），两处已互相注释「改动需两处同步」；抽取独立 auth 模块属重构，agent-memory-2 裁定本批不做 |
| `AgentTaskQueue.enqueue` supersede 不分任务类型 | `memory_extract` 与 `skill_distill` 同点入队会**互相顶掉**（队列自动 supersede 同会话旧 pending）。D3 用「同会话任意 pending 即跳过」规避 → 提炼给 memory 让位，**首轮必然延后 1 轮**（agent-memory-3 D3，记 TODO） |
| 提炼技能草稿不按 `user_id` 分目录 | 纯文件系统选型的固有结果：`userData/skills/_auto/` 与 `_drafts/` 单机共用，IPC 已按 C3 四条鉴权但多账号共享草稿列表（agent-memory-3 D3，单机桌面可接受） |
| D3/D4 渲染侧改动行无单测 | `SkillsPanel.tsx`「提炼技能」栏与 `agentStore` 的 `loadSkillDrafts/approveSkillDraft/rejectSkillDraft`、D4 经验注入渲染侧均未纳入覆盖（主进程侧 D3 88% / D4 96.6%），待 Gate E 收口评估 |
| chat 分支经验块生产恒空 | `useAgentPrompt = !isChatIntent || ...` ⇒ 走 `buildChatSystemPrompt` 的唯一条件就是 `intent==='chat'`，而 D4 裁定 3「chat 一律不注入」→ **生产上第 3 参恒收 `''`**。能力完整有 4 条单测；待 `intentRouter` 能区分「闲聊 / 未知任务类型」后即生效 |
| `approveDraftSkill` 全非法 `intents` 报错不具体 | `parseSkillMarkdown` 先把非法值滤成 `[]` → `assertValidSkillDraft` 抛「不能为空数组」，人工确认失败时**不提示具体非法值**（agent-memory-3 D4，低风险，文案可细化） |
| `isFallthrough` 语义取自 agent 任务路由 | D1 按裁定实现为 `intentRouter.classifyIntent(query).intent === 'chat'`，实测大部分 KB 检索 query 不命中该路由关键词表 → 多为 `true`。若需按 KB 侧 `detectQueryIntent` 的 keyword 默认分支判定，改一行即可（agent-memory-3 D1） |
| **D6 首个升级版本可能有一次批量 embedding 成本** | 启动回填（`scheduleMemoryVectorBackfill`）在 embedding 已配置时对存量 `vector IS NULL` 行发起批量 API 调用（分批 20 / 限速 300ms / 上限 100 批，失败静默）；未配置时零成本空转。**建议生产观察调用频次**（agent-memory-3 D6） |
| `memory_read` 的 hyde 引导未进工具提示词 | D6.1 只在工具 schema 的 `description` 里说明「传 query + hyde:true 走语义混合召回」，**未在 `agentPromptBuilder` 的工具规则段追加引导**（该文件属 D4、D6.1 未获授权）。LLM 是否主动传 `hyde` 取决于 schema description 的表达力 |
| D7 未重建旧库 FTS 内容 | 3 处触发器已修为标准 DELETE，但回填仍是 `rowid NOT IN` **只补不删**（红线禁 DROP/重建）。因删除历史从未成功、基表无孤儿行，实测风险低；若历史库已有 FTS 残留条目需人工核对 |
| 连通性修复入口（取消竞态 + 裸 `.then` 合规） | 已修（fix `43ab99c`）：`waitForInteraction` 取消竞态 + `subtaskScheduler` 裸 `.then`；RED→GREEN 实录已在 git 历史 |
