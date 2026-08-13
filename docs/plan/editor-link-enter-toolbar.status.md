# editor-link-enter-toolbar — 进度/分级状态

> 更新：2026-08-13 | 任务 slug：`editor-link-enter-toolbar`
> 工作流：/devflow-core（M 级，standard TDD；按用户指示全自动化执行）

## 阶段 0 — 任务分级与分类

**请求类型**：Bug 修复（4 个相关联的超链接体验缺陷）。

**跨模块判断**：不跨模块。全部落在「编辑主区 v2」渲染层 + 控制器（kernel inlineLexer 只读使用；toolbarState / FloatingToolbar / ToolbarButton / enterCtrl / formatCtrl / globals.css）。不涉权限/密钥/数据库/多端/Agent/Skill/MCP。

**定档**：**M**（半天内，单模块多子模块）。

**裁剪决定**：Bug → 复现测试 → 最小修复短路径；跳过完整 grilling（仅对 R4 做一次 AskUserQuestion 决策）；跳过技术调研（纯内部逻辑）；跳过规划智能体（范围清晰，自写 req/status）；实现直改（上下文完整）；TDD standard；全量门禁 + 合规 + 交付核对全走。

## 阶段 1 — 复现证据（Playwright 真实 Chromium，`link-editing-regression.spec.ts` 演进为回归）

| # | 用户现象 | 实测证据（修复前） |
| --- | --- | --- |
| R1 | 链接提示被代码块顶栏覆盖 | tooltip 区域 `elementFromPoint` 返回 `DIV.code-fence-header`（`topClass: code-fence-header, inHeader: true`）；根因 `a.inline-link:hover{opacity:.85}` 堆叠上下文 + `.code-fence-block{relative}` 后序 paint |
| R2 | 点击链接弹「块类型\|解链」 | 点击链接后 `.floating-toolbar-v2` count=1，trigger=正文（解链-only 形态） |
| R3 | 链接内回车损坏 | 回车后块文本 `["[12","3](baidu.com)"]` |
| R4 | 代码块内设链接不渲染 | code text 变 `"[const url = abc;](www.baidu.com)"`，`.code-fence-content a.inline-link` count=0 |

用户确认：R4 → **禁用代码块内行内格式**（工具栏置灰 + 控制器兜底）；R2 → 解链改由选中文本后操作。

## 阶段 3~5 — 实现（TDD standard）

**R1**：`globals.css` 给 `a.inline-link:hover` 补 `z-index: 1`——把 hover 链接（含 tooltip）抬升到 positioned(z-auto) 的代码块之上；同时新增 `.ft-btn:disabled{opacity:.35;cursor:not-allowed}` 供 R4 置灰。

**R2**：`toolbarState.computeToolbarState` 对折叠选区一律返回 `delay-hide`（不再因 inLink 显示）；`FloatingToolbar` 移除 `showUnlinkOnly` 分支。非折叠 inLink 左置 + 移除链接保留。

**R3**：`enterCtrl` 新增 `snapSplitOffset(text, offset)`（折叠光标严格落在 link token 内时吸附到 `token.end`），`splitAndFocusNewLeaf` 与 `enterInListItem` 共用。

**R4**：`FloatingToolbar` 在 `code-block` 下给 CHAR/OBJECT/橡皮擦按钮传 `disabled`；`ToolbarButton` disabled 时跳过 hover 效果；`formatCtrl.formatRange` 与 `insertImageFromSelection` 对 code-block 返回 null。

**测试**：`FloatingToolbarV2.test.tsx`（R4-2 更新为"折叠 inLink 不弹工具栏" + 新增 bug4 禁用断言）；`controllers.test.ts`（bug3 六例：label 后/中间/URL 中间回车吸附、边界不吸附、纯文本回归、列表项链接）；`formatCtrl.test.ts`（bug4 三例：link/bold/图片 对代码块 null）；E2E `link-editing-regression.spec.ts` 4 项 + `image-resize.spec.ts` R4·E5 更新。

## 阶段 6 — 全量质量门禁

| 门禁 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 error |
| `npx vitest run` | 49 files / **836 passed**（基线 821 + 新增 15） |
| `npm run lint` | 0 error（8 条存量 warning：useContentSync/useEditorActions，非本任务） |
| `npx vite build` | ✓（renderer + main + preload） |
| `npx playwright test` | **68 passed / 5 failed**（5 个失败均为**存量 drag-selection-markers「当前 RED」**，文件头已注明"预期 RED、只写复现"；另 1 个 `image-resize R4·E5` 因 R2 行为变更按新语义更新后通过） |
| `npm run build`（electron-builder） | ⚠ 环境阻塞：`better-sqlite3.node` 被运行中的 electron 进程锁定（EBUSY/EPERM），非代码问题；`vite build` 部分已通过 |

**E2E 变更**：新增 `link-editing-regression.spec.ts`（4 项：tooltip 层级/折叠不弹工具栏/回车不损坏/代码块禁用）；`image-resize.spec.ts` R4·E5 由"左置断言"改为"折叠 inLink 不弹工具栏"。

## 阶段 7 — 合规核对

- **代码 vs 需求**：逐条核对 REQ G1~G5，全部满足（G1 E2E tooltip 命中不再 inHeader；G2 E2E 折叠不弹；G3 单测+E2E 链接完整；G4 组件单测 disabled + 控制器单测 null；G5 全量门禁绿）。
- **代码 vs 规范（CONVENTIONS/SECURITY/WORKFLOW）**：无 `any`；命名规范；`formatCtrl` 守卫为纯防御（不削弱任何正常路径）；无 IPC/DB 改动；测试未删除（R4-2 / R4·E5 按行为变更更新为更严格语义）；CSS 注释记录根因与设计。
- **工作流自身**：docs 已同步（req/status + spec 9.6.1）；未跑 skill-comply（成本高，默认不做）。

## 阶段 8 — 交付核对

**变更清单核对**（对照 REQ §四）：全部在计划内（6 src + 4 测试文件 + 2 e2e + 2 文档）；临时 `repro-link-bugs.spec.ts` 已重命名为正式回归 `link-editing-regression.spec.ts`，临时截图已删。计划外改动：无。

**剩余风险 / 注意事项**：
- **N1（R2 行为变更）**：折叠光标在链接内不再有工具栏入口；解链需先选中链接文本。若用户期望右键菜单等其他解链入口，另立任务。
- **N2（R3 语义）**：链接内回车吸附到链接末尾 → 光标后的内容留在链接所在行（不把链接后半移行）。仅保证不损坏链接，未实现更复杂的"拆行"语义。
- **N3（存量）**：5 个 drag-selection-markers E2E 为已知 RED；electron-builder MSI icon 错误与 better-sqlite3 锁定为存量/环境问题。均未触碰。
- **N4**：`.ft-btn:disabled` 样式仅作用于 `.floating-toolbar-v2` 内（ImageToolbar 不含 disabled 按钮，不受影响）。

## 下一任务（建议）

- 修 drag-selection-markers 5 个已知 RED E2E（独立任务）。
- 或确认 R2 是否需要替代的解链入口（右键菜单等）（独立任务）。
