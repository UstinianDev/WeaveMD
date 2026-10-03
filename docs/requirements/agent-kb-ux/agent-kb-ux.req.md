# agent-kb-ux — KB 可见性修复 + 文件树复制路径 + 会话消息楷体

> 来源：/devflow 2026-10-03 用户输入；档位 **M**（跨主进程/渲染 2~3 模块），TDD standard
> 关联诊断：KB 目录导入文档 Agent 可见性五步取证（会话内，结论已固化于本需求 §2）

## 1. 需求清单

| # | 需求 | 裁定 |
| - | ---- | ---- |
| R1 | **KB 文档对 Agent 可见**（目录导入/单文件导入同构问题） | Q1=B：修 A + 修 B |
| R2 | `useKnowledgeBase` 开关 UI 接线 | Q2=A：Composer 发送区旁勾选，绑定既有 `setUseKnowledgeBase`（`agentStore.ts:1224`）与 i18n 键 `ai.agent.useKnowledgeBase` |
| R3 | B11 两闸语义对齐 | 导入流程加「允许外发」授权勾选，`consentGranted` 贯通 `indexImportedText`；白名单口径不变（`source_type='attachment' AND consent_granted=1` 扩为含授权后的 import 行或经由同列生效），**铁律二不削弱**；不采用白名单无条件扩（违反铁律二） |
| R4 | 文件树右键新增「复制文件地址」 | 复制**绝对路径**；文件与文件夹节点均显示；clipboard 写入 + 轻提示；既有重命名/删除不动 |
| R5 | Agent 会话消息字体楷体 | **仅会话消息区**（消息流容器）换 `EDITOR_FONT_FAMILY`（KaiTi+Consolas）；home/设置/composer/面板容器字体不动 |

## 2. 诊断结论（已对齐事实，实施依据）

- **根因 A（决定性）**：`useKnowledgeBase` 无 UI 接线，`agentStore.ts:339` 恒 `false`，`setUseKnowledgeBase` 全仓零调用 → `agentContext.ts:691` → `agentToolSelector.ts:121/134/152/159` 全部要求该开关 → **searchKB 工具从不下发**，Agent 看不到任何 KB 文档（非目录导入独有）。
- **根因 B（潜伏）**：`agentTaskWorker.ts:599-605` allowSend=false 时走 `filterKbEgressResults`，白名单 `db/kb.ts:245-253` 仅 `source_type='attachment' AND consent_granted=1`；导入行 `source_type='import'`、`consent_granted=0`（`kbIndexer` 不传 → DB DEFAULT 0，`db/index.ts:427`）→ 100% 被滤。渲染层 `agentStore.ts:688` KB 开启须 allowSend=true 才可发送，故该分支当前不可达——两闸矛盾，修 R2 后须一并消除。
- B8 四工具（`searchDocument/readPage`）为会话附件专属，不覆盖 KB 导入行（不在本需求范围）；`@文档` 注入走编辑器正文，与 KB 无关（不动）。
- 参考：附件导入 `importAttachmentAsKb`（`kbHandlers.ts:367-407`）已贯通 `consentGranted`，R3 照此模式。

## 3. 验收标准

1. 开启 KB 开关后，Agent 对目录/单文件导入文档可经 searchKB 检索命中（含 allowSend=false + 导入行已授权的组合）；
2. 工具下发矩阵测试：allowSend 开/关 × 导入/附件 × kbQa/chat 意图 → searchKB 下发与结果过滤行为符合 R3 口径；
3. 导入 UI 出现授权勾选且 `consentGranted` 落库（导入行可进 egress 白名单）；
4. 文件树右键复制绝对路径（文件/文件夹）生效；既有重命名/删除回归不破；
5. 仅会话消息区字体 = KaiTi 栈；home/composer 字体不变；
6. 门禁：`npm run typecheck` + `npm run test` + `npm run lint` 全绿；涉渲染改动跑 playwright 与 31 例基线比对零新增。

## 4. 边界与失败场景

- 开关默认值保持 `false`（存量会话行为不变，用户显式开启才检索 KB）；
- 授权勾选默认不勾（fail-closed，铁律二）；
- clipboard 写入失败（权限/非安全上下文）需有降级提示，不静默；
- searchKB 结果空/拒答路径不受影响（0.6 拒答等既有语义不动）。
