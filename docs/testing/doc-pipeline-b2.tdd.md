# doc-pipeline B2 — TDD 证据报告（strict）

> 创建：2026-09-25 | 批次：**B2（一-1 格式白名单 + 一-2 多选批量 + 一-3 粘贴上传）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../plan/doc-pipeline.plan.md) §1/§2-B2/§4.2-B2 / [需求](../requirements/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §一-1/一-2/一-3

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ipcDialogs.test.ts` | 扩展 | +6 | `DIALOG_OPEN_FILE` **upload 模式**：7 格式 filters、`multiSelections` 属性、路径数组保用户选择顺序、**不返回全文**（无 `content`/`name` 键）、取消返回 `success:false`；**编辑器默认模式**（无 `upload` 参数）：md 单选 + 返回 `{path,name,content}` 全文 + `readFileSync` 恰调 1 次（双入口共享通道回归锁定） |
| `tests/main/ai/parseLimiter.test.ts` | 新建 | 5 | 并发峰值 ≤ limit（6 任务 limit=2）、FIFO 保序启动、异常 reject 传播不断队、limit=1 严格串行、默认上限 `PARSE_MAX_CONCURRENCY`（≤3） |
| `tests/components/composerPaste.test.ts` | 新建 | 16 | 图片双兜底 4（items 图片项 / files 降级 / Electron `clipboard.readImage()` 兜底 / 兜底无图）、`DataTransfer.files` 7 格式分支 4（有 path 交解析层保序、无 path txt/md 浏览器读、无 path 二进制跳过不断批、白名单外忽略）、文本行为 4（普通文本 false、URL 插入、link-preview 插原始 URL、clipboardData 缺失）、`ingestFilePaths` 4（全成功保序、success:false 不断批、抛异常不断批、空数组） |
| `tests/utils/weaveMDBridge.test.ts` | 扩展 | +3 | openFile mock：7 格式 `accept` + `multiple` + 返回 `paths` 保序且无 `content`；`pickImage` mock 受控返回非 null；`file.open` mock 保持单文件 + 全文契约（编辑器入口不受上传契约影响） |
| `e2e/ai-agent-panel.spec.ts` | 扩展 | +4 | 多选上传 6 文件 chips >5 折叠「1 个附件」、上传图片按钮 pickImage 受控、粘贴文件 chip + 正文防重复、粘贴图片 chip（方式1） |
| **合计** | | **34** | |

## 2. RED（先写失败测试，实际执行）

```
$ npx vitest run tests/main/ipcDialogs.test.ts tests/main/ai/parseLimiter.test.ts \
    tests/components/composerPaste.test.ts tests/utils/weaveMDBridge.test.ts --reporter=verbose
```

实际输出（2026-09-25 23:28）：

```
Test Files  4 failed (4)
     Tests  6 failed | 9 passed (15)
  Duration  10.73s
```

失败构成（原始输出摘录）：

```
FAIL  tests/main/ai/parseLimiter.test.ts
Error: Failed to resolve import "@main/ai/files/parseLimiter" — Does the file exist?

FAIL  tests/components/composerPaste.test.ts
Error: Failed to resolve import "@render/components/AIAgent/composer/pasteAttachment" — Does the file exist?

FAIL  ipcDialogs > DIALOG_OPEN_FILE > filters 放开到 7 格式
（旧 filters extensions:['md'] → 缺 pdf/doc/docx/xls/xlsx）
FAIL  ipcDialogs > DIALOG_OPEN_FILE > properties 含 multiSelections
（旧 properties:['openFile']）
FAIL  ipcDialogs > DIALOG_OPEN_FILE > 返回路径数组且保持用户选择顺序
Error: ENOENT: no such file or directory, open 'C:\docs\c.pdf'
（旧实现 readFileSync 假路径 + 返回单对象 {path,name,content}）
FAIL  ipcDialogs > DIALOG_OPEN_FILE > 不返回文件全文
Error: ENOENT ... 'C:\docs\report.pdf'  （readFileSync 尚未删除）
FAIL  weaveMDBridge > openFile mock：accept 放开 7 格式
AssertionError: expected '.md,.markdown,.txt,...' to contain '.pdf'
FAIL  weaveMDBridge > pickImage mock 返回受控图片路径而非恒 null
AssertionError: expected null not to be null
```

通过的 9 条为存量兼容项（ipcDialogs 旧 pickImage 5 条 + bridge 旧 3 条 + DIALOG_OPEN_FILE 取消分支旧实现本就 `success:false`）。

## 3. 最小实现 → GREEN（实际执行）

实现顺序（B2 变更清单 + 伴随修复，见 §7）后逐文件验证：

```
$ npx vitest run tests/main/ai/parseLimiter.test.ts
Test Files  1 passed (1)     Tests  5 passed (5)          # 23:30

$ npx vitest run tests/components/composerPaste.test.ts
Test Files  1 passed (1)     Tests  16 passed (16)        # 23:31

$ npx vitest run tests/main/ipcDialogs.test.ts tests/utils/weaveMDBridge.test.ts
Test Files  2 passed (2)     Tests  15 passed (15)        # 23:32
```

首轮 GREEN 过程暴露**实现缺陷 1 处**（真实返工、非测试问题）：`parseLimiter` 初稿在自定义 `limit` 参数下存在双计数与混合 limit 唤醒缺陷（`acquire/release` 与 `acquireWithin/releaseWithin` 两套计数并存），重写为单一信号量 + `wakeAll` 全量唤醒、等待者醒来自查条件的标准实现后全绿。

首轮类型检查暴露 4 处类型错误并修复：

```
$ npx tsc --noEmit
error TS2459: '@tiptap/core' declares 'EditorView' locally, but it is not exported
  → 改用 '@tiptap/pm/view'（项目已有 @tiptap/pm/state 用法先例）
error TS2322: baseDeps 交叉类型 addAttachment 冲突 → 显式 PasteDepsWithMock 断言
error TS2493: vi.fn(async () => undefined) 无参推断 → 补 (_paths: string[]) => undefined
error TS2345: document.createElement spyOn 重载不匹配 → mockImplementation as typeof 断言
修复后：exit 0，零输出
```

### 3.1 第二轮 RED：双入口共享通道回归（自检发现，非测试遗漏放行）

自查 `DIALOG_OPEN_FILE` 消费方时发现 preload **`file.open`（:300）与 `dialog.openFile`（:331）
共享同一 IPC 通道**——编辑器「打开文件」（`useNavbarActions.handleOpenFile` /
`ImportMarkdownModal`）期望 `{path,name,content}`，被上传侧 paths 契约破坏（vitest/E2E 均未覆盖
该共享点：E2E 的 `file.open` 是 spec 内独立 mock）。修复为**参数区分双模式**后补 2 条回归锁定
用例，其 RED 实测（2026-09-26 00:05）：

```
$ npx vitest run tests/main/ipcDialogs.test.ts tests/utils/weaveMDBridge.test.ts
Test Files  2 failed (2)     Tests  5 failed | 12 passed (17)
FAIL  ipcDialogs > filters 放开到 7 格式        — expected [ 'md' ] to include 'pdf'
      （上传用例未传 { upload:true } → 走默认 md 模式）
FAIL  ipcDialogs > properties 含 multiSelections — expected [ 'openFile' ] to include 'multiSelections'
FAIL  ipcDialogs > 保序 / 不返回全文             — ENOENT readFileSync（默认模式读全文）
FAIL  weaveMDBridge > file.open 单文件+全文      — success:false（jsdom 24 File 无 .text()）
```

修复（handler 接 `{upload?:boolean}`、preload `dialog.openFile` 传 `{upload:true}`、
bridge 拆 `readBrowserSelectedFile` / `readBrowserSelectedUploadFiles`、测试注入
`File.prototype.text`）后：

```
Test Files  2 passed (2)     Tests  17 passed (17)        # 00:08
$ npx tsc --noEmit → exit 0
```

## 4. 重构（不改行为）

1. **`readBrowserSelectedFile` 契约改造**：删除 `IMPORT_FALLBACK_TEMPLATE` 常量（唯一消费点——无 document 分支的 fallback 内容——随 openFile 契约改造移除，浏览器模式无 DOM 时改为显式 failure，与 `openFolder` mock 风格一致）。
2. **id 生成统一**：`handleUploadImage` 内联的 `Date.now()+Math.random()` 提为 `genAttachmentId()`（组件与粘贴通道共用，消除重复）。
3. **粘贴逻辑抽纯函数**：`handleComposerPaste` / `ingestFilePaths` / `extractImageBlob` 收敛到 `composer/pasteAttachment.ts`（AIPanelComposer 仅做 deps 注入），使粘贴逻辑可脱离 TipTap 渲染单测——与项目既有 `toolbarState.ts` / `resizeMath.ts` 纯函数先例一致。

## 5. 覆盖率（新增代码）

```
$ npx vitest run tests/main/ai/parseLimiter.test.ts tests/components/composerPaste.test.ts \
    tests/main/ipcDialogs.test.ts --coverage \
    --coverage.include='src/main/ai/files/parseLimiter.ts' \
    --coverage.include='src/render/components/AIAgent/composer/pasteAttachment.ts' \
    --coverage.reporter=text
```

实际输出：

```
File               | % Stmts | % Branch | % Funcs | % Lines
parseLimiter.ts    |   95.91 |    83.33 |     100 |   95.91
pasteAttachment.ts |   96.42 |    84.44 |   85.71 |   96.42
```

语句覆盖率 95.91% / 96.42% ≥ 80% 门槛。`ipc-handlers.ts`/`AIPanelComposer.tsx` 为大文件存量，
新增分支由上表测试逐条断言（DIALOG_OPEN_FILE 5 例、chips 折叠走 E2E 用例）。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 实际结果 |
|------|------|----------|
| 类型检查 | `npx tsc --noEmit` | exit 0，零错误（TS strict，最终状态 2026-09-26 00:08） |
| 单元测试 | `npx vitest run` | **141 文件 / 3280 passed / 0 failed**（exit 0，2026-09-26 00:12；B1 基线 3250 + 本批次 30）——注：过程中 `tests/benchmarks/ab-test.test.ts` 两次出现 1 failed（djb2 vs MD5 性能对比受机器负载影响），同代码单独重跑与全量重跑均全绿，属存量 flaky 非本批次引入 |
| Lint | `npm run lint` | **0 errors, 108 warnings**（与 B1 基线完全一致的存量 warning；`npm run lint` 范围为 `src/`，本批次 src 新增/修改 8 文件单独跑 eslint 亦 0 error） |
| 构建 | `npx vite build` | exit 0（renderer 1m12s/1278 modules + main 13.17s + preload 40ms） |
| E2E | `npx playwright test` | 见下方基线对照 |

<!-- E2E_RESULTS -->

实际输出（最终代码状态，2026-09-26 00:20，`npx playwright test --reporter=line`，7.4m）：

```
  31 failed
  1 skipped
  101 passed (133 条)
```

### E2E 基线对照（验收口径：零新增失败）

1. 基线：**31 failed / 1 skipped / 97 passed（129 条）** 为存量已裁定（B1 TDD §6 同口径，含 ai-agent-panel 选区改写 4 条、floating-toolbar、drag-selection-markers、feedback、thematic-break 等）。
2. **31 failed 名单与基线逐条同名单**（脚本比对：无任何 B2/上传/粘贴相关用例失败；ai-agent-panel 恰 4 条 = 该文件基线的 A2/A3/A4/①整块高亮选区改写）。
3. 本批次新进 E2E 的 4 条用例（多选折叠 / pickImage / 粘贴文件 / 粘贴图片）**全部通过**；passed 101 = 基线 97 + 新增 4。
4. 回归修复（§3.1 双模式）后已**以最终代码状态重跑全量**，结果与修复前一致（31f/1s/101p），主进程/bridge 改动对 renderer-only E2E 零影响。

> 按 `docs/README.md:68-70` 门禁口径如实记录：前 4 项全绿；E2E 为「与基线一致、零新增失败」，
> 不宣称全绿。存量 31 条不属 B2 范围，不在本批次修复（不删、不改测试）。

## 7. B2 批次变更文件（13 个，commit 见 §9）

| 文件 | 变更 |
|------|------|
| `src/main/ipc-handlers.ts` | `DIALOG_OPEN_FILE` 参数化双模式：`{upload:true}`（附件上传）→ 7 格式 filters + `multiSelections` + 返回 `{paths}` 保序 + **该模式无 `readFileSync`**；无参数（编辑器 `file.open`）→ 保持 md 单选 + `{path,name,content}` 全文（回归修复，见 §3.1/§8.9） |
| `src/main/preload.ts` | `dialog.openFile` 返回类型改 `Promise<IpcResponse<{paths:string[]}>>` 并 invoke 传 `{upload:true}`；`file.open`（:300）不传参保持旧行为 |
| `src/main/ai/files/parseLimiter.ts` | **新建**：信号量限流 `parseWithLimit(task, limit?)`，默认并发 3，FIFO 补位、`wakeAll` 全量唤醒 |
| `src/main/ai/ipc/kbHandlers.ts` | `KB_PARSE_DOCUMENT` 内 `parseDocument` 套 `parseWithLimit`（+2 行接线，见 §8.2） |
| `src/render/components/AIAgent/panel/AIPanelComposer.tsx` | `handleUploadFile` 收路径数组走 `ingestFilePaths`（逐个 `KB_PARSE_DOCUMENT`、失败不断批）；`handlePaste` 换 `handleComposerPaste`；chips >5 折叠「N 个附件」；本地 `Attachment` 类型迁出 |
| `src/render/components/AIAgent/composer/pasteAttachment.ts` | **新建**：粘贴/批量解析纯函数（图片双兜底、7 格式文件分支、防重复插入、ingest 保序）+ `Attachment` 类型 + `genAttachmentId` |
| `src/render/utils/weaveMDBridge.ts` | 拆两函数：`readBrowserSelectedFile`（`file.open`，恢复单文件+全文原契约含 `IMPORT_FALLBACK_TEMPLATE`）/ `readBrowserSelectedUploadFiles`（`dialog.openFile`，7 格式 + `multiple` + `paths`）；`pickImage` mock 恒 null → 受控返回 |
| `src/render/components/AIAgent/knowledge/KnowledgeBaseSettings.tsx` | openFile 契约波及伴随适配：取首个路径 → `kb.parseDocument` → `triggerKbImportFile`（见 §8.3） |
| `tests/main/ipcDialogs.test.ts` | +6 例（含双模式回归锁定） |
| `tests/main/ai/parseLimiter.test.ts` | 新建 5 例 |
| `tests/components/composerPaste.test.ts` | 新建 16 例 |
| `tests/utils/weaveMDBridge.test.ts` | +3 例（含 `file.open` 契约锁定） |
| `e2e/ai-agent-panel.spec.ts` | mock 增强（`openFilePaths` 选项、`dialog.pickImage`、`kb.parseDocument` 受控产物）+ 4 条新用例 |

## 8. 决策与偏离记录

1. **粘贴逻辑抽独立文件（对计划 §2-B2 清单的偏离）**：计划将 AIPanelComposer 列为唯一渲染层改动文件；若 `handleComposerPaste`/`ingestFilePaths` 留在组件文件内，文件级覆盖率被组件渲染行拖累无法达到「新增代码 ≥80%」门禁。按项目既有纯函数先例（`toolbarState.ts`/`resizeMath.ts`）抽至 `composer/pasteAttachment.ts`，组件仅注入 deps。行为与测试断言不受影响。
2. **`kbHandlers.ts` +2 行限流接线（必要伴随修改）**：`parseLimiter` 的唯一可靠接线点是主进程 `KB_PARSE_DOCUMENT` handler（渲染层无法 import 主进程模块；仅渲染层串行则多入口并发时失效）。计划清单未列 kbHandlers，2 行接线避免新模块成为死代码（B1 已记录「死代码零 import」是要清除的现状问题），记录于此。
3. **`KnowledgeBaseSettings.tsx` 伴随适配（共享契约波及）**：`DIALOG_OPEN_FILE` 不再返回 `content` 后，KB「导入文件」入口（`dialog.openFile` 的另一消费方）若不改将静默失败。改为取首个路径走 `KB_PARSE_DOCUMENT` 再 `triggerKbImportFile`——同时对齐「内容由解析层接管」方向；多选批量入 KB 属 B4 范围，本批次单文件只取 `paths[0]`。
4. **图片粘贴批次边界**：本批次图片仅接入附件 pending 流程——以 data URL **临时引用**进 chips（内存态）；**落盘 `userData/attachments/` 随 B6**、正文占位符方案随 B3、`attachments_json` 持久化随 B3。发送链路 `handleSend` 的 image 分支本就只拼 `[图片: name]`，data URL 不进消息表（一-3②「不得 base64 塞进消息表」在本批次已满足）。
5. **粘贴文件的 path 语义**：Electron 31 的 `File.path` 可用 → 有 path 走 `KB_PARSE_DOCUMENT` 解析层；无 path（浏览器/E2E）时 txt/md 走 `FileReader` 内存读（临时通道，B3 统一持久化），无 path 二进制（pdf/docx/xls）**跳过但不断批**（无法交解析层，避免乱码内容入库）。`FileReader` 非 `readFileSync`，一-1②「composer 不得自行 readFileSync」保持满足。
6. **chips 折叠语义**：显示前 5 个可删 chip + 折叠标签「N 个附件」（N = 总数 − 5），`data-testid="attachment-fold"`；不提供展开交互（不为未发生需求建设，B3 持久化时再议）。
7. **`pickImage` mock 处置**：按任务要求由恒 null 改为受控返回（`mock-picked-image-*.png` / E2E `mock-picked-image.png`），使图片入口断言不假通过；主进程 `DIALOG_PICK_IMAGE` 本批次不动（图片选择非 7 格式文档范围）。
8. **E2E 粘贴事件构造**：Chromium 下用 `new Event('paste')` + `Object.defineProperty(ev, 'clipboardData', ...)`（与单测同手法，规避 `ClipboardEvent` 构造器兼容差异），ProseMirror view 的 paste 委托正常触发 `editorProps.handlePaste`。
9. **`DIALOG_OPEN_FILE` 双入口共享通道（计划 §2-B2 未披露的关键耦合，自检发现）**：计划与源文档均把该通道当上传专用，实际 preload `file.open` 与 `dialog.openFile` **共用同一通道**（`ipc-handlers.ts` 单 handler）。若按计划字面直接改死契约，编辑器「打开文件」将拿到 `{paths}` 而丢全文。处置：handler 接 `{upload?:boolean}` 参数区分——**上传侧 7 格式 + 多选 + 只返 paths（一-1② 全部要求），编辑器侧保持 md 单选 + 全文读取不变**（编辑器打开文档本就需要 content，不属一-1② 删除范围；源文档「删除 readFileSync」针对的是附件上传链路）。不新增 IPC 通道（§1.3 硬规则满足），补 2 条双契约回归锁定用例。计划字面「删除 :147 readFileSync」在 upload 模式下达成，编辑器默认模式保留并显式注释。
10. **jsdom 24 无 `File.text()`**：`file.open` mock 成功路径单测需注入 `Object.defineProperty(file,'text',...)`（浏览器/Electron 有此 API，属测试环境兼容而非产品代码问题）。

## 9. 结论

B2 三项验收点（§4.2）逐项落地：
- **一-1②**：只传 path（`DIALOG_OPEN_FILE` upload 模式删 `readFileSync`，返回 `paths`）、composer 无全文读取、单文件失败不断批（ingest 4 例 + E2E）、`pickImage` mock 同步受控无 E2E 假通过；大文件占位符方案按计划由 B3 落地（本批次解析文本进内存 chips，不进消息表）。
- **一-2②**：路径数组保用户选择顺序（handler 透传 + ingest 串行 + 双断言）、chips >5 折叠「N 个附件」（单测 + E2E）、解析并发限流（`parseWithLimit` 接线 `KB_PARSE_DOCUMENT`，5 例峰值断言）。
- **一-3②**：两种图片来源均覆盖（items/files 双兜底 + Electron `clipboard.readImage()` 兜底，4 例）、`DataTransfer.files` 走 7 格式白名单分支、图片以临时引用进 chips 不进消息表（落盘随 B6）、粘贴命中分支同步返回 `true` 防文本重复插入（E2E 断言正文不重复）。

测试 34/34 绿（新增口径）、全量 3280 passed、新增代码覆盖率 95.91%/96.42%、
tsc/lint/build 全绿、E2E 零新增失败（31f/1s/101p 与基线同名单）。
