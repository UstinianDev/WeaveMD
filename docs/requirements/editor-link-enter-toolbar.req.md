# 超链接四项体验修复 — 需求

> 需求编号：REQ-EDIT-LINK-ENTER-TOOLBAR | 更新：2026-08-13
> 任务名：`editor-link-enter-toolbar` | 档位：M（standard TDD）
> 来源：/devflow-core，用户提交四问题 + 复现证据（Playwright 真实 Chromium）

## 一、需求清单（4 项）

| # | 需求 | 类型 | 现状（已核实） |
| --- | --- | --- | --- |
| R1 | 链接 hover 提示不被代码块顶部栏覆盖 | Bug | `a.inline-link:hover { opacity:0.85 }` 使 `<a>` 自身成为堆叠上下文，`::after` tooltip（z-index:50）被"困"在其中；`.code-fence-block`（Tailwind `relative`）同为 positioned(z-auto) 且 DOM 顺序更靠后 → paint 在链接之上。实测 tooltip 区域 `elementFromPoint` 返回 `DIV.code-fence-header` |
| R2 | 点击链接内容不再弹出「块类型 \| 解链」工具栏 | Bug | 折叠光标命中链接时 `computeToolbarState` 返回 show + `showUnlinkOnly` 渲染 [块类型\|解链]（R4「解链-only」形态） |
| R3 | 链接内容后回车不损坏链接格式 | Bug | `splitLeaf` 按 offset 朴素拆分：`[123](baidu.com)` 光标在 `123` 后回车 → 第一行 `[123`、第二行 `](baidu.com)`，链接损坏。实测 `["[12","3](baidu.com)"]` |
| R4 | 代码块内不提供/应用行内格式（含链接） | Bug | 代码块 raw 渲染，选中内容点链接 → 插入 `[text](url)` 字面量不渲染。实测 code text 变为 `"[const url = abc;](www.baidu.com)"`，link in code = 0 |

## 二、已对齐问题（grill-me / AskUserQuestion，用户已确认）

1. **R4 期望行为** → **禁用代码块内行内格式**：代码块内选中内容时，工具栏字符/对象格式按钮（加粗/链接/图片/橡皮擦等）全部禁用；块类型下拉保持可用（可转回正文/其他）。`formatCtrl.formatRange` / `insertImageFromSelection` 对代码块返回 null 兜底，杜绝「设置了却不渲染」。
2. **R2 解链入口** → 折叠光标点击链接不再弹工具栏；解链改由**选中链接文本**后经非折叠工具栏的「移除链接」完成（非折叠 inLink 工具栏保留）。

## 三、验收标准（G 判据）

- **G1（R1）**：hover 链接（其后紧接代码块）时 tooltip 浮于代码块顶栏之上；注入 `::after { pointer-events:auto }` 后 tooltip 区域 `elementFromPoint` 不再返回 `.code-fence-header`。
- **G2（R2）**：折叠光标在链接内 → `.floating-toolbar-v2` 不出现（`computeToolbarState` 对折叠选区一律 `delay-hide`）。
- **G3（R3）**：链接内任一位置回车 → `[label](url)` 完整保留在拆块后的第一段；不得出现 `[123` / `](baidu.com)` 残体。链接 token 边界回车不吸附（正常拆分）。
- **G4（R4）**：代码块内选中 → 工具栏加粗/链接/图片/橡皮擦按钮 `disabled`；`formatCtrl.formatRange`（bold/link）与 `insertImageFromSelection` 对代码块返回 null，代码文本不被污染。
- **G5（回归）**：非折叠 inLink 工具栏左置 + 移除链接按钮保留；`tsc` 0 error；`vitest` 全绿；`lint` 0 error；`vite build` ✓；E2E 全绿（存量 drag-selection-markers RED 除外）。

## 四、变更范围（预估文件）

- `src/render/styles/globals.css`（`a.inline-link:hover` z-index + `.ft-btn:disabled` 样式）
- `src/render/components/Editor/v2/toolbarState.ts`（折叠选区一律 delay-hide）
- `src/render/components/Editor/v2/FloatingToolbar.tsx`（移除 showUnlinkOnly；代码块禁用格式按钮）
- `src/render/components/Editor/v2/ToolbarButton.tsx`（disabled 跳过 hover 效果）
- `src/render/editor/controllers/enterCtrl.ts`（`snapSplitOffset` 拆块吸附）
- `src/render/editor/controllers/formatCtrl.ts`（代码块守卫）
- 测试：`tests/components/FloatingToolbarV2.test.tsx`（R4-2 更新 + bug4 新增）、`tests/components/toolbarState.test.ts`、`tests/editor/controllers/controllers.test.ts`（bug3 新增）、`tests/editor/controllers/formatCtrl.test.ts`（bug4 新增）、`e2e/link-editing-regression.spec.ts`（新增 4 项）、`e2e/image-resize.spec.ts`（R4·E5 按新行为更新）
- 文档：`docs/specs/floating-toolbar-ux-and-inline-format.md`（9.6.1 R4 更新）、`docs/plan/editor-link-enter-toolbar.*`

## 五、非目标（范围控制）

- 不改代码块纯文本渲染语义（代码块内不渲染行内 markdown）。
- 不改非折叠 inLink 工具栏（完整工具栏 + 移除链接保留）。
- 不处理 drag-selection-markers 存量 RED E2E、electron-builder MSI icon 存量问题。
- 不引入"链接内回车把光标后内容移行"的更复杂语义（仅保证链接不损坏，吸附到链接末尾）。
