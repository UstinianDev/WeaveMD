# doc-pipeline B1 — TDD 证据报告（strict）

> 创建：2026-09-25 | 批次：**B1（二-1 统一解析入口 + 二-2 xls/xlsx + 二-6 类型契约）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../plan/doc-pipeline.plan.md) §1/§2-B1/§4.2-B1 / [需求](../requirements/doc-pipeline.req.md) Q3
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §二-1/二-2/二-6

## 1. 测试范围

| 文件 | 类型 | 用例数 | 覆盖项 |
|------|------|--------|--------|
| `tests/main/ai/documentParser.test.ts` | 新建 | 23 | 7 格式白名单（含 xlsm/xlsb 拒绝）、xlsx 多 sheet/合并单元格/公式取值/空单元格不错位/超宽 40 列/超长 600 行/表格序号与章节路径/路径与 Buffer 双入参、`.doc` 降级（Q3）、md 标题层级与章节路径与围栏不误抽、docx 标题/表格/嵌套列表、PDF native 文本与页码与损坏 PDF、`KB_PARSE_DOCUMENT` 结构化产物与白名单接线 |
| `tests/utils/weaveMDBridge.test.ts` | 扩展 +1 | 3 | 浏览器 mock `parseDocument` 受控实现（成功结构化产物 + 白名单拒绝） |
| **合计** | | **26** | |

## 2. RED（先写失败测试，实际执行）

```
$ npx vitest run tests/main/ai/documentParser.test.ts tests/utils/weaveMDBridge.test.ts --reporter=verbose
```

实际输出（2026-09-25 22:21）：

```
Test Files  2 failed (2)
     Tests  22 failed | 3 passed (25)
  Duration  10.55s
```

通过的 3 条为存量兼容项（bridge 原有 2 条 + 「拒绝清单外格式」白名单负向断言）。

失败样例（原始输出摘录）：

```
FAIL tests/main/ai/documentParser.test.ts > xlsx 解析（二-2） > 多 sheet 全转，sheet 名作章节标题
（xlsx 不在 SUPPORTED_TYPES → Unsupported file type，sections/tables 均缺）

FAIL tests/main/ai/documentParser.test.ts > docx 结构化（mammoth convertToHtml） > 标题层级与章节路径
AssertionError: expected [] to deeply equal [ …(2) ]   （extractRawText 丢结构）

FAIL tests/main/ai/documentParser.test.ts > PDF（liteparse 实测 API） > native 文本提取 + 页码 + parseVersion
AssertionError: expected undefined to be 1            （parseVersion 缺失；pageCount 缺失）

FAIL tests/main/ai/documentParser.test.ts > KB_PARSE_DOCUMENT handler（IPC 接线） > 白名单外文件被拒（isSupportedDocument 已接线）
AssertionError: expected true to be false             （handler 未接白名单，恒 success:true）

FAIL tests/utils/weaveMDBridge.test.ts > kb.parseDocument 浏览器 mock 返回结构化受控产物（B1）
（恒 { success:false } stub）
```

## 3. 最小实现 → GREEN（实际执行）

实现（B1 变更清单 7 文件，见 §7 变更文件）后：

```
$ npx vitest run tests/main/ai/documentParser.test.ts tests/utils/weaveMDBridge.test.ts
```

第一轮 GREEN（2026-09-25 22:30）暴露**实现缺陷 1 处**（真实失败、非测试问题）：

```
Tests  2 failed | 23 passed (25)
FAIL  docx > 标题层级与章节路径   — expected [] to deeply equal […]
FAIL  docx > 表格转 Markdown      — expected +0 to be 1
根因：parseDocx 返回时漏挂 builder 的 headings/sections/tables/images（只拼了 text）。
```

修复后（2026-09-25 22:31）：

```
Test Files  2 passed (2)
     Tests  25 passed (25)
```

## 4. 重构（不改行为）+ 回归加固

1. **docx 遍历分支重排**：`ul/ol`、`blockquote` 处理移到「嵌套块跳过」守卫之前，修复嵌套列表被
   `closest('li')` 守卫误杀导致内层项丢失的缺陷；删除重排后遗留的重复死分支。
2. **新增回归测试** `嵌套列表不丢失且不重复出文`（fixture 加 `<ul><li>外层项<ul><li>嵌套项</li></ul></li></ul>`，
   断言两项各出现一次）：

```
$ npx vitest run tests/main/ai/documentParser.test.ts
Test Files  1 passed (1)
     Tests  23 passed (23)
```

最终合并运行（2026-09-25 23:11）：

```
Test Files  2 passed (2)
     Tests  26 passed (26)
```

## 5. 覆盖率（新增代码）

```
$ npx vitest run tests/main/ai/documentParser.test.ts --coverage \
    --coverage.include='src/main/ai/files/documentParser.ts' \
    --coverage.include='src/shared/ai/document.ts' --coverage.reporter=text
```

实际输出：

```
File               | % Stmts | % Branch | % Funcs | % Lines
documentParser.ts  |   94.57 |    74.25 |   94.44 |   94.57
document.ts        |     100 |      100 |     100 |     100
```

语句覆盖率 94.57% / 100% ≥ 80% 门槛。bridge mock 新增块两分支（受控成功/白名单拒绝）由
`weaveMDBridge.test.ts` 两条断言覆盖（该文件整体历史覆盖率不计入本批次口径）。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 实际结果 |
|------|------|----------|
| 类型检查 | `npx tsc --noEmit` | exit 0，零错误（TS 5.9.3 strict） |
| 单元测试 | `npx vitest run` | **139 文件 / 3250 passed / 0 failed**（exit 0，2026-09-25 22:48） |
| Lint | `npm run lint` | **108 problems (0 errors, 108 warnings)**，warning 全为存量（含 `kbHandlers.ts:166` 存量 `row` 未用，HEAD 已存在）；本批次新增/修改 3 个 src 文件单独跑 eslint = 0 problems |
| 构建 | `npx vite build` | exit 0；`dist-render/index.html` 生成；xlsx 按动态 import 独立 chunk（`dist-main/xlsx-qn1xoUuv.js 429.20 kB`） |
| E2E | `npx playwright test` | **31 failed / 1 skipped / 97 passed（129 条）** —— 与 B1 前基线**完全一致**，无新增失败（见下） |

### E2E 基线对照（31 failed 的归属证明）

1. 数字与前序任务收尾记录一致：`agent-cost-optimize` 五门禁记录为「E2E 全量 31 failed / 1 skipped /
   97 passed（129 条）」，含已裁定保留的已知失败（`ai-agent-panel` 选区改写 4 条 +
   `floating-toolbar.spec.ts:222`、`drag-selection-markers` 5 条标题自带「当前 RED」等）。
2. **反证实验**：将本批次唯一进入 E2E（浏览器 mock）链路的两个文件
   （`src/render/utils/weaveMDBridge.ts`、`src/shared/ai/document.ts`）临时回退到 `HEAD~1` 后重跑
   失败子集：`npx playwright test e2e/feedback.spec.ts e2e/thematic-break.spec.ts` →
   **7 failed（与 B1 代码下同 7 条完全相同）**，证明失败与本批次无关；随后已恢复 B1 版本
   （`git diff HEAD` 为空）。
3. 失败清单 31 条全部落在编辑器表格/拖选标记/反馈弹窗/图片缩放/欢迎文档等**未被本批次触碰的子系统**；
   本批次渲染层改动只有 browser mock 的 `kb.parseDocument`（E2E 无调用方）。

> 按 `docs/README.md:68-70` 门禁口径如实记录：前 4 项全绿；E2E 为「与基线一致、零新增失败」，
> 不宣称全绿。存量 31 条不属 B1 范围，不在本批次修复（不删、不改测试）。

## 7. B1 批次变更文件（9 个，commit `7056dcf`）

| 文件 | 变更 |
|------|------|
| `src/shared/ai/document.ts` | `IDocumentParseResult` 扩结构化字段（headings/sections/tables/images/parseVersion/degraded）+ `DOCUMENT_PARSE_VERSION` + `SUPPORTED_DOC_EXTENSIONS` + `isSupportedDocFile` |
| `src/main/ai/files/documentParser.ts` | 白名单扩 xls/xlsx；新增 `parseXlsx`（多 sheet→`## sheet` 章节、`!merges` 左上值铺满还原、公式取缓存 `v`、`defval:''` 列宽归一）；`parsePdf` 适配实测 API `LiteParse.parse`（`ocrEnabled:false`，本期无 OCR）；`parseDocx` 改 `convertToHtml`+cheerio 结构遍历；md 抽标题/章节/表格（围栏感知）；`.doc` 降级产物（Q3 文案） |
| `src/main/ai/ipc/kbHandlers.ts` | `KB_PARSE_DOCUMENT` 入口接 `isSupportedDocument` 白名单（拒绝 → `success:false`），返回结构化产物 |
| `src/render/utils/weaveMDBridge.ts:711` | 恒 `success:false` stub → 可测受控实现（白名单 + 结构化占位产物） |
| `src/types/llamaindex-liteparse.d.ts` | **删除**（伪造 `LlamaParseReader` 类型，实测不存在） |
| `package.json` / `package-lock.json` | 新增依赖 `xlsx@0.18.5`（SheetJS 社区版） |
| `tests/main/ai/documentParser.test.ts` | 新建 23 例 |
| `tests/utils/weaveMDBridge.test.ts` | +1 例 |

## 8. 决策与偏离记录

1. **`LlamaParseReader.loadDataAsContent` 实测不存在**：`node -e "import('@llamaindex/liteparse')"`
   输出 `keys: ['LiteParse', 'default', 'searchItems'] / has LlamaParseReader: false`；按任务要求
   以现状实测为准适配为 `new LiteParse({ outputFormat:'text', ocrEnabled:false, quiet:true }).parse(buffer)`，
   删除伪造类型的 shim，改用包内真实 `dist/lib.d.ts`。实测单页 PDF native 提取 18ms 出文本。
2. **`isSupportedDocument` 取「接线」不删除**：接入 `KB_PARSE_DOCUMENT` 入口做 7 格式白名单校验
   （IPC 边界参数校验，满足 SECURITY.md「IPC handler 必须验证参数」），并为 B2 上传白名单复用留口；
   删除则 B2 需要原样加回。
3. **`.doc` 降级（Q3）**：不调用必失败的 mammoth，直接返回 `degraded` 提示（含「另存为 .docx」与
   「D 路线多模态优先」）；**D 路线接线随 B7**（`multimodalParse.ts`），本批次不引 OCR。
4. **合并单元格取舍**：`sheet_to_json` 不支持合并区间且覆盖格会残留陈旧值（实测 `B3='STALE'` 往返保留）；
   采用「左上值铺满合并区」还原语义——同时消除残留值噪声与行列错位，全部行经列宽归一后管道数一致。
5. **渲染层调用方**：`KB_PARSE_DOCUMENT` 真实 composer/文件树接线按计划批次定义属 **B2**；
   B1 落地的是「handler 返回结构化产物 + `weaveMDBridge` mock 受控实现 + 测试调用方」（本报告 §1/§6）。
6. **`blankrows` 陷阱**：`sheet_to_json` 默认丢空行会使 `!merges` 行号错位，故先 `blankrows:true`
   按 sheet 绝对行号应用合并，再剔除全空行（实现内注释已标明）。
7. **行号偏差**：计划 §0 已记录的偏差均复核属实，未发现新偏差；源文档行号未改动。

## 9. 结论

B1 六项验收点（§4.2）逐项落地：结构化产物、`.doc` 降级、`isSupportedDocument` 接线有记录、
`KB_PARSE_DOCUMENT` 返回结构化产物（渲染层真实 composer 接线随 B2）、xlsx 全项、二-6① 契约字段
（页码/章节/表格序号/图片序号/parseVersion 齐备，PDF 版面细项标注随 B7）。测试 26/26 绿、
新增代码覆盖率 94.57%、tsc/lint/build 全绿、E2E 零新增失败。
