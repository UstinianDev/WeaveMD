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

## 任务 3 — R4：文件树右键复制文件地址（提交 `ea3b81a`）

**RED**（实测 `npx vitest run tests/utils/copyPath.test.ts tests/components/FileTreePanel.test.tsx`）：
```
Test Files  2 failed (2)
     Tests  3 failed | 3 passed (6)
FAIL 面 = copyPath.test.ts 整文件（模块 @render/utils/copyPath 不存在，collect 失败）
         + FileTreePanel 新 3 例（菜单无「复制文件地址」项）
既有 3 例（切换保存/磁盘为准）零改动，天然绿。
```

**GREEN**（同两文件）：
```
Test Files  2 passed (2)
     Tests  15 passed (15)   ← copyPath 9 例（isAbsolutePath 4 + copyPathToClipboard 5）+ FileTreePanel 6 例（既有 3 + 新 3）
```

**断言清单（精简）**：
- `copyPath.test.ts`：`/`、`C:\`、`D:/`、UNC → true；相对/空 → false；绝对+writeText resolve → `copied` 且参数为原路径；相对/空 → `failed` 且不调 writeText；clipboard 缺失 → `failed`；writeText reject → `failed`（不静默抛出）。
- `FileTreePanel.test.tsx`：文件与文件夹右键菜单均含「复制文件地址」（且位于「重命名」之后）；点击 → `writeText('/disk/a.md')` + `data-testid="copy-path-notice"` 显示「已复制路径」；reject → 显示「复制失败」。
- i18n 三语同位插 `sidebar.copyPath / copyPathDone / copyPathFailed`（`sidebar.confirmDeleteFolder` 后），node 脚本验证三文件 `Object.keys` 次序一致（键序测试同口径）。

**门禁（提交前实测）**：
```
typecheck: 0 error
test: 206 文件 4832 例 —— 4831 passed + 1 failed = cacheMonitor「getStats 10 万次 <50ms」计时断言
      （并行负载下 65.9ms 超阈值；单跑 npx vitest run → 37 passed 绿，既知计时 flaky 非本任务，与 ab-test 同类）
lint: 0 error（108 warning 基线）
```

## 任务 4 — R5：会话消息楷体仅消息流（提交 `f19c70b`）

**RED**（实测 `npx vitest run tests/styles/agentMessageStreamCss.test.ts tests/render/components/AIAgent/AgentTab.test.tsx`）：
```
Test Files  2 failed (2)
     Tests  2 failed | 7 passed (9)
FAIL 面 = CM1「.ai-message-stream 规则不存在」+ AgentTab「容器未挂 .ai-message-stream」
（气泡根内联 fontFamily 断言被首个 expect 短路，属同一根因）
```

**GREEN**（同两文件）：
```
Test Files  2 passed (2)
     Tests  9 passed (9)
```
> 过程记录：首版 GREEN 时 CM1/CM2 曾误红——系**测试侧缺陷**（`blockText` 传入转义选择器双转义；CM2 扫描把注释里的 `.chat-scroll` 字面量当成规则块）。修复为「先剥 /* */ 注释再扫描 + 选择器传原始串」，实现代码零改后转绿。

**断言清单（精简）**：
- `agentMessageStreamCss.test.ts`：`.ai-message-stream` 规则存在且含 `KaiTi`+`Consolas`；`.chat-scroll` 任何规则块（剥注释后）无 `font-family` + 全文无 `.chat-scroll{…font-family}` 形态。
- `AgentTab.test.tsx`：`container.querySelector('.ai-message-stream')` 非空；消息流内所有 `[style]` 元素 `style.fontFamily` 全空（D3 三处删除回归锁：气泡根 :499 / 用户气泡 :370 / textarea :341）。
- 实现：`globals.css` 新增 `.ai-message-stream { font-family: 'Consolas','KaiTi','楷体','STKaiti',system-ui }`（与 `fontConstants.ts:7` 逐字一致，注释双向锚定）；`AgentTab.tsx:285` className 追加；`AIMessageBubble.tsx` 删三处内联普惠体。

**门禁（提交前实测）**：
```
typecheck: 0 error
test: 207 文件 4835 例 —— 全量复跑 4835 passed / 0 failed
      （首跑曾 2 failed：cacheMonitor 计时 flaky + ab-test 类负载抖动，复跑归零）
lint: 0 error（108 warning 基线）
playwright: 31 failed / 104 passed / 1 skipped
      失败清单按 spec.ts:line:col 提取 31 条，与 /tmp/pw-baseline-failed.txt 基线 diff → IDENTICAL（同数同名零新增）
      （按任务裁定：两需求同批渲染改动，playwright 只在 R5 后跑一次）
```

**实施偏差（1 项微增）**：
- textarea 删 `fontFamily` 后补 className `[font-family:inherit]`（表单控件默认不继承 font-family，不补则编辑态回退 UA 字体而非楷体）。走 className 非内联 style，不动 minHeight，不影响「无内联 fontFamily」验收。
- CSS 测试首版为测试侧误红（见上），已修测试不动实现；测试手法仍为 node:fs + 花括号配平（ft2Css 同法，vitest css:false 前提）。

## 覆盖对账（req §3 验收）

| # | 验收 | 证据 |
| - | ---- | ---- |
| 1 | 开关后 Agent 可检索 KB 导入文档 | R2 工具下发链 + R3 白名单/注入矩阵（kbDao 4 例 + consent 过滤矩阵） |
| 2 | 工具下发矩阵 allowSend × 来源 × 意图 | consent.test 注入/过滤矩阵 + ipc.test 两闸回归锁（零改动全绿） |
| 3 | 导入 UI 授权勾选 + consentGranted 落库 | knowledgeBaseSettings 组件例 + kbHandlers 透传 4 例 |
| 4 | 复制绝对路径（R4） | 任务 3 章：copyPath 9 例 + FileTreePanel 3 例（菜单/成功/失败），提交 `ea3b81a` |
| 5 | 仅会话消息楷体（R5） | 任务 4 章：CSS 2 例 + AgentTab 容器/无内联回归锁，提交 `f19c70b`；playwright 31·104·1 基线同名 |
| 6 | 门禁全绿 | R4/R5 各自 typecheck 0 / lint 0 / vitest 全量绿（计时 flaky 单跑复跑归零）+ playwright 基线 diff IDENTICAL |
