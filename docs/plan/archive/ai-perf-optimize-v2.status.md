# AI 模块性能优化 — 状态文档

> 创建：2026-08-29
> 最后更新：2026-08-31

## Round 1（2026-08-29）✅

- busy_timeout pragma、prepared statement cache（20 处）
- AIPanelComposer React.memo、AgentStepTimeline useMemo
- Markdown LRU 缓存（64 条）、isStreaming 缓存清理

## Round 2（2026-08-31）✅

### Agent 执行流程 DB 优化（8 项）
- agentEventStore seq 内存缓存
- appendMessage 客户端 timestamp（省 SELECT）
- getMessagesByConversation 去 JOIN
- agentSessionDao 省回读 SELECT + incrementSessionRounds 原子 UPDATE
- supersedeOldTasks 单条 UPDATE
- agentLoop findIndex 直接访问 + JSON.stringify 复用

### 知识库搜索优化（5 项）
- KB_LIST 聚合查询（N+1→1）
- writeChunks 事务包裹
- 复合索引 idx_kb_doc_user_file
- indexFile 去冗余查询
- titleMatchSearch 合并 OR

### 写控制 + 前端
- editLocalFile statSync 替代 readFileSync
- AgentStepTimeline/AgentLoopLogList React.memo
- aiMarkdown processor 模块级复用
- DAO 层省回读 SELECT

### 测试门禁
- tsc 0 新增 | vitest 1530/1530 | lint 0 新增 error | vite build ok
