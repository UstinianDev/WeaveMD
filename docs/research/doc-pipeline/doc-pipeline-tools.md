# doc-pipeline 调研：Agent 文档工具集与 tool use 最佳实践

> 调研日期：2026-09-25 · 只读调研（未改业务代码）· 对应需求：`docs/requirements/doc-pipeline/doc-pipeline.req.md` 模块六-1
> （search/read_page/extract_table/analyze_chart 只读区 + concurrency 注册 + 陈旧工具名清理）
> 检索方式与不可达项见 §5。全文缓存于本机临时目录 `weavemd-doc-pipeline-research/`（未入仓库）。

## 1. 文档工具集的常见工具划分与 schema 设计

### 1.1 要点（均出自已抓取全文）

- **少而精、按任务划分，而非包一层 API**：Anthropic《Writing effective tools》指出常见错误是把现有
  API 端点直接包成工具；推荐 `search_contacts` 而非 `list_contacts`、`search_logs` 而非 `read_logs`、
  合并出 `get_customer_context`（一次拉齐客户相关信息）。工具可合并多步离散操作，同时减少中间输出
  占用的上下文；工具太多或功能重叠会让 agent 分心、选错工具。
- **命名空间与参数命名**：按服务/资源分组（`asana_search`、`asana_projects_search`），前缀 vs 后缀
  命名对工具选择评测有非平凡影响，应按自家评测选型；参数名必须无歧义（`user_id` 而非 `user`）。
- **返回高信号字段 + 可控详略**：优先 `name`/`image_url`/`file_type` 而非 `uuid`/`mime_type`；自然语言
  标识比随机 ID 显著降低检索幻觉；提供 `response_format: concise|detailed` 枚举，示例中 concise 约为
  detailed 的 1/3 token；返回结构（JSON/Markdown/XML）无普适最优，按评测定。
- **Schema 表达不了用法，要配示例**：《Introducing advanced tool use》（2025-11-24）的 Tool Use
  Examples——每个工具 1-5 个真实 `input_examples`（真实日期格式、ID 约定、参数组合），内部测试中复杂
  参数处理准确率 72%→90%；工具 description 里写清返回格式（利于程序化编排与解析）。
- **文档 QA 的检索形态**：《Multi-agent research system》对比静态 RAG（一次取相似 chunk）与多步
  动态搜索（迭代查询、评估结果、再收敛）；检索策略「先宽后窄」；委派子任务必须给全
  objective / 输出格式 / 工具与来源指引 / 任务边界，否则子代理重复劳动。《Context engineering》提出
  「just-in-time」：上下文里只保留轻量标识（文件路径、查询、链接），运行时用工具按需加载；混合策略 =
  少量预取保速度 + 自主探索补长尾。
- **实操参考**：Claude Code 内置工具各司其职（Read 读文件 / Grep 搜索内容 / Glob 按模式找文件 /
  WebFetch 抓取转 markdown / WebSearch 带配额检索）；crw CLI 也是同构划分（scrape/search/crawl/map/
  extract，`--extract <SCHEMA>` 做结构化抽取、`--fields` 做输出投影）。Anthropic cookbook
  `multimodal/reading_charts_graphs_powerpoints.ipynb` 给出图表问答要领：整页 PDF/视觉 + 文本问题、
  复杂图先让模型「逐一描述数据点」、算术易错应配计算器工具；`capabilities/retrieval_augmented_generation`
  为 RAG 官方教程；`multimodal/documents/` 提供年报/10-K 等带表 PDF 样例。
- **评测驱动**：工具优劣要用基于真实场景的任务集度量（总耗时、调用次数、总 token、工具错误率），
  避免过简的 sandbox 任务；坏 description 会把 agent 引向完全错误的路径（web search 工具曾因模型
  自行追加年份而劣化，靠改 description 修正）。

### 1.2 对本项目 toolRegistry（24 工具 = 5 核心全量 schema + 19 延迟 stub、字母序排序）的接入建议

1. **先划界再落地**：四个新工具全部只读，按合并原则评估与既有工具的边界并写进 description
   （何时用 `search` vs `searchKB`、何时用 `read_page` vs `readFile`/`readLocalFile`、何时用
   `analyze_folder`）——「人类都说不清该用哪个，模型更不行」是官方点名的失败模式。
2. **命名**：现有注册表 camelCase 与 snake_case 混用；文档工具集建议沿用需求文档命名
   （`search`/`read_page`/`extract_table`/`analyze_chart`）或统一加 `doc_` 前缀做命名空间
   （`doc_search`…），保证 name+description 可被工具检索准确命中（defer 机制依赖检索式发现）。
3. **schema 设计**：`extract_table` 必配 `input_examples`（合并单元格、跨页表、无框线表各一例）与
   返回格式说明；提供 `response_format: concise|detailed`；`search` 只回摘要字段（标题/页码/章节路径/
   分数），不回全文；`read_page` 支持 `page`/`offset` 范围参数（对应 Claude Code Read 的
   PARTIAL+range 模式）。
4. **工具集膨胀控制**：官方 defer 适用条件为「10+ 工具、定义 >10K tokens」，24→28 工具后依然成立；
   但新工具默认 `defer_loading: true`，仅当评测显示高频（官方建议「3-5 个最常用工具常驻」——本项目
   现有 5 核心正好）再提升为核心；若 `read_page(format=table)` 已能覆盖大部分抽取场景，可考虑不再单列
   `extract_table`（合并 vs 拆分的取舍在计划文档写明即可）。
5. **评测闭环**：按模块六-3 要求，为四工具建最小任务集（约 20 条即可起步，官方经验：小样本也能
   显出 prompt/工具改动的效应），度量检索命中、表格还原、页码溯源与降级路径。

## 2. tool use 缓存前缀稳定性与排序

### 2.1 要点

- **前缀 = system + tools，必须字节级稳定**：官方 cookbook `cost_optimization.ipynb` 明确「system
  prompt 与 tool schema 即 prefix」；只要前缀块不变，重处理只按 0.1× 计价。**最常见的破缓存原因**是
  system prompt 或 **tool description 里混入动态内容**（时间戳、request id、用户名）——「你看着一样，
  缓存键每次都不同，`cache_read` 恒为 0」；修法是保持静态前缀 byte-stable、把易变内容下移到断点之后。
- **计价与断点**：`misc/prompt_caching.ipynb`——写入 1.25×（news 页口径：+25%）、命中读取 0.1×；
  自动断点随对话前移，显式断点最多 4 个；TTL 默认 5 分钟（每次命中刷新），1h 档 2× 基价。
- **defer_loading 与缓存的关系**：《Advanced tool use》原文——Tool Search Tool 不破坏 prompt caching，
  因为延迟工具「完全排除在初始 prompt 之外」，system prompt 与核心工具定义保持可缓存；deferred 工具
  经检索后才展开为完整定义。官方分流建议：3-5 个最常用工具保持加载，其余 defer。
- **规模阈值**：Claude Code 文档——50 个工具定义可达 10-20K tokens；`ENABLE_TOOL_SEARCH=auto` 在可
  延迟定义达到上下文窗 10% 时启用（`auto:N` 可调）；内置核心（Bash/Read/Edit）始终全量；**少于约
  10 个工具时全量加载通常更快**。
- **未检索到**：官方对「tools 数组按字母序排序」的显式建议——未能访问
  platform.claude.com 的 tool-use/prompt-caching 文档页（地区封锁，见 §5）。字母序是本项目自身的选择
  （`defineCoreTools()` 用 `localeCompare` 排序，注释即为 S5/S7 缓存一致性）。由前缀匹配机制可推断
  （推论，非引文）：tools 数组中段插入/删除一个工具，会使其后的前缀全部失配，产生一次 1.25× 重写，
  TTL 内恢复命中。

### 2.2 对本项目 toolRegistry 的接入建议

1. **保持 `defineCoreTools()` 的确定性排序不动**：新工具加入 `CORE_TOOLS` 后自动进字母序；预期
   一次性前缀重写成本（会话早期、5 分钟 TTL），可接受。注意 `localeCompare` 依赖运行环境 locale——
   同进程内恒定即可满足会话内缓存；若追求跨环境字节一致，可改显式 `'en'` locale 或简单字节序比较
   （低风险改进，非必须）。
2. **stub 描述必须静态**：`getToolStub()` 只回 name+description——严禁在 description 里拼时间戳、
  文件数、会话 id 等动态值，否则整段前缀失效（官方点名的头号破缓存原因）。
3. **defer 分层对齐官方阈值**：28 工具（24+4）继续「5 核心全量 + 其余 stub」结构；四文档工具若评测
   显示为高频只读入口（尤其 `search`），可与 `searchKB` 一同评估进核心，但每次调整都会改前缀，
   应与功能版本一起一次性发布，避免频繁抖动。
4. **协议核对**：`anthropicClient.ts` 已在 system 末块带 `cache_control: {type:'ephemeral'}`
   （已核）；接入时确认四工具经 `buildToolListForPrompt()` 序列化后位于被缓存前缀内，且
   OpenAI 协议路径（`llmClient`）的缓存行为在实现阶段另行确认（本次未检索到项目内对应实现证据）。

## 3. 只读区与写区隔离范式

### 3.1 要点

- **监督 vs 围栏**：《How we contain Claude across products》（2026-05-25）——纯人工审批会疲劳
  （遥测：用户批准约 93% 的权限提示，看得越多越不专心）；更可靠的是「控制它**能**做什么」的
  containment（沙箱/VM/出口控制）。Claude Code 起步规则即「放行读，写/bash/网络需审批」；OS 级沙箱
  （读自由、写限工作区、默认断网）带来 84% 审批下降。关键句：**「只读 DB 权限的 agent 比能写生产的
  agent 部署面广得多」**；Claude Cowork 文件挂载三档 read-only / read-write / read-write-no-delete；
  symlink 解析必须先于路径校验；出口白名单也会被「经批准域名外传」绕过（api.anthropic.com 案例）——
  **外部内容一律视为不可信输入**（毒化 README 可直载进上下文）。
- **工具级只读清单**：Claude Code permissions 文档——内置只读命令集（ls/cat/echo/pwd/head/tail/
  grep/find/wc/which/diff/stat/du/cd 与只读 git 形态）在任何模式免审批；带重定向写目标要另查；
  解析不了的命令一律转审批；plan mode 只读探索。tools 文档——Read/Grep/Glob 工作区内默认不提示。
- **MCP 侧范式**：规范页（2025-06-18）——`annotations` 是「描述工具行为的可选属性」，客户端
  **MUST** 视为不可信（除非来自可信服务器）；《Writing tools》补充：tool annotations 用于披露
  工具是否需要 open-world 访问、是否具破坏性。**具体 hint 字段名未检索到**（抓取的规范页未列出）。
- **读写任务的评估差异**：《Multi-agent research》附录——只读研究任务可逐步评估，而会变更状态的
  agent 应做「终态评估」+ 离散检查点，而非逐 turn 挑错。
- **并发范式**：同文 §8——并行化两手抓：多子代理并行 + 单代理内 3+ 工具并行，复杂查询耗时最多降
  90%；《parallel_tools.ipynb》给出 batch/meta-tool 包装多次调用的变通式。
- **本项目现状**：`agentToolExecutor` 已实现「只读工具并行 + 有副作用工具串行」（S2，逐步以
  `concurrencyDefs.ts` 的 per-invocation `isToolConcurrencySafe` 替代静态集合）。

### 3.2 对本项目 toolRegistry 的接入建议

1. **四工具一律只读**：注册进 `READ_ONLY_TOOLS`，并在 `concurrencyDefs.ts` 标 `defaultSafe: true`
   （正好落在该文件「阶段 2 补全其余只读工具」的窗口内），获得并行执行；`WRITE_TOOLS`、
   `FORCE_CONFIRM_TOOLS` 不因本任务变动。
2. **只读 ≠ 免同意**：`analyze_chart`/文档解析若走 D 路线远程多模态，出境内容仍受铁律二
   （`allowSend` 外发闸）约束——「只读」只说明无本地副作用，不豁免知情同意；与模块八联动核对。
3. **陈旧工具名清理**（需求六-1）时，`READ_ONLY_TOOLS` / `WRITE_TOOLS` / `FORCE_CONFIRM_TOOLS` /
   `concurrencyDefs` / `handlerMap` / 系统提示词（`agentPromptBuilder`）五处需同一提交同步改名，
   避免出现「注册表有、集合无」的孤儿工具（权限与并发分类的静默失效点）。
4. **可加只读元数据**：仿 MCP annotations 在 `ToolDef` 上加 `readOnly?: boolean` 等项目自控字段并
   在注册时校验（不照抄 MCP 字段名——未检索到）；字段可直接驱动 concurrency 判定，取代散落的集合。
5. **入参边界**：`read_page` 的 URL/本地路径、`search` 的范围参数要做越界拦截；工具**返回内容**
   按 containment 教训视为不可信数据（不回灌为可执行指令、不因「来自工具」放宽校验）。

## 4. 结果预算与落盘降级

### 4.1 要点

- **Claude Code 的现行预算与落盘**（tools 文档，已核）：命令有效结果 inline ≈30,000 字符，超出则
  「写入会话目录的文件 + 截断 + 前 2,000 字符预览 + 返回路径」，模型按需再读/搜该文件；失败结果仅
  inline ≈10,000 字符的头尾摘录（不给路径）；命令输出 >5GB 被杀；`BASH_MAX_OUTPUT_LENGTH` 默认
  30k、上限 150k。Read 超 token 限返回「PARTIAL view」+ `offset`/`limit` 续读指引；Glob 结果 100
  文件封顶并带截断标记；WebSearch 每会话 200 次封顶，且返回「用已有信息继续」的提示而非报错
  （错误提示应引导而非诱导重试）。
- **截断与错误消息即引导**（《Writing tools》）：对可能膨胀的结果实现分页/范围/过滤/截断 + 合理
  默认值（文中提到 Claude Code 曾默认限制 25,000 token）；截断消息鼓励「多次小而准的检索」；错误
  响应要给出可操作的改正建议；`response_format` 控制详略。
- **落盘引用模式**：《Multi-agent research》附录——子代理把大产出写入文件系统、只回传轻量引用，
  避免「传话游戏」失真与 token 搬运；《Context engineering》——子代理只回 1-2K token 蒸馏摘要，
  JIT 用路径/链接作轻量标识，最轻的压缩手段是「清理深层历史中的工具结果」（平台
  context-management/记忆工具已产品化）。
- **中间结果彻底绕开上下文**：《Advanced tool use》Programmatic Tool Calling——代码编排中工具
  中间结果不进模型上下文（200KB→1KB 示例），复杂研究任务平均 token 降 37%；适用于只需聚合、
  多步依赖、过滤变换、并行批量的场景。
- **本项目现状（已核）**：`toolResultStorage.ts`（S6）——单结果 10,000 字符（≈2.5k tok）、单轮聚合
  40,000 字符（≈10k tok）、预览 500 字符；超限写 `userData/tool-results/` 不丢弃；`ContentReplacementState`
  保证同一 toolCallId 跨轮替换内容一致。另有 `knowledgeContext` token 预算截断、
  `agentPromptBuilder` 文档上下文 20k 字符截断。

### 4.2 对本项目 toolRegistry 的接入建议

1. **四工具统一走 S6**：`extract_table` 的大结果 JSON 落盘 → 返回「表头 + 前 N 行预览 + 文件路径 +
   恢复提示」；`search` 回 topK 摘要；`analyze_chart` 回结构化结论而非图面复述。S6 的 10k/40k 阈值
   已按 64k 窗口收紧，比 Claude Code 30k 更保守，保持不动。
2. **截断消息必须可操作**：形如「结果已落盘 <path>，用 page/offset 参数继续读取」——对齐官方
   「helpful truncation/error」原则，避免模型盲重试。
3. **`read_page` 分页化**：默认返回一页/一章节，超预算走 S6；配合 §1 的范围参数实现「先宽后窄」
   的检索式阅读。
4. **大表格的「轻量引用」**：表格落盘后仅以路径/`source_ref`（页码、章节、表格序号——需求二-6）传参，
   与 multi-agent artifact 模式一致，也直接服务模块六-2 的 citation 回链。
5. **批量只读可并行**：`search`/`read_page` 多调用在只读并行区执行（§3），预算按单轮聚合 40k 统一
   计，防止并行放大上下文占用。

## 5. 文章出处 URL

### 主题 A：Agent 工具化设计 / RAG 工具化 / 文档 QA 工具集

1. Writing effective tools for agents — with agents（2025-09-11）
   https://www.anthropic.com/engineering/writing-tools-for-agents （crw scrape 全文缓存）
2. How we built our multi-agent research system（2025-06-13）
   https://www.anthropic.com/engineering/multi-agent-research-system （全文缓存）
3. Effective context engineering for AI agents（2025-09-29）
   https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents （全文缓存）
   辅：Building effective agents（2024-12-19）https://www.anthropic.com/engineering/building-effective-agents
   辅：DataWhale All-in-RAG（中文 RAG 全栈指南，可达）https://datawhalechina.github.io/all-in-rag/
   辅：anthropics/claude-cookbooks `capabilities/retrieval_augmented_generation/`（README 已核）
   https://github.com/anthropics/claude-cookbooks/tree/main/capabilities/retrieval_augmented_generation

### 主题 B：Anthropic tool use 最佳实践

1. Introducing advanced tool use on the Claude Developer Platform（2025-11-24）
   https://www.anthropic.com/engineering/advanced-tool-use （全文缓存；defer_loading/工具检索/程序化调用/示例）
2. anthropics/claude-cookbooks — cost_optimization/cost_optimization.ipynb（缓存前缀稳定性关键引文出处）
   https://github.com/anthropics/claude-cookbooks/blob/main/cost_optimization/cost_optimization.ipynb
3. anthropics/claude-cookbooks — misc/prompt_caching.ipynb（断点/TTL/计价）
   https://github.com/anthropics/claude-cookbooks/blob/main/misc/prompt_caching.ipynb
   辅：Prompt caching with Claude（news 页）https://www.anthropic.com/news/prompt-caching
   辅：Claude Code Agent SDK Tool Search 文档 https://code.claude.com/docs/en/agent-sdk/tool-search
   辅：anthropics/courses `tool_use/`（官方工具使用课程，目录已核）
   https://github.com/anthropics/courses/tree/main/tool_use
   未检索到（URL 见被引文章但地区封锁）：platform.claude.com/docs/.../tool-use/implement-tool-use
   「best-practices-for-tool-definitions」与 prompt-caching 文档页正文。

### 主题 C：只读工具分区 / 并发执行

1. How we contain Claude across products（2026-05-25）
   https://www.anthropic.com/engineering/how-we-contain-claude （全文缓存；审批疲劳/沙箱/挂载三档）
2. Claude Code Tools 参考 https://code.claude.com/docs/en/tools （输出预算/截断/配额，全文缓存）
   与 Permissions 文档 https://code.claude.com/docs/en/permissions （内置只读命令集/plan mode，全文缓存）
3. MCP Tools 规范（2025-06-18）
   https://modelcontextprotocol.io/specification/2025-06-18/server/tools
   （annotations 概念与不可信要求已核；readOnlyHint 等具体字段名未检索到）
   辅：anthropics/claude-cookbooks `tool_use/parallel_tools.ipynb`（batch tool 并行模式，已核）
   https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/parallel_tools.ipynb

### 检索过程与不可达说明（如实记录）

- **`crw search` 不可用**：本地后端 127.0.0.1:8080 未配置；`crw setup --local --non-interactive`
  因需 Docker 而跳过后端（本机无 Docker）；公共 SearXNG（searx.be、searxng.site、
  search.inetol.net、searx.tiekoetter.com）全部超时；CRW Cloud 无 API key。
- **替代检索链路**：`crw scrape` 抓 cn.bing.com 搜索页（可用但算符失效、结果噪声大）、
  marginalia-search.com（可用）、context7 API（可用）、GitHub API（可用）。内置 WebSearch 工具
  4 次尝试均返回空结果，弃用。
- **文章获取**：`crw scrape -o` 逐篇缓存 + `crw crawl https://www.anthropic.com/engineering
  --depth 1 --limit 8` 建索引缓存（均落在临时目录，未写入仓库）。
- **不可达**：platform.claude.com / docs.claude.com / docs.anthropic.com（App unavailable in
  region）、web.archive.org、r.jina.ai、duckduckgo/startpage/brave（超时）、platform.openai.com
  （403）、mojeek（403 反爬）。
- **未检索到**：「工具按字母序排序」的官方建议；MCP tool annotation 的具体 hint 字段名；
  Anthropic tool-use best-practices 官方文档页正文（仅从被引链接确认其存在）。
