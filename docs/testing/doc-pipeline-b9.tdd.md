# doc-pipeline B9 — TDD 证据报告（strict）

> 创建：2026-09-27 | 批次：**B9（三-1 超长 md 发送 + 三-3 相对路径图片）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../plan/doc-pipeline.plan.md) §1/§2-B9/§4.2-B9 / [需求](../requirements/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §三-1/三-3（拷问细节② = 验收点）
> 风险级：**L2**；红线：文件树不扩格式（决策基线）、不删测试、不放宽 `allowSend`、图片向量（`imageIndexer`/`images_vec`）不动、不推送远程

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ai/mdImageResolver.test.ts` | **新建** | 24 | **三-3② 全项**：引用提取（内联 `![]()` 含 `<>`/标题形态 + `<img src>` + 去重 + 不误伤普通链接）；**解析基准 = md 所在目录**（不随 cwd 漂移）；`./`/`../` 前缀；**`../../` 越界拦截**（工作区外真实文件存在仍拦截、显式 workspaceRoot 根内/根外矩阵、绝对引用也须落根内）；Windows 盘符与 UNC（`//server/share` 根不误折叠）；md 路径非绝对/空引用 invalid；存在性 missing（**md 移动后相对路径失效**降级）；远程/data 分类；svg/非图片扩展与 `media:` 拒绝；`pickWorkspaceRoot` 最长根 + 非前缀不误配；`buildMdImageContext`（五链路注入：vision 门控 degraded、缺失/越界提示、远程/data 静默、上限 3 张、空输入三路） |
| `tests/main/ai/agentPromptBuilder.test.ts` | 扩展 | +5 | **三-1② 引用模式**：带 fileRef 注入文件名+路径+`readLocalFile` 指引+规模统计、正文深处标记不出现、长度 <2500；短文档同样走引用模式；**无 fileRef 旧行为锁定**（整篇注入 + 20000 字截断标记）；空文档 null；超长单行按字符上限截断 |
| `tests/main/ai/agentLoop.test.ts` | 扩展 | +4 | **三-1② 超长 md 摘要发送（端到端不整篇内联断言）**：首条 system 只带 `huge.md` + 路径 + `readLocalFile` + 行数统计，`TAIL_MARKER_XYZ` 不出现、总长 <2500；**三-3② 注入**：vision 模型（claude）user 消息含 `image_url` part 且 url = md 目录基准绝对路径；deepseek（无 vision）→ `VISION_DEGRADED_NOTICE` 且 content 保持纯文本；缺失图 → 「缺失」提示随当前轮消息注入 |
| `tests/main/ipcDialogs.test.ts` | 扩展 | +1 | **三-1② `FOLDER_READ` `.md` 过滤行为锁定（防误"修复"回归）**：真实临时目录递归列 md 与文件夹，txt/png/docx 一律不出现；首跑即绿（行为本就未改，锁定用例） |
| `tests/components/MentionPreview.test.tsx` | **新建** | 5 | **三-1② 摘要 + 前 N 行**：100 行长文档展示「共 100 行」统计 + 标题大纲 + 第 20 行可见、第 21/100 行不渲染 + 「仅预览」提示（500 字硬截断废除）；短文档无截断提示；读取失败错误态；directory 前 20 项 + 总数；skill 描述（后两条存量分支补测抬覆盖率） |
| `tests/render/stores/agentStore.test.ts` | 扩展 | +3 | **三-1② 发送构造**：`buildCurrentFileRef`（盘符/posix 绝对路径 → `{name,path}`；`welcome://`、DB id、null → undefined）；`sendAgentMessage` 载荷携带 `currentFileRef`（打开磁盘文件）；未打开磁盘文件不带字段 |
| `tests/main/ai/ipc.test.ts` | 扩展 | +2 | **载荷链两段**：`AGENT_RUN` 把 `currentFileRef` 写进 payloadJson、不传不塞；`worker.readTaskPayload` 白名单解析（缺 path / name 非字符串 / 非对象 / 坏 JSON → 丢弃） |
| **合计** | | **+44** | （= 全量 vitest **3708** − B8 基线 **3664**；文件 157 → 159，新建 2） |

## 2. RED（先写失败测试，实际执行）

分三轮（每轮先落测试再改实现），实测输出：

```
$ 轮1（2026-09-27 01:27）
 npx vitest run tests/main/ai/mdImageResolver.test.ts tests/components/MentionPreview.test.tsx
 Test Files  2 failed (2)
      mdImageResolver.test — 模块不存在（收集失败，23 用例全红）
      MentionPreview  2 failed | 1 passed (3)   ← 无「共 100 行」统计、无前 20 行限制
                                               （错误态 1 条为存量行为，首跑即绿）

$ 轮2（2026-09-27 01:28）
 npx vitest run tests/main/ai/agentPromptBuilder.test.ts tests/main/ipcDialogs.test.ts
 Test Files  1 failed | 1 passed (2)
      Tests  3 failed | 54 passed (57)
      ← 引用模式未实现：期望含 huge.md / /ws/s.md 实得旧文案「以下为当前编辑文档内容」；
        超长单行期望 <2500 实得 20039（旧截断）
      ipcDialogs 16 passed —— FOLDER_READ 过滤行为锁定**首跑即绿**（行为未改，防未来误改）

$ 轮3（2026-09-27 01:29）
 npx vitest run tests/main/ai/agentLoop.test.ts tests/render/stores/agentStore.test.ts
 Test Files  2 failed (2)
      Tests  6 failed | 55 passed (61)
      ← agentLoop B9 4 failed：首条 system 无文件引用、user 消息无 image_url part、
        无 VISION_DEGRADED_NOTICE（md 图路径）、无「缺失」提示；
        agentStore 2 failed：buildCurrentFileRef 不存在（导入失败）、载荷无 currentFileRef
```

RED 即通过的大量用例 = 存量回归断言（A1a 无 fileRef 的整篇注入/截断、B6 附件图片降级、既有 FOLDER_READ 消费方、MentionPreview 错误态）——**新引用模式对旧载荷零行为变化**。

## 3. 最小实现 → GREEN（实际执行）

```
$ 轮1（2026-09-27 01:33） mdImageResolver.ts 新建
 npx vitest run tests/main/ai/mdImageResolver.test.ts
 Test Files  1 passed (1)      Tests  23 passed (23)   ← 首版实现一次通过

$ 轮2（2026-09-27 01:35） 引用模式 + 载荷链 + 注入接线
 npx vitest run tests/main/ai/agentPromptBuilder.test.ts tests/main/ai/agentLoop.test.ts
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 66 passed (67)
      ← 超长单行期望 <2500 实得 51350：**标题大纲未设单条字符上限**（50k 标题整行进大纲）
        → 补 REF_OUTLINE_MAX_CHARS=120 → 全绿（agentLoop 26/26 含 B9 4 条）

$ 轮3（2026-09-27 01:36）
 npx vitest run MentionPreview agentStore ipcDialogs agentPromptBuilder
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 94 passed (95)
      ← agentStore 跨 describe 的 runAgent mock.calls 污染（calls[0] 指到上一 describe 的调用）
        → 本 describe 补 beforeEach clearAllMocks → 35/35 全绿
      （MentionPreview 5/5、ipcDialogs 16/16、agentPromptBuilder 全绿）

$ 补强（2026-09-27 01:44） ipc.test +2（payloadJson 透传/白名单）、MentionPreview +2（directory/skill）
 Test Files  2 passed (2)      Tests  56 passed (56)
```

提交（均 `(B9)` 结尾 + Co-Authored-By）：见 §3 末表（feat 1 个 + docs 1 个，commit hash 见 status.md）。

最终全量（重构收口后）：

```
$ npx vitest run
 Test Files  159 passed (159)
      Tests  3708 passed (3708)             ← 2026-09-27 收口实测 exit 0（B8 基线 3664 + 44）
```

## 4. 重构（不改行为）

- **UNC 路径折叠修复**：首版 `collapsePath` 把 `//server/share` 折成 `/server/share`（双斜杠根丢失）→ 根判定先识别 `//` 前缀；补 UNC 三断言（基准解析 / share 内 `../` 放行 / 出 share 越界拦截）。
- **超长行防线对齐**：引用模式大纲单条 120 字符上限（prompt 侧 `REF_OUTLINE_MAX_CHARS`）与 MentionPreview（`PREVIEW_OUTLINE_MAX_CHARS`）同口径，摘录另有 1200/4000 字符上限。
- 载荷链字段透传全部走「可选 + 存在才塞」（`...(ref ? { currentFileRef: ref } : {})`），不制造空字段噪声；worker 侧白名单校验（name/path 均非空字符串才收）。
- 路径运算不依赖 `path` 模块平台语义（B8 同因：vitest 下 browserify posix 语义会误拒 `C:\`）——自实现归一/折叠/包含判定纯函数，posix/盘符/UNC 三形态直接可测。

## 5. 覆盖率（新增代码）

B9 触及文件定向覆盖（vitest --coverage，6 个相关测试文件）：

```
-------------------|---------|----------|---------|
File               | % Stmts | % Branch | % Funcs |
-------------------|---------|----------|---------|
 mdImageResolver.ts |  98.26  |  83.18   |  100   |  ← 新建模块，24 用例直达
 MentionPreview.tsx |  93.97  |  68.65   | 86.66  |
 agentPromptBuilder |  91.42  |  93.54   | 62.50  |  ← 低 funcs 为存量 buildFileListSnapshotCached
                                                       等未在本轮测试集的函数
 agentContext.ts    |  80.08  |  60.00   | 83.33  |
 agentTaskWorker.ts |  50.00  |  65.11   | 50.00  |  ← 整文件口径；新增 readTaskPayload
                                                       currentFileRef 白名单分支 4 例直达
 agentHandlers.ts   |  69.03  |  75.38   | 100    |  ← 整文件口径；新增 extra 透传行经
                                                       AGENT_RUN payloadJson 断言直达
-------------------|---------|----------|---------|
```

**新增代码语句覆盖 ≥80% 达标**（mdImageResolver 98.26%、引用模式函数与 MentionPreview 预览体、`buildCurrentFileRef`、`currentFileRef` 载荷链各段全部有用例直达；agentTaskWorker/agentHandlers/agentStore 低值均为存量分支——新增行被定向断言覆盖）。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 实测结果 |
|------|------|---------|
| 类型 | `npx tsc --noEmit` | **0 error**（收口实测；中途修 TS2459 ContentPart 未导出 ×1 → 改从 llmClient 引入） |
| 单测 | `npx vitest run` | **159 文件 / 3708 passed / 0 failed**（exit 0；B8 基线 3664 + 44） |
| Lint | `npm run lint` | **0 error / 106 warning**（与 B8 基线完全持平） |
| 构建 | `npx vite build` | **exit 0**（renderer + main + preload 三段成功） |
| E2E | `npx playwright test` | **31 failed · 1 skipped · 101 passed（133 条）**——failed 按 spec 构成与基线逐条一致（editor-table 7 / feedback 5 / drag 5 / ai-agent-panel 4 / thematic 2 / floating-toolbar 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1 = 31），**零新增失败** |

过程 flaky（已知存量）：`cacheMonitor`「getStats 10 万次 <50ms」在两次全量中间歇超阈（单跑 37 passed；B4/B5/B6 记录同款），`ab-test` 首轮全量同款单跑 22 passed；收尾全量 3708/3708 绿。

## 7. §4.2-B9 验收点逐条对照

| 验收点 | 结论 | 证据 |
|--------|------|------|
| 三-1② 树 md 发会话只带文件名+路径+摘要不整篇内联 | ✅ | agentLoop「超长 md + currentFileRef → 首条 system …」（含路径/readLocalFile/行统计、正文标记不出现、<2500 字符）+ agentPromptBuilder 引用模式 5 例 + agentStore 载荷 3 例；正文由 `readLocalFile` 按需读取（system 指引断言） |
| 三-1② `FOLDER_READ` `.md` 过滤保持 + 注释/文档写明有意为之 | ✅ | 行为零改动（ipcDialogs 锁定 16/16 首跑即绿）+ `ipc-handlers.ts` handler 内「有意为之」注释 + `docs/modules/08-IPC通信机制.md` `folder:read` 行写明决策基线 |
| 三-1② `MentionPreview` 摘要 + 前 N 行 | ✅ | 组件测试：统计「共 100 行」+ 大纲 + 前 20 行可见、第 21 行起不渲染、「仅预览」提示；500 字硬截断废除（RED 实证旧文案失败） |
| 三-3② 解析基准为 md 所在目录 | ✅ | mdImageResolver「不随 cwd 漂移」+ 盘符/UNC 基准矩阵；agentLoop 端到端注入 `image_url.url` = md 目录基准绝对路径 |
| 三-3② `../../` 越界拦截不读工作区外 | ✅ | 工作区外**真实存在**文件仍返回 escape（判定先于存在性检查）+ 根内 `../` 放行 / 出根拦截矩阵 + 绝对引用落根校验；越界→提示「已拦截」 |
| 三-3② 图片可被 Agent 识别（走五链路） | ✅ | `buildMdImageContext` 复用 B6 `buildImageParts`（vision 门控/degraded/gif 提示口径一致）；agentLoop 断言 vision 模型收 image_url part、无 vision 模型 `VISION_DEGRADED_NOTICE` |
| 三-3② 缺失降级提示 | ✅ | 单元 missing 用例 + agentLoop「缺失或已移动」提示随当前轮消息注入断言（md 移动后失效同路径） |
| 三-3② 图片向量明确标注后续 | ✅ | `mdImageResolver.ts` 文件头「imageIndexer/images_vec 不动，范围外」+ `docs/architecture/ai-agent.md` md 图片行同注 + 计划 §5 范围外清单不动 |
| 门禁全绿 | ✅ | §6 |

## 8. 偏离与决策记录

1. **计划列「FileTreePanel doSwitchFile/handleFileClick 改发送构造」，实测该组件只负责 `openFile`（文件树磁盘文件 id=路径），全库无「点树 → 发会话」的独立发送通道**——真正的发送构造在渲染层 `agentStore.sendAgentMessage`（`currentDocument`/新增 `currentFileRef`）与主进程 `buildDocumentContext` 注入点。故 FileTreePanel **零改动**，改动落在 agentStore / agentPromptBuilder / agentContext / agentTaskWorker / agentHandlers / shared 类型（计划行号指位偏差，照实记录，行为验收点全部满足）。
2. **`currentDocument` 全文仍随 IPC 载荷传递，但不进 prompt**：`editBlocks` 的 `contentHash`/`documentSnapshotLength` staleness 校验、`toolsForIntent` 的 editBlocks 门控、渲染侧 diff 都依赖全文——与 B3「附件正文入 `parsed_attachments`、`content` 只留占位符」同口径：**token 层面的「不整篇内联」落在 prompt 注入点（引用模式）**，工具上下文字段保留全文（IPC 载荷不消耗 CONTEXT_WINDOW）。
3. **无 fileRef 保持旧行为（整篇注入+截断）**：welcome:// 与 DB 文档没有磁盘路径，`readLocalFile` 读不到正文，引用模式会让模型彻底拿不到内容——引用模式只对文件树磁盘 md 生效（任务对象本身），存量测试（A1a 三条）零修改通过。
4. **md 图片走 `agentMedia.buildImageParts` 注入主对话，不调用 `recognizeImageAttachments`**：识别链路的产物写 `parsed_attachments.content`（附件专属，md 图片无附件行 → DB 回写无效），且会额外烧一轮 vision token；主模型经五链路注入直接识读即达成「图片可被识别/被 Agent 看到」。取舍记录于此。
5. **注入上限 = 3 张**（`MAX_MD_IMAGES = KEEP_RECENT_IMAGES`，Q4 压缩保留同口径），超出省略并提示；**远程/data 引用静默跳过**（不抓取为范围外，避免提示噪声）；缺失/越界/格式不支持才出提示。
6. **MentionPreview 为零引用组件**（全库无 import），按计划仍改造并补组件测试（5 例，含 directory/skill 存量分支）——为未来 @ 预览复用，不新增调用方。
7. **新增源文件仅 `mdImageResolver.ts`**（计划 §2-B9 列明的新建项）；共享的「摘要」构造在 prompt 侧（agentPromptBuilder）与预览侧（MentionPreview）各自实现——两处输出格式与用途不同（system 指引 vs UI 摘要），不为此新增跨层共享文件（全局规则：新增文件需理由与批准）。
8. **越界判定大小写敏感**：Windows 盘符大小写差异不归一——最坏方向是「多拦不漏读」（fail-safe），记录为已知边界。

## 9. 遗留（移交后续批次）

- **`readLocalFile` 无分块读取**：引用模式下正文交工具按需读取，>1MB 的 md 工具侧直接拒读（B8 §9 已列遗留）——本批不扩（范围外），如常态化超大 md 需实现 offset/limit。
- **md 图片不持久化**：注入只发生在当前轮 prompt（消息表与事件回放不含 md 图片路径），历史轮次不回放 md 图片；如需历史可见列后续。
- **越界大小写边界**（§8.8，fail-safe 方向）。
- E2E 存量 31 failed 与 `cacheMonitor`/`ab-test` 性能断言负载 flaky 不属本批次（§6）。
