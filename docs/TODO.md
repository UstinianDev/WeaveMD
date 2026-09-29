# TODO

> 最后更新：2026-09-29

## 已完成

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

（无）

## 待开发

| 优先级 | 任务 | 说明 |
|------|------|------|
| 🔲 P0 | **Agent Memory 优化方向**（第一批） | 指代追问被反问"它指什么"的五条根因修复：chat 丢历史 / 「忽略之前所有对话」注入 / 短文本误判澄清 / tool_calls 不落库 / KB 代词消解无历史；7 模块 30 任务路线图、红线与逐任务拷问见 [direction](./plan/agent-memory-optimize.direction.md) |
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
| 🔲 | `classifyIntent` 接入 searchKB 主管线 | queryPlanner 意图分类未接入 kbSearch 搜索管线 |
| 🔲 | 选区改写入口是否恢复 | `startSelectionRewrite` 生产零调用方，4 条 E2E 断言保留作已知失败（见 status §附4） |

## 已知问题

| 问题 | 影响范围 |
|------|------|
| `useKnowledgeBase` 恒 `false`（R1） | KB 注入矩阵、`searchKB` citation 分支在生产 UI 不可达——该开关为 Module 10 移除后的废弃项，**按裁定不恢复**（连通性 R1） |
| `allowSend` 无可达设置入口（R2） | `filterKbEgressResults` 生产不执行，仅数据层 fail-closed 兜底；`ai.settings.allowSend` 为孤儿 i18n 键 |
| Linux AppImage 与 liteparse 排除互斥（R9） | `build.files` 排除 Linux 原生件是 Windows 瘦身手段，执行 Linux 打包前须先移除这两条排除（见 [packaging](./guide/packaging.md)） |
| `AI_CHAT` 附件/入 KB 链休眠（R10） | 主进程 `ChatReqPayload` 有 `attachments`/`uploadToKb`，preload 类型缺字段，渲染层零调用方（Chat 模式已废弃） |
| anthropic 主循环不分流 | `protocol=anthropic` 时主循环仍走 OpenAI 形状，已建的 `anthropicClient` 未接入主循环（另立 issue） |
| xlsx@0.18.5 依赖漏洞 | SheetJS 官方源修复版未发 npm，跟踪上游发布后再升级 |
| v2 Normal 模式无查找高亮 | 编辑主区（Normal 模式） |
| 撤销/重做后光标回到重建树首块 | 编辑主区（撤销/重做操作） |
| 段落级 MD Source 视图未迁移 | 编辑主区（Source 模式） |
| `classifyIntent` 未接入 searchKB 主管线 | queryPlanner 意图分类与 kbSearch 独立运行 |
| E2E 全量 31 failed（基线 112） | 其中 **10 条为已知/预期失败**：`ai-agent-panel` 4 条选区改写（保留作证据）+ `drag-selection-markers` 5 条（标题自带「当前 RED」）+ `floating-toolbar:222` 1 条（同属已移除的 AI 改写能力）；**其余 21 条属其他 spec 的既有问题**，不在 agent-cost-optimize 范围 |
| 选区改写链路零 E2E 覆盖 | document scope 的预览/应用/撤销/stale/unchanged/失败条已覆盖；选区侧因 `startSelectionRewrite` 无调用方而不可测 |