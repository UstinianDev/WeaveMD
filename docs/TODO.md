# TODO

> 最后更新：2026-09-07

## 已完成

### Agent 优化 v3（2026-09-07）

详见 [实施状态](./plan/agent-optimize-v3.status.md)。

| 需求 | 任务 | 门禁 |
|------|------|------|
| R1 搜索持久化 | refreshSearchConfig 联动 + handleTest 去乐观置位 | tsc 0 \| vitest 1530/1530 \| lint 0 |
| R2 动态轮次 | DEFAULT_MAX_ROUNDS 统一 + agentLoop/guard/session 同步 + 死循环消息透传 + 意图动态轮次 + userMaxRounds | 同上 |
| R3 多文件 Diff | IPatchProposal + agentStore 拦截 + PatchPreviewCard + PatchDetailModal + AgentTab 集成 | 同上 |

### AI Agent 优化（2026-09-07，30/30 全部完成）

详见 [实施状态](./plan/ai-agent-optimize.status.md)。

| 阶段 | 任务 | 门禁 |
|------|------|------|
| P0 | 重试状态重置、历史污染、提示词精简 | tsc 0 \| vitest 1530/1530 |
| P1 | 轮次压缩、动态工具、重排优化、进度反馈、保存按钮/提示、手动保存 | 同上 |
| P2/P3 | Schema压缩、上下文压缩、KB缓存、滚动优化、IPC批量、KB预加载、searchMode、Web Worker | 同上 |
| P4 | Agentic RAG（全意图自主检索）、HyDE（假设性文档检索） | 同上 |

### 性能优化 + Bug 修复（2026-08-31）

- Agent 执行流程 DB 优化（8 项）：seq 缓存、timestamp 客户端生成、冗余 JOIN 移除等
- 知识库搜索优化（5 项）：N+1→聚合查询、writeChunks 事务、复合索引等
- 写控制 + 前端优化（4 项）：editLocalFile statSync、React.memo、unified 复用、DAO 省回读
- Bug 修复：编辑器模式切换滚动保持、检查更新卡住、启动自动检查更新

### UI 美化 + AI 性能 v2（2026-08-29）

- 字体统一、工具栏毛玻璃、按钮悬停动效、Composer 标签、Material Design Icons
- 前端 4 组件 memo + 后端 5 项 DB 查询优化

### 知识库 Notus 对齐（2026-08-25 ~ 2026-08-27，R1~R12）

12 项需求全部完成：Embedding 多提供商、RRF 混合检索、加权策略、段聚合、查询理解、条件重排、知识澄清、证据分级、研究循环、文档上下文、jieba 分词、图片 embedding。

### 写控制与任务安全（2026-08-24 ~ 2026-08-25，R1~R7）

7 项需求全部完成：写模式切换、版本对比、交互暂停/恢复、待处理 UI、事件持久化、草稿恢复、模块集成。

### Notus Agent 克隆（2026-08-24，Phase 1-5）

21 项功能全部实现：Session 状态机、Checkpoint/Resume、结构化提问、任务队列、preview_patch_files、文件快照、SSE 持久化、死循环检测、联网搜索等。

### 编辑主区 v2（2026-08-06 ~ 2026-08-19）

块树内核、前缀即时转换、退出规则、浮动工具栏、行内格式、跨块拖选、图片工具栏、media:// 协议、可编辑表格块。

### AI 代理面板（2026-08-14 ~ 2026-08-16）

7 期全部交付：基建 + Chat 闭环 + 知识库 + Agent + 块级改写 + KB 参数 + 体验重构。

### 其他

认证系统、文件管理、导出（8 格式）、国际化（三语言）、深色主题、Frameless 窗口。

## 进行中

（无）

## 待开发

- 🔲 v2 Normal 查找高亮
- 🔲 撤销/重做后光标定位优化
- 🔲 段落级 MD Source 视图迁移
- 🔲 真 MCP server 管理
- 🔲 pdf/docx 知识库导入
- 🔲 Web Worker JSON.parse（AgentWorkflowCard 大 JSON 异步解析，已实现 worker 基础设施）

## 已知问题

- v2 Normal 模式无查找高亮
- 撤销/重做后光标回到重建树首块
- 5 个既有 E2E 红（drag-selection-markers.spec.ts）
