# doc-pipeline 调研笔记：7 格式统一文档解析层（三个库）

> 调研日期：2026-09-25。工具：`@arabold/docs-mcp-server` CLI（本地索引 + search）、`crw` CLI（scrape）。
> `crw search` 实测不可用（无搜索后端：本地后端需 Docker 未配置，Cloud 无 key，见 `crw doctor` WARN），
> 外部文章检索改用 `crw scrape` 抓取 GitHub/Bing 搜索页完成，已在文末标注。
> 所有 API 均摘自已索引/已抓取的原始文档，未检索到的条目明确标注「未检索到」。

---

## 1. `@llamaindex/liteparse`（LiteParse）

### 索引状态
- 调研前未索引；已执行 `scrape liteparse "https://github.com/run-llama/liteparse" --max-pages 100 --max-depth 3`，成功 102 页。

### 关键 API 摘录
- **定位**：Rust 编写的本地 PDF 解析库，空间文本提取（bounding box），零云依赖；提供 Node.js/TS（napi-rs）、Python、WASM、CLI 绑定。
  （https://github.com/run-llama/liteparse/blob/main/AGENTS.md）
- **支持格式**：PDF、DOCX、XLSX、PPTX、图片 —— 非 PDF 格式经转换（LibreOffice / Rust image+resvg）后走 PDFium 提取。
  输出格式：Markdown / JSON / Text，JSON 含 text + bounding boxes。
  （https://github.com/run-llama/liteparse/blob/main/README.md）
- **Node API 入口**：`packages/node/src/lib.ts` 导出 `LiteParse` 类。
  - `constructor(userConfig: Partial<LiteParseConfig> & PoolOptions = {})`
  - `async parse(input: LiteParseInput): Promise<ParseResult>`，`LiteParseInput = string | Buffer | Uint8Array`
  - 另有 `warmUp()`、`parseBatches()`（流式）、`isComplex()`（复杂度预判，用于路由 OCR）、`screenshot()`
  - `OutputFormat = "json" | "text" | "markdown"`；`PoolOptions { poolSize, parseTimeoutMs }`（进程池 + 硬超时 `ParseTimeoutError`）
  - 关键配置：`extractBlocks`（每页版面块 + bbox）、`emitWordBoxes`（词级 bbox）、`extractTextMetadata`、`extractLinks`、`imageMode: "off" | "placeholder" | "embed"`
  （https://github.com/run-llama/liteparse/blob/main/packages/node/src/lib.ts）
- **坐标/版面回传**：回传。`ParseResult.pages[].text_items` 含 `text/x/y/width/height/font_name`；`extractBlocks` 额外输出分类版面块及 bbox；README 明确 "Bounding Boxes: Precise text positioning information"。
  （https://github.com/run-llama/liteparse/blob/main/crates/liteparse-wasm/src/lib.rs、README.md）
- **`LlamaParseReader.loadDataAsContent`**：**未检索到**。在 liteparse 索引内搜索 `LlamaParseReader` 与 `loadDataAsContent` 均返回空；该命名属于 LlamaParse 云端 reader 体系，不属于本仓库的 LiteParse API，本次不作进一步断言。

### 接入建议与风险
- 建议：若 7 格式管线需要 PDF 空间信息（坐标回传、版面块），用 `new LiteParse({ outputFormat: "json", extractBlocks: true })` 拿 `ParseResult`；只需求纯文本/Markdown 时用 `outputFormat: "markdown"`。
- 风险：原生二进制依赖（napi-rs 跨平台包，Electron 打包需处理 platform-specific optionalDependencies）；非 PDF 格式依赖 LibreOffice 转换（桌面环境未必安装，DOCX/XLSX 走此路径会降级或失败）；`poolSize` 进程池对 Electron 主进程生命周期需显式关闭。
- 风险：文档站在 `developers.llamaindex.ai/liteparse/`，本地索引只覆盖 GitHub 仓库；站点专页未索引（需要时可再 scrape）。

---

## 2. `mammoth`（node-mammoth / mammoth.js）

### 索引状态
- 调研前未索引；初始 URL `github.com/mwilliamson/node-mammoth` 失败（仓库不存在，实际已改名），改为
  `scrape mammoth "https://github.com/mwilliamson/mammoth.js" --max-pages 100 --max-depth 3`，成功 58 页。

### 关键 API 摘录
- **导出**：`convertToHtml` / `convertToMarkdown` / `convert` / `extractRawText` + `images` / `transforms` / `underline` / `embedStyleMap`。
  （https://github.com/mwilliamson/mammoth.js/blob/master/lib/index.js）
- **`extractRawText` vs `convertToHtml` 结构保留差异**：
  - `convertToHtml(input, options)` → 走完整 document model → HTML：保留标题（`Heading 1` → `h1`）、列表、表格（表结构转 `<table>`，边框等外观忽略）、脚注/尾注、图片、粗斜体/上下标、链接、文本框（作为独立段落）、批注；支持 styleMap 自定义样式映射；README 明言 "produce simple and clean HTML by using semantic information in the document, and ignoring other details"。
  - `extractRawText(input)` → `lib/raw-text.js` 只拼接 text/tab，段落后加两个换行（`"\n\n"`），**完全丢弃结构**（无标题/表格/列表信息）。
  - README：**Markdown 输出已 deprecated**（`--output-format=markdown` 仍可用），推荐 HTML 后接 HTML→Markdown 库。
  （https://github.com/mwilliamson/mammoth.js/blob/master/README.md、lib/raw-text.js、lib/index.js）
- **`.doc` 支持**：**未检索到任何支持**。README 只述 ".docx documents"；解析入口 `unzip.openZip` 按 zip 打开，非 docx 抛 "Could not find main document part. Are you sure this is a valid .docx file?" / "are you sure this is a docx file?"。即 legacy 二进制 `.doc` 不支持。
  （https://github.com/mwilliamson/mammoth.js/blob/master/lib/unzip.js、lib/docx/docx-reader.js）
- **安全**：README 两处警告 "Mammoth performs no sanitisation of the source document" —— HTML 输出必须自行消毒。

### 接入建议与风险
- 建议：docx → 结构化用 `convertToHtml`（或 `convert` + styleMap 定标题映射），只取纯文本时才用 `extractRawText`；Markdown 需求应自建 HTML→Markdown 步骤（官方已弃用内置 markdown writer）。
- 风险：`.doc` 需另找转换途径（如 LibreOffice 转 docx 后再进 mammoth，或与 liteparse 的转换层复用）；HTML 输出必须消毒后进 contentEditable/编辑器；表格样式（边框等）信息不可恢复。

---

## 3. `xlsx`（SheetJS）

### 索引状态
- 调研前未索引；已执行 `scrape xlsx "https://docs.sheetjs.com/docs/" --max-pages 100 --max-depth 3`，成功 100 页。

### 关键 API 摘录
- **`sheet_to_json`**：`XLSX.utils.sheet_to_json(ws, opts)`；选项 `raw`（true=原始值/false=格式化字符串）、`range`、`header`（`1`=数组的数组 / `"A"`=列字母键 / 字符串数组=指定键 / 默认=首行做键并去重 `foo_1`）、`defval`、`blankrows`、`skipHidden`、`dateNF`、`UTC`。
  `header!==1` 时行对象带非枚举 `__rowNum__`。
  （https://docs.sheetjs.com/docs/api/utilities/array）
- **`sheet_to_csv`**：`XLSX.utils.sheet_to_csv(ws, opts)`，分隔符可配；流式版 `XLSX.stream.to_csv`。
  （https://docs.sheetjs.com/docs/api/utilities/csv、https://docs.sheetjs.com/docs/solutions/output）
- **合并单元格 `merge`**：
  - 存储：`ws["!merges"]` 为 range 对象数组（`{s:{c,r},e:{c,r}}`，可用 `XLSX.utils.decode_range("A1:B2")` 生成）；值存左上角单元格。
  - `read/readFile` 自动提取 merge 元数据；`sheet_to_html` 会生成 `colspan/rowspan`。
  - **`sheet_to_json` / `sheet_to_csv` 不支持合并区间**：导出包含被覆盖的单元格（covered cells 原样输出），行列还原需自己读 `!merges` 后处理。
  （https://docs.sheetjs.com/docs/csf/features/merges）
- **公式取值**：单元格 `f` 字段存公式串（A1 式、无前导 `=`、en-US），`v` 字段存**文件里缓存的计算值**；`sheet_to_json` 默认输出 `v`（`raw: true`）。**SheetJS 不计算公式**（"This library will not automatically compute formula results!"，计算器属 SheetJS Pro）；读取需 `XLSX.read(data, { cellFormula: true, ... })` 才保留公式串。
  （https://docs.sheetjs.com/docs/csf/features/formulae）
- **多 sheet 遍历**：`wb.SheetNames`（名字数组）+ `wb.Sheets[name]`（worksheet 对象），标准写法：
  `for (let name of wb.SheetNames) { const ws = wb.Sheets[name]; const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }); }`
  （https://docs.sheetjs.com/docs/getting-started/examples/loader）

### 接入建议与风险
- 建议：统一入口 `XLSX.read(buffer)` → 遍历 `SheetNames` → 每 sheet 用 `sheet_to_json(ws, { header: 1, defval: null })` 拿 AOA 做行列还原，再按 `ws["!merges"]` 自行展开/标注合并区；CSV 导出直接 `sheet_to_csv`。
- 建议：产物同时记录 `f`（公式串）与 `v`（缓存值），默认展示 `v`，避免无计算引擎时出现空值。
- 风险：合并单元格语义（colspan/rowspan）完全要自实现——直接 `sheet_to_json` 会把 covered cell 当普通数据，造成行列错位；重复表头列名会被自动改名（`foo_1`），做表头还原时要改用 `header: 1` AOA 模式。
- 风险：包来源——npm 上 `xlsx` 停更于 0.18.5，官方推荐 CDN/新渠道版本，需确认安装源与版本一致性。

---

## 4. 外部文章要点

> 检索方式说明：`crw search` 不可用（后端未配置）；`WebSearch` 本次返回空结果；DuckDuckGo/Google 网络不可达。
> 实际通过 `crw scrape` 抓取 GitHub 搜索页与 Bing 搜索页定位，再抓 README/文档原文取要点。

### 4.1 多格式文档统一解析与结构化产物设计（3 篇）

1. **Docling（IBM 开源）README** — https://github.com/docling-project/docling
   - 多格式解析（PDF/DOCX/PPTX/XLSX/HTML/EPUB/图片/LaTeX 等）收敛到统一的 **DoclingDocument** 表达格式，再由同一格式导出 Markdown/HTML/DocLang/DocTags/无损 JSON。
   - 要点：**「先统一中间表示，再多格式导出」**——各格式解析器只负责填充中间表示，导出端与解析端解耦；PDF 端补充版面/阅读顺序/表格结构等结构化信息。
2. **Microsoft MarkItDown README** — https://github.com/microsoft/markitdown
   - 面向 LLM 管线的多格式 → Markdown 工具（PDF/PPT/Word/Excel/图片/音频/HTML/CSV/JSON/EPUB/ZIP…），明确设计目标是「保结构而非高保真排版」（标题、列表、表格、链接）。
   - 要点：**产物定位为机器消费而非人眼还原**，Markdown 作为 token 高效的统一产物；提供分格式可选依赖与 `convert_*` 窄入口，并显著标注安全边界（进程权限 I/O，需清洗输入）。
3. **tokimo-package-fileparser README** — https://github.com/tokimo-lab/tokimo-package-fileparser
   - Pure-Rust 统一入口 `parse(input, out_dir)`，按扩展名分发 PDF/DOCX/XLSX/PPTX/DOC/XLS/CSV/TXT → Markdown + 图片落盘；产物按页/按 sheet/按 slide 切分为多文件，返回结构化 `ParseOutput { dir, files, tree }`（可序列化 JSON）。
   - 要点：**统一 API + 按天然分页单位切片 + 结构化返回值**，正好对应「7 格式统一解析层」的目录/产物组织方式；其 `.doc/.xls` 走 office_oxide IR，也说明 legacy 格式可在转换层统一。

### 4.2 Excel 表格结构化转 Markdown/CSV 的行列还原（3 篇）

1. **SheetJS 官方 Merges 文档** — https://docs.sheetjs.com/docs/csf/features/merges
   - 要点：合并信息独立在 `ws["!merges"]`，**`sheet_to_json`/`sheet_to_csv` 不支持合并区间且会输出 covered cells**；HTML 导出才原生给 colspan/rowspan；CSV 等不支持合并的格式会把区间内每个单元格都导出。行列还原必须自读 `!merges`。
2. **SheetJS 官方 Array Output（sheet_to_json）文档** — https://docs.sheetjs.com/docs/api/utilities/array
   - 要点：还原行列的推荐路径是 `header: 1` 拿 AOA（空行/空列行为与对象模式不同）；对象模式会自动去重表头、跳过 null、`raw` 控制取原始值还是格式化字符串——做「表格 → Markdown」时逐格语义应以 AOA + `defval: null` 为基准再拼管道符。
3. **obsidian-excel-to-markdown-table README** — https://github.com/ganesshkumar/obsidian-excel-to-markdown-table
   - 剪贴板 TSV（Excel/Sheets/Numbers/Calc 复制数据）→ Markdown 表格的成熟实现（粘贴/快捷键/命令面板三种入口，256 star），并引用了 vscode-excel-to-markdown-table（https://github.com/csholmq/vscode-excel-to-markdown-table，支持 `^[lcr]` 表头对齐标记、管道符转义、换行处理）。
   - 要点：这类工具的通行做法是**走剪贴板/TSV 层而非文件层**做「快速粘贴为 Markdown」，与本项目「解析文件产物」的定位不同，但其**转义规则（管道符、换行、对齐）**可直接借鉴到表格 → Markdown 的拼接器。

---

## 5. 遗留与未完成

- `crw search` 两个主题查询：**未完成**（后端缺失），已用 `crw scrape` 搜索页 + README 原文替代，结论可信度已标注来源。
- `LlamaParseReader.loadDataAsContent`：**未检索到**（liteparse 索引内无此 API）。
- mammoth 对 `.doc`：**未检索到支持证据**，反向证据为 zip-only 解析与 docx 专属报错。
- liteparse 站点文档（developers.llamaindex.ai）未索引，仅覆盖 GitHub 仓库。
