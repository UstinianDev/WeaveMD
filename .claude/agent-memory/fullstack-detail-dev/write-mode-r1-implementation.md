---
name: write-mode-r1-implementation
description: R1 写模式切换（auto/manual 泛化）全栈实现模式 — ai_config 持久化 + IPC + store + UI
metadata:
  type: project
---

R1 写模式切换已于 2026-08-25 完成。将 `autoApplyRewrite: boolean` 泛化为 `writeMode: 'auto' | 'manual'`，覆盖 editBlocks / createFile / createFolder 三种写操作。

**Why:** Notus 项目的写控制模块要求所有写操作可配置自动/手动，原 `autoApplyRewrite` 仅控制 editBlocks。

**How to apply:**
- 新增配置持久化到 ai_config 表的模式：`addColumnIfMissing` 幂等迁移 + `AiConfigRow`/`AiConfigDbRow`/`AiConfigUpdate` 三处扩展 + `mapConfigRow` NULL 兜底 + `upsertAiConfig` UPDATE/INSERT 双路径
- IPC 通道命名惯例：`AI_GET_WRITE_MODE` / `AI_SET_WRITE_MODE`（放在 configConsentHandlers.ts，不单独开文件）
- preload 暴露：`WeaveMDApi.ai.getWriteMode` / `setWriteMode`
- store 消费：`init()` 并行拉取（可选链安全访问 + fallback 默认值），`setWriteMode()` 先更新内存态再异步持久化（失败不回滚）
- UI 开关：AIPanelComposer 底部控制条，`writeMode === 'auto'` / `'manual'` 双按钮 + toggle
- auto 模式 onTool 分流：editBlocks 单文件 → `updateContent` 入 undo 栈；createFile/createFolder → `file.write` + `readDisk` + 刷新文件树
- weaveMDBridge.ts 浏览器 mock 必须补齐新 API（否则 TS2739）
