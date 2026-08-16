# ai-panel-ux-optimize — 进度与分级记录

> 2026-08-16 | devflow L 级 | 分支 `feat/ai-panel-ux-optimize`

## 阶段 0 分级（L）

- 请求类型：功能开发 + 优化
- 跨模块判断：**是** — 渲染高亮① + 渲染 store/composer② + 主进程/配置/KB/i18n③ + IPC④ + CSS⑤
- 涉持久化/配置结构变更：**是** — `ChatBackend` 收敛、ai config 字段精简、断开状态语义
- 预估工时：多天
- 定档：**L（重型）**
- 裁剪：全部阶段；TDD strict；强制内部代码面调研 + 规划；并行实现；全量门禁。

## 阶段 1 需求对齐

- **已完成**（两轮 grill-me 确认，`docs/requirements/ai-panel-ux-optimize.req.md` 已定稿）
- 需求 5 项：① 整块渐变蓝高亮+取消胶囊 ② composer 草稿跨视图保留 ③ 完全去除 ollama ④ 提供商状态+断开 ⑤ 字体放大一档
- 范围外 / 另开任务：可编辑表格块（slug `editor-table-block`）、document scope 高亮、草稿磁盘持久化

## 阶段 2 技术调研

- 决策：本任务无外部库/API 方案选型（纯内部重构 + UX 优化），技术调研聚焦**内部代码面确认**（已用 Explore 智能体穷尽 ollama 链路 + 亲读关键文件）：
  - ollama 相关代码面全清单（③）：shared/ai.ts `ChatBackend`/`IAIConfig`/`AiHealth`/`AIErrorCode`；main llmClient `probeOllama`、ipc 4 处 `'ollama'` 兜底 + AI_HEALTH、agentLoop 降级、rewrite/consent ollama 免同意、embeddingClient/kbIndexer/kbSearch 本地向量、modelList、db/ai.ts + db/index.ts 建表默认、ModelForm radio+地址字段、i18n 键、13 个测试文件、4 份文档。
  - 高亮（①）：`highlight.ts` buildHighlightRanges 现产「选中区间」；`EditorV2.tsx:99-161` 计算 rects + `302-310` 渲染 `.rewrite-highlight` overlay；rewriteStore `selectionContext`/`clearRewrite`。
  - 草稿（②）：`AIPanelComposer.tsx:56` `input` 本地 useState → 切 view unmount 丢失；`AIAgentPanel.tsx` 三视图容器，composer 在 AIPanelSession 承载；agentStore `newChat`/`loadConversation`。
  - 提供商状态（④）：`ModelForm.tsx` API key 216-225 + 同意开关 228-252；`db/ai.ts` getConfig/setConfig（`apiKeyEnc` 密文）；`hasApiKey` 渲染侧从 `ai.getConfig` 推导。
  - 字体（⑤）：面板正文 `text-sm`(14) / 控件 `text-xs`(12) / 徽标 `text-[11px]` / CTA `text-base`(16)。
- **设计决策（已确认）**：
  1. KB 向量：**移除向量、仅 FTS5**（用户已选）——删 embeddingClient 向量路径、ModelForm/KB 设置 embeddingHost/Model 字段；检索纯 BM25（含 CJK 前缀优化）。
  2. 断开语义：**清 key 即断开**（`setConfig({apiKey:''})` → hasApiKey=false → 状态行显示「未配置 API key，AI 不可用」），不新增持久化字段。
  3. DB：**不做 schema 迁移**——保留 `backend`/`ollama_base_url` 遗留列；读取时 `backend='ollama'` → 收敛为 `'remote'`（mapConfigRow 读时收敛 + upsert 恒写 remote）。可空库/旧库双通。
  4. `ChatBackend`：移除联合，收敛为常量 `'remote'`（或从 IAIConfig 面移除 backend/ollamaBaseUrl，主进程消费者恒按 remote，删分支）。
- 结果：见 `docs/plan/ai-panel-ux-optimize.plan.md`

## 阶段 3~6 执行与门禁

- **阶段 3/4 并行实现（TDD strict）**：M2 类型/i18n（先导）→ 并行 M1 主进程去 ollama+KB FTS5 / M3 表单④③ / M4 草稿② / M5 高亮① → M6 字体⑤ → 收尾（agentBackendHint 渲染清除 + e2e 更新）。各模块 RED→GREEN 有证据。
- **阶段 6 全量门禁（testing-quality-agent）**：
  - typecheck 🟢 0 error（修 weaveMDBridge 死 ai.health key）
  - vitest 🟢 98 files / 1360 tests 全绿
  - lint 🟢 0 error（9 个既有 warning 非本任务）
  - vite build 🟢 render/main/preload 三包成功
  - Playwright 🟢 ai-agent-panel 35/35（含 ① 整块高亮+取消 / ② 草稿跨视图 / ④ provider+断开 / ③ 无 ollama 回归 全部新用例）；非 RED 用例 106/106
  - 门禁修复：ModelForm.tsx ④ provider 保存后未同步 store.config 的真实 bug（重进设置仍显「未配置」）；rewrite/ipc/aiDao 测试夹具死 mock 清理。
- **任务外既有阻塞（如实报告，未越权修）**：
  - electron-builder MSI 打包失败：`public/icons/icon.png` 从未提交 + 缺 author/manufacturer 元数据（`vite build` 已通过，仅 MSI 打包受阻；git status 无 package.json/build/icon 变更 → 任务外既有配置缺口）。
  - Playwright `drag-selection-markers.spec.ts` 5 个已知 RED（globals.css `.md-syntax` 灰度占宽缺陷线，spec 头部已注明当前 RED，本任务未触碰）。

## 阶段 7 合规核对 + 文档同步（完成）

- 代码实测核对：⑤③④②① 五项全部落地（已逐条验证）。
- 同步 `CLAUDE.md`/`docs/SUMMARY.md`/`docs/modules/11-AI代理面板-Agent.md` 三份（去 ollama/双后端/双路召回/embedding 描述 → remote-only + 仅 FTS5 + provider 状态 + 草稿跨视图 + 整块渐变高亮胶囊；module 文末追加「2026-08-16 ai-panel-ux-optimize 变更」小节）。
- 历史过程记录（status/requirements 阶段文档）按「保历史、同步现状」保留不改写。

## 阶段 8 交付 gate（完成）

- 变更清单核对：74 文件（+1336/−1690）与计划吻合；删除 `embeddingClient.ts`(+test)、恢复计划外被删的 `ai-rewrite-highlight-draft.req.md`（草稿前身，已按 gate 规则回滚）。
- agent-memory 增量随任务提交（仓库既有实践）。
- 交付物 / 剩余风险 / 未完成项见总指挥交付汇总。

## 最终状态：✅ 门禁全绿（任务相关）

typecheck 0 | vitest 98 files/1360 | lint 0 | vite build 三包成功 | Playwright ai-agent-panel 35/35（含 ①②③④ 新用例）。任务外既有：electron-builder MSI 图标缺失、drag-selection-markers 5 RED。
