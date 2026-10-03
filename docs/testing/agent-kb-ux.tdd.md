# agent-kb-ux — TDD 证据报告

> 任务：KB 可见性修复 + 导入授权 + 文件树复制路径 + 会话消息楷体（M 级，TDD standard）
> 需求：`docs/requirements/agent-kb-ux/agent-kb-ux.req.md` ｜ 计划：`docs/plan/agent-kb-ux.plan.md`
> 创建：2026-10-03；证据均为实测命令输出，未虚构

## 任务 1 — R2：useKnowledgeBase 开关接线（提交 `2820f05`）

**RED**（执行智能体实录）：
```
AIPanelComposer.test.tsx + agentStore.test.ts → 2 failed（开关不存在 / payload 恒 false）
```
**GREEN**：同两文件 71 passed（+2 组件例：默认存在 unchecked / 点击 setter=true；+1 store 例：runAgent payload 含 useKnowledgeBase:true）。

**门禁（提交前实测）**：
```
typecheck: 0 error
test: 205 文件 4787 passed
lint: 0 error（108 warning 基线）
playwright: 31 failed / 104 passed / 1 skipped —— 与 31 例基线同数同名（失败清单 /tmp/pw-baseline-failed.txt 比对）
```

## 任务 2 — R3：导入授权贯通 + D1/D2/D4（本轮收尾提交）

**RED**（执行智能体 6 文件跑批实录）：
```
kbDao + kbHandlers + consent + docTools + agentStore + knowledgeBaseSettings
→ 12 failed | 209 passed（consent/docTools 两回归锁天然绿）
FAIL 面 = kbDao 白名单矩阵 4 + kbHandlers 透传 4 + agentStore 放行 1 + KB 设置勾选 3
```

**GREEN 收尾（总指挥接手，2026-10-03）**：
```
npx vitest run <六测试文件>
 Test Files  6 passed (6)
      Tests  221 passed (221)
```

**收尾修复 3 项（半成品清理）**：
1. 三语 i18n `"ai.kb.importDir"` 缩进回 2 空格（JSON.parse 三语验证 OK）；
2. `knowledgeBaseSettings.test.tsx:212` `.mock.calls` → `vi.mocked(...)`（typecheck TS2339 修复）；
3. 注释同步 3 处（代码零改）：`agentContext.ts:659`（授权含已授权导入行 + D4-A 名称保留注记）、`agentTaskWorker.ts:597`（过滤口径）、`kbSearch.ts:463-470`（白名单 `source_type IN ('attachment','import')`）。

**门禁（提交前实测）**：
```
typecheck: tsc --noEmit 0 error
test: 205 文件 4820 例 —— 4819 passed + 1 failed = tests/benchmarks/ab-test.test.ts
      「djb2 faster than MD5」计时 flaky，单跑复跑 npx vitest run → 22 passed 绿（既知 flaky，非本任务）
lint: 0 error（108 warning 基线）
playwright: 31 failed / 104 passed / 1 skipped —— 与基线同数同名零新增
db/index.ts diff: 空（零 DDL）
```

**实施偏差（均已在计划/需求框架内裁定）**：
- `IKbDocumentStatus.consentGranted` 做**可选**非计划必填——必填击穿 `ai-types.test.ts:71` 既有 fixture（计划红线只许 2 处预期适配）；渲染闸谓词 `=== true` 对缺省同样 fail-closed，行为等价，代价为类型层不强制主进程回填。
- 唯一预期既有断言适配：`kbDao.test.ts` 白名单 SQL 断言（`source_type IN (?, ?)`）；`knowledgeBaseSettings.test.tsx` fixture 补 `consentGranted:false` 字段（计划列明的第 2 处）。
- 既有测试其余零改动（ai-types 改动已还原）。

## 覆盖对账（req §3 验收）

| # | 验收 | 证据 |
| - | ---- | ---- |
| 1 | 开关后 Agent 可检索 KB 导入文档 | R2 工具下发链 + R3 白名单/注入矩阵（kbDao 4 例 + consent 过滤矩阵） |
| 2 | 工具下发矩阵 allowSend × 来源 × 意图 | consent.test 注入/过滤矩阵 + ipc.test 两闸回归锁（零改动全绿） |
| 3 | 导入 UI 授权勾选 + consentGranted 落库 | knowledgeBaseSettings 组件例 + kbHandlers 透传 4 例 |
| 4 | 复制绝对路径（R4） | 见后续章节（R4 未开始） |
| 5 | 仅会话消息楷体（R5） | 见后续章节（R5 未开始） |
| 6 | 门禁全绿 | 上表四项实测 |
