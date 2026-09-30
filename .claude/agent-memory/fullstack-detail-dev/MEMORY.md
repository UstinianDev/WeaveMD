# Agent Memory Index（精选索引）

> 本目录 64 个记忆中**只索引最近批次的 11 条**（未索引者不会自动加载，但文件仍在，可按文件名点名引用）。
> 未索引的主要是：第一批 A/B 与 `agent-memory-*-done` 早期记录、`doc-pipeline-b1~b11-done`（该批已交付，权威版本见 `docs/testing/doc-pipeline-b*.tdd.md`）、以及 perf/cost/ux 等更早批次的执行记录。
> **需要跨任务延续上下文时，优先看 `docs/`（tdd/plan/status），本索引只作最近批次的快捷入口。**

- [agent-memory-optimize-2 B4 完成](agent-memory-optimize-2-b4-done.md) — 画像层已实现未提交、五层 token 实测表、db 来源口径、下一任务 Gate B/C1
- [agent-memory-optimize-2 C3 完成](agent-memory-optimize-2-c3-done.md) — 设置页自动记忆 tab、首个 event.sender 校验范式、JWT 鉴权口径、门禁 100% 改动行覆盖
- [agent-memory-optimize-2 C4 完成](agent-memory-optimize-2-c4-done.md) — 场景③ E2E 两段式（Node 段真压缩 + 渲染段 mock 注入），纯新增 198 行、连跑 3 绿、未提交
- [WeaveMD 测试环境六坑](weavemd-test-env-pitfalls.md) — better-sqlite3 需 mock、coverage.include 重复传参、有红不出覆盖报告、提示词 sha256/「画像」护栏、两处 flaky、E2E 内加载主进程纯函数
- [D1 hadPronounRef 可观测交付](d1-hadpronounref-observability.md) — searchKB content 条件挂载、agentTaskWorker 闭包丢 opts、researchLoop 仍未接线
- [D2 遗忘/过期机制交付](agent-memory-optimize-3-d2-done.md) — 访问计数绝对值写回、runMemoryPolicy 形状锁、fake 引擎兼容清单、Electron smoke 挂起坑
- [D3 轨迹→Skill 提炼交付](agent-memory-optimize-3-d3-done.md) — queue supersede 抢位、skillLoader 整模块 mock 坑、双防线组合变异、四门禁 4315 例
- [D4 intents+经验注入交付](agent-memory-optimize-3-d4-done.md) — 白名单落 agentPromptBuilder 的理由、filter(Boolean) 空块护栏、六层 token 实测、4350 例
- [D5 防膨胀三防线交付](agent-memory-optimize-3-d5-done.md) — fts5 'delete' 命令在普通表必报错（kb 侧疑似长期失效）、unicode61 中文不可用、六态 smoke、4418 例
- [D7 KB FTS 触发器修复交付](agent-memory-optimize-3-d7-done.md) — smoke 自持 SQL 副本须双向同步、仓内 CRLF、迁移函数 export+FakeDb 补覆盖、4430 例
- [D6 向量化经验库交付](agent-memory-optimize-3-d6-done.md) — FTS5 rank 升序=相关度序（小库反例）、列实为 16、fake 须从 SQL 派生过滤、4491 例
