# TODO

> 最后更新：2026-09-30

## 已完成

### agent-memory-optimize 第二批（2026-09-29 ~ 2026-09-30）

P1 主干，路线图「模块四 → 三 → 五 → 二.4 → 七.1/七.2/七.3」共 9 任务，档位 **L（含 L4 迁移）**，Q1~Q15 已裁定。三子批三 Gate **全部通过**。

| 子批 | 任务 | Gate | 门禁实测 |
|------|------|------|------|
| A 提示词/检索层 | 四.1 三文件注入、四.3 摘要保留先行词、二.4 classifyIntent 接主管线、七.3 红线护栏补测 | Gate A | tsc 0 / vitest 4037·4038（1 flaky 单跑绿）/ eslint 0 err·106 warn / vite build 0 / E2E 31f·103p·1s；改动行覆盖 **195/195 = 100%** —— **已提交 `8fd28f1`** |
| B 存储层 | 三.1 单表 `agent_memory`+双时间、三.2 Ledger/Views/Policy、三.4 迁移双路径、四.2 分层 Prompt | Gate B（**L4**） | tsc 0 / vitest 4106·4107 / eslint 0 err·106 warn / vite build 0 / **真库 smoke 四态 EXIT 0** / E2E 31f·103p·1s；B4 覆盖 129/129 —— **B3/B1/B2 已提交 `6ed0b4c`**，B4 未提交 |
| C 读写工具层 | 五.1 两工具、五.2 后台写入+冲突清洗、五.3 可见入口、七.1 场景③+七.2 门禁 | Gate C | **vitest 175 文件 4191 例全绿 0 failed** / tsc 0 / eslint 0 err·108 warn / vite build 0 / 真库 smoke 四态 EXIT 0 / **E2E 31f·104p·1s = 136**（+1 即场景③，31 条失败清单零变化） |

**验收要点**：三 Gate 六项门禁全绿；改动行覆盖 A 195/195、B4 129/129、C1 100%、C2 552/553、C3 419/419；**39 处变异全部变红后还原复绿**；`vitest.config.ts` 全程零改动；计划外 `src/` 改动 0 行。
**安全交付**：`memoryHandlers.ts` 是全仓**第一个**按 `SECURITY.md` 校验 `event.sender` 的 IPC handler（此前零落实，已记已知问题）。
**未提交**：B4 / C1 / C2 / C3 / C4 全部代码改动 + 本批文档（`8fd28f1`、`6ed0b4c`、`33c3763` 之外的部分）。

> 需求 [req](./requirements/agent-memory-optimize-2.req.md)（Q1~Q15）/ 计划与三 Gate 实施记录 [plan](./plan/agent-memory-optimize-2.plan.md) §6 / TDD 证据 [tdd](./testing/agent-memory-optimize-2.tdd.md)

### agent-memory-optimize 第一批（2026-09-28 ~ 2026-09-29）

L 级 / TDD strict，devflow 阶段 0~8 全完成，**门禁通过、阻塞 0**。修「指代追问被反问它指什么」的五条根因（P0-1~P0-7）。

| 项 | 交付 |
|----|------|
| P0-1 | chat 意图保留历史与摘要（`agentContext` 删 `isChat` 双闸，与非 chat 统一窗口） |
| P0-2 | 四处「忽略之前所有对话」反上下文文案同批改写（`agentPromptBuilder` 核心规则 + `CHAT_SYSTEM_PROMPT`、`contextManager` 摘要前缀、`agentContext:449`），防串题由「只回答最后一条」承担 |
| P0-3 | `classifyIntent(input, ctx?: {hasHistory})` —— 长度门仅在无历史时生效，`confidence<0.7` 无条件保留 |
| P0-4 | `tool_calls` 单事务落库：`appendToolTurnWithAssistant`（assistant upsert + tool `INSERT OR IGNORE`，id 带 `runId` 盐）+ 回读透传 `tool_calls` + 新建 `repairToolTurnPairing` + **拆掉渲染侧 6 处回写** |
| P0-5 | 读取按轮次：`getRecentMessagesByRounds(3 轮, {byteBudget:45_000})`，20 行降为水位线、`rowid DESC` 兜底，取消行数硬上限 |
| P0-6 | `searchKB` 接入历史代词改写：`toolCtx.history` 注入 + `resolveReferencesDetailed` 进主管线 + `expandedQueries` 双路 RRF 召回 |
| P0-7 | `knowledgeClarify` 补 28 例测试（**源文件 0 改动**） |
| 连带 | 阶段 6.5 修复两条本批引入回归：重载态空气泡（`AgentTab`）+ 指代改写自指（`queryPlanner`）—— **计划外改动，待用户追认** |

**门禁实测**：typecheck 0 error / vitest 168 文件 3986 例（1 既知 flaky 隔离复核判过）/ eslint 0 error 106 warning / vite build 成功 / E2E 31f·103p·1s 与基线逐项相等 + 新增 2 条 passed / **改动行覆盖 19 文件 589/589 = 100%**。

> 详见 [req](./requirements/agent-memory-optimize.req.md)（Q1~Q18 全对齐）/ [status](./plan/agent-memory-optimize.status.md) / [connectivity](./plan/agent-memory-optimize.connectivity.md)（12 链 0 断裂）/ [compliance](./plan/agent-memory-optimize.compliance.md) / [TDD 报告](./testing/agent-memory-optimize.tdd.md)

### doc-pipeline 文档处理流水线（2026-09-26 ~ 2026-09-27）

M 级，8 模块 29 任务全量交付 + 遗留修复批次；需求见 [doc-pipeline.req](./requirements/doc-pipeline.req.md)。

| 批 | 范围 | 核心交付 |
|----|------|---------|
| B1~B2 | 解析与上传 | `parseDocument` 结构化产物 + `DIALOG_OPEN_FILE({upload:true})` 7 格式多选 + 粘贴/选择器双入口 + 解析限流 3 并发 |
| B3~B4 | 持久化与入库 | `attachments_json`(D1) + `parsed_attachments` 三态 + `structure_json` 页码溯源 + KB 附件关联 `attachment_id`(D3) |
| B5~B6 | 检索与多模态 | `searchDocument`/`readPage`/`extractTable`/`analyzeChart` + citation 回链 `refsJson` + `LlmMessage.content` 数组贯通 + 图片相对路径落盘 |
| B7~B8 | 版面与工具引用 | `pdfLayout` 坐标分栏/无框线表格/跨页合并 + D 路线多模态截图 + 工具计数 24→28 与文档同步 |
| B9~B10 | 文件树与体积 | 超长 md 引用模式发送 + `files` 21 条反向排除（Setup 147.68→99.16MB / unpacked 602→369MB / asar 288→86MB）+ `sizeGate` 双口径门禁 |
| B11~B12 | 外发闸与 PoC | `allowSend` 不放宽 + 勾选入 KB 授权列(D5/D5b) + Docling PoC 量化不达标按 Q6 关闭 |
| 收尾 | 四阶段 | 五门禁（`doc-pipeline.final.md`，E2E 31 failed 为裁定基线零新增）/ 连通性 12 链 0 断裂 / 合规 APPROVED WITH COMMENTS / 交付对账 |

> 目录批量导入 `importDirAsKb` 已扩至 7 格式且先解析再入索引，原「pdf/docx 知识库导入」待办随之关闭。

**遗留修复批次（2026-09-27）**：Bug A（附件绝对路径清单注入 system prompt + 附件消息解锁 `ask_question_card`）、Bug B（`vision_override` 三态列 + 能力表 + 未知模型乐观默认 + 降级上屏）、R3 外发双检会话边界、R4/R5 路径回执与 citation 打开、R6 20 附件截断对齐、R7/R8 删除级联。证据 [doc-pipeline-remedial.tdd](./testing/doc-pipeline-remedial.tdd.md)。

> 详见 [status](./plan/doc-pipeline.status.md) / [connectivity](./plan/doc-pipeline.connectivity.md) / [compliance](./plan/doc-pipeline.compliance.md)

### agent-cost-optimize（2026-09-23 ~ 2026-09-24）

M 级 Agent 成本降低优化，A 轨叙述精简 + B 轨缓存/预算，全量交付；衍生任务含 consent 闸调整、协议分流接线、E2E 断言处置。

| 轨 | 任务 | 核心交付 |
|----|------|---------|
| A | 文件操作叙述精简 A1-A5 | `FILE_OP_NARRATION_TOKEN_LIMIT=80` + `## 文件操作后的回复`/`## 写入规则`/`## 回复风格`/`## 回答格式` 四段改写（系统提示 1,072→1,363 tok） |
| B | B1 文档上下文门控 | 非文件操作意图不注入文档上下文（chat/kbQa/web 每轮最多省 5,000 tok） |
| B | B2 Anthropic 缓存断点 | system 末块 `cache_control: ephemeral` + usage 五字段解析；6 处非工具调用点协议分流（`ai_config.protocol`） |
| B | B3 结果预算收紧 | 单结果 30k→10k、聚合 120k→40k 字符，超限落盘带恢复路径 |
| B | B4 缓存折扣计费 | `costTracker` 扣减 `cacheRead`/`cacheWrite` + 0.1×/1.25× 分列计价 |
| 衍生 | consent 铁律二调整 | 联网同意闸停用（`needsConsent` 恒 false），仅存笔记外发闸 `allowSend`；`ConsentOverlay` 单勾选 |
| 衍生 | E2E 断言处置 | 单 spec **4/35 → 27/31**；删 4 条（对象已不存在）+ 4 条改走 `@文档 ` + 2 条补全改断言 + 4 条选区断言保留作已知失败 |

**门禁**：tsc 0 error / vitest **3226 passed 0 failed** / lint **108 (0 error)** / `vite build` exit 0 / E2E 全量 **31 failed 97 passed**（基线 112/20）。
付费 LLM 实测净额**用户裁定挂起**（降本改动已生效，挂起的只是量化）。

> 详见 [agent-cost-optimize 状态](./plan/agent-cost-optimize.status.md) / [TDD 报告](./testing/agent-cost-optimize.tdd.md)

### agent-md-kb-optimize（2026-09-18）

L 级跨层优化，6 子任务（Markdown 解析层 / 知识库检索层 / Agent 上下文构建层），全量交付。

| 优先级 | 模块 | 任务 | 核心交付 |
|--------|------|------|---------|
| P0 | Markdown 解析层 | CommonMark/GFM 测试套件 | 1300 例 100% 通过 + parseList 连续空行 bug 修复 |
| P0 | Markdown 解析层 | 正则统一 | 3 个正则迁移到 markdownSyntax.ts + tableCodec 统一 |
| P1 | 知识库检索层 | 检索管线可观测性 | IKbSearchDiagnostics 接口 + 全链路 performance.now() 埋点 |
| P1 | 知识库检索层 | 研究循环并行化 | executeSubQuery 提取 + Promise.allSettled + 并发限制 3 |
| P1 | Agent 层 | 代码重复消除 | 8 个共享函数提取到 agentToolExecutor.ts（-180 行重复） |
| P1 | Agent 层 | 延迟工具重发优化 | 保留已执行结果 + 重发上限 3 次 + upgradedDeferredTools 追踪 |

> 详见 [agent-md-kb-optimize 状态](../docs/plan/agent-md-kb-optimize.status.md)

### agent-perf-optimize（2026-09-16 ~ 2026-09-17）

L 级 Agent 性能优化，4 阶段 17 子任务，283 新增测试，全量交付。

| 阶段 | 优化项 | 核心交付 |
|------|--------|---------|
| 1: Agent 核心 | 流式推测执行 / 并发精细化 / 缓存键 / xxHash | StreamingToolExecutor（430 行）+ concurrencyDefs + hashUtil |
| 2: 架构级 | Prompt 分层 / 工具 defer_loading / 大结果持久化 / 压缩 cache-safe fork | 工具延迟加载（5 核心 + 19 延迟）+ ContentReplacementState |
| 3: 知识库 | HyDE 缓存 / Embedding 缓存 / 预加载模糊匹配 / 查询理解增强 | 5 层缓存命中率体系 + 多意图分类 + 指代消解 |
| 4: 监控 | 性能基准 / A/B 测试 / 缓存监控 / 成本追踪 | cacheMonitor + costTracker + AB test runner + 基准套件 |

> 详见 [agent-perf-optimize 状态](../docs/plan/agent-perf-optimize.status.md)

### perf-agent-arch（2026-09-15）

| 类别 | 任务 | 说明 |
|------|------|------|
| 架构 | 工具调用时机前置 | 系统提示增加"先调工具→拿到结果→再输出文本"规则 |
| 架构 | Checkpoint 真增量写入 | 跳过每轮 DB read+JSON.parse，用内存已有消息直接构建 |
| 清理 | 动态 import 静态化 | agentStore 8 处 await import(fileTreeStore) 改静态 import |
| 清理 | 压缩路径死代码删除 | 删除 oldMessageCount/newTokenCount/compressionRatio |
| 清理 | JSON 往返消除 | agentEventStore BatchEventItem 同时存 payload 对象引用 |
| 功能 | 文件树根文件夹垃圾桶 | 仅从文件树移除导入文件夹，不删磁盘文件 |

### agent-ux-optimize（2026-09-14）

L 级 UX 优化，7 子任务 + 触发路径修复 + UI 美化，全量交付。

| 类别 | 任务 | 说明 |
|------|------|------|
| 核心 | DiffSummaryCard 统一 diff 卡片 | 三种来源 discriminated union type，单卡片承载所有 diff 场景 |
| 核心 | QuestionCard 向导式重构 | 单题向导 + 进度圆点 + ABCD 选项 + shake 错误动画 |
| 核心 | Clarification Rules 注入 | 澄清规则注入 Agent 系统提示，规范 Agent 提问行为 |
| 核心 | 技术文档索引 | react / tailwindcss / zustand 最新文档注入 Agent 上下文 |
| 核心 | KB 澄清与 Agent 联动 | buildClarificationContext 分轮策略 + searchKBHandler 注入 |
| 核心 | Delete 强制确认 | 双层防线：前端 confirm + Agent 二次确认 |
| 核心 | DiffSummaryCard 写控制集成 | 写模式 auto/manual 适配 + MD5 staleness 检测 |
| 路径修复 | editLocalFile diff 预览 | 触发路径修复，确保编辑后正确弹出 diff 预览 |
| 路径修复 | ask_question_card 铁律强化 | 文本扫描器 + needsClarification 判断 + 铁律加固 |
| 路径修复 | chat 意图 ask_question_card | chat 意图下正确触发提问卡片 |
| 路径修复 | ask_question_card 去重 | 跨轮 + 同轮两层去重，防止重复提问 |
| UI | Diff 卡片摘要化 + DetailModal | Portal 全应用居中挂载 + 尺寸扩大 + 同名文件合并 |
| UI | QuestionCard 美化 | 加粗蓝色标题 + ABCD 标签 + 去除提示文字 |
| UI | Agent 回复去 emoji | 系统提示词禁止 emoji，回复更专业 |
| UI | Diff 卡片持久化 | 应用/废弃后卡片保留 + 流式期间延迟显示 |
| UI | Staleness 修复 | editLocalFile / createFile 豁免 staleness 检测 |

### 四模块全局重构（2026-09-13）

L 级重型重构，8 阶段全部完成。详见 [重构进度文档](./plan/archive/refactor-export-editor-outline-navbar.status.md)。

| 阶段 | 范围 | 核心 |
|------|------|------|
| P0 | 模式切换 | 4 hooks 抽取 + 快捷键合并 + store 净化 + 死代码清理 |
| P1 | 目录区 | headingFromBlock / buildHeadingTree 迁入 kernel；FileTreeRow / ToolbarIconButton 去重 |
| P2 | 编辑主区 | blockTree 裂解 (blockDetection.ts) + formatCtrl 裂解 (imageFormatCtrl.ts) |
| P3 | 导出 | 3 个 MIME 映射合并为 mediaMime.ts；魔法值常量化；路径解析合并 |
| Gate | 审查/连通性 | code-review 0 critical + 19/19 链路 + eslint/lint/tsc 全绿 |

### Bug 修复与体验优化（2026-09-11 ~ 2026-09-12）

| 日期 | 任务 | 类型 |
|------|------|------|
| 09-12 | 导出图片修复（offscreen 渲染 + 3x 缩放 + 高清导出） | Bug 修复 |
| 09-12 | URL 查询修复（Agent 系统提示词优化，强制调用 web_search） | Bug 修复 |
| 09-12 | 视图切换修复（删除冗余 ViewMenu + scrollTop 保持） | Bug 修复 |
| 09-12 | 上下键跨块导航（ArrowUp/ArrowDown 跨语法类型跳转） | 功能修复 |
| 09-12 | 保存功能修复（文件树刷新 + 编辑器同步） | Bug 修复 |
| 09-11 | Outline 数据源统一为 v2 块树 | 功能优化 |
| 09-11 | Agent 输出标题自动编号（h1 中文/h2 阿拉伯/h3 层级/h4 带圈） | 新功能 |
| 09-11 | Composer /@ 标签化（TipTap + chip + 自动补全） | 重构 |
| 09-11 | 执行过程折叠重构 + 消息内联编辑 + 流式缓冲竞态修复 + 上下文延续修复 | Agent 优化 |

### Agent/KB 架构演进（2026-09-07 ~ 2026-09-10）

| 日期 | 里程碑 | 要点 |
|------|------|------|
| 09-10 | Agent/KB 代码重构 | agentLoop 拆分 (agentPromptBuilder/agentToolSelector/agentKbPreloader) + kbSearch 缓存提取 + tokenEstimator 共享 |
| 09-09 | Agent 优化 v4 | deleteLocalFile 文件树刷新 + editLocalFile 编辑器同步 + web_search 意图路由优化 + QuestionCard 美化 |
| 09-08 | AI 优化方案 | IPC 通道名修复 + deleteLocalFile 工具 + QuestionCard 底部面板 + 系统通知 + i18n |
| 09-07 | Agent 优化 v3 | 搜索持久化 + 动态轮次 + 多文件 Diff (IPatchProposal + PatchPreviewCard) |
| 09-07 | AI Agent 优化 30/30 | 重试状态重置/历史污染/提示词精简 + 轮次压缩/动态工具 + Schema 压缩/上下文压缩/KB 缓存 + Agentic RAG/HyDE |

### 历史里程碑（2026-08-06 ~ 2026-08-31）

| 日期 | 里程碑 |
|------|------|
| 08-31 | 性能优化：Agent 执行流程 DB 优化 8 项 + KB 搜索优化 5 项 + 写控制/前端优化 4 项 |
| 08-29 | UI 美化：字体统一、工具栏毛玻璃、Composer 标签、Material Design Icons + AI 性能 v2 |
| 08-25~27 | 知识库 Notus 对齐 R1~R12：Embedding 多提供商、RRF 混合检索、查询理解、jieba 分词等 |
| 08-24~25 | 写控制与任务安全 R1~R7：写模式切换、版本对比、交互暂停/恢复、事件持久化、草稿恢复 |
| 08-24 | Notus Agent 克隆 Phase 1-5：Session 状态机、Checkpoint/Resume、任务队列、死循环检测 |
| 08-14~16 | AI 代理面板 7 期交付：基建 + Chat + 知识库 + Agent + 块级改写 + KB 参数 + 体验重构 |
| 08-06~19 | 编辑主区 v2：块树内核、前缀即时转换、浮动工具栏、跨块拖选、可编辑表格块、media:// 协议 |
| 更早 | 认证系统、文件管理、8 格式导出、三语言国际化、深色主题、Frameless 窗口 |

## 进行中

### agent-memory-optimize 第三批（2026-09-30 开工）

P2 远期能力共 6 项，档位 **L（含 2 处 L4 迁移）**，Q1~Q7 已裁定（全按推荐）。三 Gate：

| Gate | 任务 | 状态 |
|------|------|------|
| D | 二.3 指代触发率接入 diagnostics（S）+ 五.4 遗忘/过期机制（M，含 L4 补列） | **D1/D2 并行实施中** |
| E | 六.1 轨迹→Skill 提炼（L）→ 六.2 结构化存储+任务类型注入（M）→ 六.3 防膨胀三防线（M） | 未开始 |
| F | 三.3 向量化经验库（L，**独立表**） | 未开始（**顺序从方向文档第 2 位挪到最后**，Q2） |

**对方向文档的两处调整（已裁定）**：① 三.3 推迟到 Gate F（经验结构未定就建向量库会建错重来）；② 六.1 走**半自动**（草稿态 + 设置页人工确认）且轨迹源用 `ai_messages`。

> 需求 [agent-memory-optimize-3.req](./requirements/agent-memory-optimize-3.req.md)（Q1~Q7 + §七事实核验 14 条修正）/ 计划 [plan](./plan/agent-memory-optimize-3.plan.md)

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
| 🔲 | 选区改写入口是否恢复 | `startSelectionRewrite` 生产零调用方，4 条 E2E 断言保留作已知失败（见 status §附4） |

## 已知问题

| 问题 | 影响范围 |
|------|------|
| `useKnowledgeBase` 恒 `false`（R1） | KB 注入矩阵、`searchKB` citation 分支在生产 UI 不可达——该开关为 Module 10 移除后的废弃项，**按裁定不恢复**（连通性 R1） |
| `allowSend` 无可达设置入口（R2） | `filterKbEgressResults` 生产不执行，仅数据层 fail-closed 兜底；`ai.settings.allowSend` 为孤儿 i18n 键 |
| Linux AppImage 与 liteparse 排除互斥（R9） | `build.files` 排除 Linux 原生件是 Windows 瘦身手段，执行 Linux 打包前须先移除这两条排除（见 [packaging](./guide/packaging.md)） |
| `AI_CHAT` 附件/入 KB 链休眠（R10） | 主进程 `ChatReqPayload` 有 `attachments`/`uploadToKb`，preload 类型缺字段，渲染层零调用方（Chat 模式已废弃） |
| anthropic 主循环不分流 + 丢 `tool` 行 | `protocol=anthropic` 时主循环仍走 OpenAI 形状；`anthropicClient.ts:217-234` / `anthropicCompat.ts:89-105` 静默丢 `tool` 角色与 `tool_calls`（agent-memory **R4**，agent-memory 另立 issue 范围） |
| `AI_CHAT` 读到空 assistant 行 | 主进程 `chatHandlers.ts:345-353` 不透传 `tool_calls`，本批新形状会送 `content:''`；渲染层零调用点**当前不可达**（agent-memory **R3**，留第二批） |
| `AI_CONVERSATION_GET` 未校验 `event.sender` | 以渲染进程传入 `userId` 为权威（`chatHandlers.ts:73-83`）——既有问题，agent-memory 阶段 7 A7 提出、非本批引入，留第二批 |
| `getMessagesByConversationPaginated` 已无 `src/` 调用点 | 本批 P0-5 接线改用 `getRecentMessagesByRounds` 后成死代码（`db/ai.ts:948`）；`e2e/ai-agent-panel.spec.ts:371` 残留 `updateMessageToolCalls` mock（无行为影响，改动需重跑 E2E） |
| fake DB 未验真实 `transaction()`/`iterate()` 语义 | better-sqlite3 在系统 Node 下 ABI 不兼容，vitest 只能用 fake；本批按 plan 未新增 cjs，`scripts/agent-smoke.cjs` 需 Electron + 真实 key 未跑 |
| xlsx@0.18.5 依赖漏洞 | SheetJS 官方源修复版未发 npm，跟踪上游发布后再升级 |
| v2 Normal 模式无查找高亮 | 编辑主区（Normal 模式） |
| 撤销/重做后光标回到重建树首块 | 编辑主区（撤销/重做操作） |
| 段落级 MD Source 视图未迁移 | 编辑主区（Source 模式） |
| E2E 全量 31 failed（基线 112） | 其中 **10 条为已知/预期失败**：`ai-agent-panel` 4 条选区改写（保留作证据）+ `drag-selection-markers` 5 条（标题自带「当前 RED」）+ `floating-toolbar:222` 1 条（同属已移除的 AI 改写能力）；**其余 21 条属其他 spec 的既有问题**，不在 agent-cost-optimize 范围 |
| 选区改写链路零 E2E 覆盖 | document scope 的预览/应用/撤销/stale/unchanged/失败条已覆盖；选区侧因 `startSelectionRewrite` 无调用方而不可测 |
| `searchMode:'vector'` 无向量即拒答 | `kbSearch.ts:508` FTS5 分支只认 `fts5\|hybrid`，`vector` 模式不传 `queryVector`（未开 HyDE）→ 候选空 → `:683` 规范拒答，**无关键词兜底**；`kbSearch.ts:443` JSDoc 称「无 queryVector 降级 FTS5+标题」对 `vector` 不成立（agent-memory-2 A4 实测发现，降级只在默认 hybrid 路径成立） |
| KB 搜索缓存键缺参 | `searchCache.ts:118-124` 键只含 `topK/currentFileId/threshold/searchMode`，**不含 `pinnedWeight` 与 `queryVector`**；且仅 `kbIndexer` 索引事件触发失效、设置变更不失效 → 3min TTL 内改置顶权重或切换向量开关会复用旧排序（A4 实测发现） |
| `rankCandidates` 死参数 | `kbSearchFts.ts:193-198` 的 `pinnedWeight` 形参函数体内零使用（×1.5 只在 `applyWeighting`），既有用例 `:165` 已注明分工 |
| 记忆提取节流状态不持久化 | `memoryWriter.ts` 的 `Map<conversationId, {turn,lastEnqueuedTurn}>` 为进程内，**重启后节流失效**（首轮即提取）且会话数增长不回收；跨重启节流需加落库字段（涉迁移，agent-memory-2 C2 明令不改） |
| pending 提取任务可能被 supersede 吞掉 | `agentTaskQueue` 既有语义：新 agent 任务 `enqueue` 会顶掉同会话仍 pending 的后台提取任务 → 一次提取可能被跳过（agent-memory-2 C2 复用队列不改该语义，Gate C 后评估实际频率） |
| `MEMORY_EVICT_MAX_AGE_DAYS=90` 无实测依据 | `memoryPolicy.ts` 的时间衰减阈值为无数据的保守取值，注释已标「待实测校准（建议按 active 行 written_at 距今 P90）」 |
| 同组多条 manual 记忆会并存 | `mergeConflicts` 按「manual 恒免」绝对口径执行 → 组内多条 manual 行不关闭（短期不可达：表内 manual 写入方要到 C3 才存在）；届时若需「组内只留一条」再改 |
| **全仓 IPC handler 均无 `event.sender` 校验** | `SECURITY.md` 明确「IPC handler 必须验证调用来源和参数」，但核查确认**此前零落实**（`chatHandlers.ts:73-83` 以渲染进程传入 `userId` 为权威即其一）；`memoryHandlers.ts` 是**第一个**按该规则落地的范式（`isTrustedSender` + JWT + `findById` + fail-closed）。其余 handler 待逐个补齐——**既有问题，非 agent-memory-2 引入** |
| `getJwtSecret` 存在双份副本 | `memoryHandlers.ts` 与 `ipc-handlers.ts` 各一份 `sha256(userData)` 推导（导入会成循环 + 拉大测试 import 图），两处已互相注释「改动需两处同步」；抽取独立 auth 模块属重构，agent-memory-2 裁定本批不做 |
| `AgentTaskQueue.enqueue` supersede 不分任务类型 | `memory_extract` 与 `skill_distill` 同点入队会**互相顶掉**（队列自动 supersede 同会话旧 pending）。D3 用「同会话任意 pending 即跳过」规避 → 提炼给 memory 让位，**首轮必然延后 1 轮**（agent-memory-3 D3，记 TODO） |
| 提炼技能草稿不按 `user_id` 分目录 | 纯文件系统选型的固有结果：`userData/skills/_auto/` 与 `_drafts/` 单机共用，IPC 已按 C3 四条鉴权但多账号共享草稿列表（agent-memory-3 D3，单机桌面可接受） |
| D3/D4 渲染侧改动行无单测 | `SkillsPanel.tsx`「提炼技能」栏与 `agentStore` 的 `loadSkillDrafts/approveSkillDraft/rejectSkillDraft`、D4 经验注入渲染侧均未纳入覆盖（主进程侧 D3 88% / D4 96.6%），待 Gate E 收口评估 |
| chat 分支经验块生产恒空 | `useAgentPrompt = !isChatIntent || ...` ⇒ 走 `buildChatSystemPrompt` 的唯一条件就是 `intent==='chat'`，而 D4 裁定 3「chat 一律不注入」→ **生产上第 3 参恒收 `''`**。能力完整有 4 条单测；待 `intentRouter` 能区分「闲聊 / 未知任务类型」后即生效 |
| `approveDraftSkill` 全非法 `intents` 报错不具体 | `parseSkillMarkdown` 先把非法值滤成 `[]` → `assertValidSkillDraft` 抛「不能为空数组」，人工确认失败时**不提示具体非法值**（agent-memory-3 D4，低风险，文案可细化） |
| `isFallthrough` 语义取自 agent 任务路由 | D1 按裁定实现为 `intentRouter.classifyIntent(query).intent === 'chat'`，实测大部分 KB 检索 query 不命中该路由关键词表 → 多为 `true`。若需按 KB 侧 `detectQueryIntent` 的 keyword 默认分支判定，改一行即可（agent-memory-3 D1） |
