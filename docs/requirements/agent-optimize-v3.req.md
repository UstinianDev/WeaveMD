# agent-optimize-v3 — 需求文档

> 创建时间：2026-09-07
> 来源：用户反馈三大痛点 + 代码调研发现

---

## 一、联网搜索配置持久化（Bug 修复）

### 目标
重启应用后，AI 面板「联网搜索」状态自动恢复为上次保存的配置，无需手动重新操作。

### 已对齐问题
1. **根因已确认**：`refreshSearchConfig` 仅更新 `searchConfig` 字段，不联动 `searchConnectionOk`；`handleTest` 乐观置位与 init 逻辑不一致
2. **init 无竞态**：`Promise.all` + 单次 `set()` 保证原子性，无需改
3. **hasApiKeys 链路正确**：DB→IPC Handler→Preload→渲染层，无需改
4. **缺少清除 key 能力**：前端只传非空值，DB 层对 undefined 保留旧值（低优，本次不改）

### 需求清单

| # | 需求 | 验收标准 |
|---|------|----------|
| R1.1 | `refreshSearchConfig` 联动更新 `searchConnectionOk` | 调用 `refreshSearchConfig` 后，`searchConnectionOk` 与 init 逻辑一致 |
| R1.2 | `handleTest` 与 init 逻辑对齐 | 测试通过后不保存，重启后 `searchConnectionOk` 不会残留 `true` |
| R1.3 | 重启后自动恢复搜索状态 | 启动应用→AI 面板→联网搜索显示已配置状态，无需手动操作 |

### 变更范围
- `src/render/stores/agentStore.ts` — `refreshSearchConfig` 函数
- `src/render/components/AIAgent/settings/SearchSettings.tsx` — `handleTest` 逻辑

---

## 二、Agent 动态轮次控制（功能优化）

### 目标
根据任务复杂度动态调整 Agent 轮次上限，避免简单任务浪费轮次、复杂任务被过早截断。

### 已对齐问题
1. **三处 maxRounds 不一致**：agentLoop 硬编码 6、guard 类默认 20、session 状态机 20
2. **agentLoop 与 agentSession 独立计数**：`incrementRounds()` 在 agentLoop 中未被调用
3. **死循环消息未透传**：用户只看到"能力上限"而非"死循环检测"提示
4. **无恢复机制**：轮次耗尽后只能开新会话

### 需求清单

| # | 需求 | 验收标准 |
|---|------|----------|
| R2.1 | 统一 maxRounds 配置源 | agentLoop、guard、session 三处引用同一常量，不再各自硬编码 |
| R2.2 | 基于意图的动态轮次 | 简单 chat 意图 6 轮，中等任务 10 轮，复杂多工具任务 15 轮 |
| R2.3 | 轮次上限可配置 | 用户可在设置中手动调整 Agent 轮次上限（4-20 范围） |
| R2.4 | 死循环消息透传 | 死循环检测触发时，用户看到具体原因（而非"能力上限"） |
| R2.5 | 轮次耗尽恢复 | 轮次耗尽后提供「继续」按钮，允许用户手动追加轮次 |

### 变更范围
- `src/main/ai/agent/agentLoop.ts` — 主循环、maxRounds 逻辑
- `src/main/ai/agent/agentLoopGuard.ts` — maxRounds 可变、消息透传
- `src/main/ai/agent/agentSession.ts` — 轮次同步
- `src/render/stores/agentStore.ts` — 轮次配置状态
- `src/render/components/AIAgent/settings/` — 轮次设置 UI
- `src/render/components/AIAgent/AgentTab.tsx` — 耗尽恢复 UI

---

## 三、多文件 Diff 预览（功能开发）

### 目标
Agent 执行文件操作（创建/修改/删除）时，显示多文件 Diff 预览，用户确认后才实际写入。

### 已对齐问题
1. **preview_patch_files 后端完备**：主进程工具定义完整，返回 `IPatchPreview` 结构
2. **渲染侧未拦截**：`agentStore` 将 `preview_patch_files` 当直接执行型工具处理
3. **diff 渲染可复用**：`diffLines()` 纯函数已统一用于 RewritePreviewCard 和 EditBlocksPreviewCard
4. **组件模式可复用**：EditBlocksPreviewCard + EditBlocksDetailModal 的模式可直接套用

### 需求清单

| # | 需求 | 验收标准 |
|---|------|----------|
| R3.1 | agentStore 拦截 preview_patch_files 结果 | 工具结果存入 `patchProposals` 状态，不直接刷新文件树 |
| R3.2 | PatchPreviewCard 汇总卡片 | 单文件内联 diff + 多文件汇总计数，应用/废弃按钮 |
| R3.3 | PatchDetailModal 详情弹窗 | 左侧文件列表 + 右侧红删绿增 diff，支持单文件确认/取消 |
| R3.4 | 多文件批量操作 | 全部应用 / 全部废弃 / 逐文件确认 |
| R3.5 | 与现有预览组件不冲突 | PatchPreviewCard 与 EditBlocksPreviewCard 可共存 |

### 变更范围
- `src/render/stores/agentStore.ts` — 新增 `patchProposals` 状态 + action
- `src/render/components/AIAgent/cards/PatchPreviewCard.tsx` — 新建
- `src/render/components/AIAgent/cards/PatchDetailModal.tsx` — 新建
- `src/render/components/AIAgent/AgentTab.tsx` — 集成 PatchPreviewCard
- `src/shared/ai/clarify.ts` — 可能需要补充类型

---

## 优先级

1. **R1 联网搜索持久化**（用户感知最强，改动最小）
2. **R3 多文件 Diff 预览**（功能完整性，铁律一的延伸）
3. **R2 动态轮次控制**（需要更多设计验证）

## 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 动态轮次导致 token 消耗增加 | 中 | 默认值保守（6→10），用户可手动调整 |
| 多文件预览大文件性能 | 低 | diff 计算已是纯函数，可加虚拟滚动 |
| 搜索配置清除 key 功能缺失 | 低 | 本次不改，后续迭代 |
