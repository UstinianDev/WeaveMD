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

---

## 热修（2026-10-03）— 三项用户反馈（TDD light，每项一提交）

> 缘由均为交付后用户实测反馈：①「依照知识库创作」勾选麻烦+难看；②打包版复制文件地址恒「复制失败」；
> ③AI 输出不是楷体。三项各自 RED→GREEN，三提交前各跑一次完整门禁。

### 热修 1 — 删除 composer KB 开关，KB 检索默认开启（提交 `542eb9f`）

**RED**（实测 `npx vitest run tests/render/stores/agentStore.test.ts tests/render/components/AIAgent/AIPanelComposer.test.tsx`）：
```
Test Files  1 failed | 1 passed (2)
     Tests  7 failed | 70 passed (77)
FAIL 面 = 默认 payload useKnowledgeBase false→true、reset 默认断言、
         三态 allow 5 例（success:false / data 非数组 / IPC reject / undefined / 空列表）
（composer toggle 2 例已按规格删除，随组件退役不计 RED）
```

**GREEN**（同两文件）：
```
Test Files  2 passed (2)
     Tests  77 passed (77)
```

**闸语义变更论证（二态 fail-closed → 三态 `checkKbEgressGate`）**：
- `useKnowledgeBase` 初值 `false → true`（KB 检索默认开），composer `data-testid="use-kb-toggle"` label 整块删除；
  i18n 键 `ai.agent.useKnowledgeBase` 保留（R2 前即孤儿键，删除属额外 churn）。
- 三态：`'allow' | 'prompt'`。空列表（无文档）→ allow；有已授权 `attachment/import` 行 → allow；
  **有文档但无授权行 → prompt**（首次弹既有 ConsentOverlay，同意后 `allowSend=true` 不再弹）；
  读取失败（`success:false` / `data` 非数组 / IPC reject / 未登录 `userId` 空）→ **allow**。
- 放行零泄漏论证：渲染闸只是 UX 提示层，主进程 `filterKbEgressResults`（`kbSearch.ts:472`）在
  `allowSend=false` 时仅放 `grantedAttachmentDocIds`（白名单，笔记/未授权一律滤除），
  即渲染闸放行也不会让任何未授权内容外发；consent 主进程从 DB 读，渲染不可伪造。
- `hasKbEgressGrant` → 改名 `checkKbEgressGate`（返回三态，接口/调用点同步）。

**断言清单（精简）**：
- 三态新例：`有授权行 → allow`、`空列表 → allow`、`有文档无授权 → prompt`（+ `runAgent` 未被调用）；
  读取失败四例（success:false / 非数组 / reject / undefined）全改断言 `pendingConsent=false` 且 `runAgent` 被调用，
  附主进程强制论证注释；`sourceType=db` 笔记例保留 prompt（笔记永不计入授权）。
- `:525 pendingConsent 既有例`——`git log -L` 查证来源 `9b1a108`（2026-09-24，**R2 之前**）→ 按规格**只补 mock 不弱断言**：
  补登录态（否则 `kb.list` 探测不了 → 视同读取失败 allow）+ `kb.list` 返回「有文档无授权行」，
  断言仍为 `pendingConsent=true` 且 `runAgent` 未被调用；describe 补 `afterEach` 清登录态防串到
  「未登录 → `createConversation('', 'agent')`」断言。
- 默认断言翻转 2 处：`runAgent(objectContaining({useKnowledgeBase:true}))`、`reset → useKnowledgeBase=true`。

**门禁（提交前实测）**：`typecheck 0 error` / `test 207 文件 4835 例全绿` / `lint 0 error（108 warning 基线）`。

### 热修 2 — 复制文件地址走主进程剪贴板桥（提交 `3bdb4e8`）

**根因**：打包 Electron 的 `navigator.clipboard` 非安全上下文恒 reject → `copyPathToClipboard` 恒返回 `'failed'`。

**RED**（实测 `npx vitest run tests/utils/copyPath.test.ts`）：
```
Test Files  1 failed (1)
     Tests  3 failed | 12 passed (15)
FAIL 面 = 桥成功→copied（navigator 不被调用）/ 桥 false→回落 navigator→copied（回落被尝试）/
         桥 false 且 navigator 失败→failed（两端均被尝试）
```

**GREEN**（`copyPath.test.ts` + `FileTreePanel.test.tsx` + `preload.test.ts`）：
```
Test Files  3 passed (3)
     Tests  23 passed (23)
```

**断言清单（精简）**：
- `constants.ts` 新增 `CLIPBOARD_WRITE_TEXT: 'clipboard:write-text'`；`ipc-handlers.ts` 仿 readImage 链路加 handler
  （参数校验 `typeof !== 'string' || !text → false`，try/catch → false）；`preload.ts` 桥 + 类型声明同步；
  `weaveMDBridge.ts` 浏览器 noop `writeText → false`（受控失败，交回落）。
- `copyPathToClipboard`：优先 `window.weaveMD.clipboard.writeText`（`===true` → copied），桥缺失/抛错/false →
  回落 `navigator.clipboard.writeText`，两端均败 → `'failed'`（仍不静默）。
- 既有 `FileTreePanel` 3 例只 mock navigator、未动桥（桥在 setup 缺失 → 走回落），零改动全绿（只补不弱=无需补）。
- 既有 copyPath 5 例（判定/缺失/reject）口径不变，仅补 `clearBridge` 复位钩子。

**门禁（提交前实测）**：`typecheck 0 error` / `test 207 文件 4841 例全绿` / `lint 0 error（108 warning 基线）`。

### 热修 3 — AI 输出楷体（提交 `f0adc44`）

**根因**：`.ai-markdown`（`globals.css:2935`）自带普惠体，覆盖容器 KaiTi 继承。

**RED**（实测 `npx vitest run tests/styles/agentMessageStreamCss.test.ts`）：
```
Test Files  1 failed (1)
     Tests  1 failed | 4 passed (5)
FAIL 面 = CM3「.ai-markdown 规则含 KaiTi 且不含 PuHuiTi」
（CM4/CM5 = code 仍等宽 / markdown-preview code 仍走 --font-code，先行钉死既有规则未动）
```

**GREEN**（同文件）：
```
Test Files  1 passed (1)
     Tests  5 passed (5)
```

**断言清单（精简）**：
- `.ai-markdown` `font-family` 改为 `'Consolas','KaiTi','楷体','STKaiti',system-ui`（与 `fontConstants.ts:7`
  `EDITOR_FONT_FAMILY` 顺序一致，注释双向锚定）；影响面= `AIMessageBubble.tsx:516` 与 `MarkdownMessage.tsx:34` 两处 AI 输出容器。
- 不动 `code`/`pre`（仍 `'Consolas', monospace` 等宽）、不动 body / `.chat-scroll` / home / composer（CM2/CM4/CM5 回归锁）。

**门禁（提交前实测）**：`typecheck 0 error` / `test 207 文件 4844 例全绿` / `lint 0 error（108 warning 基线）`；
`ab-test`/`cacheMonitor` 计时 flaky 单跑复核：首跑 ab-test「djb2 < MD5」1 failed，复跑 2 次全绿（非回归）。

### 热修 E2E（三提交后全量一次）

`npx playwright test` → `31 failed / 104 passed / 1 skipped`，与 R5 基线 `31·104·1` 同数；
失败名单与 `/tmp/pw-baseline-failed.txt`（31 行）逐行 diff → **IDENTICAL**（同数同名零新增；
仅行尾 ─ 填充符有无之差，剥除后 diff 为空）。三项热修零新增 E2E 失败。



## 功能删除记录 — R4 复制文件地址（2026-10-03 用户裁定「没必要了」）

- `git revert --no-commit 3bdb4e8` + `git revert --no-commit ea3b81a` 零冲突合并为单提交 **`6a88791`**
  （12 files，+2/-383）：删 `src/render/utils/copyPath.ts`、`tests/utils/copyPath.test.ts`、ContextMenu 菜单项与
  `onCopyPath`、FileTreePanel 提示条、i18n `sidebar.copyPath*` 三键 ×3 文件、`CLIPBOARD_WRITE_TEXT` 常量 +
  ipc-handlers handler + preload 桥 + weaveMDBridge noop。
- 门禁实测：typecheck 0 / lint 0 error（108 基线）/ vitest **206 文件 4826 例全绿**（4844-18=已删功能测试）/
  playwright **31·104·1 与基线相等**。
- 本报告上方任务 3（R4）章节与热修章保留为历史证据，不回改。
