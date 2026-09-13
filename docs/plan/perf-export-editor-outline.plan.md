# 变更清单 + 执行计划 — perf-export-editor-outline

> /devflow-perf Phase 2 ｜ 2026-09-13 ｜ 分级 **M**（B 档：低风险速赢组 + 测量解锁候选）
> 铁律：相同输入 → 相同输出。零行为变更。白名单外零文件修改。

## 一、白名单（Phase 4 允许修改的完整文件列表）

### A 组：速赢（7 项，低风险，直接执行）

| ID | 文件 | 改法摘要 | 预估规模 | 测试覆盖 |
|----|------|----------|----------|----------|
| E1 | `src/render/editor/kernel/stateToMarkdown.ts` | `serializeCodeBlock` 内 `new RegExp(...)` 从每行 reduce 内提升到函数体开编译一次（markerChar 单块恒定） | 3 行 | `tests/editor/kernel/markdownRoundTrip.test.ts` ± 追加 fence 边界用例 |
| E2 | `src/render/editor/kernel/outline.ts:133-135` | `blockLineCount`：`serializeBlock(...).join('\n').split('\n').length` → 元素内 '\n' 直接计数（等价性：空数组 → 1） | 5 行 | `tests/editor/kernel/outline.test.ts`（扩展，新增等价断言） |
| E3 | `src/render/editor/editorInstance.ts:48-59` | `getMarkdown` 空文档判断：`Object.values().filter()` 全量数组分配 → 早退遍历（遇第 2 叶即停止） | 8 行 | `tests/editor/editorInstance.test.ts` |
| O1 | `src/render/hooks/useOutlineNavigation.ts:44-55` | 滚动检测：单一 `querySelectorAll('[data-block-id]')` → Map + 首个 `rect.top > detectLine` break（替代全量 forEach） | 15 行 | Playwright e2e 新增（jsdom rect 全零） |
| O2 | `src/render/components/Editor/panels/OutlinePanel.tsx` | ①:161 `(s)=>s.content` → `(s)=>s.content===''`（布尔化）②:318 内联箭头提取 ③ `export default React.memo(OutlinePanel)` | 5 行 | （纯类型/引用稳定化，回归由 e2e 覆盖） |
| O4 | `src/render/hooks/useOutlineNavigation.ts:54` | `onActiveHeadingChangeRef` 返回值 bail-out：ref 记录上次值，相同则跳过回调 | 3 行 | 同 O1 |
| X1 | `src/main/export/imageInline.ts:216-258` | 图片加载改为并发（cap 8）+ 结果按发生序回填 `replacements`（Map 语义一致）；同时保留每出现一次 fetches/readFile 数量（不去重） | 25 行 | `tests/main/export/imageInline.test.ts`（新增，mock IO 注入） |
| X2 | `src/main/export/exportService.ts:56-116` | `inlineMediaImages + buildExportHtml` 从开关前无条件执行移入非 `'md'` 分支 | 8 行 | `tests/main/export/exportService.test??`（var，新增或手测） |

### B 组：候选（仅当 microbench 数据达标后解锁，每项需先补基线测试）

| ID | 文件 | 改法 | 预估 | 解锁条件 | 新增测试 |
|----|------|------|------|----------|----------|
| E4 | `src/render/editor/kernel/stateToMarkdown.ts` + `useContentSync.ts` | WeakMap 引用缓存（体标识 + 子引用快照失效判定），`serializeBlock` 在未变子树上命中缓存 | ~60 行 | 100KB 文档击键路径 stateToMarkdown > 5ms | 往返模糊测试（1000 次随机替换往返，逐字节断言） |
| O3 | `EditorV2.tsx:75-80` + `useEditorActions.ts` + `outline.ts` | changedBlockIds 经 ref 透传给 `extractHeadingOutlineCached`；脏集合扩展祖先容器块 | ~30 行 | 100 标题文档格式击键 outline 重算 > 2ms | `tests/editor/kernel/outline.test.ts` 增量分支覆盖（新增"脏块+不变摘要相等"断言） |

### 明确不纳入白名单的文件（本轮不改）

- `blockTree.ts` 结构操作相关、`types.ts`（X3 IPC 契约）、`exportService.ts` offscreen 窗口复用（X6）、`OutlinePanel.tsx` 虚拟化（O5）
- X4 `imageInline.ts` 单次遍历 —— **经精读后确认无法安全实现**（IO 异步，同步收集/替换两趟已为最优），放弃

## 二、执行顺序

```
Step 0  — 基线门禁：npm run test + typecheck + lint + build（全绿才往下走）
Step 1  — 新建分支 feat/perf-export-editor-outline
Step 2  — 合成 fixture 生成器 + bench 脚本（scripts/perf/）
Step 3  — E1（围栏正则提升）→ 补 fence 边界用例 → 回归 → bench
Step 4  — E2（行数计算优化）→ 扩展 outline.test.ts 等价断言 → 回归 → bench
Step 5  — E3（getMarkdown 早退）→ 回归
Step 6  — O2（面板布尔+ memo）→ 回归
Step 7  — O1+O4（滚动检测）。同时补 e2e/perf-outline 测量
Step 8  — X2（md 跳过内联）→ 回归
Step 9  — X1（并发图片）→ 补基线测试 → 回归 → bench
Step 10 — 全量 bench → 速度对比表
Step 11 — 决策：E4/O3 达标？→ 若达标，补基线 → 动刀 → 回归 → bench
Step 12 — Phase 5.5 连通性 + Phase 6 全量门禁 + Phase 7 文档修正 + Phase 8 交付
```

每步 `git commit` 作为回滚点；任一步 `npm run test` exit ≠0 则 `git checkout <file>` 回滚该项并记录"已拒绝"。

## 三、速度对比表模板（待 Step 10 实测填入）

| 项目 | 改动前 | 改动后 | Δ% | 测量方式 |
|------|--------|--------|-----|----------|
| `stateToMarkdown` 全树（1000 块，5 代码块） | _TBD_ | _TBD_ | _TBD_ | vitest bench |
| `blockLineCount` 全量 outline（100 标题） | _TBD_ | _TBD_ | _TBD_ | vitest bench |
| `getMarkdown` 空文档（50× 迭代） | _TBD_ | _TBD_ | _TBD_ | vitest bench |
| 击键纯文本（100KB .md，50 击键） | _TBD_ | _TBD_ | _TBD_ | Playwright e2e |
| 导出 md 含 10 图（media:// 本地） | _TBD_ | _TBD_ | _TBD_ | vitest bench main-process |
| 导出 md 含 10 图（http remote mock） | _TBD_ | _TBD_ | _TBD_ | vitest bench main-process |

## 四、预期收益与风险总评

- **预期总收益**：击键路径 ~40-60%（E1+E2+E3+O2），滚动 ~50-100%（O1），大图导出 ~5-10×（X1 + X2）
- **剩余风险**：X1 并发度 cap 暂定 8（file handle 峰值可调，不回退语义）；O1 算法依赖文档序单调 → 已由 `editor-scroll-container` 纯垂直布局保证
- **行为不变证据链**：每项改动前 git log hash + 改动后 bench 数据对比 + 全量测试 exit 0