# WeaveMD — CLAUDE.md

> 精简版：仅保留当前主线所需信息。深层设计见 `docs/`（[SUMMARY.md](../docs/SUMMARY.md) 为索引，
> `specs/` 按模块分文件夹存功能规格、`research/` 存外部资料调研）。

## Build / Test

- `npm run dev` — Vite + Electron (HMR)
- `npm run build` — Vite build + electron-builder
- `npm run lint` / `npm run typecheck` / `npm run test` — ESLint / tsc --noEmit / Vitest
- `npx playwright test` — 真实 Chromium E2E（自动启动 renderer-only vite server）
- 质量门禁：tsc + vitest + eslint(0 error) + vite build + E2E 全绿才算完成

## 目录结构（要点）

- `src/main/` — Electron 主进程：window、ipc-handlers、db（better-sqlite3，含 `agentMemory.ts` 记忆 DAO / `agent_memory` 16 列）
- `src/render/editor/` — **编辑主区 v2 内核（React-free）**：`kernel/`（blockTree、blockDetection、
  双向转换、行内渲染、选区、outline）+ `controllers/`（七类交互 + imageFormatCtrl + shared）
- `src/render/hooks/` — 编辑器 hooks：useMonacoTheme / useGlobalShortcuts / useModeScrollPersistence / useDraftFlusher
- `src/render/utils/` — DOM 选择器常量（domSelectors.ts）+ 字体常量（fontConstants.ts）
- `src/render/components/Editor/v2/` — v2 渲染层：EditorV2（宿主）、`blocks/`
  （ContentBlock 是唯一 contentEditable）、`toolbar/FloatingToolbar`（文本工具栏）+
  ImageToolbar（图片工具栏）+ toolbarState（纯函数）
- `src/render/components/Editor/` — EditorView 薄编排器（v2 唯一）
- `src/render/stores/ services/ styles/` — Zustand / markdown 服务 / globals.css
- `src/main/export/` — 导出模块：exportService / imageInline / types + mediaMime（MIME 映射）
- `src/main/ai/` — AI 主进程服务（remote-only）：`llm/`（llmClient/anthropicClient/modelList）+
  `agent/`（agentLoop/agentSession/agentTaskQueue/agentContext/memoryWriter/memoryPolicy）+ `knowledge/`（kbIndexer/kbSearch）+
  `files/`（documentParser/multimodalParse/pdfLayout/mdImageResolver/conversationExport/parseLimiter）+
  `skills/`（skillLoader/skillPaths/skillAutoStore/skillDistiller/skillManager）+ `tools/`（30 个工具：5 核心 + 25 延迟，含 memoryRead/memoryWrite）+
  `ipc/` 按域拆分（13 个 handler 模块 + index + shared）
- `src/render/components/AIAgent/` — AI 面板三视图外壳（home/session/settings）+
  AIPanelComposer（TipTap contentEditable + /@标签 chip）+ AgentTab 消息流 +
  composer/extensions/（SkillTag/MentionTag/skillSuggestion/mentionSuggestion）+
  settings/{ModelForm,EmbeddingSettings,SearchSettings,...}
- `README.md` — GitHub 项目主页（功能介绍、下载安装、开发指南）
- `docs/` — README / SUMMARY / TODO / REQUIREMENTS / CONTRIBUTING + architecture/ modules/ specs/ plan/ requirements/ research/ guide/

## 规范

- 中文交流；代码/标识符英文；React 18 + TS strict；Zustand v4；Tailwind（自定义色板，禁止默认色）
- 文档优先：改代码前先同步需求/技术文档，完成后更新进度与验证记录
- 命名：组件 PascalCase，函数/文件 camelCase；不用 `any`
- 标题字号：H1 26/700、H2 22/600、H3 18/600、H4 16/500、正文 14/400
- 编辑器+目录区字体：中文楷体（KaiTi）、英文 Consolas（`.editor-scroll-container` + `.outline-scroll`）
- 行前缀解析统一走 `src/render/editor/kernel/markdownSyntax.ts`（正则全含 U+00A0 分隔）+ `blockDetection.ts` 消费

## 编辑主区 v2（当前主线）

> 详细规范见 `docs/specs/editor/editor-v2-architecture.md`（§1-§2 架构，§3-§6 拆为同名分册）+
> `docs/specs/editor/editor-v2-progress.md`（§13 实施记录索引，13.1~13.15 分 3 册）+
> `docs/modules/04-编辑主区-Editor.md`（模块文档）

- 仅叶子块内容 span（`ContentBlock`）可编辑；不可变块树 + 无损双向转换（往返不变式）
- 前缀即时转换（`# `/`- `/`1. `/`- [ ] `/`> `/` ```lang `），退格在内容起点降级
  （六条退出规则：docs/specs/editor/markdown-block-exit-rules.md）
- 语法外观对齐 marktext：标题 `#`×n 光标提示、深灰列表 marker、圆形任务复选框、引用绿色竖线
- 浮动工具栏（SPEC-EDIT-FT）：选区触发 + 块类型下拉 + 行内格式（加粗/斜体/删除线/高亮/代码/链接/图片/数学/表格）
- 图片：工具栏直选系统文件框 + `media://` 本地图协议 + 四角等比缩放 + 图片工具栏
- 可编辑表格块：`tableCodec.ts` 纯函数 + `TableBlock.tsx` 每格 `contenteditable="plaintext-only"` + `TableToolbar.tsx`
- 跨块拖选：rAF 节流 + 反向交换端点 + `useCrossBlockDragSelection.ts`
- 跨块选区替换：`beforeinput`/`onPaste` 拦截 → `replaceLeafRange` 块树级删除+插入
- 性能优化：setBlockText/setInlineHtml 精准单块克隆 + tokenizeInline LRU 缓存（256 条）+ outline 脏标记（数据结构就绪，增量路径待接线）+ React.memo 补全 + Prism/KaTeX code splitting

## AI 代理面板与知识库

> 详细规范见 `docs/specs/ai-agent/ai-panel-features.md`（交付记录）+
> `docs/specs/ai-agent/agent-memory.md`（自动记忆）/ `agent-prompt-context.md`（提示词注入）+
> `docs/modules/11-AI代理面板-Agent.md`（架构文档）

- **后端 remote-only**：`ChatBackend` 只有 `'remote'`（无本地推理后端）
- 右侧 AI 面板（导航栏「AI」按钮开合），仅 Agent 模式（Chat 已删除）
- 铁律一：**AI 写入必经确认**——红删绿增预览 → 用户确认 → `updateContent` 入 undo 栈
- 铁律二：**笔记外发必须用户知情同意**（联网同意已停用——三配置齐全即视为许可）；key 用 safeStorage 加密存 SQLite
- Agent 能力：toolRegistry + agentLoop（≤6 轮）+ skillLoader + intentRouter + intentTiering 三层路由（含 runTaskSplit）+ contextManager
- 多意图：规则预检门（命中 ≥2 类才开闸，单意图零 LLM）→ `runTaskSplit` 结构化拆分（`parseStructuredJson` 严格 JSON，失败重试 1 次后降级单意图直通）→ 拆分确认卡（`SplitConfirmCard`）→ 子任务链顺序执行（`subtaskOrchestrator`：轮次双预算 / 中断安全点 / 失败重试）与依赖图并行调度（`subtaskScheduler`：双预算 + 冲突防护）
- 多意图追踪与报告：全链状态落 `agent_sessions.intent_json`（`chainTracking`，零加列）+ 链末执行报告合并（`chainReport`，部分失败策略）
- 多意图确认与写控制：intent × tool 确认矩阵（`confirmMatrix` 唯一权威，force/batch/none 三档，fail-closed）+ `writeMode` auto/manual 消费（manual 逐写确认、auto 链末写批次汇总确认 `BatchConfirmCard`），铁律一不削弱
- 三层意图路由：L1 规则 `classifyIntent` / L2 低置信 tier2 小模型（1.5s 硬闸）/ L3 `runTaskSplit` 大模型规划；KB 检索策略意图与 Agent 任务意图**桥接不合并**（见 `docs/architecture/knowledge.md` 桥接小节）
- 自动记忆：`agent_memory` 16 列（+ `agent_memory_fts` trigram）+ `memory_read`/`memory_write` 两工具 +
  后台 `memory_extract` 提取与轨迹提炼 `skill_distill`（`userData/skills/_auto/`，草稿需人工采纳）+
  画像/经验块注入 prompt + 遗忘与容量上限（`access_count` LRU 淘汰，`manual` 永不关闭）+ 相似合并建议三态审核
- 知识库：FTS5 BM25 召回 + 标题召回 + 拒答 0.6 + 出处可跳转 + 置顶 ×1.5；searchMode 三模式（fts5/vector/hybrid）
  —— **向量为可选路径**：`kb_chunks.vector` 需配置 embedding 才写入，且 `queryVector` 仅在 `searchKB` 传 `hyde: true` 时生成，
  **默认 hybrid 降级为 FTS5+标题；vector 模式无 `queryVector` 时不回退 FTS5**（只剩标题匹配，无候选按 0.6 拒答）
- Agentic RAG：所有非 chat 意图均可自主调用 searchKB（LLM 决定是否检索）；HyDE 支持假设性文档 embedding 检索
- 写控制：writeMode auto/manual + MD5 staleness detection + Agent 交互暂停/恢复 + 事件持久化
- 三视图重构：home（RECENT 最近3）/ session（会话）/ settings（设置侧栏）
- Composer 标签化：TipTap contentEditable + SkillTag/MentionTag 自定义 Node（atom/inline）+
  @tiptap/suggestion 补全 + Codex 风格 chip（蓝/绿/琥珀色）
- AI 标题自动编号：h1→中文数字、h2→阿拉伯、h3→层级、h4→带圈（渲染层自动编号，不依赖 LLM）

## 关键文件

- `src/render/editor/kernel/` — blockTree / blockDetection / markdownToState / stateToMarkdown / inlineRenderer / outline / selection
- `src/main/media-protocol.ts` — media:// 本地图协议（非 standard scheme）
- `src/render/services/saveCurrentDraft.ts` — 切换/关闭前统一保存前置
- `src/render/editor/controllers/` — input / enter / backspace / convert / click / list / formatCtrl / imageFormatCtrl / shared
- `src/render/editor/editorInstance.ts` — 内核宿主（内容加载、markdown 同步）
- `src/render/components/Editor/v2/EditorV2.tsx` — v2 入口（状态、事件路由、焦点恢复、撤销）
- `src/render/components/Editor/v2/blocks/ContentBlock.tsx` — 唯一 contentEditable 表面
- `src/render/components/Editor/v2/toolbar/FloatingToolbar.tsx` — 文本浮动工具栏
- `src/render/components/Editor/v2/image/ImageResizeBox.tsx` + `resizeMath.ts` — 图片四角缩放
- `src/render/components/Editor/EditorView.tsx` — 薄编排器（v2 唯一，副作用抽入 hooks/）
- `src/render/hooks/useMonacoTheme.ts` — Monaco 主题异步加载
- `src/render/hooks/useGlobalShortcuts.ts` — 全局快捷键单例（Ctrl+F/S/Z/Y/`/O）
- `src/render/hooks/useModeScrollPersistence.ts` — 模式切换滚动保存/恢复
- `src/render/hooks/useDraftFlusher.ts` — 草稿刷新模块级 ref（替代 store 字段）
- `src/render/utils/domSelectors.ts` — DOM 选择器常量集中
- `src/render/utils/fontConstants.ts` — 字体常量集中
- `src/main/export/imageInline.ts` — 图片 base64 内联（media:// / http(s) / 本地路径）
- `src/main/export/exportService.ts` — 8 格式分发器（md/html/doc/docx/pdf/png/jpg/jpeg）
- `src/main/mediaMime.ts` — 项目唯一 MIME 映射表（合并 3 处重复定义）
- `src/main/ai/toolRegistry.ts` — Agent 工具注册（30 工具：5 核心 + 25 延迟，含 deleteLocalFile / memory_read / memory_write）
- `src/main/ai/agent/agentLoop.ts` — Agent 循环（WRITE_TOOLS + toolsForIntent + 确认流程）
- `src/main/ai/agent/agentTaskWorker.ts` — 后台任务执行器（交互事件持久化 + IPC 发送）
- `src/main/ai/agent/agentEventStore.ts` — 事件持久化（persistAndSend + persistOnly + replayFromSeq）
- `src/main/ai/agent/taskPlanner.ts` — 多意图结构化拆分调用（runTaskSplit + 失败降级单意图直通）
- `src/main/ai/agent/subtaskOrchestrator.ts` — 子任务链状态机（顺序执行 / 中断安全点 / 前序摘要注入）
- `src/main/ai/agent/confirmMatrix.ts` — intent × tool 确认矩阵唯一权威（force/batch/none + fail-closed）
- `src/main/ai/agent/chainTracking.ts` — 子任务链全链状态落 `agent_sessions.intent_json`
- `src/main/ai/intentTiering.ts` — 三层意图路由（规则 / tier2 小模型 / 大模型规划）+ 共享 TTL 缓存
- `src/main/ai/llm/structuredJson.ts` — 严格 JSON 解析骨架（剥围栏 + 校验，厂商无关）
- `src/shared/ai/{taskPlan,intentRecord}.ts` — 拆分计划与 intent_json 共享类型
- `src/render/components/AIAgent/cards/{SplitConfirmCard,BatchConfirmCard}.tsx` — 拆分确认卡 / 写批次汇总确认卡
- `src/render/components/AIAgent/cards/QuestionCard.tsx` — 底部滑出提问面板
- `src/render/components/AIAgent/panel/AIPanelSession.tsx` — 会话视图（集成 QuestionCard）
- `src/render/components/AIAgent/panel/AIPanelComposer.tsx` — TipTap Composer（/@标签 + 补全）
- `src/render/components/AIAgent/composer/extensions/` — SkillTag/MentionTag/skillSuggestion/mentionSuggestion
- `src/render/services/aiMarkdown.tsx` — AI Markdown 渲染（HeadingCounter + 自动编号）

## UI 美化

> 详细规范见 `docs/specs/editor/editor-v2-features.md`（编辑器 UI + 工具栏 + 图片 + 表格）
> （原引用的 `memory/ui-beautify-2026-08-29.md` 已不存在于记忆目录，2026-10-01 核对移除）

- 字体：代码块 `Consolas + 阿里巴巴普惠体 B`；编辑主区 `Consolas + 阿里巴巴普惠体`
- 工具栏毛玻璃：`backdrop-filter: blur(12px) saturate(180%)`
- 浮动工具栏图标：Material Design Icons（react-icons/md）
- 主题：Default（明亮）+ Warm Earth（暖色陶土），CSS 变量在 globals.css

## 已知限制（详见 docs/specs/editor/editor-v2-progress.md §13 索引表 → 对应分册）

- v2 Normal 无查找高亮；撤销/重做后光标回到重建树首块；段落级 MD Source 视图未迁移

## 项目文档

- [README](../README.md) — GitHub 项目主页（功能介绍、下载安装、开发指南）
- [docs/README.md](../docs/README.md) — 开发参考（技术栈、目录结构、命令、质量门禁）
- [TODO](../docs/TODO.md) — 功能进度、已知问题
- [SUMMARY](../docs/SUMMARY.md) — 文档索引（含渐进式披露规则）
- [REQUIREMENTS](../docs/REQUIREMENTS.md) — 功能需求文档
- [CONTRIBUTING](../docs/CONTRIBUTING.md) — 文档编写规范
- [architecture/](../docs/architecture/) — 按技术层分类（10 篇：前端/编辑器/后端/AI/知识库/数据库/IPC/安全/测试/构建）
- [modules/](../docs/modules/) — 各模块文档（11 个模块；11-AI代理面板 另带 4 篇分册）
- [specs/](../docs/specs/) — 功能规格与行为契约，**按模块分文件夹**（editor 10 主 + 7 分册 / ai-agent 6 主 + 3 分册 / knowledge 5 主 / release 1 主 = **22 主 + 10 分册**）
- [requirements/](../docs/requirements/) — devflow 需求文档（8 篇按模块分 6 个子文件夹；**保留在库** —— 它是当前代码行为的裁定依据）
- [testing/](../docs/testing/) — TDD 报告 + [索引](../docs/testing/README.md)（**交付时点快照，门禁数字已过期**；测试意图溯源用，要跑测试看 `tests/` + `e2e/`）
- `plan/` — 现行任务的过程文档（**现行 5 篇，全部属 ai-core-perf**：bottleneck / plan / status / connectivity / delivery）。**已完成任务的过程文档与测试报告正文一律删除、见 git 历史**（2026-10-04 文档精简）；权威规格在 `specs/`、调研在 `research/`

### 查阅规则（渐进式披露）
- 项目是什么、怎么跑 → README.md（根目录）
- 技术栈、目录结构、命令 → docs/README.md
- 功能进度、已知问题 → TODO.md
- 前端渲染层、状态管理 → docs/architecture/frontend.md
- 编辑器内核、块树、控制器 → docs/architecture/editor.md
- 主进程、IPC、工具系统 → docs/architecture/backend.md
- AI/Agent 循环、工具、意图 → docs/architecture/ai-agent.md
- 知识库索引、搜索、HyDE → docs/architecture/knowledge.md
- 数据库表结构、DAO → docs/architecture/database.md
- IPC 通道、事件持久化 → docs/architecture/ipc.md
- 认证、加密、权限 → docs/architecture/security.md
- 测试策略、工具、覆盖率 → docs/architecture/testing.md
- 构建、打包、发布 → docs/architecture/build.md
- 自动更新、版本检测 → docs/specs/release/auto-update-spec.md
- 模块实现细节 → docs/modules/{模块名}.md
- 超长三级文档的分册 → 主文档头部索引 → docs/{文档名}/NN-主题.md（分册正文与原章节逐字一致）
- 功能规格与行为契约 → docs/specs/{模块}/（editor / ai-agent / knowledge / release）
- 外部资料调研 → docs/research/
- 验证证据 → `tests/` + `e2e/`（活证据）；测试意图溯源 → docs/testing/（快照）；性能对比数据 → docs/plan/ai-core-perf.delivery.md
- 实施计划、优化状态 → docs/plan/（仅现行任务；已完成任务见 git 历史）
- 导出/MIME/打包指南 → docs/guide/
