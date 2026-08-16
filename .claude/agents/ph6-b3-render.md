# ph6-b3-render — 第 6 期批次 3：渲染侧 store + SettingsModal 持久化

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 依赖批次 1（A 已就绪）

## 范围（plan.md §1 组 C，可独立并跑）

- `src/render/stores/agentStore.ts`：
  - `init`（:164-177）`Promise.all` 并入 `kb.getSettings(userId)`：成功 → `set({kbSettings: 持久化值})`（覆盖 RESET_FIELDS 默认）；失败 → 保留默认不阻塞
  - `setKbSettings`（:438）改 **async 持久化**：`set({kbSettingsSaveState:'saving'})` → `await kb.setSettings({userId, settings})` → 成功 `set({kbSettings:settings, kbSettingsSaveState:'saved'})`；失败 `set({kbSettings:settings, kbSettingsSaveState:'error'})`（保留内存态 + 提示，Q4 语义）
  - ADD `kbSettingsSaveState?: 'idle'|'saving'|'saved'|'error'`（接口 + RESET_FIELDS 默认 'idle'）
- `src/render/components/Settings/SettingsModal.tsx`：`handleSave`（:154-163）`setKbSettings(next)` 已 async；绑定 `kbSettingsSaveState` 显示保存中/已保存/失败提示（尽力恢复 vs 简洁内联提示，以不引入大改为准）
- `src/render/i18n/{en,zh-CN,zh-TW}.json`：新增 KB 保存提示键（如 `ai.settings.kb.saved`/`saveFailed`），**三文件键集一致**（勿重排既有键）
- 测试：`tests/render/stores/agentStore.test.ts`（改，init 拉取覆盖默认/失败保留默认；setKbSettings 成功/失败路径）

## 关键实现点

- 竞态防护：init 仅登录时跑；SettingsModal Save 显式写回，不冲突
- 写失败**内存态更新**（不回滚旧值），差异在 UI 提示
- 测试 mock：window.weaveMD.kb.getSettings/setSettings（tests/setup 批次 1 已补）

## 铁律

- 铁律二不破：持久化 KB 参数不触碰 consent 语义；无新增外发
- 无 dangerouslySetInnerHTML、无 any；i18n 三文件键集一致

## 门禁

- `npm run typecheck` 0 error | `npm run test` 全绿（相关用例） | `npm run lint` 0 error
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
