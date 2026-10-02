# doc-pipeline 调研笔记 — PDF 版面还原 + 远程多模态 D 路线 + 多模态消息协议

> 生成日期：2026-09-25｜只读调研，未改任何业务代码
> 一手来源：本地 docs-mcp 索引（pdfjs-dist 110 页 / anthropic-sdk 107 页）+ 源码直抓（pdf.js、anthropic-sdk-typescript、openai-openapi）+ arXiv API
> 检索方法与受限情况见 §5

## 1. pdfjs-dist：坐标结构与页面栅格化

### 1.1 `getTextContent()` 返回结构（源：`src/display/api.js` JSDoc typedef）

`page.getTextContent(params)` → `Promise<TextContent>`；另有流式 `streamTextContent()`（`TEXT_CONTENT_CHUNK_SIZE = 100`，按 items 条数分片）。

```ts
// getTextContentParameters
{ includeMarkedContent?: boolean;  // 默认 false；true 时 items 里混入 TextMarkedContent
  disableNormalization?: boolean } // 默认 false；false 时 worker 内做文本规范化

interface TextContent {
  items: Array<TextItem | TextMarkedContent>;
  styles: Record<TextStyle>;   // 按 fontName 索引
  lang: string | null;         // 文档 /Lang 属性
}

interface TextItem {
  str: string;                 // 文本内容
  dir: 'ttb' | 'ltr' | 'rtl';  // 文本方向
  transform: number[];         // 变换矩阵
  width: number;               // 设备空间宽度
  height: number;              // 设备空间高度
  fontName: string;            // pdf.js 转换后的字体名（对应 styles 键）
  hasEOL: boolean;             // 该文本后是否跟换行
}

interface TextMarkedContent {
  type: 'beginMarkedContent' | 'beginMarkedContentProps' | 'endMarkedContent';
  id: string;                  // 仅 beginMarkedContentProps 使用
}

interface TextStyle { ascent: number; descent: number; vertical: boolean; fontFamily: string }
```

补充注释（原文）：`getTextContent` 会把所有空白出现处替换为标准空格（0x20）。

### 1.2 坐标系与 viewport 变换

- 每页 viewport：`page.getViewport({ scale })`。官方 examples 注释：viewport 的初始变换矩阵计入 scale、rotation 与 **Y 轴翻转**——PDF 文档 (0,0) 在左下，canvas (0,0) 在左上。
- 官方 `examples/text-only/pdf2svg.mjs` 的坐标用法（可直接照抄）：

```js
const tx = pdfjsLib.Util.transform(
  pdfjsLib.Util.transform(viewport.transform, textItem.transform),
  [1, 0, 0, -1, 0, 0]   // 再翻转一次，使文本不倒置
);
const style = textContent.styles[textItem.fontName]; // 取 fontFamily
// tx 即设备空间矩阵；示例里配合 font-size:1px 使用
```

- 页面尺寸换算：`scale = 目标宽度 / viewport.width` 得到等比 scale（官方 examples 提供此公式）。
- **阅读顺序语义：官方 API 注释未声明 `items` 的排列顺序是否等于阅读顺序**（本次抓取到的注释只覆盖分片拼接逻辑）。阅读顺序还原（分栏、行聚类、跨页衔接）需以 `transform`/`width`/`height` 自行计算并实测验证 —— 未检索到官方结论。

### 1.3 页面栅格化 `page.render()`

`RenderParameters`（源同上）：

```ts
{ canvas?: HTMLCanvasElement | null;      // 推荐参数，与 canvasContext 二选一
  viewport: PageViewport;                  // 必填
  canvasContext?: CanvasRenderingContext2D;// 向后兼容
  intent?: 'display' | 'print' | 'any';    // 默认 'display'
  annotationMode?: number }                // AnnotationMode.DISABLE / ENABLE / ENABLE_FORMS ...
```

### 1.4 Node / Electron 主进程可行性（有官方一手证据，可行）

官方 Node 示例 `examples/node/pdf2png/pdf2png.mjs`（完整流程）：

```js
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const data = new Uint8Array(fs.readFileSync(pdfPath));
const loadingTask = getDocument({ data, cMapUrl, cMapPacked, standardFontDataUrl });
const pdfDocument = await loadingTask.promise;
const page = await pdfDocument.getPage(1);
const viewport = page.getViewport({ scale: 1.0 });
const canvasAndContext = pdfDocument.canvasFactory.create(viewport.width, viewport.height);
await page.render({ canvasContext: canvasAndContext.context, viewport }).promise;
const image = canvasAndContext.canvas.toBuffer("image/png"); // 写出 PNG
page.cleanup();
```

`src/display/node_utils.js`（GENERIC 构建）关键事实：

- `isNodeJS` 时：`NodeCanvasFactory extends BaseCanvasFactory`，`_createCanvas` 内部 `require("@napi-rs/canvas").createCanvas(width, height)`；并 polyfill `globalThis.DOMMatrix`、`globalThis.Path2D`、`navigator`；数据读取走 `fs/promises`。
- `src/display/api.js` 默认值随环境切换：
  - `CanvasFactory = src.CanvasFactory || (GENERIC && isNodeJS ? NodeCanvasFactory : DOMCanvasFactory)`（FilterFactory / BinaryDataFactory 同理）
  - `disableFontFace` 默认 `= isNodeJS`（Node 下 true）
  - `isOffscreenCanvasSupported` / `isImageDecoderSupported` 默认 `= !isNodeJS`（Node 下关闭）
  - `useSystemFonts` 默认 `= !isNodeJS && !disableFontFace`
- 运行时告警原文：`Please use the "legacy" build in Node.js environments.`

结论：Electron **主进程**（无 DOM）栅格化可行 —— 用 `pdfjs-dist/legacy/build/pdf.mjs` + `@napi-rs/canvas`（pdfjs 自动接线 NodeCanvasFactory），`canvas.toBuffer('image/png')` 拿 PNG buffer；备选是在 renderer 进程用 DOM canvas 渲染后回传。

## 2. 两套多模态协议消息格式对照

### 2.1 Anthropic（源：`anthropic-sdk-typescript` `src/resources/messages/messages.ts` main 分支，逐字提取）

图像块：

```ts
interface Base64ImageSource { type: 'base64'; media_type: 'image/jpeg'|'image/png'|'image/gif'|'image/webp'; data: string }
interface URLImageSource    { type: 'url'; url: string }
interface FileImageSource   { type: 'file'; file_id: string }
interface ImageBlockParam {
  type: 'image';
  source: Base64ImageSource | URLImageSource | FileImageSource;
  cache_control?: CacheControlEphemeral | null;
}
```

文档块（**原生 PDF 支持**）：

```ts
interface Base64PDFSource  { type: 'base64'; media_type: 'application/pdf'; data: string }
interface URLPDFSource     { type: 'url'; url: string }
interface FileDocumentSource { type: 'file'; file_id: string }
interface PlainTextSource  { media_type: 'text/plain'; /* …字段见源文件 */ }
interface ContentBlockSource { type: 'content'; content: string | Array /* TextBlockParam|ImageBlockParam */ }

interface DocumentBlockParam {
  type: 'document';
  source: Base64PDFSource | PlainTextSource | ContentBlockSource | URLPDFSource | FileDocumentSource;
  cache_control?: CacheControlEphemeral | null;
  citations?: CitationsConfigParam | null;
  context?: string | null;
  title?: string | null;
}
// 返回侧 DocumentBlock：{ type:'document'; source: Base64PDFSource|PlainTextSource;
//                        title: string|null; citations: CitationsConfig|null }
```

补充：`api.md` 索引中还有 `BetaBase64PDFBlock` / `BetaURLPDFSource`（beta 变体，同一文件族）。PDF 的页数/大小/模型支持等**官方限制数值未检索到**（docs 正文抓取失败，见 §5）。

### 2.2 OpenAI（源：`openai/openai-openapi` `openapi.yaml` master，逐字提取）

Chat Completions 图像 part：

```yaml
ChatCompletionRequestMessageContentPartImage:
  properties:
    type: { enum: [image_url] }
    image_url:
      type: object
      properties:
        url:   { type: string, format: uri,
                 description: Either a URL of the image or the base64 encoded image data. }
        detail: { type: string, enum: [auto, low, high], default: auto,
                  description: Specifies the detail level of the image… }
      required: [url]
  required: [type, image_url]
```

另一处 `MessageContentImageUrlObject` 说明：url 必须是受支持图像类型 `jpeg, jpg, png, gif, webp`；`low` 用更少 token，`high` 为高分辨率。

Chat Completions 文件 part（可传 base64 文件）：

```yaml
ChatCompletionRequestMessageContentPartFile:
  properties:
    type: { enum: [file] }
    file:
      properties:
        filename: { type: string }
        file_data: { type: string, description: The base64 encoded file data… }
        file_id:  { type: string, description: The ID of an uploaded file… }
      required: [file]     # filename / file_data / file_id 按需
```

另有旧式 `image_file` part：`{ type:'image_file', image_file:{ file_id, detail? } }`（file 上传后引用）。

Responses API（PDF 的另一条路）：

```yaml
{ type: "input_text", text: "what is in this file?" }
{ type: "input_file", file_url: "<pdf url>", detail: "auto" }   # 官方示例传 PDF
{ type: "input_image", image_url: "<image url>" }               # 图像直接字符串字段
```

### 2.3 对照表（供 `LlmMessage.content` 分流实现用）

| 维度 | Anthropic | OpenAI |
|---|---|---|
| 图像内容块 | `{type:'image', source:{type:'base64', media_type, data}}` | `{type:'image_url', image_url:{url, detail}}`，url 可为 base64 数据 |
| 图像 media_type | 显式枚举 jpeg/png/gif/webp | 不单独给 media_type，由 url 描述 |
| 分辨率/成本旋钮 | 无 detail 字段（本次在 SDK 类型中未检索到） | `detail: auto|low|high`，默认 auto，low 省 token |
| PDF 直传 | 原生 `{type:'document', source:{type:'base64', media_type:'application/pdf', data}}` | Chat 无 PDF document 块：走 `file` part（base64 file_data/file_id）或 Responses `input_file.file_url` |
| URL 传源 | image/pdf 均有 `type:'url'` source | image_url.url / input_file.file_url |
| 引用/元数据 | `citations` / `title` / `context` 字段 | 未见等价字段（本次检索范围内） |
| 上下文断点 | `cache_control`（可挂 document/image 块） | `prompt_cache_breakpoint`（挂在 part 上） |

## 3. 外部文章要点（四主题）

> 说明：`crw search` 后端不可用（§5），四主题改经 arXiv API + 官方源直抓 + `crw scrape` 获得；下列均为实际抓取到的标题/摘要要点。

### 3.1 PDF 版面阅读顺序还原与跨页表格合并算法

1. **LayoutReader: Pre-training of Text and Layout for Reading Order Detection**（arXiv 2108.11591）— 从 Word XML 元数据自动构造 ReadingBank：50 万文档图像的阅读顺序标注；用 seq2seq 同时吃文本与版面坐标做读序预测，接近完美，并显著改善开源/商用 OCR 引擎的文本行排序。启示：读序是"可学习/可规则化"的独立问题，不必依赖 LLM。
2. **PubTables-v2: A new large-scale dataset for full-page and multi-page table extraction**（arXiv 2512.10888）— 首个跨页（multi-page）表格提取基准，统一窄上下文→全页→全档多档任务；前沿 VLM 在全档多页任务上比小模型 GRI TS_Con 高 +0.354，窄上下文下差距可消失。启示：跨页表格合并要有专门评测口径。
3. **olmOCR**（arXiv 2502.18443）— 开源工具链把 PDF 转成"自然阅读顺序"的线性化纯文本，保留章节/表格/列表/公式；给出成本对照：GPT-4o 全托管超 6,240 USD/百万页。启示：本地版面还原的成本价值可直接引用该量级。

### 3.2 Anthropic Claude PDF Support 设计思路

1. **一手：SDK 协议本身**（§2.1）— 设计思路体现为：PDF 是 `document` 块而非 image 块，保留 `media_type:'application/pdf'` 原生类型 + `title`/`citations`/`context`/`cache_control`，即"文档作为可引用、可缓存的一等内容块"，与图像块解耦；同时保留 `content` 型 source（文本+图像块混合）作为中间形态。
2. **Claude 3 发布公告**（anthropic.com/news/claude-3-family，已抓取）— "Strong vision capabilities"：可处理照片、图表、技术图纸；明确动机是企业知识库中最多 50% 内容是 PDF/流程图/幻灯片格式。愿景定位是"视觉即输入模态"，而非先 OCR 再喂文本。
3. **官方 PDF 支持文档正文未检索到**：`docs.claude.com/en/docs/build-with-claude/pdf-support`（及其 platform.claude.com 变体）只抓到导航壳，页数/大小限制、支持模型列表等数值一律未写入本笔记。

### 3.3 多模态 RAG 文档解析最佳实践

1. **D-RAC: Document Retrieval-Aware Chunking**（arXiv 2609.24220）— 与本项目 D 路线最接近：先把任意格式**归一化为 PDF**（利用"几乎所有格式都有忠实确定的 PDF 渲染"），再用**单次多模态 LLM**把渲染页转成检索优化 Markdown：表格改写为自含散文语句、保留标题层级；之后确定性解析成 ID 可寻址单元 + LLM 只对 ID 做 chunk 规划，正文永不重新生成。实测 236 文档/795 页 72 分钟 0 错、1,748 chunk；相比 agentic chunking：输出 token -95.7%、成本 -77.8%~85.6%、时间 -75%，且线性扩展到 500+ 页。
2. **Vision-Guided Chunking Is All You Need**（arXiv 2506.16035）— 文本式切块难以处理复杂版面、**跨页表格**、嵌入图与跨页依赖；做法是 LMM 按可配置 page batch 处理 PDF、批间保持上下文以维持语义连贯，提升 chunk 质量与下游效果。启示：分页批次 + 跨批上下文是跨页合并的工程抓手。
3. **Ask in Any Modality: A Comprehensive Survey on Multimodal RAG**（arXiv 2502.08826）— 多模态 RAG 综述，系统梳理检索、融合、增强、生成及跨模态对齐难点（超出单模态 RAG 的部分），可作方案对齐的分类框架。

### 3.4 多模态对话消息与上下文压缩的工程设计

1. **EpiCache**（arXiv 2509.17396）— 长对话 KV cache 管理：block-wise 有界增长 + episodic 结构；指出**依赖查询的 eviction 会把 cache 语义窄化到单次查询，在多轮对话中产生失败案例**。启示：多模态消息压缩的丢弃策略要保留与查询无关的会话语义（对应 Q4"保留最近 N 张图"）。
2. **Structured Distillation for Personalized Agent Memory**（arXiv 2603.13017）— 每次交换压缩为四字段复合对象（exchange_core / specific_context / thematic room_assignments / regex 抽取的 files_touched），平均 371→38 token（11x），并用 201 条召回查询验证压缩后个性化召回是否存活。启示：压缩必须带"压缩后召回保持"的评测，而非只看 token 数。
3. **Are We Using the Right Benchmark: Visual Token Compression Evaluation**（arXiv 2510.07143）— 反直觉结论：**简单图像降采样在多个常用基准上胜过许多高级视觉 token 压缩方法**；现有基准并非为压缩任务设计（任务不匹配）。启示：多模态上下文压缩先试"降分辨率/detail=low"这类便宜手段，别急着上复杂方案。

## 4. 对本项目 D 路线的接入建议

对应需求：二-3 PDF 版面还原、二-4 D 路线兜底、二-6 溯源 metadata、五-1 content 数组两套协议分流、Q4 丢图策略（见 `docs/requirements/doc-pipeline/doc-pipeline.req.md`）。

1. **本地主路（二-3）**：`parseDocument` 的 PDF 分支用 `getTextContent()` 拿 `items`（`str/transform/width/height/dir/hasEOL/fontName`）+ `styles`，经 `viewport.transform` 换算到统一坐标系后做分栏与行聚类；`hasEOL` 可辅助行边界。**items 顺序语义官方未声明，先用样例 PDF 实测再定排序策略**（§1.2）。`items` 为空即判定"无文本层"，路由到 D 路线。
2. **栅格化（二-4 前置）**：主进程用 `pdfjs-dist/legacy/build/pdf.mjs` + `@napi-rs/canvas`（pdfjs 的 `NodeCanvasFactory` 自动接线），`canvasFactory.create()` → `page.render().promise` → `toBuffer('image/png')` 得页图（§1.4 官方示例可直接照抄）。需带 `cMapUrl`/`standardFontDataUrl`（CJK 必需）。备选：renderer 进程 DOM canvas 渲染回传。
3. **D 路线投递策略**：优先整份 PDF 原生直投 Anthropic（`document` 块 base64），比逐页截图省 token；OpenAI 侧 PDF 走 `file` part（`file_data` base64）或 Responses `input_file.file_url`，复杂版面/扫描页再降级为逐页 PNG + `image_url`（`detail:'low'` 控成本，直接覆盖二-4 的"token 成本覆盖"）。
4. **协议分流实现（五-1）**：`LlmMessage.content` 保持中立结构，出口层按 `backend==='remote'` 内的 provider 分支序列化——对照表见 §2.3；两套协议的枚举（media_type、detail）集中在一处常量表，禁止散落字符串。
5. **溯源（二-6）**：pdfjs 逐页产出页码/章节路径/表格序号 + `parseVersion`；栅格化的页图与 `source_ref` 页码一一绑定，保证 citation 回链（六-2）用真实页码。
6. **跨页表格（二-3）**：坐标检测出表格后按列 x 区间 + 跨页 y 边界拼接；工程上采用 Vision-Guided Chunking 的"可配置 page batch + 跨批上下文"思路，评测口径可参照 PubTables-v2 的 multi-page 指标。
7. **上下文压缩丢图（Q4）**：保留最近 3 张、更早图片降占位符——与 EpiCache"保持与查询无关语义"一致；压缩时优先 `detail:'low'`/缩略图（2510.07143 表明降采样常已足够），并按 Structured Distillation 的做法补"压缩后召回保持"测试。
8. **降级显式提示（二-4）**：远端无 vision/超限/失败时，UI 给出显式提示而非静默降级；`allowSend` 外发同意闸不因 D 路线放宽（八-1 红线）。

## 5. 检索方法与索引状态（如实记录）

| 项 | 状态 |
|---|---|
| `pdfjs-dist` 索引 | 本次新建，`scrape https://github.com/mozilla/pdf.js --max-pages 100 --max-depth 3` → 110 页 completed（Treesitter 对部分 JS 分块告警，已回退 TextContentSplitter，不影响结果） |
| `anthropic-sdk` 索引 | 本次新建，scrape anthropic-sdk-typescript → 107 页 completed；GitHub 索引未覆盖 `src/` 类型定义，改用 `crw scrape` raw 源码 + `gh api` 补齐 |
| `openai-api` 索引 | **索引内容无效**：search 命中的唯一页面是 Cloudflare 拦截页（"you have been blocked"）；已改用权威替代源 `openai/openai-openapi` 的 `openapi.yaml`（2.4 MB 全文抓取） |
| `crw search` | **不可用**：`crw doctor` 报 `search backend not configured`；无 Docker（`crw setup --local` 需 Docker 起 SearxNG）；试 4 个公共 SearxNG 实例全部超时 |
| 替代检索路径 | arXiv API（HTTPS）可用；`crw scrape` Bing 可用但中国出口结果噪音大（site:/引号限定失效）；Mojeek 403、DuckDuckGo 不可达；内置 WebSearch 两次返回空结果 |
| 未检索到（不编造） | ① Anthropic 官方 PDF 支持文档正文与限制数值；② pdfjs `items` 阅读顺序语义的官方表述；③ 中文站内（知乎/CSDN）版面还原工程文章 |
