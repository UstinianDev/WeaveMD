# doc-pipeline 遗留修复批次（remedial）TDD 证据报告

> 分支 `feat/doc-pipeline`｜执行日期 2026-09-27｜方法：**TDD strict**——每项 RED 实测 → GREEN → 分项小步提交。
> 蓝图：`docs/plan/doc-pipeline.remedial.diagnosis.md`（commit aca71fd）；三个开放点裁定结果见 §6。

---

## 1 修复项与 RED→GREEN 实录

| # | 项 | RED 实测（修复前失败断言） | GREEN（修复后） | commit |
|---|---|---|---|---|
| R6 | 发送前附件截断（shared 常量） | composerPaste **2 failed**（25 附件 → 载荷 25≠20） | composerPaste 35 passed + attachments 30 passed | `925fe20` |
| R5 | open-source 相对路径 resolve + 图片档放行 | ipc open-source **2 failed**（相对图片路径拒开 / 绝对 .png 拒开） | ipc 全文件 66 passed | `1a2070b` |
| R4 | AGENT_RUN 回执图片路径转绝对 | ipc **1 failed**（回执 path 仍相对，toImgSrc 非 media://） | ipc 67 passed | `76928e2` |
| R8 | 会话删除级联清理附件 | ipc **1 failed**（listParsedAttachmentsByConversation 未被调） | ipc 70 passed | `59b8bf6` |
| R7 | 消息删除级联（deleteMessagesAfter） | aiDao **3 failed**（removeParsedAttachment 零调用 / 删后不级联 / 目标缺失不早退） | aiDao 27 passed | `db7e6f8` |
| R3 (L4) | 外发双检 + 会话边界 | docTools **6 failed**（4 个跨会话格全放行 + fail-closed 缺字段放行 + readPage 同洞） | docTools 54 passed + agentContext 4 passed | `442a028` |
| Bug A | 附件清单注入 + chat 意图解锁 | agentContext **2 failed**（system 段无路径/id；chat+附件仍走 CHAT_SYSTEM_PROMPT） | agentContext 9 passed + agentPromptBuilder 41 passed | `4d0b07b` |
| Bug B | vision 判定链（D8+能力表+乐观+上屏） | **20 failed**：modelDiscovery 4 / migrations D8 3 / agentContext 4 / imageRecognition 3 / aiDao 4 / ipc 2（+1 条按 -t 过滤后补测） | 各文件全绿（见 §4 汇总） | `d6a7bef` |
| 覆盖补齐 | 新增行错误/缺省分支（8 条小测） | —（GREEN 后覆盖率缺口定向补测） | ipc 82 passed / aiDao 33 passed | 随 §7 收尾 commit |

- 每个 RED 均为**独立运行实测**（vitest 输出的失败断言原文入档于会话记录），未出现「先实现后补测试」。
- Bug A-2 前置事实锁定：`classifyIntent('[文件: a.pdf]\n帮我看看').intent === 'chat'`（真实路由，非 mock）。

## 2 R3 外发矩阵测试结果（docTools.test.ts，8 格 + 4 断言）

判定链：`attachmentEgressAllowed = allowSend ∨ 勾选授权`（agentContext 注入）；
豁免 = 附件 `conversation_id === 当前会话`（用户主动上传且落库）；**其余 fail-closed**。

| # | allowSend | 会话 | 勾选授权 | 结果 | 拦截原因 |
|---|---|---|---|---|---|
| 1 | T | 本会话 | 授权 | **放行** | —（裁定豁免） |
| 2 | T | 本会话 | 未授权 | **放行** | —（裁定豁免） |
| 3 | F | 本会话 | 授权 | **放行** | —（裁定豁免） |
| 4 | F | 本会话 | 未授权 | **放行** | —（豁免核心格：附件问答主场景不受损） |
| 5 | T | 跨会话 | 授权 | **拦截** | 附件不属于当前会话（会话边界恒拒） |
| 6 | T | 跨会话 | 未授权 | **拦截** | 附件不属于当前会话 |
| 7 | F | 跨会话 | 授权 | **拦截** | 附件不属于当前会话 |
| 8 | F | 跨会话 | 未授权 | **拦截** | 附件外发未授权（外发闸先行报因） |

补充断言（全过）：ToolCtx 缺 `attachmentEgressAllowed` → 跨会话拒「外发未授权」/ 本会话仍豁免放行（fail-closed + 豁免仅限当前会话）；跨用户 attachment_id 归属拒在闸前；`readPage` 复用同一 `resolveAttachmentTarget` 同洞共闸（四工具一并收口）。
`agentContext.test` 另锁注入端：allowSend=T→true、F+无勾选→false、F+勾选→true。

## 3 Bug B 三态与判定链

- **D8 迁移三断言**（`migrations.test.ts`，FakeDb 驱动真实迁移函数）：态1 空库首建 `vision_override INTEGER DEFAULT NULL`；态2 旧库仅追加（无 DROP/DELETE/UPDATE）；态3 重复执行零 ALTER。✅
- **三态语义**：NULL=自动判定（能力表→未知乐观）/ 1=强制支持 / 0=强制不支持（已在迁移注释与 `IAIConfig.visionOverride` 文档字段记录）。
- **判定链单测**（modelDiscovery 95.65%）：覆盖优先（deepseek-chat+true→T、claude+false→F）→ 能力表（deepseek-chat F / claude T）→ 未知乐观（my-finetune/my-private-llm/gpt-5→T）。
- **能力表扩展**：vision 侧 +glm-4v/minicpm/cogvlm/fuyu/kosmos；非 vision 侧显式负表（deepseek-chat·reasoner / gpt-3.5 / 参数量 `\d+b` / -instruct / embedding / davinci 系 / qwen-turbo·plus·max·math·coder / glm-4(非 v)）——`llama-3.2-11b-vision` 类「参数量+vision 标识」由 vision 模式优先命中不误杀。
- **注入/识别统一来源**：`resolveVisionSupport` 接入 agentContext(注入) / chatHandlers(注入) / imageRecognition(识别) 三处 + 两处识别调用点透传 `visionOverride`（ipc AGENT_RUN 两条对照实测：覆盖生效→「图片未成功识别」通用态；无覆盖+已知非 vision→「不支持图片理解」上屏）。
- **降级上屏**（不只 console.warn）：① 识别链经 `IAttachmentMeta.error`（回执 + attachments_json，气泡 `data-testid=attachment-status-error` 展示）；② 注入链在 appendMessage 前对当前轮图片补写 `parseStatus='error' + error`（识别链异常被吞时兜底，已标过的保留原 error）；③ `VISION_DEGRADED_NOTICE` 照常给 LLM。

## 4 质量门禁（全部实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `tsc --noEmit` | **0 error** ✅ |
| 单测 | `npx vitest run` | 全量口径 **3847 = 3788（160 文件，剔除 2 个已知负载 flaky 后 EXIT=0）+ 59（2 个 flaky 文件单跑 EXIT=0）**；过程中两次全量整跑亦全绿（3837/3837、3845/3845）。flaky = `cacheMonitor getStats 10 万次 <50ms` 与 `ab-test djb2>MD5` 两条**存量性能断言**（B4/B5/B6 已同款入档，单跑全过、与本批次改动无关） |
| Lint | `npm run lint`（src/） | **0 error**，106 warning 与基线持平 ✅ |
| 构建 | `npx vite build` | **exit 0**（renderer+main+preload 三段） ✅ |
| E2E | `npx playwright test` | **31 failed / 1 skipped / 101 passed（133 条）**，exit 1——failed 按 spec 构成与裁定基线**逐条一致**（ai-agent-panel 4 / drag 5 / table 7 / feedback 5 / float-toolbar 2 / thematic 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1 = 31），**零新增失败** ✅ |

## 5 新增代码覆盖率（v8，触及 16 文件口径）

| 文件 | Stmts | 未覆盖归属 |
|---|---|---|
| searchDocument.ts | **98.45%** | 既有 sectionPathAt 分支 |
| imageRecognition.ts | **97.7%** | 既有 isSupportedImageFormat/decrypt catch |
| pasteAttachment.ts | **97.09%** | 既有 Electron 降级分支 |
| modelDiscovery.ts | **95.65%** | 既有 guessProvider 局部/guessCapabilities code 分支 |
| agentPromptBuilder.ts | **93.13%** | 既有文件缓存/截断分支 |
| attachments.ts | **91.78%** | 既有 persist 异常兜底 |
| agentContext.ts | **82.19%** | 既有 HyDE/清理/锚点 splice 分支 |
| db/ai.ts | **81.57%** | 既有会话/消息/KB 设置函数体 |
| shared config/document/ipc-shared | 100 / 100 / 100 | — |
| chatHandlers.ts | 73.21% | 未覆盖全部为**既有** list/get/create/edit/export/chat 流程体；R8 新增块（含 4 个 catch）全覆盖 |
| agentHandlers.ts | 72.09% | 未覆盖全部为既有 skills/global-files/abort/retry 等 handler 体；R4/R5/识别透传新增行全覆盖（180-181 为既有防御 catch，识别内部不外抛） |
| configConsentHandlers.ts | 60.24% | 未覆盖为既有 apiKey/consent/write-mode handler 体；visionOverride 双分支已覆盖 |
| db/index.ts | 31.18% | **既有** runMigrations 建表 DDL（vitest 惯例不执行，真库 smoke 脚本覆盖）；D8 迁移函数经 FakeDb 三断言全覆盖 |
| **聚合** | **78.35% stmts / 81.10% branch**；**剔除 db/index.ts（既有 DDL）后 87.5%** | **本批次新增行经 40+ 条专属用例全部覆盖（含 8 条定向补测），新增代码 ≥80% 达成** |

## 6 三个开放点裁定结果（按需求方裁定执行，未偏离）

1. **R3 外发取舍**：本会话附件豁免、拦跨会话——实现为「会话边界 + 外发双检」：当前会话上传且落库的附件豁免 allowSend；非本会话先按 `attachmentEgressAllowed` 报「外发未授权」，已授权仍被会话边界恒拒（跨会话读堵死）。矩阵见 §2。
2. **R7 删除入口**：消息级级联——`deleteMessagesAfter` 内聚实现（先收集受影响行 attachments_json 附件 id → 删行 → 逐 id `removeParsedAttachment` 级联 KB+图片），**不做**附件 chip 独立删除。
3. **BugB 形态**：**两者都做**——D8 `vision_override` 配置列（NULL/1/0 三态，AI_GET/SET_CONFIG 可读写）**且**扩展已知模型能力表；未知模型默认乐观注入（既有降级链兜底）；降级提示经 `IAttachmentMeta.error` 上屏可见（非仅 console.warn）。
   - 遗留注记：设置页 vision 开关 **UI 勾选项未做**（裁定枚举未含 UI 项，配置经 `AI_SET_CONFIG { visionOverride }` 通道已可写读）；观察项 `agentLoop` anthropic 协议不分流（诊断 §开放点 4）不在本批次范围，维持原状。

## 7 提交清单

| commit | 内容 |
|---|---|
| `aca71fd` | docs(plan): remedial 诊断报告（执行蓝图入库） |
| `925fe20` | fix(composer): R6 截断（shared 常量单一来源） |
| `1a2070b` | fix(agent): R5 open-source 相对路径 resolve + 图片档 |
| `76928e2` | fix(agent): R4 回执图片绝对路径 |
| `59b8bf6` | fix(agent): R8 会话删除级联 |
| `db7e6f8` | fix(agent): R7 消息删除级联 |
| `442a028` | fix(agent): R3 外发双检 + 会话边界（L4） |
| `4d0b07b` | fix(agent): Bug A 附件清单注入 + chat 意图解锁 |
| `d6a7bef` | fix(agent): Bug B vision 判定链（D8+能力表+乐观+上屏） |
| 收尾 | test(agent): 覆盖补齐 8 条 + docs: 本报告与 status 追加 |

## 8 遗留与风险

- E2E 存量 31 failed 属前序已裁定范围（与基线逐 spec 一致，本批次零新增）。
- `cacheMonitor` / `ab-test` 两条存量性能断言在高负载下间歇超阈（B4/B5/B6 已入档同款），单跑全绿。
- Bug A-3 观察项（`readLocalFile` 相对路径按 cwd 解析）按蓝图维持不动；诊断 §开放点 4（anthropic 主循环不分流）未处理。
- vision 覆盖开关无设置页 UI（见 §6-3 遗留注记）；未配置时三态保持 NULL=自动，与旧行为判定来源一致。
- 未经用户授权，**未推送远程**。
