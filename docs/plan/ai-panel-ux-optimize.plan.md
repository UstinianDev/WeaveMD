# ai-panel-ux-optimize — 实施计划

> 2026-08-16 | devflow L 级 | 基于 `docs/requirements/ai-panel-ux-optimize.req.md`（两轮 grill-me 已确认）
> 技术调研：内部代码面穷尽（Explore）+ 关键文件亲读；设计决策已与用户确认。

## 0. 设计决策（已锁定）

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | KB 向量 | **移除向量、仅 FTS5**（用户已选）。删 embeddingClient、向量写入/检索、ModelForm+KB 设置 embeddingHost/Model 字段。 |
| D2 | 断开语义 | 清 key 即断开：`setConfig({apiKey:''})` → hasApiKey=false → 状态行「未配置 API key，AI 不可用」。**不新增持久化字段**。 |
| D3 | DB 收敛 | **不做 schema 迁移**。保留 `backend`/`ollama_base_url`/`kb_embedding_*` 遗留列；`mapConfigRow` 读时 `'ollama'→'remote'`，`upsertAiConfig`/INSERT 恒写 `'remote'`。空库/旧库双通，回滚安全。 |
| D4 | ChatBackend | **保留类型但收敛为 `type ChatBackend = 'remote'`**；渲染恒传 `backend:'remote'`。删 `AiHealth`/`AI_HEALTH`/`agentBackendHint`/`AIErrorCode 'ollama_offline'`。最小化破坏面。 |

## 1. 模块拆分与并行

```
M2 (类型+i18n) ─串行先导─► ┌─ M1+M3 主进程去 ollama + KB FTS5 + 表单④③（并）
                           ├─ M4   composer 草稿跨视图②             （并）
                           ├─ M5   整块渐变高亮+取消胶囊①           （并）
                           └─ M6   字体放大一档⑤                    （串行最后，与 M3/M4 文件重叠）
```

- **M2 必须最先**：类型/i18n 是所有模块输入。
- **并行组**（文件不相交）：M1+M3（主进程+表单，同功能面上下层）、M4（composer/panel）、M5（highlight/EditorV2/globals.css）。
- **M6 最后串行**：改动 `AIAgent/**` 全部 TSX，与 M3/M4 文件重叠，须在二者合并后执行。
- 各子任务按 **TDD strict**（RED→GREEN→重构→覆盖率≥80%→证据）。

### M2 — 共享类型 + i18n 收敛（先导）
- `src/shared/ai.ts`：`ChatBackend='remote'`；`IAIConfig`/`AiConfigUpdate` 删 `ollamaBaseUrl`；删 `AiHealth`；`AIErrorCode` 删 `'ollama_offline'`；`AgentRunResult` 删 `agentBackendHint`；`IKbSettings`/`DEFAULT_KB_SETTINGS`/`normalizeKbSettings` 删 `embeddingHost/embeddingModel`。
- `src/shared/constants.ts`：删 `AI_HEALTH` 通道。
- i18n 三语言：删 `ai.settings.backend.ollama`、`ai.settings.ollamaBaseUrl`、`ai.settings.kb.embeddingHost`、`ai.settings.kb.embeddingModel`、`ai.kb.embeddingEnabled/Disabled`；加 `ai.settings.provider.connected`、`ai.settings.provider.disconnected`、`ai.settings.disconnect`、`ai.settings.reconnect`。

### M1 — 主进程 ollama 去除 + KB FTS5（依赖 M2）
- `llmClient.ts`：删 `probeOllama`/`OllamaProbeResult`/backend 分支，恒按 remote baseUrl。
- `consent.ts`：`needsConsent` 恒 remote 联网闸；`needsKbSendConsent` 恒 `!allowSend`。
- `agentLoop.ts`：删 `isOllamaHint`/`agentBackendHint`；三元化简。
- `rewrite.ts`：baseUrl/model 化简。
- `modelList.ts`：删 ollama path，恒 remote /models Bearer。
- `embeddingClient.ts`：**整文件删除**（含测试）。
- `kbIndexer.ts`：删向量分支/`vectorEnabled`/`embeddingHost/Model` opts。
- `kbSearch.ts`：删 `embedBatch` import、`vectorEnabled`/`embeddingHost/Model`、queryVec 嵌入；`rankCandidates` 保留纯 FTS（fuse 恒 ftsNorm）。
- `ipc.ts`：删 `AI_HEALTH` handler/embedding 探针；config 兜底改 `backend:'remote'`；`KB_STATUS` 删 embedding 探针。
- `db/ai.ts`：`mapConfigRow` 收敛 remote；INSERT 默认 remote。
- `db/index.ts`：仅注释（不迁移）。
- 测试：`tests/main/ai/{llmClient,consent,agentLoop,rewrite,modelList,kbIndexer,kbSearch,ipc}.test.ts` 更新；`tests/main/ai/embeddingClient.test.ts` 删除。

### M3 — 渲染表单 ④ 状态行 + ③ 表单 ollama 去除（依赖 M2，与 M1 同功能面）
- `ModelForm.tsx`：删 `aiBackend`/`aiOllamaBaseUrl`/后端 radio/ollama 地址/`kbEmbeddingHost/Model` 字段；恒传 `backend:'remote'`；API key 与允许联网之间插入「当前提供商」状态行 + 「断开连接」（清 key → hasApiKey=false → 状态更新）；保存不主动清 key。
- `agentStore.ts`：`kbSettings` 类型删 embedding 字段。
- `KnowledgeBaseSettings.tsx`：删 embedding 字段。
- 测试：`ModelForm.test.tsx`、`AIPanelSettings.test.tsx` 更新（无 ollama 控件、④ 断开断言、保存恒 remote）。

### M4 — composer 草稿跨视图（②，依赖 M2）
- `AIPanelComposer.tsx`：改受控（`value/onChange/onSend` props）；发送分流逻辑保留在 composer。
- `AIAgentPanel.tsx`：持有 `draft` state，透传 home/session；`handleNewChat`/`handleOpenConversation`/`handleCloseConversation`/`handleClose`/发送成功后 `setDraft('')`。
- `AIPanelHome.tsx`/`AIPanelSession.tsx`：透传 draft props。
- 测试：`AIPanelComposer.test.tsx` 改受控 wrapper（分流协议不回退）；`AIAgentPanel.test.tsx`/`AIPanelHome`/`AIPanelSession` 新增跨视图草稿保留 + 清空断言。

### M5 — 整块渐变蓝高亮 + 取消胶囊（①，无类型依赖）
- `highlight.ts`：`buildHighlightRanges` 产出整块范围（每覆盖叶 `{leafIndex,start:0,end:叶长}`）；保留空 content/越界/失同步保守 `[]`。
- `EditorV2.tsx`：rect 计算改取 `.block-content` span 整行宽（`span.getBoundingClientRect()` 而非 range 子串）；新增取消胶囊绝对定位 div（取 `rects[0]` 左缘，`pointer-events:auto`，onClick `clearRewrite()`）。
- `globals.css`：`.rewrite-highlight` 改渐变蓝（`linear-gradient(90deg, 左浅, 右深)`，明暗主题可见，保留圆角/outline，`pointer-events:none`）；新增 `.rewrite-cancel-capsule`（`pointer-events:auto`）。
- 测试：`highlight.test.ts` 断言全换整块；EditorV2 overlay/capsule 组件断言。

### M6 — 字体放大一档（⑤，最后串行）
- `AIAgent/**` 所有 TSX：正文 `text-sm`(14)→15、控件/标签 `text-xs`(12)→13、徽标 `text-[11px]`→12、CTA `text-base`(16) 保持或 +1。**只扫 AIAgent 目录，不误触编辑器主区**。
- 测试：无逻辑断言（可加 Playwright 计算 font-size）。

## 2. 变更清单（汇总）

**新增**：无（取消胶囊并入 EditorV2/globals.css；Provider 状态并入 ModelForm）。

**删除文件**：`src/main/ai/embeddingClient.ts`、`tests/main/ai/embeddingClient.test.ts`。

**修改（src/shared）**：`ai.ts`、`constants.ts`。

**修改（src/main）**：`ai/{llmClient,consent,agentLoop,rewrite,modelList,kbIndexer,kbSearch,ipc}.ts`、`db/ai.ts`、`db/index.ts`（仅注释）。

**修改（src/render）**：`stores/{agentStore,rewriteStore}.ts`、`components/AIAgent/{AIAgentPanel,AIPanelHome,AIPanelSession,AIPanelComposer,KnowledgeBaseSettings}.tsx`、`components/AIAgent/settings/ModelForm.tsx`、`components/AIAgent/**`（⑤）、`editor/rewrite/highlight.ts`、`components/Editor/v2/EditorV2.tsx`、`styles/globals.css`、`i18n/*.json`。

**修改（测试）**：上述对应 `tests/**` 全部同步（含 `tests/main/ai/*`、`tests/render/components/AIAgent/*`、`tests/render/editor/rewrite/highlight.test.ts`）。

**修改（e2e/文档）**：`e2e/ai-agent-panel.spec.ts`（去 ollama mock 契约、纯 remote、新增断开/高亮/草稿用例）；`docs/modules/11-AI代理面板-Agent.md`、`docs/SUMMARY.md`、`.claude/CLAUDE.md`、`docs/plan/ai-panel-ux-optimize.status.md`。

## 3. 数据 / 兼容方案

- **DB 收敛**：`backend` 列读时 `'ollama'→'remote'`；写恒 `'remote'`。遗留列保留不删、不再写入。
- **旧库升级**：无 schema 迁移/版本号；旧 `backend='ollama'` 行读取自动收敛；旧 embedding 列被 `normalizeKbSettings`（删字段后）忽略。
- **空库**：缺省兜底 `backend:'remote', remoteBaseUrl:'https://api.deepseek.com'`。
- **回滚**：仅代码与遗留列值，无破坏性 DB 变更；`git revert` 即可。

## 4. 验收标准

- **①** 选中→「AI 改写」→覆盖块整段渐变蓝（左浅右深），跨块各块全宽整块；左端「取消」胶囊始终可见；点击清高亮+重置改写；应用/确认后消失；不写 contentEditable（往返不变式）。
- **②** 输入→切⚙→返回保留；切会话/新建/发送/关面板清空。
- **③** UI 无 ollama 选项/字段；主进程无 ollama 分支；后端固定 remote；未填 key 提示不可用。
- **④** 设置显示当前提供商状态；断开清 key 后 AI 不可用、状态更新；重填 key 恢复。
- **⑤** 字号整体放大一档，明暗主题正常。
- **门禁**：`tsc 0` + `vitest 全绿` + `lint 0` + `vite build` + `Playwright 全绿`（新增：整块高亮+取消、草稿跨视图、provider 状态+断开、无 ollama 回归）。

## 5. 实施顺序

M2（串行）→ 并行 [M1+M3 | M4 | M5] → M6（串行）→ 阶段6 全量门禁 → 阶段7 合规 → 阶段8 交付 gate。
