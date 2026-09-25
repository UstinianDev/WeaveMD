# doc-pipeline 调研笔记：Markdown 智能分块（表格边界 / 超长表格 / 标题统领）

> 只读调研，未改业务代码。目标函数：`src/main/ai/knowledge/kbIndexer.ts` 的 `splitNote(content, { targetSize: 800, overlap: 80 })`。
> 调研日期：2026-09-25。

## 0. 检索方式与工具限制（影响可信度，先读）

- 任务指定的 `crw search` **本机不可用**：本地 SearXNG 后端未配置（`crw doctor` → search.reachability WARN，需 Docker，本机无 docker）、公共 SearXNG 实例（searx.be / search.inetol.net）超时、Cloud 无 API key、内置 WebSearch 无结果返回、DuckDuckGo/Brave/百度不可达、Bing 仅返回中文低质结果。
- 实际采用的替代检索面：**arXiv API（经 `crw scrape` 直抓，相关度排序）+ 权威站点直抓**（Anthropic、GFM 规范、LlamaIndex docs、GitHub 仓库页）。凡未覆盖的主题，下文明确写「未检索到」。
- `crw crawl` 深爬可选步骤已执行 1 次：`https://arxiv.org/html/2603.23533v2` → `%TEMP%/crw-cache/mdkeychunker.md`（41 KB，仓库外缓存）。

---

## 1. 表格边界识别算法

### 可落地要点

- **GFM 表格的最小判定条件**（`github.github.com/gfm` §Tables extension）：
  1. 表格 = 1 行表头 + 1 行分隔行（delimiter row）+ 0..n 行数据行；
  2. 分隔行单元格内容只能是 `-`，可带前/后 `:` 表示对齐；
  3. **表头行的单元格数必须等于分隔行，否则整段不被识别为表格**（Example 203）；数据行单元格数可以不齐（少则补空、多则截断，Example 204）；
  4. 单元格内的字面 `|` 必须 `\|` 转义（含行内 span 内）；单元格两侧空格 trim；
  5. **表格在第一个空行、或新块级结构开始处中断**（Example 201）。
  → 足以写一个 O(n) 行扫描状态机：`非空含 '|' 行` + 下一行匹配 `^\s*\|?(\s*:?-+:?\s*\|)+\s*$` → 表格开始；之后逐行并入，遇空行或不匹配的行结束。
- **MDKeyChunker（arXiv 2603.23533）**：块类型六类（header / code / table / list / blockquote / paragraph），每块记 type、raw、行区间、标题层级；**header stack**：遇层级 ℓ 的标题时弹出所有 ≥ℓ 的栈项再入栈，栈即「当前 section path」；**原子性约束**：表格（含表头行与分隔行）、围栏代码、列表项、引用块**永不跨 chunk 切分**；分组阈值 τmin=100 字符 / τmax=1500 字符。自评：18 文档 / 354 KB / 269 chunk，**0 次表格或代码被切开**，超 τmax 的 chunk 全部是无法再分的原子块（大表格、长代码）。
- **Adaptive Chunking（arXiv 2603.25333，LREC 2026）**：提出 5 个**无需 ground truth 的内禀指标**，其中 **Block Integrity (BI) = 结构块（段落/表格/列表）保持完整的比例**；其 `split-then-merge recursive splitter` 属默认方法之一。实测 BI：Adaptive 99.4 / LangChain recursive 95.0 / **semantic 91.3**；SC（尺寸合规）semantic 仅 48.1。下游：答案正确率 62–64% → 72%，答对题 49 → 65（33 文档 3 域，Wilcoxon p<0.05）。
- **Oil & Gas 实证（arXiv 2603.24556）**：4 策略（固定窗 / recursive / breakpoint semantic / **structure-aware**）对比，structure-aware 在 top-K 指标上最好且**计算成本显著低于 semantic**；文本型 RAG 对图表型文档（P&ID）整体失效。
- **语义分块的反面证据（arXiv 2410.13070）**：三任务系统评测结论 —— semantic chunking 的算力成本**换不来稳定收益**；arXiv 2607.01852 在学术长文档上同样发现 cluster-based semantic 分块**未跑赢** fixed-size / recursive。

### 对 `splitNote` 的具体改法建议

1. 增加**表格区间预扫描**（一次 O(n) 遍历，产出 `tableRanges: [start,end)[]`），`findBreakpoint` 外新增第三类断点：窗口内出现表格起始行时，切点至少推进到该表结束（前提：表长 ≤ targetSize）；表长 > targetSize 走第 2 节的行级切分 —— **禁止字符硬切表格**（对齐 BI 指标）。
2. 判定逻辑严格照 GFM：表头行单元格数 ≠ 分隔行单元格数 → 不算表格，按普通段落处理，避免把 `|` 散落的段落误判成表。
3. 现有 `HEADING_SEP = ['## ', '# ', '---']` 不覆盖 `### ` 及以下，建议改为 `/^#{1,6} /` 正则判定（与 header stack 配套）；断点优先级建议 `heading > table 起始 > 换行/字符`。
4. 落一条单测型不变式：**任意 chunk 不落在 table 区间内部**（BI 的最小化版本），并纳入 `npm run test`。

---

## 2. 超长表格切分与表头重复

### 可落地要点

- **STC：Structure-Aware Tabular Chunking（arXiv 2605.00318，2026-05）** —— 与本主题最贴合的一篇：
  1. **Row Tree**：每张表 = 根节点 + 行级节点；每行编码为 key-value 块，**并携带上下文 H（列头）**（Algorithm：`n_i ← key-value block of r_i with context H`）——即「每一小片都自带表头语义」；
  2. **token 约束的递归切分**沿结构边界下钻：节点满足 token 上限即保留为叶，否则拆到子节点；
  3. **Emergency Splitting**：单行自身超限时，按 **KV（单元格）边界**切，保证每片是完整字段而非半个单元格；
  4. **Greedy Merge**：同一父节点内相邻叶子顺序累加至 token 上限，**overlap-free**（明确论证：overlap 造成冗余 token 与重复计算）；
  5. 结果（MAUD，512 token 上限）：chunk 数较 recursive（带 100-token overlap）**-40%**、较 KV+recursive **-56%**；token 利用率 399–402/512；**BM25-only Recall@1 0.366 → 0.754**，hybrid MRR 0.3576 → 0.5945；速度显著更快。
- **MDKeyChunker**：表格整体作原子块，超 τmax 才允许切；实践中一次未切（见第 1 节）。
- **未检索到**：专门研究「markdown 超长表格按行切分后**重复表头行 + 分隔行**」的论文或可引证实验文章。「表头重复」在本次调研里只能作为 STC「每行携带列头上下文 H」在 markdown 语法上的等价实现（工程通用做法），**无直接实证出处**。

### 对 `splitNote` 的具体改法建议

1. 表格片格式：`<当前 heading 行>` + 表头行 + 分隔行 + 数据行子集；按行累积至 ≈ targetSize（800 字符）后开新片，**每片都重复表头行与分隔行**（markdown 语法上分隔行必须紧随表头行，否则不渲染为表）。
2. 单行超长（目标宽度很大的表）→ 按**单元格**切，片格式降级为「列名: 值」行式（STC 的 emergency split），保证列名不丢。
3. **表格片之间不施加 80 字符 overlap**：表头重复已承担语义衔接；STC 显示 overlap-free 在 BM25-only 上更准更省。非表格区仍保留现有 overlap 逻辑（`headed ? cut : cut - overlap`）。
4. 现有 `buildSourceRef` 用 `approxOffset / 60` 估行号，表格内误差大；表格片建议改按**真实行号**（扫描时累计 `\n` 计数）写 `source_ref.line`，否则「出处可跳转」在长表笔记上会偏。

---

## 3. 标题路径注入的检索收益证据

### 可落地要点

- **Anthropic《Introducing Contextual Retrieval》（2024-09-19）**：把**chunk-specific** 的说明性上下文（通常 50–100 token）前置到 chunk，再分别建 embedding 与 BM25 索引。指标 = 1 − recall@20（top-20 检索失败率），跨 code / fiction / arXiv / science 四域：
  - baseline **5.7%** → Contextual Embeddings **3.7%（−35%）** → + Contextual BM25 **2.9%（−49%）** → + Cohere rerank **1.9%（−67%）**；
  - 反面对照：**通用文档摘要前置「收益非常有限」**（引用 aclanthology W02-0405，原文 "we experimented and saw very limited gains"）；summary-based indexing（LlamaIndex）"low performance"；
  - 实施细节：Haiku 单次生成 50–100 token 上下文，prompt caching 后约 $1.02 / 百万文档 token；chunk size、边界、overlap 都影响结果，需按域调；**top-20 优于 top-10/5**；"Always run evals"。
- **MDKeyChunker**：header stack 产出的 `section_title` / section path 作为 chunk 的一等字段（输出 schema 中 `section_title` 来源 = Parser/header stack）；其 BM25 在结构化 chunk 上 Recall@5 = 1.000、MRR = 0.911（**仅 30 查询 / 18 文档，样本很小，只作方向参考**）。
- **金融元数据 RAG（arXiv 2510.24402，FinanceBench）**：多阶段消融结论 —— 最大收益来自「**把 metadata 与文本一起 embedding（contextual chunks）**」，reranker 负责精度；纯 pre-retrieval 过滤、路由等收益居中。
- **D-RAC（arXiv 2609.24220）**：文档→检索友好 markdown 转换阶段把「**保留标题层级**」「表格改写成自足语句」列为明确优化目标（方向性证据，未单独量化标题路径收益）。
- **未检索到**：**只注入标题路径、不加 LLM 生成上下文**的对照实验（即无法给出「heading path 单独贡献 X%」的量化数字）。这是本次调研最大的证据缺口。

### 对 `splitNote` 的具体改法建议

1. `splitNote` 内维护 header stack（遇 `#{1,6} ` 弹栈/入栈），为每个 chunk 计算 `headingPath`，例如 `产品说明 > 安装 > Windows`；**截到当前标题为止、不含文档标题**，长度硬上限 ~80 字符。
2. 落库时把 `headingPath` **前置进 `kb_chunks.content`**（FTS5 全列索引自动覆盖）并让 embedding 吃同一字符串 —— 对应 Anthropic 的 contextual embeddings + contextual BM25 双路；注意现有实现「跨标题切分时下一块以标题开头」只带**当前**标题，父级路径是纯增量信息，正是收益来源。
3. `NoteChunk` 增加 `headingPath` 字段，`buildSourceRef` 顺带写入（出处可跳转从「文件名+近似行」升级为「文件名+标题路径」）。
4. 若后续做 LLM 版上下文增强（Anthropic 式 50–100 token 摘要），属新依赖/新调用，**须先过人工确认**，本次不建议直接引入；纯规则的 heading path 注入零成本，先落地它。

---

## 4. 上下文前缀是否污染 BM25 的结论

### 结论（含证据强度）

1. **实测未见污染，反见收益**：Anthropic 把同一段前缀**同时**并入 BM25 索引（Contextual BM25），top-20 失败率 5.7% → 2.9%；即前缀进 FTS 索引是正向设计，而非规避手段。
2. **机制上 BM25 自带稀释保护**：BM25 基于 TF-IDF，含 TF 饱和与**文档长度归一化**、并按 IDF 加权（Anthropic 文中机制说明）——同一父级下所有子块共享的标题串，其 IDF 会被拉低，**兄弟块之间的相对排序基本不受前缀影响**；查询若命中该标题词，前缀反而是加分项。
3. **真实风险是「前缀过长/不含查询词」稀释 chunk 内有效词密度**（长度归一化惩罚 + 匹配词被摊薄），Anthropic 因此把上下文控制在 **50–100 token**，并用反例（通用摘要前置收益极有限）说明**前缀必须 chunk-specific**。
4. **未检索到**：专门量化「标题路径前缀拉低 BM25 / FTS5 排序」的实验文章；SQLite FTS5 官方文档（sqlite.org/fts5.html）本次抓取失败（返回 240 字节），**未取得原文**，故不引用其 bm25() 细节。
5. **检索评估方法要点**（主题 4 另一半）：
   - Anthropic：1 − recall@20，多域、top-5/10/20 三点对比，**改分块前先建 eval**；
   - Adaptive Chunking：无标注即可算的 5 内禀指标（RC / ICC / DCC / **BI** / SC）+ Wilcoxon 显著性；
   - HetDocQA（arXiv 2606.28367）：**chunker-agnostic span-overlap 相关性标签 + collection-disjoint 划分**；关键告警 —— **强 cross-encoder reranker 会吃掉大部分分块/检索改进**，加了它之后除 query expansion 与 SSCC 外均无可靠收益 → 评估必须固定（或分层报告）reranker；
   - arXiv 2607.01852：**RAGAs faithfulness 在该设置下可靠性有限**，不可作为唯一指标。

### 对 `splitNote` 的具体改法建议

1. 前缀长度硬上限 80 字符、不重复文档标题（文档标题已有独立召回通道 `titleMatchSearch` + RRF 融合，重复注入是纯冗余）。
2. 不要因为「怕污染」而只把 heading path 喂 embedding、不进 `content`：Anthropic 双路都有独立收益；FTS5 侧的 IDF 已能压低共享前缀。
3. 改动前后跑同一组离线对比（固定 20–30 个真实问题 + span 标签）：看 recall@5 / recall@20 / MRR，以及 top-k 重合率变化；同时加 BI 断言（表格/代码/列表不被切开）。**未做评估前不得声称提升**。
4. 若引入 reranker 再评估，须分层报告（有/无 reranker 两套数），否则会把分块改进抹平（HetDocQA 结论）。

---

## 5. 文章出处 URL

| 主题 | 出处 | 备注 |
| --- | --- | --- |
| 上下文前缀 / BM25 | https://www.anthropic.com/news/contextual-retrieval | 已抓全文，核心数字来源 |
| 表格语法判定 | https://github.github.com/gfm/#tables-extension- | 已抓 §Tables（Example 198–204） |
| 结构感知分块 / header stack | https://arxiv.org/abs/2603.23533 + https://arxiv.org/html/2603.23533v2 | MDKeyChunker，已抓 HTML 全文；repo: https://github.com/bhavik-mangla/MDKeyChunker |
| 内禀评估指标 / split-then-merge | https://arxiv.org/abs/2603.25333 + https://github.com/ekimetrics/adaptive-chunking | LREC 2026；**HTML 版不存在**，仅摘要+README |
| 表格化数据结构分块 | https://arxiv.org/abs/2605.00318 + https://arxiv.org/html/2605.00318v1 | STC，已抓全文（算法+数字） |
| structure-aware 实证 | https://arxiv.org/abs/2603.24556 | 摘要级 |
| semantic 分块反面证据 | https://arxiv.org/abs/2410.13070 | 摘要级 |
| 学术文档分块评估 | https://arxiv.org/abs/2607.01852 | 摘要级，含 RAGAs 可靠性告警 |
| 评估方法 / reranker 掩盖效应 | https://arxiv.org/abs/2606.28367 | HetDocQA，摘要级 |
| contextual chunks 收益 | https://arxiv.org/abs/2510.24402 | 摘要级 |
| 标题层级保留 | https://arxiv.org/abs/2609.24220 | D-RAC，摘要级 |
| 分块器实现参考 | https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/ | MarkdownNodeParser / CodeSplitter 等，已抓 |

**未检索到清单**：①「markdown 超长表格切分重复表头」的实证文章；②「仅注入标题路径」的对照实验；③「标题前缀损害 BM25/FTS5」的量化研究；④ SQLite FTS5 官方 BM25 文档原文（抓取失败）；⑤ Pinecone 分块系列（页面 JS 渲染，只拿到营销文案）；⑥ LangChain `MarkdownHeaderTextSplitter` 官方文档页（URL 已重定向到文档首页）。
