# 性能瓶颈扫描报告 — 导出功能 / 编辑主区 / 目录区

> 任务：perf-export-editor-outline ｜ 分级：**M**（1-3 模块，半天目标）
> 铁律：只允许「相同输入 → 相同输出」的纯提速改动
> 扫描方式：导出/目录区 = 并行子代理扫描（因 agent 通道 403 中断过一次，已重试成功）；编辑主区 = 总指挥逐文件直扫（子代理配额持续 403）
> 规则库：perf-rules-core G01-G10 ｜ perf-rules-frontend F01-F10 ｜ perf-rules-backend B01-B11
> 日期：2026-09-13

## 已验证存在的既有优化（勿重复提议）

- tokenizeInline LRU(256) inlineLexer.ts:525-579 ✓；syntaxRange 单槽缓存 syntaxType.ts:45-122 ✓
- 文本编辑路径精准克隆 setBlockText/setInlineHtml（blockTree.ts:536-567）✓（**仅文本路径**，见 E5）
- 全部块组件 React.memo ✓；EditorScrollContainer memo 在纯打字时 props 稳定可挡住子树 ✓
- FloatingToolbar selectionchange 已 rAF 节流（createRafThrottle）✓；scroll/resize 监听器清理齐全（G02 未发现泄漏）✓
- outline 增量缓存**数据结构**已落地（outline.ts:58-104）但生产未接线（见 O3）

---

## 一、编辑主区（编辑器热路径：击键/回车/格式/转换）

数据流：击键 → ContentBlock.syncDomToModel → inputCtrl(仅脏块 setBlockTextAndRender) → needRender 时 setTree → **syncContent 每次必调** → getMarkdown() **全树序列化** → editorStore.content → 订阅者重渲染；tree 变化时 outline useMemo 全量重算。

| # | file:line | 规则 | 严重度 | 证据 | 建议优化（纯提速） | 预期提升 | 风险 |
|---|-----------|------|--------|------|--------------------|----------|------|
| E1 | src/render/editor/kernel/stateToMarkdown.ts:76-81 | G04/G06 | **高** | `text.split('\n').reduce((max,line)=>{const m=line.match(new RegExp(...))}` —— 围栏正则**每行编译一次**；全树每次击键都序列化（经 syncContent） | 正则提升到循环外每块编译一次（markerChar 每块恒定，输出逐字节一致） | 大代码块文档每击键省 O(行数) 次 RegExp 编译 | 低 |
| E2 | src/render/editor/kernel/outline.ts:133-135 | G06 | **高** | `serializeBlock(...).join('\n').split('\n').length` —— 行数计算先拼全文再拆（两次全文分配） | 改按数组元素累加换行数（保留 `arr.length===0 → 1` 边界语义与 join('\n') 完全一致） | outline 全量重算省 ~2 次全文字符串分配/块 | 低（需等价性单测锁边界） |
| E3 | src/render/editor/editorInstance.ts:50 | F08/G06 | 中 | `Object.values(this.tree.blocks).filter(b=>b.text!==null)` 每次击键分配全块数组，仅为判断"是否空文档" | 早退式遍历：遇到第 2 个叶块即 false（结果集与原逻辑一致） | 每击键省 O(块数) 次数组分配 | 低 |
| E4 | src/render/hooks/useContentSync.ts:42-46 + useEditorActions.ts:121 | G06 | 中偏高 | 纯文本击键（needRender=false）仍走全树 stateToMarkdown + onContentChange | **候选**：按块引用身份缓存序列化行（WeakMap，容器块存子引用快照做失效校验），失效判定 O(指针比较) 替代 O(全文) 字符串操作 | 大文档每击键序列化降至近常数 | **中**（失效逻辑错误→输出漂移；须先补往返模糊测试基线） |
| E5 | src/render/editor/kernel/blockTree.ts:302-308 | G06 | 中 | `cloneTree` 对**全部块** cloneNode；结构性操作（Enter/退格合并/转换/删除）每次全树克隆 | **候选**：仅克隆受影响路径（脏节点集 + 邻接链 prev/next 涉及块）；不可变语义不变 | 大文档结构操作 O(块数)浅拷贝 → O(1) | 中（链表不变式复杂；需块树不变式测试守护） |
| E6 | （核对项，非瓶颈） | — | — | FloatingToolbar/selection 已 rAF；ContentBlock memo 已包；renderInlineAll 仅 setContent 调用 | 无需改动 | — | — |

**文档-实现不一致（需同步修正文档，不改行为）**：CLAUDE.md "cloneTree 精准化" 实际仅覆盖 setBlockText/setInlineHtml 文本路径；结构性操作仍全量克隆。

## 二、目录区（滚动/高亮/面板渲染）

| # | file:line | 规则 | 严重度 | 证据 | 建议优化 | 预期提升 | 风险 |
|---|-----------|------|--------|------|----------|----------|------|
| O1 | src/render/hooks/useOutlineNavigation.ts:48-53 | G03/G07 | **高** | scroll 事件内 `outline.forEach` → 每标题 `querySelector + getBoundingClientRect`（O(标题数) 强制布局，~60Hz） | ① 单次 `querySelectorAll('[data-block-id]')` 建 Map；② outline 文档序单调 → 首个 `top > detectLine` 即 break（与原"取最后一个≤"等价） | 滚动热路径 O(N) DOM 测量 → 每帧 ≤1 布局读取 | 低（高亮结果逐点一致；不加 rAF 合帧，时机不变） |
| O2 | src/render/components/Editor/panels/OutlinePanel.tsx:161→:307 | F01/F08 | 中 | `useEditorStore(s=>s.content)` 订阅全文字符串但只用于空态布尔 → 每击键面板全树重渲染 | 选择器布尔化 `(s)=>s.content===''`（原始值比较）+ 组件包 React.memo + 内联 onNavigate 提为 useCallback | 普通打字时面板 0 重渲染 | 低 |
| O3 | src/render/components/Editor/v2/EditorV2.tsx:75-80 | G06 | 中 | `extractHeadingOutlineCached(tree, cache, null)` 脏标记 API 已就绪未接线 → 每次 setTree 全量 serializeBlock | **候选**：把 `result.changedBlockIds` 经 ref 透传；脏集合须扩展"脏块+全部祖先容器"（容器行号由后代决定） | 格式类击键 outline 重算降至脏子树 | **中偏高**（行号级联错误风险；增量分支现无测试覆盖，须先补基线） |
| O4 | useOutlineNavigation.ts:54 + MainPage.tsx:113 | F01 | 低中 | 每 scroll 事件无条件回调 `setActiveHeadingIndex`，index 未变也进 React 调度 | hook 内 ref 记录上次值，相等则跳过调用（输出一致） | 消除滚动期无效 render pass | 低 |
| O5 | （核对项）OutlinePanel:311-324 | F02 | 低 | 无虚拟化 | 现状可接受，**不立项**（虚拟列表改动行为面大） | — | — |

**文档-实现不一致**：CLAUDE.md 宣称的 "outline 脏标记" 优化实为"数据结构就绪、生产路径未启用"（EditorV2.tsx:76 注释自认）。

## 三、导出功能（点导出 → 序列化 → IPC → 主进程渲染/落盘）

调用链：ExportMenu → useNavbarActions.handleExport（flushEditorDraft + 全量 renderMarkdownToHtml）→ IPC 传 {content, html} → exportService.exportFile → inlineMediaImages（**串行**逐图 IO）→ buildExportHtml → fs 写入 / offscreen 渲染 capturePage / docx JSZip 重压缩。

| # | file:line | 规则 | 严重度 | 证据 | 建议优化 | 预期提升 | 风险 |
|---|-----------|------|--------|------|----------|----------|------|
| X1 | src/main/export/imageInline.ts:216-259 | G05/B05 | **高** | `for (const src of imgSrcs) { await readFile... await applyDownsample }` 串行逐图 | 并发读+降采样（限并发度），**结果仍按原顺序**回填替换（输出逐字节一致；fetch 失败的静默语义保留） | 多图笔记导出 O(n×图) → O(max)，5-10× | 低-中（错误传播语义需单测锁） |
| X2 | src/main/export/exportService.ts:76-79 | B07/G04 | 中 | `inlineMediaImages` 无条件执行，但 `case 'md'` 只用 req.content | 图片内联移入非 md 分支（md 输出完全不变） | 含图笔记 md 导出省全部图 IO | 低 |
| X3 | src/render/hooks/useNavbarActions.ts:284-293 | B07 | 中 | content+html 同时跨 IPC 传输（结构化克隆大 payload） | **候选**：按 format 只传所需字段（改 ExportRequest 契约 + preload 类型） | IPC 克隆字节减半 | 中（跨模块契约，Phase 5.5 连通性必验） |
| X4 | src/main/export/imageInline.ts:284 | B08 | 低 | replace 整份含 base64 的中间串 | 收集+替换合并单趟 | 省一次全文拷贝/GC 峰值 | 低 |
| X5 | src/main/export/exportService.ts:213-217 | B08 | 低 | JSZip level-6 全量重压缩 docx | **备选**：media 条目透传原压缩 | docx 导出省重压缩 | 中（jszip 逐条目 API；建议本轮不动） |
| X6 | exportService.ts:230-240 | G02 | — | offscreen 窗口每次新建+finally destroy，清理正确 | **不立项**（复用窗口改变生命周期时序，违反铁律） | — | — |

## 跨模块 Top 排序（按严重程度 × 热路径频率）

1. **O1** 滚动高亮 O(N) DOM 测量（~60Hz 事件，唯一每帧热点）
2. **E1+E2** 全树序列化每击键执行 + 围栏正则逐行编译（击键路径常数因子大头）
3. **X1** 导出图片串行 IO（用户可感知的导出延迟主因）
4. **O2+E3+X2+O4** 低风险速赢组（各一处小改动）
5. **E4 / O3 / X3 / E5** 中风险候选组（须先补基线测试，由 grill-me 决定是否纳入本轮）
