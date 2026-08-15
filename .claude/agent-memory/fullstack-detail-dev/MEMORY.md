# Agent Memory Index

- [AI 主进程层模块/测试隔离/安全契约](ai-main-process-layer.md) — 主进程 ai/* 模块边界、KB/Agent IPC+preload 接线模式、weaveMDBridge noop 必改点、FakeDatabase/electron mock 实证
- [AI 渲染安全 + M1 类型耦合](feedback-ai-renderer-security.md) — assistant 纯文本渲染禁 innerHTML；weaveMDBridge 需 ai noop；onStream mock 用 unknown cast
- [FTS5 unicode61 中文 token 行为](fts5-cjk-unicode61.md) — 连续 CJK 当一个 token，裸 MATCH 不命中；kbSearch 需前缀或向量兜底
- [渲染批次5收尾现状](renderer-batch5-closing.md) — SettingsModal KB 参数(agentStore.kbSettings 内存态)/出处 line 比例滚动/e2e Agent 流程规范
- [第5期批次4 D预览UI+store](ph5-batch4-d-preview-store.md) — rewriteStore 两步触发/错误码约定/uiStore 补 setAIPanelOpen/卡片 data-type
