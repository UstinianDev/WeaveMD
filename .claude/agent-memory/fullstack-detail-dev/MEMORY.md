# Agent Memory Index

- [AI 主进程层模块/测试隔离/安全契约](ai-main-process-layer.md) — 主进程 ai/* 模块边界、KB/Agent IPC+preload 接线模式、weaveMDBridge noop 必改点、FakeDatabase/electron mock 实证
- [AI 渲染安全 + M1 类型耦合](feedback-ai-renderer-security.md) — assistant 纯文本渲染禁 innerHTML；weaveMDBridge 需 ai noop；onStream mock 用 unknown cast
- [FTS5 unicode61 中文 token 行为](fts5-cjk-unicode61.md) — 连续 CJK 当一个 token，裸 MATCH 不命中；kbSearch 需前缀或向量兜底
- [渲染批次5收尾现状](renderer-batch5-closing.md) — SettingsModal KB 参数(agentStore.kbSettings 内存态)/出处 line 比例滚动/e2e Agent 流程规范
- [第5期批次4 D预览UI+store](ph5-batch4-d-preview-store.md) — rewriteStore 两步触发/错误码约定/uiStore 补 setAIPanelOpen/卡片 data-type
- [better-sqlite3 不支持 ADD COLUMN IF NOT EXISTS](better-sqlite3-add-column-incompat.md) — 幂等加列需 pragma_table_info 探测守卫；smoke 真验走 scripts/kb-migration-smoke.cjs
- [改写叶序下标 A4](rewrite-leaf-index-a4.md) — readDocumentSelection 启用 _content 求叶序；不可按 id 匹配（newBlockId 随机），只能文档序位置+文本对齐映射
- [高亮叶序定位 A3 + 零宽陷阱](rewrite-highlight-leaf-index-a3.md) — buildHighlightRanges 位置映射/视口-容器坐标/E2E 权威；零宽空格字面量被 eslint 拒、须转义
- [A1c 整篇写协议](ai-a1c-full-doc-write-protocol.md) — 复用 document scope + 空 numberedBlocks（非新增 scope）；buildRewriteMessages 空数组分支/undefined 抛错
- [B1 / @ 补全菜单](ai-completion-b1-menu.md) — listSkills IPC 只读+剥离 instructions；CompletionMenu capture 键盘协议；/ 与 @ 前缀优先 WRITE_WHOLE_DOC_RE；挂载异步 skills 需重估
